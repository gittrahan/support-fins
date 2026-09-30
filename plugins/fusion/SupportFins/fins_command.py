"""The *Insert Support Fins* command: pick the print bed and the part, and the
website's breakaway fins (overhang ribs with a comb of one-layer tines, and a
bed pad where the part barely touches the plate) appear in a 'Supports' component.

The geometry is the printfins.com engine itself, run by Fusion's own browser in
a hidden palette (engine_host.py), so Fusion places the same fins the site would.

The engine answers asynchronously: a change in the dialog queues a job and the
readout says it is computing; when the palette posts the fins back, a custom
event refreshes the readout and re-runs the preview (doExecutePreview), since
no dialog input changed to make Fusion do it.
"""

import traceback

import adsk.core
import adsk.fusion

from . import engine_host
from . import fusion_bridge as fb
from . import settings_store
from .fins_core import shells

CMD_ID = 'SupportFins_InsertSupportFins'
CMD_NAME = 'Insert Support Fins'
CMD_TIP = ('Add printfins.com breakaway support fins under the part’s overhangs: upside-down-T '
           'walls gripped by one-layer tines, plus a bed pad where the part barely touches the '
           'plate. Export the part and the Supports bodies together for slicing.')
WORKSPACE_ID = 'FusionSolidEnvironment'
PANEL_ID = 'SolidCreatePanel'
RESOURCES = 'resources/SupportFins'

STYLES = (('Auto (props + bracing if it would topple)', 'auto'),
          ('Props only', 'prop'),
          ('Stabilize (bracing fins)', 'stabilize'))

PLA_DENSITY = 1.24      # g/cm^3, for the readout's rough weight
RESULT_EVENT = 'SupportFins_EngineResult'

_app = None
_ui = None
_handlers = []
_session = {}
ENGINE = None           # engine_host.PaletteEngine in Fusion; the tests swap in their own
_result_event = None


def _version():
    import json
    import os
    try:
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'SupportFins.manifest')
        with open(path, encoding='utf-8') as fh:
            return json.load(fh).get('version', '?')
    except (OSError, ValueError):
        return '?'


VERSION = _version()


def start(app, ui):
    global _app, _ui, ENGINE, _result_event
    _app, _ui = app, ui
    # open the engine's palette now, so it has loaded by the first click
    ENGINE = engine_host.PaletteEngine(ui, log=_log)
    ENGINE.start()
    try:
        _result_event = app.registerCustomEvent(RESULT_EVENT)
        on_result = _ResultEventHandler()
        _result_event.add(on_result)
        _handlers.append(on_result)
    except Exception:
        _result_event = None        # _engine_done falls back to refreshing in place
    defs = ui.commandDefinitions
    cmd_def = defs.itemById(CMD_ID)
    if cmd_def:
        cmd_def.deleteMe()
    cmd_def = defs.addButtonDefinition(CMD_ID, CMD_NAME, '%s (v%s)' % (CMD_TIP, VERSION),
                                       _resource_path())
    on_created = _CreatedHandler()
    cmd_def.commandCreated.add(on_created)
    _handlers.append(on_created)

    panel = ui.workspaces.itemById(WORKSPACE_ID).toolbarPanels.itemById(PANEL_ID)
    if not panel.controls.itemById(CMD_ID):
        panel.controls.addCommand(cmd_def)


def stop(ui):
    global ENGINE, _result_event
    try:
        if ENGINE is not None:
            ENGINE.stop()
            ENGINE = None
        if _result_event is not None:
            try:
                _app.unregisterCustomEvent(RESULT_EVENT)
            except Exception:
                pass
            _result_event = None
        panel = ui.workspaces.itemById(WORKSPACE_ID).toolbarPanels.itemById(PANEL_ID)
        ctrl = panel.controls.itemById(CMD_ID)
        if ctrl:
            ctrl.deleteMe()
        cmd_def = ui.commandDefinitions.itemById(CMD_ID)
        if cmd_def:
            cmd_def.deleteMe()
    finally:
        _handlers.clear()


def _resource_path():
    import os
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), RESOURCES)


def _log(msg):
    try:
        _app.log(msg)
    except Exception:
        pass


def _report(where):
    if _ui:
        _ui.messageBox('Support Fins — %s failed:\n%s' % (where, traceback.format_exc()))


# --------------------------------------------------------------------------
# Dialog
# --------------------------------------------------------------------------

