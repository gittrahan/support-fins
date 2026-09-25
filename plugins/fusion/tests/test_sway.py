"""Sway braces (port of tests/sway.test.js from the support-fins repo).

Runs with plain Python, outside Fusion:

    C:\\Python312\\python.exe -m unittest discover -s tests -v

Built on plain blocks:
  - a tall post gets braces on its sides, and they are watertight;
  - the rib never fuses into the part -- only the tines bite in;
  - every tine is one layer tall, on the layer grid, and actually in the part;
  - the tines run all the way up, evenly;
  - "grip from" keeps tines below that height off;
  - a short part gets none, and says why;
  - a picked brace works on an upright side and refuses a top face;
  - the defaults match the website's (PLA, 0.2 mm layers, 6 mm spacing, 15% depth);
  - the Fusion layer's box-and-cut construction rebuilds each piece exactly;
  - the fence-cap sample matches the website's Auto result -- the pin that proves this
    port still agrees with web/sway.js. The model is a CUSTOMER ASSET and is in no repo,
    so this one skips loudly when it is not on the machine;
  - braces across a narrow channel are refused, staggered ones allowed;
  - auto on the channel never stands two braces into each other;
  - the stilt limit: auto refuses a brace that stands far up before its first tine,
    a picked one builds and reports it, and "grip from" is not treated as a stilt.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'SupportFins'))

from sway_core import sway                                  # noqa: E402
from sway_core.geometry import Mesh, in_box, is_closed, ray_hit, signed_volume  # noqa: E402
from sway_core.patches import grow_wall_patches, make_patch, patch_at_point, patches_from_mesh  # noqa: E402

# The fence cap is a CUSTOMER ASSET and is deliberately in neither repo (both
# .gitignore *.stl). It is the pin that proves this port still agrees with
# web/sway.js -- it is what caught the 102 -> 120 drift when the stilt limit
# landed -- so a run without it is a WEAKER run, not a passing one. Hence the
# warning below: a silent skip once let that pin sit unrun on any machine but
# Mitch's. Point SUPPORT_FINS_FENCE_CAP at the file to use a copy elsewhere.
FENCE_CAP = os.environ.get('SUPPORT_FINS_FENCE_CAP') or os.path.join(
    os.path.dirname(os.path.abspath(__file__)), '..', '..', 'support-fins',
    'Samples', 'Fence Cap-45 Degree Vertical-Rev 3.stl')
HAVE_FENCE_CAP = os.path.exists(FENCE_CAP)
if not HAVE_FENCE_CAP:
    print('\n*** website-agreement pin NOT RUN: the fence cap sample is not on this machine.\n'
          '    Everything else still runs. Set SUPPORT_FINS_FENCE_CAP to its path to include it.\n'
          '    (The model is a customer asset and is not committed to either repo.)\n',
          file=sys.stderr)

LAYER = 0.2


def block(x0, x1, y0, y1, z0, z1):
    """An axis-aligned box as 12 outward-wound triangles."""
    v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
         (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    quads = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
             (2, 3, 7, 6), (1, 2, 6, 5), (3, 0, 4, 7)]
    tris = []
    for a, b, c, d in quads:
        tris.append((v[a], v[b], v[c]))
        tris.append((v[a], v[c], v[d]))
    return tris


def post(h=150):
    """A 40 x 30 x h mm post -- tall and slender, the case sway braces exist for."""
    mesh = Mesh(block(-20, 20, -15, 15, 0, h))
    return mesh, [p for p, _ in patches_from_mesh(mesh)]


def channel():
    """Two 80 x 10 x 150 walls with a 40 mm channel between them."""
    mesh = Mesh(block(-40, 40, -30, -20, 0, 150) + block(-40, 40, 20, 30, 0, 150))
    return mesh, patches_from_mesh(mesh)


def face_patch(groups, ny, y):
    """The patch whose normal points along ±y at plane y."""
    for p, _ in groups:
        if p.n[1] * ny > 0.9 and abs(p.d - y * p.n[1]) < 1e-6:
            return p
    raise AssertionError('no face at y=%s' % y)


def opts(**kw):
    o = {'tines': True, 'layer_height': LAYER}
    o.update(kw)
    return o


def tines_of(ribs):
    return [t for r in ribs for t in r.prisms if t.kind == 'tine']


class SwayTests(unittest.TestCase):

    def assert_watertight(self, ribs):
        for r in ribs:
            for pr in r.prisms:
                tris = pr.triangles()
                self.assertTrue(is_closed(tris), '%s is not closed' % pr.kind)
                self.assertGreater(signed_volume(tris), 0, '%s is wound inward' % pr.kind)

    def test_tall_post_gets_watertight_braces(self):
        mesh, patches = post()
        s = sway.build_sway_braces(mesh, patches, opts())
        self.assertGreaterEqual(s.count, 2, 'expected braces on a 150mm post (%s)' % s.reason)
        self.assert_watertight(s.ribs)

    def test_rib_never_fuses_into_part(self):
        mesh, patches = post()
        s = sway.build_sway_braces(mesh, patches, opts(tines=False))
        self.assertGreaterEqual(s.count, 2, 'no braces to check')
        inside = 0
        for r in s.ribs:
            for pr in r.prisms:
                for tri in pr.triangles():
                    for x, y, z in tri:
                        # lifted a hair off the bed, where the parity ray runs
                        # along the block's bottom edge
                        if mesh.inside(x, y, max(z, 1e-3)):
                            inside += 1
        self.assertEqual(inside, 0, '%d rib verts are inside the part' % inside)

    def test_tines_one_layer_on_grid_and_bite(self):
        mesh, patches = post()
        s = sway.build_sway_braces(mesh, patches, opts())
        tines = tines_of(s.ribs)
        self.assertEqual(len(tines), s.tines)
        self.assertGreater(len(tines), 0)
        for t in tines:
            lo, hi = t.bbox()
            self.assertAlmostEqual(hi[2] - lo[2], LAYER, places=6)
            k = lo[2] / LAYER
            self.assertAlmostEqual(k, round(k), places=6, msg='tine at z=%s is off the grid' % lo[2])
            z_mid = (lo[2] + hi[2]) / 2
            corners = [(lo[0], lo[1]), (lo[0], hi[1]), (hi[0], lo[1]), (hi[0], hi[1])]
            self.assertTrue(any(mesh.inside(x, y, z_mid) for x, y in corners),
                            'tine at z=%.2f grips nothing' % z_mid)

    def test_tines_run_all_the_way_up_evenly(self):
        H = 150
        mesh, patches = post(H)
        s = sway.build_sway_braces(mesh, patches, opts(tine_spacing=6))
        top = max(t.bbox()[0][2] for t in tines_of(s.ribs))
        self.assertGreater(top, 0.9 * H, 'highest tine at %.1fmm on a %dmm post' % (top, H))
        for r in s.ribs:
            zs = sorted(t.bbox()[0][2] for t in r.prisms if t.kind == 'tine')
            for a, b in zip(zs, zs[1:]):
                self.assertLessEqual(abs((b - a) - 6), LAYER + 1e-6, 'tine gap %.2fmm, asked for 6' % (b - a))

    def test_grip_from_keeps_low_tines_off(self):
        mesh, patches = post()
        s = sway.build_sway_braces(mesh, patches, opts(grip_from=80))
        zs = [t.bbox()[0][2] for t in tines_of(s.ribs)]
        self.assertTrue(zs, 'no tines at all')
        self.assertGreaterEqual(min(zs), 80 - LAYER)

    def test_short_part_gets_none_and_says_why(self):
        mesh, patches = post(20)
        s = sway.build_sway_braces(mesh, patches, opts())
        self.assertEqual(s.count, 0)
        self.assertTrue(isinstance(s.reason, str) and s.reason)

    def test_picked_brace_on_side_refuses_top(self):
        mesh, _ = post()
        side = [t for t in mesh.tris if all(abs(v[1] + 15) < 1e-9 for v in t)]   # the -Y side
        roof = [t for t in mesh.tris if all(abs(v[2] - 150) < 1e-9 for v in t)]
        p_side, why = make_patch(side)
        self.assertIsNotNone(p_side, why)
        self.assertLessEqual(p_side.lean_deg, sway.SWAY['maxLeanDeg'])
        p_roof, why_roof = make_patch(roof)
        self.assertIsNone(p_roof)
        refused = sway.sway_at_face(mesh, p_roof, (0, 0, 150), opts())
        self.assertFalse(refused.ok)
        self.assertTrue(refused.reason)
        self.assertTrue(why_roof)

        r = sway.sway_at_face(mesh, p_side, (0, -15, 60), opts())
        self.assertTrue(r.ok, r.reason)
        self.assertGreater(r.height, 100)
        self.assert_watertight([r])

    def test_leaning_face_is_refused(self):
        # a wedge whose sloped side leans 45 degrees: too far for a brace
        mesh, _ = post()
        slope = [((0, 0, 0), (100, 0, 0), (100, 100, 100)), ((0, 0, 0), (100, 100, 100), (0, 100, 100))]
        p, _ = make_patch(slope)
        self.assertIsNotNone(p)
        r = sway.build_rib(p, (p.u0 + p.u1) / 2, mesh, opts())
        self.assertFalse(r.ok)
        self.assertIn('leans', r.reason)

    def test_defaults(self):
        s = sway.settings()
        self.assertTrue(s['tines'])
        self.assertEqual(s['layerH'], 0.2)
        self.assertEqual(s['gap'], 0.2)
        self.assertEqual(s['bite'], 0.3)
        self.assertEqual(s['spacing'], 6)
        self.assertEqual(s['reach'], 0.15)
        self.assertEqual(s['gripFrom'], 0)
        self.assertEqual(sway.MATERIALS['PETG'], {'gap': 0.3, 'bite': 0.15})

    def test_channel_across_refused_staggered_allowed(self):
        mesh, groups = channel()
        in_a = face_patch(groups, 1, -20)     # wall A's channel face, facing +y
        in_b = face_patch(groups, -1, 20)     # wall B's channel face, facing -y
        first = sway.sway_at_face(mesh, in_a, (0, -20, 60), opts())
        self.assertTrue(first.ok, first.reason)
        across = sway.sway_at_face(mesh, in_b, (0, 20, 60), opts(), [first])
        self.assertFalse(across.ok, 'a brace straight across the channel was built')
        self.assertIn('run into another brace', across.reason)
        staggered = sway.sway_at_face(mesh, in_b, (20, 20, 60), opts(), [first])
        self.assertTrue(staggered.ok, staggered.reason)
        self.assertFalse(sway.clashes(staggered, [first]))

    def test_auto_on_channel_never_clashes(self):
        mesh, groups = channel()
        s = sway.build_sway_braces(mesh, [p for p, _ in groups], opts())
        self.assertGreaterEqual(s.count, 2)
        self.assert_watertight(s.ribs)
        for i, r in enumerate(s.ribs):
            self.assertFalse(sway.clashes(r, s.ribs[:i] + s.ribs[i + 1:]))

    def test_click_finds_its_patch(self):
        mesh, _ = post()
        groups = grow_wall_patches(mesh)
        p, why = patch_at_point(mesh, groups, (5, -15, 60))
        self.assertIsNotNone(p, why)
        self.assertLess(p.n[1], -0.99)
        r = sway.sway_at_face(mesh, p, (5, -15, 60), opts())
        self.assertTrue(r.ok, r.reason)
        roof, why = patch_at_point(mesh, groups, (0, 0, 150))
        self.assertIsNone(roof)
        self.assertIn('not a side', why)
        off, why = patch_at_point(mesh, groups, (0, -40, 60))
        self.assertIsNone(off)

    @unittest.skipUnless(HAVE_FENCE_CAP, 'fence cap sample not on this machine (customer asset, never committed)')
    def test_fence_cap_matches_website(self):
        sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'tools'))
        from stl_io import read_stl
        tris = read_stl(FENCE_CAP)
        z0 = min(v[2] for t in tris for v in t)
        mesh = Mesh([tuple((x, y, z - z0) for x, y, z in t) for t in tris])
        s = sway.build_sway_braces(mesh, [p for p, _ in grow_wall_patches(mesh)], opts())
        # the website (PLA, 0.2mm layers, defaults): 4 braces, 120 tines, 1 column
        # skipped. It was 102 before the stilt limit: the column at the gable peak
        # starts high, so auto now skips it and the nudge finds a neighbouring one
        # that grips lower -- same 4 braces, tied on lower and more often.
        self.assertEqual((s.count, s.tines, s.skipped), (4, 120, 1))

    def test_click_ray_finds_the_near_face(self):
        # a click is a ray from the camera; it must land on the face you see
        mesh, _ = post()
        hit = ray_hit(mesh.tris, (5, -100, 60), (0, 1, 0))
        self.assertIsNotNone(hit)
        for got, want in zip(hit, (5, -15, 60)):
            self.assertAlmostEqual(got, want, places=6)
        self.assertIsNone(ray_hit(mesh.tris, (5, -100, 60), (0, -1, 0)))   # facing away
        self.assertIsNone(ray_hit(mesh.tris, (50, -100, 60), (0, 1, 0)))   # misses the part

    def test_box_decomposition_rebuilds_each_prism(self):
        # the Fusion layer builds each piece as a box minus cutter boxes; that
        # has to be exactly the prism, including a leaning face's slanted rib
        import random
        mesh, patches = post()
        ribs = sway.build_sway_braces(mesh, patches, opts()).ribs
        lean = [((0, 0, 0), (100, 0, 0), (100, 20, 150)), ((0, 0, 0), (100, 20, 150), (0, 20, 150))]
        p, _ = make_patch(lean)
        ribs.append(sway.build_rib(p, 50, Mesh(lean + [((0, 0, 0), (0, 20, 150), (100, 20, 150))]),
                                   opts(tines=False)))
        rng = random.Random(1)
        pieces = [pr for r in ribs if r.ok for pr in r.prisms]
        self.assertTrue(any(len(pr.boxes()[1]) == 2 for pr in pieces), 'no slanted rib was tested')
        for pr in pieces:
            box, cutters = pr.boxes()
            for _ in range(300):
                a = rng.uniform(-1, 1) * box[3] / 2
                b = rng.uniform(-1, 1) * box[4] / 2
                c = rng.uniform(-1, 1) * box[5] / 2
                q = tuple(box[0][k] + a * box[1][k] + b * box[2][k] + c * pr.ec[k] for k in range(3))
                built = in_box(q, box) and not any(in_box(q, cu) for cu in cutters)
                qa = sum(q[k] * pr.ea[k] for k in range(3))
                qb = sum(q[k] * pr.eb[k] for k in range(3))
                inside = _in_convex(pr.poly, qa, qb)
                if abs(_edge_dist(pr.poly, qa, qb)) > 1e-6:
                    self.assertEqual(built, inside, '%s mismatch at %s' % (pr.kind, q))


def _in_convex(poly, x, y):
    s = [(b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])
         for a, b in zip(poly, poly[1:] + poly[:1])]
    return all(v >= 0 for v in s) or all(v <= 0 for v in s)


def _edge_dist(poly, x, y):
    import math
    best = math.inf
    for a, b in zip(poly, poly[1:] + poly[:1]):
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        if L:
            best = min(best, abs((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])) / L)
    return best


if __name__ == '__main__':
    unittest.main()


class StiltTests(unittest.TestCase):
    """The stilt limit (ported from web/sway.js): below its first tine a brace
    holds nothing and nothing holds it, so auto won't stand a tall one. A brace
    the user picks builds anyway and reports how far it stands."""

    def raised(self):
        """A wide block held 70 mm up on a narrow pedestal: its sides start high."""
        mesh = Mesh(block(-8, 8, -8, 8, 0, 70) + block(-20, 20, -15, 15, 70, 150))
        return mesh, patches_from_mesh(mesh)

    def side_above(self, groups):
        for p, _ in groups:
            if p.n[1] < -0.9 and p.z1 > 140:
                return p
        raise AssertionError('no raised side face found')

    def test_auto_refuses_a_stilt(self):
        mesh, groups = self.raised()
        s = sway.build_sway_braces(mesh, [p for p, _ in groups], opts())
        self.assertEqual(s.count, 0, 'auto stood %d braces on stilts' % s.count)

    def test_a_picked_brace_builds_one_and_reports_it(self):
        mesh, groups = self.raised()
        r = sway.sway_at_face(mesh, self.side_above(groups), (0, -15, 110), opts())
        self.assertTrue(r.ok, 'a picked brace was refused: %s' % r.reason)
        self.assertGreater(r.stilt, 60, 'stilt reported as %.1fmm, expected ~70' % r.stilt)

    def test_the_rule_can_still_be_enforced_on_a_picked_brace(self):
        mesh, groups = self.raised()
        r = sway.sway_at_face(mesh, self.side_above(groups), (0, -15, 110),
                              opts(allow_stilt=False))
        self.assertFalse(r.ok)
        self.assertIn('holding nothing', r.reason)

    def test_grip_from_is_the_users_choice_not_a_stilt(self):
        # gripping only above 80mm on a part whose face reaches the plate is
        # deliberate, and must still build.
        mesh, patches = post()
        s = sway.build_sway_braces(mesh, patches, opts(grip_from=80))
        self.assertGreaterEqual(s.count, 2,
                                '"grip from" was refused as a stilt (%s)' % s.reason)

    def test_a_normal_post_reports_no_stilt(self):
        mesh, patches = post()
        s = sway.build_sway_braces(mesh, patches, opts())
        for r in s.ribs:
            self.assertLess(r.stilt, 5, 'a plate-reaching face reported a %.1fmm stilt' % r.stilt)
