"""
Judge an exported STL the way a slicer and a printer would.

    python3 check_stl.py /tmp/sf-*.stl

Expects the naming written by verify_fins.js: `<case>.stl` (part + everything
added), `<case>-fins.stl` (fins only), `<case>-pad.stl` (pad only, if any).

Five things are checked, and each one exists because it caught a real bug:

  watertight/is_volume  a solid the slicer can union at all
  wall not in part      a fin fused to the part is not a breakaway fin
  tines fuse to part    a tine that misses is a divot with no grip
  tines touch the wall  tines were once 13.6mm from their own fin, which prints
                        as a scatter of loose specks (a broken patch frame)
  standoff              the gap should measure the spec's 0.2mm, not "roughly"

The pad is deliberately NOT held to the wall rule: it is meant to fuse.
"""
import sys
import glob
import numpy as np
import trimesh

WALL_MIN_VOL = 20.0     # mm^3; below this a body is a tine, not a wall or base
TINE_MAX_VOL = 5.0
STANDOFF = 0.2
# The project's own non-fusing clearance, same number as the breakaway gap: if
# 0.2mm is enough for the part to bridge over the top without welding, it is
# enough beside a flank. prop.js targets 0.35 so there is margin to lose.
FLANK_MIN = 0.20

# Mirrors web/overhangs.js constant-for-constant, same as spike_overhangs.py.
OVERHANG_COS = np.cos(np.radians(45)) + 1e-4
BED_EPS = 0.35
# One dial, one owner: the generator's PROP.maxUnsupportedSpan is the value,
# read out of prop.js so the checker cannot drift from it. The literal here is
# only the fallback if the parse ever fails (and it warns when that happens).
def _span_from_generator():
    import re, pathlib
    prop_js = pathlib.Path(__file__).resolve().parent.parent / 'web' / 'prop.js'
    try:
        m = re.search(r'maxUnsupportedSpan:\s*([0-9.]+)', prop_js.read_text())
        if m:
            return float(m.group(1))
    except OSError:
        pass
    print('  ! could not read maxUnsupportedSpan from web/prop.js; using 12.0')
    return 12.0

MAX_UNSUPPORTED_SPAN = _span_from_generator()   # mm; the dial M7b exposes


def coverage(case, added):
    """What fraction of the part's overhang area actually has a support under it.

    THE METRIC THE CHECKER NEVER HAD. Everything else in this file asks whether
    the support is CLEAN -- watertight, outside the part, correctly spaced. None
    of it asks whether the support holds anything up, so a 4.5mm brace under
    3,403 mm2 of overhang passed every gate in the repo. The scoreboard has to
    measure the thing you actually want.

    A point counts as served when some added solid has a vertex within
    MAX_UNSUPPORTED_SPAN of it horizontally AND at roughly its own height -- i.e.
    a wall top stopping just under it. Height matters: without it, a wall's
    flared foot would "serve" every overhang it happens to stand near in plan
    view, which is exactly the false pass this metric exists to prevent.

    Reported as a percentage of overhang AREA, not of regions or faces, because
    area is what fails to print.
    """
    part = part_of(case)
    tri = part.triangles
    n = part.face_normals
    zmax = tri[:, :, 2].max(axis=1)
    zmin = part.vertices[:, 2].min()

    over = (n[:, 2] < -OVERHANG_COS) & (zmax - zmin >= BED_EPS)
    if not over.any():
        return None, 0.0
    cent = tri[over].mean(axis=1)
    area = part.area_faces[over]

    sup = np.vstack([b.vertices for b in added]) if added else np.empty((0, 3))
    if len(sup) == 0:
        return 0.0, float(area.sum())

    served = np.zeros(len(cent), dtype=bool)
    for i, c in enumerate(cent):
        near_z = sup[(sup[:, 2] > c[2] - 3.0) & (sup[:, 2] < c[2] + 0.5)]
        if len(near_z) == 0:
            continue
        d = np.hypot(near_z[:, 0] - c[0], near_z[:, 1] - c[1])
        served[i] = d.min() <= MAX_UNSUPPORTED_SPAN

    return 100.0 * area[served].sum() / area.sum(), float(area.sum())