class _CreatedHandler(adsk.core.CommandCreatedEventHandler):
    def notify(self, args):
        try:
            _session.clear()
            design = adsk.fusion.Design.cast(_app.activeProduct)
            _session['earlier'] = fb.existing_fin_count(design) if design else 0
            _session['engine_error'] = ENGINE.problem() if ENGINE else 'The fin engine isn’t running.'
            _session['command'] = args.command
            if ENGINE:
                ENGINE.active = True

            s = settings_store.load()
            cmd = args.command
            cmd.okButtonText = 'Insert'
            inputs = cmd.commandInputs

            bed = inputs.addSelectionInput('bed', 'Print bed',
                                           'The face the part sits on, a plane on the bed, or the '
                                           'part itself (it stands as modelled, on its lowest point)')
            bed.addSelectionFilter('PlanarFaces')
            bed.addSelectionFilter('ConstructionPlanes')
            bed.addSelectionFilter('SolidBodies')
            bed.addSelectionFilter('MeshBodies')
            bed.setSelectionLimits(1, 1)

            body = inputs.addSelectionInput('body', 'Part',
                                            'The body to support (defaults to the bed face’s body, '
                                            'or the design’s only body)')
            body.addSelectionFilter('SolidBodies')
            body.addSelectionFilter('MeshBodies')
            body.setSelectionLimits(0, 1)

            grp = inputs.addGroupCommandInput('settings', 'Settings')
            grp.isExpanded = True
            g = grp.children
            style = g.addDropDownCommandInput('style', 'Fin style',
                                              adsk.core.DropDownStyles.TextListDropDownStyle)
            known = s['fin_style'] if s['fin_style'] in [k for _, k in STYLES] else 'auto'
            for label, key in STYLES:
                style.listItems.add(label, key == known)
            g.addValueInput('layer', 'Layer height', 'mm',
                            adsk.core.ValueInput.createByString('%g mm' % s['layer_height']))
            g.addBoolValueInput('tines', 'Tines', True, '', bool(s['fin_tines']))
            g.addIntegerSliderCommandInput('density', 'Tine density %', 0, 100, False
                                           ).valueOne = int(s['fin_tine_density'])
            g.addIntegerSliderCommandInput('coverage', 'Wide-face coverage %', 0, 100, False
                                           ).valueOne = int(s['fin_coverage'])
            g.addBoolValueInput('pad', 'Bed pad', True, '', bool(s['fin_bed_pad']))
            # Sway braces: a different job from the fins above -- they hold a TALL
            # part's sides against drift and wobble, not an overhang -- so they get
            # their own group, and their settings only matter while they are on.
            sgrp = inputs.addGroupCommandInput('sway', 'Sway braces (tall parts)')
            sgrp.isExpanded = bool(s['sway_braces'])
            sg = sgrp.children
            sg.addBoolValueInput('braces', 'Add sway braces', True, '', bool(s['sway_braces']))
            sg.addValueInput('sway_from', 'Grip from', 'mm',
                             adsk.core.ValueInput.createByString('%g mm' % s['sway_grip_from']))
            sg.addValueInput('sway_spacing', 'Brace tine spacing', 'mm',
                             adsk.core.ValueInput.createByString('%g mm' % s['sway_tine_spacing']))
            sg.addIntegerSliderCommandInput('sway_depth', 'Brace depth %', 5, 50, False
                                            ).valueOne = int(s['sway_depth'])

            ro = inputs.addTextBoxCommandInput('readout', '', 'Pick the print bed.'
                                               '<br><i>Support Fins v%s</i>' % VERSION, 7, True)
            ro.isFullWidth = True
            _sync(inputs)

            for event, handler in ((cmd.inputChanged, _InputChangedHandler()),
                                   (cmd.validateInputs, _ValidateHandler()),
                                   (cmd.executePreview, _PreviewHandler()),
                                   (cmd.execute, _ExecuteHandler()),
                                   (cmd.destroy, _DestroyHandler()),
                                   (cmd.activate, _ActivateHandler())):
                event.add(handler)
                _handlers.append(handler)
        except Exception:
            _report('opening the dialog')


def _style(inputs):
    sel = inputs.itemById('style').selectedItem
    if sel is None:
        return 'auto'
    return next((k for l, k in STYLES if l == sel.name), 'auto')


def _sync(inputs):
    inputs.itemById('density').isEnabled = inputs.itemById('tines').value
    on = inputs.itemById('braces').value
    # as on the site: grip-from and spacing place brace TINES, so they need Tines too
    tines = inputs.itemById('tines').value
    inputs.itemById('sway_from').isEnabled = on and tines
    inputs.itemById('sway_spacing').isEnabled = on and tines
    inputs.itemById('sway_depth').isEnabled = on


