"""Insert Support Fins: the engine host, the mesh reshaping, and the Fusion side
run against fake_adsk.

    python3 plugins/fusion/build.py                 # writes SupportFins/palette/fins_engine.js
    python3 -m unittest discover -s plugins/fusion/tests -v

The engine runs under Node here (engine_host.compute_fins), the same bundle
Fusion's palette runs. The engine tests skip, saying why, when the bundle or
Node is missing.

Pinned here:
  - the host runs the website's engine and hands the fins back in the part's own
    frame, wherever the part sits on the plate (same fins, just moved);
  - the palette protocol: the palette pulls the latest job, a newer job replaces
    one not yet picked up, a late answer for an old job is dropped, the palette
    idles slowly with no dialog open, and a palette that never reports is named;
  - the dialog computes asynchronously: pending until the answer lands, then the
    readout refreshes and the preview re-runs;
  - every body the command makes is a closed mesh, fins before pads;
  - the dialog's settings map onto the engine's options;
  - through the fake Fusion API: a mesh part tilted on the XY bed gets fins in a
    Supports component, inside a base feature, named and tagged; a second run
    numbers on and is counted; a direct design adds bodies without a base feature;
    a Y-up design standing "as modelled" puts the fins under the part along Y;
    a part through the bed is refused, a floating one is flagged;
  - the two commands share settings.json without wiping each other's keys.
"""

import json
import math
import os
import struct
import sys
import tempfile
import types
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
FUSION = os.path.dirname(HERE)
REPO = os.path.dirname(os.path.dirname(FUSION))
MODELS = os.path.join(REPO, 'prototype', 'stress', 'models')
sys.path.insert(0, HERE)
sys.path.insert(0, FUSION)

import fake_adsk                                            # noqa: E402

APP = fake_adsk.install()

from SupportFins import engine_host                         # noqa: E402
from SupportFins import fins_command                        # noqa: E402
from SupportFins import fusion_bridge as fb                 # noqa: E402
from SupportFins import settings_store                      # noqa: E402
from SupportFins.fins_core import shells                    # noqa: E402

ENGINE_OK, ENGINE_WHY = engine_host.node_available()
needs_engine = unittest.skipUnless(ENGINE_OK, 'fin engine unavailable: %s' % ENGINE_WHY)


def read_stl(name):
    with open(os.path.join(MODELS, name + '.stl'), 'rb') as fh:
        b = fh.read()
    n = struct.unpack_from('<I', b, 80)[0]
    assert 84 + 50 * n == len(b), 'binary STL expected'
    out = []
    for i in range(n):
        out += struct.unpack_from('<9f', b, 84 + 50 * i + 12)
    return out


def posed(soup, deg=0.0, shift=(0.0, 0.0, 0.0)):
    """Tilt about X, sit on z = 0, then move by `shift`."""
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    out = []
    for i in range(0, len(soup), 3):
        x, y, z = soup[i:i + 3]
        out += (x, y * c - z * s, y * s + z * c)
    mz = min(out[2::3])
    return [v - mz + shift[i % 3] for i, v in enumerate(out)]


def bbox(soup):
    return (min(soup[0::3]), min(soup[1::3]), min(soup[2::3]),
            max(soup[0::3]), max(soup[1::3]), max(soup[2::3]))


def tall_post(h=150.0, w=40.0, d=30.0):
    """A posed 40 x 30 x h mm post: nothing overhangs, so the only support it can
    get is a sway brace. The soup is a plain box, wound outward."""
    x0, x1, y0, y1 = -w / 2, w / 2, -d / 2, d / 2
    v = [(x0, y0, 0.0), (x1, y0, 0.0), (x1, y1, 0.0), (x0, y1, 0.0),
         (x0, y0, h), (x1, y0, h), (x1, y1, h), (x0, y1, h)]
    quads = ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (1, 2, 6, 5), (3, 0, 4, 7))
    out = []
    for a, b, c, dd in quads:
        for tri in ((v[a], v[b], v[c]), (v[a], v[c], v[dd])):
            for pt in tri:
                out += list(pt)
    return out


