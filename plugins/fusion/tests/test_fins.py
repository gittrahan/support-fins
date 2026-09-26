"""Insert Support Fins: the engine host, the mesh reshaping, and the Fusion side
run against fake_adsk.

    python3 plugins/fusion/build.py --no-vendor     # writes SupportFins/engine/fins_engine.js
    python3 -m unittest discover -s plugins/fusion/tests -v

Needs mini-racer (`pip install mini-racer==0.14.1`) or a vendored lib/<platform>/.
The engine tests skip, saying why, when the bundle or the runtime is missing.

Pinned here:
  - the host runs the website's engine and hands the fins back in the part's own
    frame, wherever the part sits on the plate (same fins, just moved);
  - every body the command makes is a closed mesh, fins before pads;
  - the dialog's settings map onto the engine's options;
  - through the fake Fusion API: a mesh part tilted on the XY bed gets fins in a
    Supports component, inside a base feature, named and tagged; a second run
    numbers on and is counted; a direct design adds bodies without a base feature;
    a Y-up design standing "as modelled" puts the fins under the part along Y;
    a part through the bed is refused, a floating one is flagged;
  - the two commands share settings.json without wiping each other's keys.
"""

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

ENGINE_OK, ENGINE_WHY = engine_host.available()
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

    def test_a_part_with_nothing_to_hold_gets_nothing(self):
        cube = posed(read_stl('cube'))
        fins, stats = engine_host.compute_fins(cube)
        self.assertEqual(len(fins), 0)
        self.assertEqual(stats['overhangRegions'], 0)

    def test_a_context_closed_under_the_host_is_replaced(self):
        # Fusion's Stop/Run (or a second copy of the module) can close the V8
        # context the host holds; the next run must start a new one, not fail
        part = posed(read_stl('lbracket'), 35)
        _, before = engine_host.compute_fins(part)
        engine_host._engine().close()
        _, after = engine_host.compute_fins(part)
        self.assertEqual(before, after)

    def test_empty_soup_is_refused_in_words(self):
        with self.assertRaises(engine_host.EngineError):
            engine_host.compute_fins([])


class RuntimeFetch(unittest.TestCase):
    """The small build fetches mini-racer on first run: pinned, checked, atomic."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.saved = (engine_host.LIB, dict(engine_host.RUNTIME))
        engine_host.LIB = os.path.join(self.tmp, 'lib')
        wheels = [os.path.join(d, f) for d in (os.environ.get('SF_WHEEL_DIR', ''),)
                  if d and os.path.isdir(d) for f in os.listdir(d) if f.endswith('.whl')]
        if not wheels:
            self.skipTest('set SF_WHEEL_DIR to a folder holding a mini-racer wheel')
        self.wheel = wheels[0]
        import hashlib
        with open(self.wheel, 'rb') as fh:
            self.sha = hashlib.sha256(fh.read()).hexdigest()

    def tearDown(self):
        import shutil
        engine_host.LIB, rt = self.saved
        engine_host.RUNTIME.clear()
        engine_host.RUNTIME.update(rt)
        shutil.rmtree(self.tmp, ignore_errors=True)

    def url(self):
        import pathlib
        return pathlib.Path(self.wheel).resolve().as_uri()

    def test_fetch_unpacks_only_py_mini_racer(self):
        engine_host.RUNTIME['test'] = (self.url(), self.sha)
        engine_host.fetch_runtime('test')
        self.assertTrue(engine_host.runtime_present('test'))
        self.assertEqual(os.listdir(os.path.join(engine_host.LIB, 'test')), ['py_mini_racer'])
        engine_host.fetch_runtime('test')                  # second call: a no-op

    def test_a_bad_checksum_is_refused_and_leaves_nothing(self):
        engine_host.RUNTIME['test'] = (self.url(), '0' * 64)
        with self.assertRaises(engine_host.EngineError):
            engine_host.fetch_runtime('test')
        self.assertFalse(engine_host.runtime_present('test'))

    def test_pins_cover_every_released_platform(self):
        for tag in ('win_amd64', 'macosx_arm64', 'macosx_x86_64'):
            url, sha = self.saved[1][tag]
            self.assertTrue(url.startswith('https://files.pythonhosted.org/'), tag)
            self.assertIn(engine_host.MINI_RACER, url)
            self.assertEqual(len(sha), 64)


class HostPlumbing(unittest.TestCase):
    def test_platform_tag_names_a_vendored_folder(self):
        self.assertIn(engine_host.platform_tag(),
                      ('win_amd64', 'macosx_arm64', 'macosx_x86_64', 'linux_x86_64'))

    def test_dialog_settings_map_onto_engine_options(self):
        s = dict(settings_store.DEFAULTS, fin_style='prop', fin_tine_density=40,
                 fin_coverage=120, fin_bed_pad=False, layer_height=0.28)
        o = fins_command.engine_options(s)
        self.assertEqual(o, {'mode': 'prop', 'bedPad': False, 'tines': True, 'tineDensity': 0.4,
                             'coverage': 1.0, 'layerHeight': 0.28})
        d = fins_command.engine_options(settings_store.DEFAULTS)
        for k, v in engine_host.DEFAULTS.items():        # untouched dialog == the website
            self.assertEqual(d[k], v, k)


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

    def test_sphere_pad_only(self):
        fins, stats = engine_host.compute_fins(posed(read_stl('sphere')))
        groups = shells.fin_groups(fins, stats['finTriangles'])
        self.assertTrue(all(g.kind == 'pad' for g in groups))


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
    )


@needs_engine
class FusionSide(unittest.TestCase):
    def setUp(self):
        fins_command._session.clear()

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
        self.assertIn('fin', res['plain'][0])
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


class SharedSettings(unittest.TestCase):
    def test_each_command_keeps_the_others_keys(self):
        old = settings_store.PATH
        with tempfile.TemporaryDirectory() as d:
            settings_store.PATH = os.path.join(d, 'settings.json')
            try:
                settings_store.save({'fin_coverage': 80, 'layer_height': 0.12})
                settings_store.save({'mode': 'auto', 'layer_height': 0.16})   # sway's save
                s = settings_store.load()
                self.assertEqual(s['fin_coverage'], 80)
                self.assertEqual(s['mode'], 'auto')
                self.assertEqual(s['layer_height'], 0.16)
            finally:
                settings_store.PATH = old


if __name__ == '__main__':
    unittest.main()