def _settings(inputs):
    return {
        'fin_style': _style(inputs),
        'layer_height': round(inputs.itemById('layer').value * fb.MM_PER_CM, 4),
        'fin_tines': inputs.itemById('tines').value,
        'fin_tine_density': inputs.itemById('density').valueOne,
        'fin_coverage': inputs.itemById('coverage').valueOne,
        'fin_bed_pad': inputs.itemById('pad').value,
        'sway_braces': inputs.itemById('braces').value,
        'sway_grip_from': round(inputs.itemById('sway_from').value * fb.MM_PER_CM, 4),
        'sway_tine_spacing': round(inputs.itemById('sway_spacing').value * fb.MM_PER_CM, 4),
        'sway_depth': inputs.itemById('sway_depth').valueOne,
    }


def engine_options(s):
    """Dialog settings -> the engine's options (fins_entry.js ENGINE_DEFAULTS)."""
    return {
        'mode': s['fin_style'],
        'bedPad': bool(s['fin_bed_pad']),
        'tines': bool(s['fin_tines']),
        'tineDensity': max(0, min(100, s['fin_tine_density'])) / 100.0,
        'coverage': max(0, min(100, s['fin_coverage'])) / 100.0,
        'layerHeight': float(s['layer_height']),
        # Only sent when asked for, so an untouched dialog still matches the
        # website's own defaults exactly (the engine's `sway` default is null).
        'sway': ({'on': True,
                  'gripFrom': max(0.0, float(s['sway_grip_from'])),
                  'tineSpacing': max(1.0, float(s['sway_tine_spacing'])),
                  'reach': max(5, min(50, s['sway_depth'])) / 100.0}
                 if s['sway_braces'] else None),
    }


class _InputChangedHandler(adsk.core.InputChangedEventHandler):
    def notify(self, args):
        try:
            inputs = args.firingEvent.sender.commandInputs
            if args.input.id == 'tines':
                _sync(inputs)
            elif args.input.id == 'bed' and inputs.itemById('bed').selectionCount:
                inputs.itemById('body').hasFocus = True
            _refresh(inputs)
        except Exception:
            _report('updating the fins')


def _refresh(inputs):
    result = _compute(inputs)
    inputs.itemById('readout').formattedText = '<br>'.join(
        result['lines'] + ['<i>Support Fins v%s</i>' % VERSION])


class _ActivateHandler(adsk.core.CommandEventHandler):
    """Start with the ground origin plane as the bed, like Insert Sway Brace."""
    def notify(self, args):
        try:
            inputs = args.command.commandInputs
            bed = inputs.itemById('bed')
            if bed.selectionCount or _session.get('bed_defaulted'):
                return
            _session['bed_defaulted'] = True
            design = adsk.fusion.Design.cast(_app.activeProduct)
            if design:
                bed.addSelection(fb.default_bed(design, _app))
                inputs.itemById('body').hasFocus = True
                _refresh(inputs)
        except Exception:
            pass


class _ValidateHandler(adsk.core.ValidateInputsEventHandler):
    def notify(self, args):
        inputs = args.firingEvent.sender.commandInputs
        args.areInputsValid = (_session.get('engine_error') is None
                               and inputs.itemById('bed').selectionCount == 1
                               and not _compute(inputs).get('pending'))


class _PreviewHandler(adsk.core.CommandEventHandler):
    def notify(self, args):
        try:
            result = _compute(args.command.commandInputs)
            if result['groups']:
                # OK keeps this preview as the result (execute never runs), so it
                # carries the same metadata an Insert would.
                fb.add_fin_bodies(_app.activeProduct, result['groups'], result['frame'],
                                  result['meta'])
                args.isValidResult = True
        except Exception:
            _report('previewing the fins')


class _ExecuteHandler(adsk.core.CommandEventHandler):
    def notify(self, args):
        try:
            result = _compute(args.command.commandInputs)
            if not result['groups']:
                _ui.messageBox('No fins to insert.\n\n' + '\n'.join(result['plain']))
                return
            fb.add_fin_bodies(_app.activeProduct, result['groups'], result['frame'],
                              result['meta'])
        except Exception:
            _report('inserting the fins')


class _DestroyHandler(adsk.core.CommandEventHandler):
    def notify(self, args):
        try:
            if args.terminationReason == adsk.core.CommandTerminationReason.CompletedTerminationReason:
                settings_store.save(_settings(args.command.commandInputs))
        except Exception:
            pass
        if ENGINE:
            ENGINE.active = False
        _session.clear()