# ------------------------------------------------------------------ engine host
@needs_engine
class EngineHost(unittest.TestCase):
    def test_lbracket_gets_fins_under_it_in_its_own_frame(self):
        part = posed(read_stl('lbracket'), 35, (100, 50, 0))
        fins, stats = engine_host.compute_fins(part, {'layerHeight': 0.2})
        self.assertGreater(stats['finTriangles'], 0)
        self.assertGreater(stats['tines'], 0)
        self.assertEqual(len(fins) % 9, 0)
        pb, fb_ = bbox(part), bbox(fins)
        self.assertAlmostEqual(fb_[2], 0.0, places=4)        # fins stand on the bed
        self.assertLessEqual(fb_[5], pb[5] + 1e-3)           # and no higher than the part
        # under the part: the fins' centre is near the part's, not near the origin
        self.assertLess(abs((fb_[0] + fb_[3]) / 2 - (pb[0] + pb[3]) / 2), 10)
        self.assertLess(abs((fb_[1] + fb_[4]) / 2 - (pb[1] + pb[4]) / 2), 10)

    def test_same_fins_anywhere_on_the_plate(self):
        base = read_stl('lbracket')
        a, sa = engine_host.compute_fins(posed(base, 35, (0, 0, 0)))
        b, sb = engine_host.compute_fins(posed(base, 35, (137.25, -61.5, 0)))
        self.assertEqual(sa, sb)
        self.assertEqual(len(a), len(b))
        dx, dy = 137.25, -61.5
        worst = max(max(abs(b[i] - a[i] - dx), abs(b[i + 1] - a[i + 1] - dy), abs(b[i + 2] - a[i + 2]))
                    for i in range(0, len(a), 3))
        self.assertLess(worst, 1e-3)                         # float32 out of the engine

    def test_options_reach_the_engine(self):
        part = posed(read_stl('lbracket'), 35)
        _, with_pad = engine_host.compute_fins(part, {'bedPad': True})
        _, no_pad = engine_host.compute_fins(part, {'bedPad': False})
        _, no_tines = engine_host.compute_fins(part, {'tines': False})
        self.assertGreater(with_pad['padTriangles'], 0)
        self.assertEqual(no_pad['padTriangles'], 0)
        self.assertEqual(no_tines['tines'], 0)

    def test_sway_braces_become_brace_bodies_not_fins(self):
        # local issue 018: braces arrived inside the fin block and became 'Support fin N'
        fins, stats = engine_host.compute_fins(tall_post(150), {'sway': {'on': True}})
        groups = shells.fin_groups(fins, stats['finTriangles'], stats['swayTriangles'])
        kinds = [g.kind for g in groups]
        self.assertEqual(kinds.count('fin'), 0, stats)
        self.assertEqual(kinds.count('sway'), stats['swayBraces'])
        self.assertGreaterEqual(stats['swayBraces'], 2)

    def test_sway_braces_reach_the_engine_and_come_back_counted(self):
        # A tall post: nothing overhangs, so anything built here is a brace. The
        # whole point of the option is that the engine's own allow-lists (Python
        # DEFAULTS and fins_entry.js) both have to carry `sway`, or it vanishes
        # quietly somewhere between the dialog and the geometry.
        post = tall_post(150)
        off_fins, off = engine_host.compute_fins(post)
        on_fins, on = engine_host.compute_fins(post, {'sway': {'on': True}})
        self.assertEqual(on['overhangRegions'], 0, 'a plain post should have no overhangs')
        self.assertEqual(off['swayBraces'], 0, 'braces nobody asked for')
        self.assertEqual(len(off_fins), 0)
        self.assertGreaterEqual(on['swayBraces'], 2, on.get('swayReason'))
        self.assertGreater(on['swayTines'], 0)
        self.assertGreater(len(on_fins), 0, 'braces counted but no geometry came back')
        self.assertAlmostEqual(bbox(on_fins)[2], 0.0, places=4)    # they stand on the bed

    def test_brace_settings_reach_the_engine(self):
        post = tall_post(150)
        _, loose = engine_host.compute_fins(post, {'sway': {'on': True, 'tineSpacing': 20}})
        _, tight = engine_host.compute_fins(post, {'sway': {'on': True, 'tineSpacing': 4}})
        self.assertGreater(tight['swayTines'], loose['swayTines'])
        _, high = engine_host.compute_fins(post, {'sway': {'on': True, 'gripFrom': 120}})
        self.assertLess(high['swayTines'], loose['swayTines'])

    def test_a_part_too_short_to_brace_says_why(self):
        _, stats = engine_host.compute_fins(tall_post(20), {'sway': {'on': True}})
        self.assertEqual(stats['swayBraces'], 0)
        self.assertTrue(stats['swayReason'])

    def test_a_part_with_nothing_to_hold_gets_nothing(self):
        cube = posed(read_stl('cube'))
        fins, stats = engine_host.compute_fins(cube)
        self.assertEqual(len(fins), 0)
        self.assertEqual(stats['overhangRegions'], 0)

    def test_empty_soup_is_refused_in_words(self):
        with self.assertRaises(engine_host.EngineError):
            engine_host.compute_fins([])


