"""The *Insert Sway Brace* command: pick the print bed, then click upright faces
(or choose Auto), and the braces appear in a 'Supports' component."""

import traceback

import adsk.core
import adsk.fusion

from . import fusion_bridge as fb
from . import settings_store
from .sway_core import sway

CMD_ID = 'SupportFins_InsertSwayBrace'
CMD_NAME = 'Insert Sway Brace'
CMD_TIP = ('Stand tapered buttress ribs beside the tall sides of a part, tied to it with '
           'one-layer tines, so it doesn’t sway or wobble as it prints.')
WORKSPACE_ID = 'FusionSolidEnvironment'
PANEL_ID = 'SolidCreatePanel'
RESOURCES = 'resources/SwayBrace'

def _version():
    """The add-in's version, from its manifest (the one place it's set)."""
    import json
    import os
    try:
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'SupportFins.manifest')
        with open(path, encoding='utf-8') as fh:
            return json.load(fh).get('version', '?')
    except (OSError, ValueError):
        return '?'


VERSION = _version()

DENSITY = {'PLA': 1.24, 'PETG': 1.27}   # g/cm^3

_app = None
_ui = None
_handlers = []      # Fusion only holds weak references to handlers
_session = {}       # per-dialog: meshed parts and the last computation


def start(app, ui):
    global _app, _ui
    _app, _ui = app, ui
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
    try:
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
            # before any preview exists: see existing_brace_data
            _session['existing'] = fb.existing_brace_data(design) if design else []
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

            mode = inputs.addDropDownCommandInput('mode', 'Placement',
                                                  adsk.core.DropDownStyles.TextListDropDownStyle)
            mode.listItems.add('Pick faces', s['mode'] != 'auto')
            mode.listItems.add('Auto', s['mode'] == 'auto')

            faces = inputs.addSelectionInput('faces', 'Faces to brace',
                                             'Click an upright face where each brace should stand')
            faces.addSelectionFilter('Faces')
            faces.addSelectionFilter('MeshBodies')      # an STL: click the spot on the mesh
            faces.setSelectionLimits(0, 0)
            # Nothing is ever selected in this input: clicks are read by _ClickHandler
            # and banked in _session['picks'], so the same face can take many braces.
            inputs.addBoolValueInput('undo', 'Undo last pick', False, '', False)
            inputs.addBoolValueInput('clear', 'Clear picks', False, '', False)

            body = inputs.addSelectionInput('body', 'Part',
                                            'The body to brace (defaults to the bed face’s body)')
            body.addSelectionFilter('SolidBodies')
            body.addSelectionFilter('MeshBodies')
            body.setSelectionLimits(0, 1)

            grp = inputs.addGroupCommandInput('settings', 'Settings')
            grp.isExpanded = False
            g = grp.children
            mat = g.addDropDownCommandInput('material', 'Material',
                                            adsk.core.DropDownStyles.TextListDropDownStyle)
            for name in sway.MATERIALS:
                mat.listItems.add(name, name == s['material'])
            vi = adsk.core.ValueInput.createByString
            g.addValueInput('layer', 'Layer height', 'mm', vi('%g mm' % s['layer_height']))
            g.addValueInput('gap', 'Support gap', 'mm', vi('%g mm' % s['gap']))
            g.addValueInput('bite', 'Tine bite', 'mm', vi('%g mm' % s['bite']))
            g.addValueInput('spacing', 'Tine spacing', 'mm', vi('%g mm' % s['tine_spacing']))
            g.addValueInput('grip', 'Grip from', 'mm', vi('%g mm' % s['grip_from']))
            g.addIntegerSpinnerCommandInput('depth', 'Brace depth (% of height)', 5, 50, 1,
                                            int(s['depth_pct']))
            g.addBoolValueInput('tines', 'Tines', True, '', bool(s['tines']))

            ro = inputs.addTextBoxCommandInput('readout', '', 'Click upright faces where each brace '
                                               'should stand.<br><i>Support Fins v%s</i>' % VERSION,
                                               6, True)
            ro.isFullWidth = True
            _sync_visibility(inputs)

            for event, handler in ((cmd.inputChanged, _InputChangedHandler()),
                                   (cmd.validateInputs, _ValidateHandler()),
                                   (cmd.executePreview, _PreviewHandler()),
                                   (cmd.execute, _ExecuteHandler()),
                                   (cmd.destroy, _DestroyHandler()),
                                   (cmd.activate, _ActivateHandler()),
                                   (cmd.preSelect, _HoverHandler()),
                                   (cmd.preSelectEnd, _HoverEndHandler()),
                                   (cmd.mouseClick, _ClickHandler())):
                event.add(handler)
                _handlers.append(handler)
        except Exception:
            _report('opening the dialog')