# --------------------------------------------------------------------------
# The computation behind the readout and the preview
# --------------------------------------------------------------------------

def _token(e):
    try:
        return e.entityToken
    except Exception:
        return str(id(e))


def _compute(inputs):
    s = _settings(inputs)
    bed = inputs.itemById('bed')
    body = inputs.itemById('body')
    key = (_token(bed.selection(0).entity) if bed.selectionCount else None,
           _token(body.selection(0).entity) if body.selectionCount else None,
           tuple(sorted((k, str(v)) for k, v in s.items())))
    if _session.get('key') == key:
        return _session['result']
    got = _prepare(inputs, s)
    if 'lines' in got:                  # answered without the engine (a bad pick...)
        _session['key'], _session['result'] = key, got
        return got
    # Mark this key pending BEFORE submitting: an engine that answers at once
    # (the tests' Node one) lands its result on top of it.
    _session['key'] = key
    _session['result'] = _result(got['pre'] + ['Computing fins…'], pending=True)
    _session['pending'] = {'key': key, 'ctx': got}
    try:
        ENGINE.submit(key, got['soup'], engine_options(s), _engine_done)
    except engine_host.EngineError as e:
        _session.pop('pending', None)
        _session['result'] = _result(got['pre'] + [str(e)])
    return _session['result']


def _engine_done(key, fins, stats, error):
    """The engine's answer for `key` (called from the palette's message handler)."""
    p = _session.get('pending')
    if not p or p['key'] != key:
        return                          # the dialog moved on, or closed
    _session.pop('pending', None)
    result = (_result(p['ctx']['pre'] + [error]) if error
              else _finish(p['ctx'], fins, stats))
    if _session.get('key') == key:
        _session['result'] = result
    if _result_event is not None:
        # Update the dialog from Fusion's event loop, not from inside the
        # palette's message handler (its JavaScript is still waiting on it).
        _app.fireCustomEvent(RESULT_EVENT, '')
    else:
        _show_result()


def _show_result():
    cmd = _session.get('command')
    if cmd is None:
        return
    inputs = cmd.commandInputs
    _refresh(inputs)
    # No dialog input changed, so Fusion won't re-run the preview by itself.
    cmd.doExecutePreview()


class _ResultEventHandler(adsk.core.CustomEventHandler):
    def notify(self, args):
        try:
            _show_result()
        except Exception:
            _report('showing the fins')


def _result(lines, groups=(), frame=None, meta=None, pending=False):
    return {'lines': lines, 'plain': [l.replace('<b>', '').replace('</b>', '') for l in lines],
            'groups': list(groups), 'frame': frame, 'meta': meta or {}, 'pending': pending}


def _soup(body, frame, frame_key):
    """The part meshed in print space, cached per body and bed for the dialog."""
    cache = _session.setdefault('soups', {})
    k = (_token(body), frame_key)
    if k not in cache:
        cache[k] = fb.body_soup(body, frame)
    return cache[k]


def _prepare(inputs, s):
    """Everything before the engine: a final _result() when there is nothing to
    run it on, else the context _finish() needs, with the part's soup."""
    if _session.get('engine_error'):
        return _result(['<b>The fin engine isn’t available.</b>', _session['engine_error']])
    design = adsk.fusion.Design.cast(_app.activeProduct)
    if not design:
        return _result(['Open a design first.'])
    bed_in = inputs.itemById('bed')
    if not bed_in.selectionCount:
        return _result(['Pick the print bed: the face the part sits on, a plane on the bed, '
                        'or the part itself.'])
    bed = bed_in.selection(0).entity
    body_in = inputs.itemById('body')
    body = body_in.selection(0).entity if body_in.selectionCount else None
    if body is None:
        body = fb.body_of(bed) or fb.only_body(design)
    if body is None:
        return _result(['Pick the part to support.'])
    if fb.is_support(body):
        return _result(['That body is a support this add-in made. Pick the part itself.'])

    try:
        frame = fb.PrintFrame.from_bed(bed, body, _app)
        soup = _soup(body, frame, _token(bed))
    except fb.BridgeError as e:
        return _result([str(e)])
    if not soup:
        return _result(['Couldn’t mesh “%s”.' % body.name])

    lines = [frame.note] if frame.note else []
    bottom = min(soup[2::3])
    if bottom < -0.05:
        return _result(['“%s” reaches %.1f mm below the bed. Pick the face it sits on, or a '
                        'plane under it.' % (body.name, -bottom)])
    if bottom > 0.5:
        lines.append('Note: “%s” floats %.1f mm above the bed; the fins start at its lowest '
                     'point, not at the bed.' % (body.name, bottom))

    return {'body': body, 'frame': frame, 'soup': soup, 'pre': lines, 's': s}