class NodeEngine:
    """PaletteEngine's interface, answering at once under Node (the tests' engine)."""
    active = False

    def problem(self):
        return None

    def submit(self, key, soup, options, done):
        fins, stats = engine_host.compute_fins(soup, options)
        done(key, fins, stats, None)


class FakePalette:
    def __init__(self):
        self.sent = []
        self.incomingFromHTML = types.SimpleNamespace(add=lambda h: None)
        self.deleted = False

    def sendInfoToHTML(self, action, data):
        self.sent.append(action)
        return 'OK'

    def deleteMe(self):
        self.deleted = True


class FakePalettes:
    def __init__(self):
        self.items = {}

    def itemById(self, pid):
        p = self.items.get(pid)
        return None if p is None or p.deleted else p

    def add(self, pid, name, url, *flags):
        self.items[pid] = FakePalette()
        self.url = url
        return self.items[pid]


class PaletteProtocol(unittest.TestCase):
    def setUp(self):
        self.ui = types.SimpleNamespace(palettes=FakePalettes())
        self.engine = engine_host.PaletteEngine(self.ui)
        self.got = []
        if os.path.isfile(engine_host.BUNDLE):
            self.assertTrue(self.engine.start(), self.engine.start_error)
        else:
            self.skipTest('no engine bundle: run plugins/fusion/build.py')
        self.engine.on_html('ready', json.dumps({'engine': True, 'browser': 'test'}))

    def done(self, key, fins, stats, error):
        self.got.append((key, fins, stats, error))

    def next_job(self):
        return json.loads(self.engine.on_html('next', ''))

    def test_page_is_the_palette_file_and_hidden(self):
        self.assertTrue(self.ui.palettes.url.startswith('file:///'))
        self.assertNotIn('\\', self.ui.palettes.url)       # no Windows backslashes
        self.assertTrue(self.ui.palettes.url.endswith('/palette/engine.html'))
        self.assertTrue(os.path.isfile(engine_host.PAGE))
        self.assertIsNone(self.engine.problem())

    def test_idle_poll_is_slow_without_a_dialog_and_quick_with_one(self):
        self.assertEqual(self.next_job(), {'idle': 1000})
        self.engine.active = True
        self.assertEqual(self.next_job(), {'idle': 100})

    def test_submit_wakes_the_palette_and_the_job_goes_out_once(self):
        self.engine.submit('k1', posed(read_stl('cube')), {'bedPad': False}, self.done)
        self.assertEqual(self.ui.palettes.itemById(engine_host.PALETTE_ID).sent, ['wake'])
        job = self.next_job()
        self.assertEqual(json.loads(job['options'])['bedPad'], False)
        self.assertIn('idle', self.next_job())             # already sent

    def test_a_newer_job_replaces_one_not_picked_up_and_old_answers_drop(self):
        self.engine.submit('old', posed(read_stl('cube')), {}, self.done)
        first = self.next_job()
        self.engine.submit('new', posed(read_stl('cube')), {}, self.done)
        self.assertEqual(self.engine.on_html('result', json.dumps({'id': first['id'], 'raw': '{}'})),
                         'stale')
        self.assertEqual(self.got, [])
        second = self.next_job()
        self.assertNotEqual(first['id'], second['id'])

    @needs_engine
    def test_an_answer_lands_decoded_for_its_key(self):
        part = posed(read_stl('lbracket'), 35, (40, 0, 0))
        self.engine.submit('k', part, {}, self.done)
        job = self.next_job()
        raw = subprocess_engine(job['soup'], job['options'])
        self.engine.on_html('result', json.dumps({'id': job['id'], 'raw': raw}))
        (key, fins, stats, err), = self.got
        want, wstats = engine_host.compute_fins(part)
        self.assertEqual((key, err, stats), ('k', None, wstats))
        self.assertEqual(len(fins), len(want))

    def test_an_engine_error_is_worded_for_the_readout(self):
        self.engine.submit('k', posed(read_stl('cube')), {}, self.done)
        job = self.next_job()
        self.engine.on_html('result', json.dumps({'id': job['id'], 'error': 'boom'}))
        self.assertEqual(self.got[0][0], 'k')
        self.assertIn('boom', self.got[0][3])

    def test_a_palette_that_never_reports_is_named(self):
        e = engine_host.PaletteEngine(self.ui)
        e.start()
        self.assertIsNone(e.problem())
        e.started_at -= engine_host.READY_TIMEOUT_S + 1
        self.assertIn('never reported', e.problem())

    def test_a_missing_bundle_is_named(self):
        saved = engine_host.BUNDLE
        engine_host.BUNDLE = os.path.join(tempfile.gettempdir(), 'no-such-bundle.js')
        try:
            e = engine_host.PaletteEngine(self.ui)
            self.assertFalse(e.start())
            self.assertIn('bundle is missing', e.problem())
        finally:
            engine_host.BUNDLE = saved

    def test_stop_closes_the_palette(self):
        self.engine.stop()
        self.assertIsNone(self.ui.palettes.itemById(engine_host.PALETTE_ID))