def bodies_of(path):
    m = trimesh.load(path, force='mesh')
    if len(m.faces) == 0:
        return None, []
    return m, m.split(only_watertight=False)


def part_of(case):
    """The part alone, against which every clearance is measured.

    Prefer the `-part.stl` sidecar. The fallback -- largest body of the combined
    file -- is wrong for a MULTI-BODY part, and wrong in a way that reads as a
    geometry bug: hub_corner.stl is two solids, so a prop correctly stopping
    0.2mm under the smaller one was measured against the larger and reported a
    13.4mm breakaway gap. That phantom was recorded in the roadmap as a real
    defect in the wall's height fitting.
    """
    try:
        return trimesh.load(f'{case}-part.stl', force='mesh')
    except Exception:
        full = trimesh.load(f'{case}.stl', force='mesh')
        print(f'  ! {case.split("/")[-1]}: no -part.stl, falling back to the '
              f'largest body (wrong for multi-body parts)')
        return sorted(full.split(only_watertight=False),
                      key=lambda b: -len(b.faces))[0]


def check(case):
    fins_path = f'{case}-fins.stl'
    m, added = bodies_of(fins_path)
    if m is None:
        # NOT a pass. This used to `return True`, so a case where the tool built
        # nothing at all counted toward the clean score exactly like a case where
        # it built a good support -- which is how "12/16 cases clean" was recorded
        # for a matrix in which 11 of the 16 produced no geometry whatsoever.
        # An empty result is a coverage failure; it is only not a CORRECTNESS
        # failure, so it gets its own bucket rather than being folded into either.
        cov, tot = coverage(case, [])
        print(f'{case.split("/")[-1]:28} EMPTY -- nothing built'
              f'{"":42}  cov   0%  of {tot:6.0f} mm2')
        return None, (0.0 if cov is not None else None), tot

    part = part_of(case)
    pq = trimesh.proximity.ProximityQuery(part)

    walls = [b for b in added if b.volume > WALL_MIN_VOL]
    tines = [b for b in added if b.volume < TINE_MAX_VOL]
    problems = []

    # A PROP has no tines by design: it stops short of the part so the part
    # bridges the last layer and it snaps off. Its assertions are therefore the
    # inverse of a fin's -- nothing may fuse, and the gap is the whole point.
    if not tines:
        return check_props(case, added, part, pq)

    bad = [b for b in added if not (b.is_watertight and b.is_volume)]
    if bad:
        problems.append(f'{len(bad)} solids not watertight/volume')

    # walls and bases must stay out of the part
    inside = 0
    for b in walls:
        inside += int((pq.signed_distance(b.vertices) > 1e-3).sum())
    if inside:
        problems.append(f'{inside} wall/base verts inside part')

    # every tine must bite the part AND be joined to a wall
    no_bite = no_grip = 0
    wall_q = [trimesh.proximity.ProximityQuery(w) for w in walls]
    for t in tines:
        if (pq.signed_distance(t.vertices) > 0).sum() == 0:
            no_bite += 1
        if wall_q and min(abs(q.signed_distance(t.vertices)).min() for q in wall_q) > 0.5:
            no_grip += 1
    if no_bite:
        problems.append(f'{no_bite} tines fuse nothing')
    if no_grip:
        problems.append(f'{no_grip} tines detached from wall')

    # The standoff is the wall's CLOSEST approach to the part, sampled over its
    # surface. Not the median: a wall whose face is only partly covered by its
    # patch has most of its area further away, which drags a median upward and
    # reports a defect that is not there. Closest approach is what "spaced 0.2mm
    # away" actually means.
    gaps = []
    for b in walls:
        if len(b.vertices) > 40:        # the base ellipse, not a wall
            continue
        pts, _ = trimesh.sample.sample_surface(b, 6000)
        d = pq.signed_distance(pts)
        if len(d):
            gaps.append(float(np.abs(d).min()))
    gap_txt = ', '.join(f'{g:.3f}' for g in gaps) if gaps else 'n/a'
    if gaps and any(abs(g - STANDOFF) > 0.05 for g in gaps):
        problems.append(f'standoff off spec ({gap_txt})')

    ok = not problems
    cov, tot = coverage(case, added)
    print(f'{case.split("/")[-1]:28} {len(added):4} solids  {len(walls)-len(gaps)}+{len(gaps)} wall/base'
          f'  {len(tines):4} tines  standoff {gap_txt:14}'
          f'  cov {0 if cov is None else cov:3.0f}%  of {tot:6.0f} mm2'
          f'  {"OK" if ok else "FAIL: " + "; ".join(problems)}')
    return ok, cov, tot