def _finish(ctx, fins, stats):
    """The engine's fins -> the readout and the bodies to add."""
    body, frame, s = ctx['body'], ctx['frame'], ctx['s']
    lines = list(ctx['pre'])
    groups = shells.fin_groups(fins, stats.get('finTriangles', 0), stats.get('swayTriangles', 0))
    if _session.get('earlier'):
        lines.append('%d fin/pad bod%s from an earlier run %s already in Supports; delete them '
                     'if these replace them.' % (_session['earlier'],
                                                  'y' if _session['earlier'] == 1 else 'ies',
                                                  'is' if _session['earlier'] == 1 else 'are'))
    if not groups:
        why = ('no overhangs need holding in this pose' if not stats.get('overhangRegions')
               else 'the engine placed nothing for the %d overhang region%s'
               % (stats['overhangRegions'], '' if stats['overhangRegions'] == 1 else 's'))
        # A tall part with no overhangs is the sway braces' own case, so this
        # path has to say what became of them too rather than only of the fins.
        if s.get('sway_braces'):
            why += '; no sway braces either: %s' % (stats.get('swayReason')
                                                    or 'no upright side takes one in this pose')
        return _result(['<b>No fins</b>: %s.' % why] + lines)

    n_fin = sum(1 for g in groups if g.kind == 'fin')
    n_pad = sum(1 for g in groups if g.kind == 'pad')
    grams = _volume_mm3(fins) / 1000.0 * PLA_DENSITY
    # Braces are counted apart from the fins: they hold the part's tall sides,
    # not an overhang, so adding them to the fin count would claim overhangs are
    # served that nothing is under. They arrive in the same bodies, though.
    braces = stats.get('swayBraces', 0)
    head = '<b>%d fin%s, %d tines%s%s, ~%.0f g PLA</b>' % (
        n_fin, '' if n_fin == 1 else 's', stats.get('tines', 0),
        ' + %d sway brace%s, %d brace tines' % (braces, '' if braces == 1 else 's',
                                                stats.get('swayTines', 0)) if braces else '',
        ', bed pad' if n_pad else '', grams)
    lines.insert(0, head)
    lines.append('%d overhang region%s, %d triangles.' % (
        stats.get('overhangRegions', 0), '' if stats.get('overhangRegions') == 1 else 's',
        sum(g.triangle_count for g in groups)))
    pieces = _loose_pieces(body)
    if pieces > 1 or stats.get('floating'):
        # A piece not joined to the rest (a hole wider than the wall it cuts, a
        # stray body) stands on its supports alone: almost always a modelling
        # slip. Must-see, so it goes right under the headline.
        lines.insert(1, '<b>Check the model:</b> %s of it %s joined to the rest%s. A hole or cut '
                        'may go right through.'
                     % ('%d pieces' % pieces if pieces > 1 else 'a piece',
                        'aren’t' if pieces > 1 else 'isn’t',
                        ', so it starts %.1f mm up, held only by supports' % stats['floatingDrop']
                        if stats.get('floating') else ''))
    if stats.get('unserved'):
        lines.append('%d overhang region%s left unsupported (too small or unreachable).'
                     % (stats['unserved'], '' if stats['unserved'] == 1 else 's'))
    # Asked for braces and got none: say why rather than leave it unexplained.
    if s.get('sway_braces') and not braces:
        lines.append('No sway braces: %s.' % (stats.get('swayReason')
                                              or 'no upright side takes one in this pose'))
    lines.append('Layer height must match your slicer: %g mm.' % s['layer_height'])
    meta = {'layer': s['layer_height'], 'style': s['fin_style'], 'engine': 'printfins.com',
            'addin': VERSION}
    return _result(lines, groups, frame, meta)


def _loose_pieces(body):
    """How many separate solids a BRep body holds (its lumps); 1 for a mesh body,
    whose loose pieces the engine reports instead (stats['floating'])."""
    try:
        lumps = adsk.fusion.BRepBody.cast(body)
        return lumps.lumps.count if lumps else 1
    except Exception:
        return 1


def _volume_mm3(soup):
    """Sum of the closed shells' volumes (they overlap a little, so it's rough)."""
    v = 0.0
    for i in range(0, len(soup), 9):
        ax, ay, az, bx, by, bz, cx, cy, cz = soup[i:i + 9]
        v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6.0
    return abs(v)