def subprocess_engine(soup_b64, options):
    """The raw computeFinsB64 answer, as the palette would post it."""
    import shutil
    import subprocess
    job = json.dumps({'bundle': engine_host.BUNDLE, 'soup': soup_b64, 'options': options})
    return subprocess.run([shutil.which('node'), '-e', engine_host._NODE_RUNNER],
                          input=job.encode(), capture_output=True, check=True).stdout.decode()


class HostPlumbing(unittest.TestCase):
    def test_dialog_settings_map_onto_engine_options(self):
        s = dict(settings_store.DEFAULTS, fin_style='prop', fin_tine_density=40,
                 fin_coverage=120, fin_bed_pad=False, layer_height=0.28)
        o = fins_command.engine_options(s)
        self.assertEqual(o, {'mode': 'prop', 'bedPad': False, 'tines': True, 'tineDensity': 0.4,
                             'coverage': 1.0, 'layerHeight': 0.28, 'sway': None})
        d = fins_command.engine_options(settings_store.DEFAULTS)
        for k, v in engine_host.DEFAULTS.items():        # untouched dialog == the website
            self.assertEqual(d[k], v, k)

    def test_the_braces_checkbox_turns_the_engine_option_on(self):
        s = dict(settings_store.DEFAULTS, sway_braces=True, sway_grip_from=15,
                 sway_tine_spacing=8, sway_depth=20)
        self.assertEqual(fins_command.engine_options(s)['sway'],
                         {'on': True, 'gripFrom': 15.0, 'tineSpacing': 8.0, 'reach': 0.2})
        # ...and the settings are ignored while it is off, so an untouched dialog
        # sends the website's own defaults whatever is parked in the fields.
        off = dict(s, sway_braces=False)
        self.assertIsNone(fins_command.engine_options(off)['sway'])


