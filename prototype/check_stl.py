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


def bodies_of(path):
    m = trimesh.load(path, force='mesh')
    if len(m.faces) == 0:
        return None, []
    return m, m.split(only_watertight=False)


def check(case):
    fins_path = f'{case}-fins.stl'
    m, added = bodies_of(fins_path)
    if m is None:
        print(f'{case.split("/")[-1]:28} (no fins)')
        return True

    full = trimesh.load(f'{case}.stl', force='mesh')
    part = sorted(full.split(only_watertight=False), key=lambda b: -len(b.faces))[0]
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
    print(f'{case.split("/")[-1]:28} {len(added):4} solids  {len(walls)-len(gaps)}+{len(gaps)} wall/base'
          f'  {len(tines):4} tines  standoff {gap_txt:14}'
          f'  {"OK" if ok else "FAIL: " + "; ".join(problems)}')
    return ok


def check_props(case, added, part, pq):
    """A prop is judged by what it does NOT touch."""
    problems = []
    bad = [b for b in added if not (b.is_watertight and b.is_volume)]
    if bad:
        problems.append(f'{len(bad)} solids not watertight/volume')

    inside = 0
    gaps = []
    for b in added:
        inside += int((pq.signed_distance(b.vertices) > 1e-3).sum())
        # 2000 samples, computed once: signed_distance is the expensive call here
        # and a prop is a simple swept wall, not a shape that needs dense cover
        pts, _ = trimesh.sample.sample_surface(b, 2000)
        gaps.append(float(np.abs(pq.signed_distance(pts)).min()))
    if inside:
        problems.append(f'{inside} prop verts inside part (must not fuse)')

    # the closest approach IS the breakaway gap; too small welds, too large and
    # the part has nothing to land on
    gap_txt = ', '.join(f'{g:.3f}' for g in gaps) if gaps else 'n/a'
    if gaps and any(abs(g - STANDOFF) > 0.06 for g in gaps):
        problems.append(f'breakaway gap off spec ({gap_txt})')

    ok = not problems
    print(f'{case.split("/")[-1]:28} {len(added):4} solids  {len(added)} props'
          f'  {"":16} gap {gap_txt:14}'
          f'  {"OK" if ok else "FAIL: " + "; ".join(problems)}')
    return ok


def main(paths):
    cases = sorted({p[:-4] for p in paths
                    if p.endswith('.stl')
                    and not p.endswith(('-fins.stl', '-pad.stl'))})
    results = [check(c) for c in cases]
    print(f'\n{sum(results)}/{len(results)} cases clean')
    return 0 if all(results) else 1


if __name__ == '__main__':
    args = sys.argv[1:] or glob.glob('/tmp/sf-*.stl')
    sys.exit(main(args))
