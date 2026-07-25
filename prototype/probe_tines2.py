"""
PROBE 2: per STATION along the contact line, what is the SHORTEST horizontal
tine that reaches the part?

Probe 1 asked "at height h, how far is the part" and averaged over heights,
which buries the answer. A station only needs ONE tine, so the question is:
scanning a fine ladder of heights above the contact point, what is the minimum
horizontal reach from the fin wall face (+/-TH/2) to the part surface -- and on
which side?

Tine length is the whole design constraint: the tine prints as an unsupported
horizontal extrusion from the fin into the part (that is what makes it one
continuous layer line). Slant3D's are ~a bead long. A 4mm tine is a bridge.
"""
import sys
import numpy as np
import trimesh

from spike_overhangs import (OVERHANG_CUT, MIN_REGION_AREA, BED_EPS,
                             contact_line, region_points)

LADDER = np.arange(0.15, 3.01, 0.15)    # mm above the contact point
TH = 1.2                                 # fin wall thickness
GOOD_TINE = 1.5                          # mm; longer than this is a bridge, not a tine


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


def station_frames(line):
    for i in range(1, len(line) - 1):
        p = line[i]
        a, b = line[i - 1], line[i + 1]
        run = np.array([b[0] - a[0], b[1] - a[1], 0.0])
        n = np.linalg.norm(run)
        if n < 1e-9:
            continue
        run /= n
        s = np.cross(run, [0, 0, 1.0])
        yield p, s / np.linalg.norm(s)


def min_tines(mesh, line, big):
    """Return, per station, (best tine length, side) over the height ladder."""
    origins, dirs, meta = [], [], []
    stations = list(station_frames(line))
    for si, (p, s) in enumerate(stations):
        for h in LADDER:
            for sg in (+1.0, -1.0):
                origins.append(p + np.array([0, 0, h]) + sg * s * big)
                dirs.append(-sg * s)
                meta.append((si, h, p, s, sg))
    if not origins:
        return []
    loc, ray_idx, _ = mesh.ray.intersects_location(
        ray_origins=np.array(origins), ray_directions=np.array(dirs),
        multiple_hits=False)
    best = {}
    for L, r in zip(loc, ray_idx):
        si, h, p, s, sg = meta[r]
        d = float(np.dot(L - p, s) * sg)         # lateral offset from wall plane
        tine = d - TH / 2.0                      # from the wall FACE to the part
        if tine <= 0.02:                         # part is inside the wall here
            continue
        cur = best.get(si)
        if cur is None or tine < cur[0]:
            best[si] = (tine, +1 if sg > 0 else -1, h)
    return [best.get(si) for si in range(len(stations))]


def main(paths):
    print(f"{'part':>26} {'reg':>4} {'stn':>4} {'tine<=1.5mm':>12} "
          f"{'median tine':>12} {'median h':>9} {'side split':>12}")
    tot_st = tot_good = 0
    for path in paths:
        mesh = load(path)
        big = float(np.linalg.norm(mesh.extents)) + 10.0
        regs = sorted(regions_of(mesh), key=lambda c: -mesh.area_faces[c].sum())[:3]
        name = path.split('/')[-1]
        if not regs:
            print(f"{name:>26}    -    (no overhang regions)")
            continue
        for ri, r in enumerate(regs):
            line = contact_line(region_points(mesh, r))
            if line is None or len(line) < 3:
                continue
            res = min_tines(mesh, line, big)
            hit = [x for x in res if x is not None]
            if not hit:
                print(f"{name:>26} {ri:>4} {len(res):>4}   (no tine reaches)")
                continue
            lens = np.array([x[0] for x in hit])
            hs = np.array([x[2] for x in hit])
            sides = np.array([x[1] for x in hit])
            good = int((lens <= GOOD_TINE).sum())
            tot_st += len(res)
            tot_good += good
            print(f"{name:>26} {ri:>4} {len(res):>4} "
                  f"{good:>5}/{len(res):<6} {np.median(lens):>11.2f} "
                  f"{np.median(hs):>9.2f} "
                  f"{f'{int((sides>0).sum())}+/{int((sides<0).sum())}-':>12}")
    print(f"\nOVERALL: {tot_good}/{tot_st} stations "
          f"({100*tot_good/max(1,tot_st):.0f}%) take a tine <= {GOOD_TINE}mm")


if __name__ == '__main__':
    main(sys.argv[1:])