# ------------------------------------------------------------------ mesh reshaping
@needs_engine
class Shells(unittest.TestCase):
    def check_model(self, name, deg):
        fins, stats = engine_host.compute_fins(posed(read_stl(name), deg))
        groups = shells.fin_groups(fins, stats['finTriangles'])
        self.assertTrue(groups)
        kinds = [g.kind for g in groups]
        self.assertEqual(kinds, sorted(kinds, key=lambda k: k != 'fin'))   # fins, then pads
        for g in groups:
            self.assertEqual(g.open_edges(), 0, '%s: a %s body is not closed' % (name, g.kind))
            # Fusion flags a mesh with a flipped triangle 'not oriented'
            self.assertEqual(g.misoriented_edges(), 0, '%s: a %s body is not oriented' % (name, g.kind))
            self.assertGreater(shells.signed_volume(g), 0, '%s: a %s body is inside out' % (name, g.kind))
        n_fin = kinds.count('fin')
        self.assertGreaterEqual(n_fin, 1)
        self.assertLessEqual(n_fin, max(1, stats['braces']))   # tines join their wall
        self.assertEqual(sum(g.triangle_count for g in groups),
                         stats['finTriangles'] + stats['padTriangles'])
        return groups

    def test_lbracket(self):
        self.check_model('lbracket', 35)

    def test_torus(self):
        self.check_model('torus', 20)

    def test_sphere_gets_its_bed_pad_as_a_body_of_its_own(self):
        # (The engine used to give a sphere a pad only; since the small-tube and
        # raster-wall work it may add walls under it too. Either way the pad is
        # split out as its own body.)
        fins, stats = engine_host.compute_fins(posed(read_stl('sphere')))
        groups = shells.fin_groups(fins, stats['finTriangles'])
        self.assertIn('pad', [g.kind for g in groups])
        self.assertEqual(sum(g.triangle_count for g in groups if g.kind == 'pad'),
                         stats['padTriangles'])


