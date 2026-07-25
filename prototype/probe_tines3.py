"""
PROBE 3: is there a near-VERTICAL part face beside each overhang that a fin can
stand against?

Probes 1-2 showed horizontal tines can't come off a wall that passes UNDER the
contact line: a wall can be under the line OR above it, never both (it would
have to pinch to zero thickness at the contact height). So the fin has to stand
BESIDE the part, off a near-vertical face, and let the TINES carry the load --
which is what "combined support" means.

That only works if such a face exists. Per overhang region: fire horizontal rays
outward from a vertical axis through the region centroid, at a ladder of heights
from the bed up to the overhang, in NDIR compass directions. A direction whose
surface distance stays ~constant over a tall z-range IS a vertical face.

Reports, for the best direction per region: the wall radius, the fraction of the
height ladder that is tine-reachable from it, and the z-span it covers.
"""
import sys
import numpy as np
import trimesh

from spike_overhangs import (OVERHANG_CUT, MIN_REGION_AREA, BED_EPS,
                             contact_line, region_points)

NDIR = 24              # compass directions probed
NH = 16                # height samples from the bed up to the overhang
TINE_REACH = 1.5       # mm; face may wander this far from the wall and still tine
MIN_COVER = 0.6        # a direction is usable if this fraction of heights reach


def load(path):
    mesh = trimesh.load(path, force='mesh')
    mesh.remove_unreferenced_vertices()
    mesh.apply_translation([0, 0, -mesh.bounds[0][2]])
    if path.endswith('.obj'):
        mesh.apply_scale(120.0 / max(mesh.extents))
        mesh.apply_translation([0, 0, -mesh.bounds[0][2]])
    return mesh


def regions_of(mesh, z_bed=0.0):
    nz = mesh.face_normals[:, 2]
    on_bed = mesh.triangles[:, :, 2].max(axis=1) < z_bed + BED_EPS
    over = (nz < OVERHANG_CUT) & (~on_bed)
    idx = np.flatnonzero(over)
    if len(idx) == 0:
        return []
    adj = mesh.face_adjacency
    keep = over[adj[:, 0]] & over[adj[:, 1]]
    comps = trimesh.graph.connected_components(adj[keep], nodes=idx)
    return [c for c in comps if mesh.area_faces[c].sum() >= MIN_REGION_AREA]


def best_wall(mesh, cx, cy, z_top):
    """Fire outward rays and score each compass direction as a fin plane."""
    hs = np.linspace(0.4, max(0.8, z_top), NH)
    ang = np.linspace(0, 2 * np.pi, NDIR, endpoint=False)
    dirs = np.stack([np.cos(ang), np.sin(ang), np.zeros(NDIR)], axis=1)

    origins, rays, meta = [], [], []
    for hi, h in enumerate(hs):
        for di in range(NDIR):
            origins.append([cx, cy, h])
            rays.append(dirs[di])
            meta.append((hi, di))
    loc, ray_idx, _ = mesh.ray.intersects_location(
        ray_origins=np.array(origins), ray_directions=np.array(rays),
        multiple_hits=False)

    R = np.full((NH, NDIR), np.nan)
    for L, r in zip(loc, ray_idx):
        hi, di = meta[r]
        d = float(np.hypot(L[0] - cx, L[1] - cy))
        if np.isnan(R[hi, di]) or d > R[hi, di]:      # outermost = the silhouette
            R[hi, di] = d

    best = None
    for di in range(NDIR):
        col = R[:, di]
        ok = ~np.isnan(col)
        if ok.sum() < NH * MIN_COVER:
            continue
        rad = float(np.median(col[ok]))
        reach = ok & (np.abs(col - rad) <= TINE_REACH)
        cover = reach.sum() / NH
        zs = hs[reach]
        span = float(zs.max() - zs.min()) if len(zs) else 0.0
        if best is None or cover > best[0]:
            best = (cover, rad, span, float(np.degrees(ang[di])))
    return best, hs


def main(paths):
    print(f"{'part':>26} {'reg':>4} {'z_top':>7} {'best dir':>9} "
          f"{'wall R':>7} {'cover':>6} {'z-span':>7}  verdict")
    tally = {'wall': 0, 'none': 0}
    for path in paths:
        mesh = load(path)
        name = path.split('/')[-1]
        regs = sorted(regions_of(mesh), key=lambda c: -mesh.area_faces[c].sum())[:3]
        if not regs:
            print(f"{name:>26}    -   (no overhang regions)")
            continue
        for ri, r in enumerate(regs):
            pts = region_points(mesh, r)
            line = contact_line(pts)
            if line is None:
                continue
            cx, cy = float(np.mean(line[:, 0])), float(np.mean(line[:, 1]))
            z_top = float(np.median(line[:, 2]))
            best, hs = best_wall(mesh, cx, cy, z_top)
            if best is None:
                print(f"{name:>26} {ri:>4} {z_top:7.1f}        -       -      -       -"
                      "  NO vertical face")
                tally['none'] += 1
                continue
            cover, rad, span, ang = best
            good = cover >= MIN_COVER and span >= 0.5 * z_top
            tally['wall' if good else 'none'] += 1
            print(f"{name:>26} {ri:>4} {z_top:7.1f} {ang:8.0f}d {rad:7.2f} "
                  f"{cover:6.0%} {span:7.1f}  "
                  f"{'FIN CAN STAND HERE' if good else 'too broken'}")
    n = sum(tally.values())
    print(f"\nOVERALL: {tally['wall']}/{n} regions have a vertical face a fin can "
          f"stand against ({100*tally['wall']/max(1,n):.0f}%)")


if __name__ == '__main__':
    main(sys.argv[1:])