def _mode(inputs):
    return 'auto' if inputs.itemById('mode').selectedItem.name == 'Auto' else 'pick'


def _sync_visibility(inputs):
    auto = _mode(inputs) == 'auto'
    for k in ('faces', 'undo', 'clear'):
        inputs.itemById(k).isVisible = not auto
    inputs.itemById('body').isVisible = auto


def _settings(inputs):
    mm = lambda k: inputs.itemById(k).value * fb.MM_PER_CM   # noqa: E731
    return {
        'mode': _mode(inputs),
        'material': inputs.itemById('material').selectedItem.name,
        'layer_height': mm('layer'),
        'gap': mm('gap'),
        'bite': mm('bite'),
        'tine_spacing': mm('spacing'),
        'grip_from': mm('grip'),
        'depth_pct': inputs.itemById('depth').value,
        'tines': inputs.itemById('tines').value,
    }


def _opts(s):
    return {'tines': s['tines'], 'layer_height': s['layer_height'], 'gap': s['gap'],
            'bite': s['bite'], 'grip_from': s['grip_from'], 'tine_spacing': s['tine_spacing'],
            'reach': s['depth_pct'] / 100.0}


class _InputChangedHandler(adsk.core.InputChangedEventHandler):
    def notify(self, args):
        try:
            # args.inputs is the changed input's own group; we want the whole dialog
            inputs = args.firingEvent.sender.commandInputs
            changed = args.input
            if changed.id == 'mode':
                _sync_visibility(inputs)
            elif changed.id == 'material':
                m = sway.MATERIALS[changed.selectedItem.name]
                inputs.itemById('gap').value = m['gap'] / fb.MM_PER_CM
                inputs.itemById('bite').value = m['bite'] / fb.MM_PER_CM
            elif changed.id == 'undo':
                if _session.get('picks'):
                    _session['picks'].pop()
            elif changed.id == 'clear':
                _session['picks'] = []
            elif changed.id == 'bed' and inputs.itemById('bed').selectionCount:
                nxt = inputs.itemById('body' if _mode(inputs) == 'auto' else 'faces')
                nxt.hasFocus = True
            _refresh(inputs)
        except Exception:
            _report('updating the braces')


def _refresh(inputs):
    result = _compute(inputs)
    inputs.itemById('readout').formattedText = '<br>'.join(
        result['lines'] + ['<i>Support Fins v%s</i>' % VERSION])


def _on_faces(args):
    try:
        return args.activeInput is not None and args.activeInput.id == 'faces'
    except Exception:
        return False


class _HoverHandler(adsk.core.SelectionEventHandler):
    """Placing braces never SELECTS anything: Fusion toggles a selection on each
    click, which fights clicking the same face (or mesh body) again. Instead this
    notes which body is under the cursor and refuses the selection; the click
    itself is read by _ClickHandler."""
    def notify(self, args):
        try:
            if not _on_faces(args):
                _session.pop('hover', None)     # e.g. re-picking the bed: not a brace click
                return
            body = fb.body_of(args.selection.entity)
            if (body is not None and body.parentComponent.name != fb.SUPPORTS_NAME
                    and not fb.is_brace(body)):
                _session['hover'] = body
            args.isSelectable = False
        except Exception:
            pass


class _HoverEndHandler(adsk.core.SelectionEventHandler):
    def notify(self, args):
        if _on_faces(args):
            _session.pop('hover', None)