class Welding(unittest.TestCase):
    def test_two_touching_blocks_weld_into_one_closed_group(self):
        def block(x0, x1):
            v = [(x0, 0, 0), (x1, 0, 0), (x1, 1, 0), (x0, 1, 0),
                 (x0, 0, 1), (x1, 0, 1), (x1, 1, 1), (x0, 1, 1)]
            q = lambda a, b, c, d: [v[a], v[b], v[c], v[a], v[c], v[d]]   # noqa: E731
            t = q(0, 3, 2, 1) + q(4, 5, 6, 7) + q(0, 1, 5, 4) + q(2, 3, 7, 6) + q(1, 2, 6, 5) + q(0, 4, 7, 3)
            return [c for p in t for c in p]
        soup = block(0, 1) + block(0.9, 2)            # overlap: separate shells, one group
        self.assertEqual(len(shells.split_shells(soup)), 2)
        groups = shells.fin_groups(soup, len(soup) // 9)
        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0].open_edges(), 0)
        far = block(0, 1) + block(5, 6)
        self.assertEqual(len(shells.fin_groups(far, len(far) // 9)), 2)

    def test_a_flipped_triangle_is_turned_back_and_the_shell_faces_out(self):
        v = [(0, 0, 0), (1, 0, 0), (0, 1, 0), (0, 0, 1)]
        tet = [v[0], v[2], v[1], v[0], v[1], v[3], v[1], v[2], v[3], v[0], v[3], v[2]]
        soup = [c for p in tet for c in p]
        g = shells.weld(soup, range(4), 'pad')
        self.assertEqual(g.misoriented_edges(), 0)
        g.indices[3:6] = [g.indices[3], g.indices[5], g.indices[4]]     # flip one face
        self.assertGreater(g.misoriented_edges(), 0)
        shells.orient(g)
        self.assertEqual(g.misoriented_edges(), 0)
        self.assertGreater(shells.signed_volume(g), 0)
        g.indices = [i for t in range(4) for i in (g.indices[3 * t], g.indices[3 * t + 2], g.indices[3 * t + 1])]
        self.assertLess(shells.signed_volume(g), 0)                   # inside out...
        shells.orient(g)
        self.assertGreater(shells.signed_volume(g), 0)                # ...turned right way out

    def test_slivers_are_dropped(self):
        soup = [0, 0, 0, 1, 0, 0, 1, 0, 0.00001]       # two corners weld to one vertex
        g = shells.weld(soup, [0], 'fin')
        self.assertEqual(g.indices, [])


# ------------------------------------------------------------------ Fusion side
def mesh_design(soup_mm, parametric=True, up='Z'):
    APP.preferences.generalPreferences.defaultModelingOrientation = up
    design = fake_adsk.Design(parametric)
    body = fake_adsk.MeshBody([c / 10.0 for c in soup_mm], None, 'bracket', design.rootComponent)
    design.rootComponent.meshBodies.append(body)
    APP.activeProduct = design
    fins_command._app = APP
    return design, body


def dialog(bed, body=None, **over):
    s = dict(settings_store.DEFAULTS, **over)
    label = next(l for l, k in fins_command.STYLES if k == s['fin_style'])
    return fake_adsk.Inputs(
        bed=fake_adsk.SelInput([bed] if bed else []),
        body=fake_adsk.SelInput([body] if body else []),
        style=fake_adsk.Drop(label),
        layer=fake_adsk.Val(s['layer_height'] / 10.0),
        tines=fake_adsk.Val(s['fin_tines']),
        density=fake_adsk.Slider(s['fin_tine_density']),
        coverage=fake_adsk.Slider(s['fin_coverage']),
        pad=fake_adsk.Val(s['fin_bed_pad']),
        braces=fake_adsk.Val(s['sway_braces']),
        sway_from=fake_adsk.Val(s['sway_grip_from'] / 10.0),        # cm, as Fusion stores it
        sway_spacing=fake_adsk.Val(s['sway_tine_spacing'] / 10.0),
        sway_depth=fake_adsk.Slider(s['sway_depth']),
    )


@needs_engine
class FusionSide(unittest.TestCase):
    def setUp(self):
        fins_command._session.clear()
        fins_command.ENGINE = NodeEngine()

    def run_command(self, design, bed, body=None, **over):
        inputs = dialog(bed, body, **over)
        res = fins_command._compute(inputs)
        added = fb.add_fin_bodies(design, res['groups'], res['frame'], res['meta']) if res['groups'] else []
        return res, added

    def test_tilted_mesh_part_gets_fins_in_supports(self):
        part = posed(read_stl('lbracket'), 35, (40, 20, 0))
        design, body = mesh_design(part)
        root = design.rootComponent
        res, added = self.run_command(design, root.xYConstructionPlane)
        self.assertRegex(res['plain'][0], r'^\d+ walls?\b')
        self.assertTrue(added)
        supports = [o.component for o in root.occurrences if o.component.name == 'Supports']
        self.assertEqual(len(supports), 1)
        comp = supports[0]
        # each fin is its own Base Mesh Feature, grouped as one 'Support fins' in the
        # timeline; no empty wrapper base feature is left behind
        self.assertEqual(comp.base_features, [])
        groups = design.timeline.timelineGroups
        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0].name, 'Support fins')
        self.assertEqual(groups[0].end - groups[0].start + 1, len(added))
        names = [b.name for b in comp.meshBodies]
        self.assertEqual(names[0], 'Support fin 1')
        self.assertIn('Bed pad 1', names)
        self.assertTrue(all(fb.is_fin(b) and fb.is_support(b) for b in comp.meshBodies))
        # parametric: every body came in through an STL import into the base feature,
        # and the temp files are gone
        self.assertEqual(len(comp.meshBodies.imported), len(added))
        self.assertFalse(any(os.path.exists(pth) for pth in comp.meshBodies.imported))
        # centimetres, under the part, standing on the bed
        allc = [c for b in comp.meshBodies for c in b.coords]
        lo, hi = bbox(allc), bbox([c / 10.0 for c in part])
        self.assertAlmostEqual(lo[2], 0.0, places=4)
        self.assertLess(abs((lo[0] + lo[3]) / 2 - (hi[0] + hi[3]) / 2), 1.0)
        # the user's body is untouched, and the only body a new run would pick
        self.assertEqual(body.coords, [c / 10.0 for c in part])
        self.assertIs(fb.only_body(design), body)

    def test_second_run_numbers_on_and_is_counted(self):
        design, _ = mesh_design(posed(read_stl('lbracket'), 35))
        root = design.rootComponent
        _, first = self.run_command(design, root.xYConstructionPlane)
        self.assertEqual(fb.existing_fin_count(design), len(first))
        fins_command._session.clear()
        fins_command._session['earlier'] = fb.existing_fin_count(design)
        res, second = self.run_command(design, root.xYConstructionPlane)
        self.assertTrue(any('earlier run' in l for l in res['plain']))
        n_fins = sum(1 for b in first if b.name.startswith('Support fin'))
        self.assertEqual(second[0].name, 'Support fin %d' % (n_fins + 1))

    def test_direct_design_needs_no_base_feature(self):
        design, _ = mesh_design(posed(read_stl('torus'), 20), parametric=False)
        root = design.rootComponent
        _, added = self.run_command(design, root.xYConstructionPlane)
        comp = next(o.component for o in root.occurrences if o.component.name == 'Supports')
        self.assertTrue(added)
        self.assertEqual(comp.base_features, [])

    def test_y_up_design_standing_as_modelled(self):
        # model the tilted bracket with +Y up (swap y and z), floating 3 mm off the ground
        zup = posed(read_stl('lbracket'), 35)
        yup = []
        for i in range(0, len(zup), 3):
            x, y, z = zup[i:i + 3]
            yup += (x, z + 3.0, -y)
        design, body = mesh_design(yup, up='Y')
        _, added = self.run_command(design, body)            # bed = the part itself
        allc = [c for b in added for c in b.coords]
        self.assertAlmostEqual(min(allc[1::3]), 0.3, places=4)          # cm, along Y
        self.assertLessEqual(max(allc[1::3]), max(c / 10.0 for c in yup[1::3]) + 1e-4)

    def test_part_through_the_bed_is_refused_and_floating_is_flagged(self):
        part = posed(read_stl('lbracket'), 35, (0, 0, -5))
        design, _ = mesh_design(part)
        res = fins_command._compute(dialog(design.rootComponent.xYConstructionPlane))
        self.assertIn('below the bed', res['plain'][0])
        self.assertEqual(res['groups'], [])

        fins_command._session.clear()
        design, _ = mesh_design(posed(read_stl('lbracket'), 35, (0, 0, 4)))
        res = fins_command._compute(dialog(design.rootComponent.xYConstructionPlane))
        self.assertTrue(any('floats 4.0 mm' in l for l in res['plain']))

    def test_a_piece_not_joined_to_the_rest_is_flagged(self):
        # engines with floatingPieces report it in stats; the readout must say so
        design, _ = mesh_design(posed(read_stl('lbracket'), 35))
        real = engine_host.compute_fins

        def with_floating(soup, options=None):
            fins, st = real(soup, options)
            return fins, dict(st, floating=1, floatingDrop=4.25)
        engine_host.compute_fins = with_floating
        try:
            res = fins_command._compute(dialog(design.rootComponent.xYConstructionPlane))
        finally:
            engine_host.compute_fins = real
        self.assertIn('Check the model', res['plain'][1])
        self.assertIn('4.2 mm up', res['plain'][1])

    def test_a_bRep_body_in_two_lumps_counts_as_loose_pieces(self):
        class Lumps:
            count = 2
        class Body(fake_adsk.BRepBody):
            lumps = Lumps()
        self.assertEqual(fins_command._loose_pieces(Body()), 2)
        self.assertEqual(fins_command._loose_pieces(fake_adsk.MeshBody([0, 0, 0, 1, 0, 0, 0, 1, 0], None)), 1)

    def test_preview_result_carries_the_metadata(self):
        # the preview is kept as the result (execute never runs), so it must tag the bodies
        import json
        design, _ = mesh_design(posed(read_stl('torus'), 20))
        inputs = dialog(design.rootComponent.xYConstructionPlane, layer_height=0.16)
        args = types.SimpleNamespace(command=types.SimpleNamespace(commandInputs=inputs),
                                     isValidResult=False)
        fins_command._PreviewHandler().notify(args)
        self.assertTrue(args.isValidResult)
        comp = next(o.component for o in design.rootComponent.occurrences
                    if o.component.name == 'Supports')
        meta = json.loads(comp.meshBodies[0].attributes.itemByName('SupportFins', 'fin').value)
        self.assertEqual(meta['layer'], 0.16)
        self.assertEqual(meta['engine'], 'printfins.com')
        self.assertEqual(APP.logged, [])                  # nothing landed elsewhere

    def test_unknown_saved_style_falls_back_to_auto(self):
        self.assertEqual(fins_command._style(fake_adsk.Inputs(style=types.SimpleNamespace(
            selectedItem=None))), 'auto')

    def test_engine_error_blocks_the_dialog_in_words(self):
        design, _ = mesh_design(posed(read_stl('lbracket'), 35))
        fins_command._session['engine_error'] = 'no runtime here'
        res = fins_command._compute(dialog(design.rootComponent.xYConstructionPlane))
        self.assertEqual(res['groups'], [])
        self.assertIn('no runtime here', res['plain'])


class AsyncDialog(unittest.TestCase):
    """In Fusion the answer comes later: the dialog shows it is computing, then
    the readout refreshes and the preview re-runs when the palette posts back."""

    def setUp(self):
        fins_command._session.clear()
        self.queued = []
        test = self

        class Later:
            active = True

            def problem(self):
                return None

            def submit(self, key, soup, options, done):
                test.queued.append((key, soup, options, done))

        fins_command.ENGINE = Later()
        self.previews = []
        self.readout = types.SimpleNamespace(formattedText='')

    @needs_engine
    def test_pending_then_the_answer_lands_and_the_preview_reruns(self):
        design, _ = mesh_design(posed(read_stl('lbracket'), 35))
        inputs = dialog(design.rootComponent.xYConstructionPlane)
        inputs['readout'] = self.readout
        fins_command._session['command'] = types.SimpleNamespace(
            commandInputs=inputs, doExecutePreview=lambda: self.previews.append(1))
        res = fins_command._compute(inputs)
        self.assertTrue(res['pending'])
        self.assertIn('Computing fins…', res['plain'])
        self.assertIs(fins_command._compute(inputs), res)          # no second job
        self.assertEqual(len(self.queued), 1)
        key, soup, options, done = self.queued[0]
        fins, stats = engine_host.compute_fins(soup, options)
        done(key, fins, stats, None)
        self.assertEqual(self.previews, [1])
        final = fins_command._compute(inputs)
        self.assertFalse(final['pending'])
        self.assertTrue(final['groups'])
        self.assertIn(' walls, ', self.readout.formattedText)

    def test_a_late_answer_for_an_old_pick_is_ignored(self):
        design, _ = mesh_design(posed(read_stl('lbracket'), 35))
        inputs = dialog(design.rootComponent.xYConstructionPlane)
        fins_command._compute(inputs)
        old_key = self.queued[-1][0]
        fins_command._compute(dialog(design.rootComponent.xYConstructionPlane, fin_coverage=90))
        self.queued[0][3](old_key, None, None, 'late')
        self.assertTrue(fins_command._session['result']['pending'])


class Settings(unittest.TestCase):
    def test_a_save_keeps_keys_it_does_not_know(self):
        old = settings_store.PATH
        with tempfile.TemporaryDirectory() as d:
            settings_store.PATH = os.path.join(d, 'settings.json')
            try:
                with open(settings_store.PATH, 'w') as fh:
                    json.dump({'mode': 'auto', 'layer_height': 0.12}, fh)
                settings_store.save({'fin_coverage': 80, 'layer_height': 0.16})
                s = settings_store.load()
                self.assertEqual(s['fin_coverage'], 80)
                self.assertEqual(s['layer_height'], 0.16)
                with open(settings_store.PATH) as fh:
                    self.assertEqual(json.load(fh)['mode'], 'auto')
            finally:
                settings_store.PATH = old


if __name__ == '__main__':
    unittest.main()
