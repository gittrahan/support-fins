"""
PROBE: can a HORIZONTAL tine actually reach the part from the swept fin wall?

The fin spec says tines must be horizontal (they print as one continuous layer
line, fused, no retraction). The prototype's wall stops GAP below the part, so
the only gap it leaves is VERTICAL -- a tine across it would be the vertical
"worst way" tine Slant3D demos failing.

A horizontal tine needs a part face standing roughly VERTICAL right next to the
wall. Question: does one exist on real parts, and how far away is it?

Per contact-line sample p, per height h above p, per side sigma of the wall:
fire a horizontal ray inward from far outside and record the lateral distance
from the wall plane to the first part surface.
"""
import sys
import numpy as np
import trimesh

from spike_overhangs import (OVERHANG_CUT, MIN_REGION_AREA, BED_EPS,
                             contact_line, region_points)

HEIGHTS = np.array([0.5, 1.0, 2.0, 3.0, 5.0, 8.0])   # mm above the contact point
REACH_MAX = 4.0        # mm; a tine longer than this is a strut, not a tine
TH = 1.2               # wall thickness (tine starts at TH/2 off the wall plane)


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


def probe_region(mesh, line, big):
    """For each side, return the median lateral distance wall-plane -> part face
    at each probe height, and the fraction of probes that landed within REACH_MAX."""
    origins, dirs, meta = [], [], []
    for i in range(1, len(line) - 1):                 # skip endpoints
        p = line[i]
        a, b = line[i - 1], line[i + 1]
        run = np.array([b[0] - a[0], b[1] - a[1], 0.0])
        n = np.linalg.norm(run)
        if n < 1e-9:
            continue
        run /= n
        s = np.cross(run, [0, 0, 1.0])
        s /= np.linalg.norm(s)
        for hi, h in enumerate(HEIGHTS):
            for sg in (+1.0, -1.0):
                o = p + np.array([0, 0, h]) + sg * s * big
                origins.append(o)
                dirs.append(-sg * s)
                meta.append((hi, 0 if sg > 0 else 1, p, s, sg))
    if not origins:
        return None
    loc, ray_idx, _ = mesh.ray.intersects_location(
        ray_origins=np.array(origins), ray_directions=np.array(dirs),
        multiple_hits=False)
    # lateral distance from the wall plane (through p, normal s) to the hit
    dist = np.full((len(HEIGHTS), 2, 0), np.nan)
    buckets = {(hi, side): [] for hi in range(len(HEIGHTS)) for side in (0, 1)}
    for L, r in zip(loc, ray_idx):
        hi, side, p, s, sg = meta[r]
        d = float(np.dot(L - p, s) * sg)              # >0 = out on that side
        buckets[(hi, side)].append(d)
    return buckets


def main(paths):
    print(f"{'part':>26} {'reg':>4} {'side':>5} " +
          " ".join(f"h={h:<4g}" for h in HEIGHTS) + "   tinable%")
    for path in paths:
        mesh = load(path)
        big = float(np.linalg.norm(mesh.extents)) + 10.0
        regs = regions_of(mesh)
        name = path.split('/')[-1]
        if not regs:
            print(f"{name:>26}    -   (no overhang regions)")
            continue
        regs = sorted(regs, key=lambda c: -mesh.area_faces[c].sum())[:3]
        for ri, r in enumerate(regs):
            line = contact_line(region_points(mesh, r))
            if line is None or len(line) < 3:
                print(f"{name:>26} {ri:>4}   (no contact line)")
                continue
            b = probe_region(mesh, line, big)
            if b is None:
                continue
            for side in (0, 1):
                med, tin, tot = [], 0, 0
                for hi in range(len(HEIGHTS)):
                    v = b[(hi, side)]
                    med.append(np.median(v) if v else np.nan)
                    tot += len(line) - 2
                    tin += sum(1 for d in v if TH / 2 < d <= REACH_MAX)
                cells = " ".join(f"{m:6.2f}" if not np.isnan(m) else "   n/a"
                                 for m in med)
                pct = 100.0 * tin / max(1, tot)
                print(f"{name:>26} {ri:>4} {'+s' if side == 0 else '-s':>5} "
                      f"{cells}   {pct:5.0f}%")


if __name__ == '__main__':
    main(sys.argv[1:])