def check_props(case, added, part, pq):
    """A prop is judged by what it does NOT touch.

    TWO different clearances, which this used to conflate into one number and
    then fail walls that were correct. They are different physical requirements:

      breakaway gap   the wall's TOP to the part directly above it. Must be
                      ~0.2mm: smaller welds, larger and the part has nothing to
                      bridge onto.
      flank clearance the wall's SIDES to anything beside them. Must simply be
                      big enough never to fuse -- there is no upper bound, and
                      holding it to 0.2 +/- 0.06 failed walls whose flanks were
                      correctly standing well clear.

    Told apart by WHERE the part is relative to the sample, not by the wall's
    parameterisation: if the nearest part surface is above the sample, that is
    the breakaway interface; if it is off to the side, that is a flank.
    """
    problems = []
    bad = [b for b in added if not (b.is_watertight and b.is_volume)]
    if bad:
        problems.append(f'{len(bad)} solids not watertight/volume')

    inside = 0
    tops, flanks = [], []
    for b in added:
        inside += int((pq.signed_distance(b.vertices) > 1e-3).sum())
        pts, _ = trimesh.sample.sample_surface(b, 4000)
        close, dist, _ = pq.on_surface(pts)
        vec = close - pts
        norm = np.linalg.norm(vec, axis=1)
        with np.errstate(invalid='ignore', divide='ignore'):
            above = np.where(norm > 1e-9, vec[:, 2] / norm, 0.0) > 0.7
        if above.any():
            tops.append(float(dist[above].min()))
        if (~above).any():
            flanks.append(float(dist[~above].min()))
    if inside:
        problems.append(f'{inside} prop verts inside part (must not fuse)')

    gap_txt = ', '.join(f'{g:.3f}' for g in tops) if tops else 'n/a'
    if tops and any(abs(g - STANDOFF) > 0.06 for g in tops):
        problems.append(f'breakaway gap off spec ({gap_txt})')
    if flanks and min(flanks) < FLANK_MIN:
        problems.append(f'flank {min(flanks):.3f} < {FLANK_MIN} (would weld)')

    ok = not problems
    cov, tot = coverage(case, added)
    print(f'{case.split("/")[-1]:28} {len(added):4} solids  {len(added)} props'
          f'  {"":16} gap {gap_txt:14}'
          f'  cov {0 if cov is None else cov:3.0f}%  of {tot:6.0f} mm2'
          f'  {"OK" if ok else "FAIL: " + "; ".join(problems)}')
    return ok, cov, tot


def main(paths):
    cases = sorted({p[:-4] for p in paths
                    if p.endswith('.stl')
                    and not p.endswith(('-fins.stl', '-pad.stl', '-part.stl'))})
    results = [check(c) for c in cases]
    built = [r for r in results if r[0] is not None]
    empty = len(results) - len(built)
    clean = sum(1 for r in built if r[0])

    # Area-weighted across the whole matrix, so one big part cannot be hidden by
    # a handful of small ones that happen to be easy.
    tot = sum(r[2] for r in results)
    got = sum((r[1] or 0.0) / 100.0 * r[2] for r in results)
    print(f'\n{clean}/{len(results)} cases produced a clean support'
          f'  ({len(built) - clean} built but failed, {empty} built nothing)')
    print(f'overhang coverage: {100 * got / tot if tot else 0:.0f}% of {tot:.0f} mm2'
          f'  (within {MAX_UNSUPPORTED_SPAN:.0f} mm of a support)')
    return 0 if clean == len(results) else 1


if __name__ == '__main__':
    args = sys.argv[1:] or glob.glob('/tmp/sf-*.stl')
    sys.exit(main(args))