class _ClickHandler(adsk.core.MouseEventHandler):
    """A click in pick mode: trace the camera ray through the clicked pixel to
    the hovered body's surface, and bank that spot as a brace."""
    def notify(self, args):
        try:
            if args.button != adsk.core.MouseButtons.LeftMouseButton:
                return
            inputs = args.firingEvent.sender.commandInputs
            body = _session.get('hover')
            bed_in = inputs.itemById('bed')
            if _mode(inputs) != 'pick' or body is None or not bed_in.selectionCount:
                return
            bed = bed_in.selection(0).entity
            frame = fb.PrintFrame.from_bed(bed, body, _app)
            part = _part(body, frame, bed.entityToken)
            origin, direction = _click_ray(args.viewport, args.viewportPosition)
            o = frame.to_print(origin)
            tip = origin.copy()
            tip.translateBy(direction)
            t = frame.to_print(tip)
            hit = part.mesh.ray_hit(o, (t[0] - o[0], t[1] - o[1], t[2] - o[2]))
            if hit is None:
                return
            _session.setdefault('picks', []).append((body, frame.to_world(hit)))
            _refresh(inputs)
            # A click changes no dialog input, so Fusion won't re-run the preview
            # by itself: without this it shows the braces a click late, or none.
            args.firingEvent.sender.doExecutePreview()
        except fb.BridgeError:
            pass
        except Exception:
            _report('adding a brace')


def _click_ray(viewport, pos):
    """World-space ray (origin Point3D, unit Vector3D) through a viewport pixel."""
    p = viewport.viewToModelSpace(pos)
    cam = viewport.camera
    if cam.cameraType == adsk.core.CameraTypes.OrthographicCameraType:
        d = cam.eye.vectorTo(cam.target)
        d.normalize()
        back = d.copy()
        back.scaleBy(-10000)            # 100 m behind the view plane
        o = p.copy()
        o.translateBy(back)
    else:
        o = cam.eye.copy()
        d = o.vectorTo(p)
        d.normalize()
    return o, d


class _ActivateHandler(adsk.core.CommandEventHandler):
    """Start with the ground origin plane as the bed, so the user can go straight
    to clicking faces. They can still pick another face or plane."""
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
                nxt = inputs.itemById('body' if _mode(inputs) == 'auto' else 'faces')
                nxt.hasFocus = True
                _refresh(inputs)
        except Exception:
            pass        # no default: the user picks the bed as before


class _ValidateHandler(adsk.core.ValidateInputsEventHandler):
    def notify(self, args):
        inputs = args.firingEvent.sender.commandInputs
        ok = inputs.itemById('bed').selectionCount == 1
        if _mode(inputs) == 'pick':
            ok = ok and bool(_session.get('picks'))
        args.areInputsValid = ok


class _PreviewHandler(adsk.core.CommandEventHandler):
    def notify(self, args):
        try:
            result = _compute(args.command.commandInputs)
            if result['ribs']:
                fb.add_braces(_app.activeProduct, result['ribs'], result['frame'])
                args.isValidResult = True     # OK keeps the preview as the result
        except Exception:
            _report('previewing the braces')


class _ExecuteHandler(adsk.core.CommandEventHandler):
    def notify(self, args):
        try:
            result = _compute(args.command.commandInputs)
            if not result['ribs']:
                _ui.messageBox('No braces to insert.\n\n' + '\n'.join(result['plain']))
                return
            fb.add_braces(_app.activeProduct, result['ribs'], result['frame'])
        except Exception:
            _report('inserting the braces')


class _DestroyHandler(adsk.core.CommandEventHandler):
    def notify(self, args):
        try:
            if args.terminationReason == adsk.core.CommandTerminationReason.CompletedTerminationReason:
                settings_store.save(_settings(args.command.commandInputs))
        except Exception:
            pass
        _session.clear()


# --------------------------------------------------------------------------
# The computation behind the readout and the preview
# --------------------------------------------------------------------------

def _key(inputs, s):
    def token(e):
        try:
            return e.entityToken
        except Exception:
            return str(id(e))

    bed = inputs.itemById('bed')
    body = inputs.itemById('body')
    return (
        token(bed.selection(0).entity) if bed.selectionCount else None,
        tuple((token(e), tuple(round(c, 5) for c in pt.asArray()))
              for e, pt in _session.get('picks', [])),
        token(body.selection(0).entity) if body.selectionCount else None,
        tuple(sorted((k, str(v)) for k, v in s.items())),
    )


def _part(body, frame, frame_key):
    cache = _session.setdefault('parts', {})
    k = (body.entityToken, frame_key)
    if k not in cache:
        cache[k] = fb.Part(body, frame)
    return cache[k]


def _compute(inputs):
    s = _settings(inputs)
    key = _key(inputs, s)
    if _session.get('key') == key:
        return _session['result']
    result = _do_compute(inputs, s, key)
    _session['key'] = key
    _session['result'] = result
    return result


def _result(lines, ribs=(), frame=None):
    return {'lines': lines, 'plain': [l.replace('<b>', '').replace('</b>', '') for l in lines],
            'ribs': list(ribs), 'frame': frame}


def _do_compute(inputs, s, key):
    design = adsk.fusion.Design.cast(_app.activeProduct)
    if not design:
        return _result(['Open a design first.'])
    bed_in = inputs.itemById('bed')
    if not bed_in.selectionCount:
        return _result(['Pick the print bed: the face the part sits on, a plane on the bed, '
                        'or the part itself.'])
    bed = bed_in.selection(0).entity
    opts = _opts(s)

    if s['mode'] == 'auto':
        body_in = inputs.itemById('body')
        body = body_in.selection(0).entity if body_in.selectionCount else None
        if body is None:
            body = fb.body_of(bed) or fb.only_body(design)
        if body is None:
            return _result(['Pick the part to brace.'])
        bodies = [body]
    else:
        picks = [(fb.body_of(e), pt) for e, pt in _session.get('picks', [])]
        picks = [(b, pt) for b, pt in picks if b is not None]
        if not picks:
            return _result(['Now click upright faces of the part where each brace should stand. '
                            'Click again for each more brace, even on the same face.'])
        lines_top = ['%d pick%s.' % (len(picks), '' if len(picks) == 1 else 's')]
        bodies = [b for b, _ in picks]

    try:
        frame = fb.PrintFrame.from_bed(bed, bodies[0], _app)
        frame_key = key[0]
        parts = {}
        for b in bodies:
            parts[b.entityToken] = _part(b, frame, frame_key)
    except fb.BridgeError as e:
        return _result([str(e)])

    lines = [frame.note] if frame.note else []
    if s['mode'] != 'auto':
        lines += lines_top
    for p in parts.values():
        if p.mesh.bottom < -0.05:
            return _result(['“%s” reaches %.1f mm below the bed. Pick the face it sits on, or a plane '
                            'under it.' % (p.body.name, -p.mesh.bottom)])
        if p.mesh.bottom > 0.5:
            lines.append('Note: “%s” floats %.1f mm above the bed.' % (p.body.name, p.mesh.bottom))

    avoid = fb.braces_in_frame(_session.get('existing', []), frame)
    ribs = []
    if s['mode'] == 'auto':
        part = parts[bodies[0].entityToken]
        res = sway.build_sway_braces(part.mesh, part.patches, opts, part.inside, avoid)
        if not res.ribs:
            return _result(lines + ['No braces: %s.' % res.reason])
        ribs = res.ribs
        for i, r in enumerate(ribs):
            lines.append(_describe(i + 1, r))
        if res.skipped:
            lines.append('%d spot%s skipped (blocked, too short, or would clash).'
                         % (res.skipped, '' if res.skipped == 1 else 's'))
    else:
        for i, (body, pt) in enumerate(picks):
            part = parts[body.entityToken]
            q = frame.to_print(pt)
            patch, why = part.patch_at(q)
            if patch is None:
                r = sway.Rib.refuse(why)
            else:
                r = sway.sway_at_face(part.mesh, patch, q, opts, avoid + ribs, part.inside)
            if r.ok:
                ribs.append(r)
                lines.append(_describe(i + 1, r))
            else:
                lines.append('Pick %d: <b>refused</b> — %s. (Undo last pick to remove it.)'
                             % (i + 1, r.reason))

    # A picked brace builds even where auto would refuse to stand one, so say what it
    # is doing: below its first tine it holds nothing and nothing holds it. Under
    # 20 mm of that isn't worth a line.
    stilted = [r for r in ribs if r.stilt > 20]
    if stilted:
        lines.append('%s up to %.0f mm before gripping — that much prints as a lone wall. '
                     'Rotate so that side reaches the bed if it wobbles.'
                     % ('One brace stands' if len(stilted) == 1
                        else '%d braces stand' % len(stilted), max(r.stilt for r in stilted)))

    if ribs:
        tines = sum(r.tines for r in ribs)
        grams = sum(r.volume() for r in ribs) / 1000.0 * DENSITY.get(s['material'], 1.24)
        lines.insert(0, '<b>%d brace%s, %d tines, ~%.0f g solid %s</b>'
                     % (len(ribs), '' if len(ribs) == 1 else 's', tines, grams, s['material']))
    return _result(lines, ribs, frame)


def _describe(i, r):
    return 'Brace %d: %.0f mm tall, %.0f mm deep at the bed, %d tines.' % (i, r.height, r.depth, r.tines)
