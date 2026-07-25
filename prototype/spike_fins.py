"""
SPIKE part 2: generalize breakaway_wall from 2 cross-sections to N, so the wall
FOLLOWS a curved contact polyline instead of assuming a straight overhang.

Deliberately written in pure numpy/trimesh, NOT Blender: if this ships as a
browser tool it has to be plain mesh math anyway. Same profile as
tools/support/breakaway.py (flared chamfered foot -> thin wall -> necked tip,
stopping `gap` below the part), just swept along n samples.

  python3 spike_fins.py models/voron_filter_housing.stl out.stl
"""
import sys
import numpy as np
import trimesh

from spike_overhangs import (OVERHANG_CUT, MIN_REGION_AREA, BED_EPS,
                             contact_line, straightness, region_points)

TH, FOOT, GAP, TIP, CHAMFER, TIP_H = 1.2, 7.0, 0.2, 0.6, 2.5, 1.5


def wall_sections(line, z_bed):
    """One 8-vertex profile per polyline sample, oriented by the LOCAL tangent."""
    secs = []
    for i, p in enumerate(line):
        a = line[max(0, i - 1)]
        b = line[min(len(line) - 1, i + 1)]
        run = np.array([b[0] - a[0], b[1] - a[1], 0.0])
        n = np.linalg.norm(run)
        if n < 1e-9:
            return None
        run /= n
        s = np.cross(run, [0, 0, 1.0])          # thin direction, horizontal
        s /= np.linalg.norm(s)
        top = p[2] - GAP                        # breakaway gap below the part
        zsh = min(z_bed + CHAMFER, top - 0.4)   # chamfer shoulder
        ztip = max(top - TIP_H, zsh + 0.1)
        P = lambda so, z: [p[0] + s[0] * so, p[1] + s[1] * so, z]
        secs.append([P(+FOOT, z_bed), P(+TH / 2, zsh), P(+TH / 2, ztip), P(+TIP / 2, top),
                     P(-TIP / 2, top), P(-TH / 2, ztip), P(-TH / 2, zsh), P(-FOOT, z_bed)])
    return np.array(secs)


def sweep(secs):
    """Bridge consecutive sections into a closed solid, cap both ends."""
    m, k = secs.shape[0], secs.shape[1]
    V = secs.reshape(-1, 3)
    F = []
    for i in range(m - 1):
        for j in range(k):
            a, b = i * k + j, i * k + (j + 1) % k
            c, d = (i + 1) * k + (j + 1) % k, (i + 1) * k + j
            F += [[a, b, c], [a, c, d]]

    for j in range(1, k - 1):                    # end caps (fan)
        F.append([0, j + 1, j])
        F.append([(m - 1) * k, (m - 1) * k + j, (m - 1) * k + j + 1])
    return trimesh.Trimesh(vertices=V, faces=np.array(F), process=False)


def main(src, dst):
    mesh = trimesh.load(src, force='mesh')
    mesh.apply_translation([0, 0, -mesh.bounds[0][2]])
    z_bed = 0.0

    nz = mesh.face_normals[:, 2]
    on_bed = mesh.triangles[:, :, 2].max(axis=1) < z_bed + BED_EPS
    over = (nz < OVERHANG_CUT) & (~on_bed)
    idx = np.flatnonzero(over)
    adj = mesh.face_adjacency
    keep = over[adj[:, 0]] & over[adj[:, 1]]
    comps = trimesh.graph.connected_components(adj[keep], nodes=idx)
    regions = [c for c in comps if mesh.area_faces[c].sum() >= MIN_REGION_AREA]

    fins, skipped = [], {'noline': 0, 'stub': 0, 'overpart': 0, 'degenerate': 0}
    for r in sorted(regions, key=lambda c: -mesh.area_faces[c].sum()):
        cen = mesh.triangles[r].mean(axis=1)
        pick = cen[np.random.default_rng(0).choice(
            len(cen), min(24, len(cen)), replace=False)]
        if mesh.ray.intersects_any(
                ray_origins=pick - np.array([0, 0, 0.05]),
                ray_directions=np.tile([0, 0, -1.0], (len(pick), 1))).mean() > 0.5:
            skipped['overpart'] += 1
            continue
        pts = region_points(mesh, r)
        line = contact_line(pts)
        if line is None:
            skipped['noline'] += 1
            continue
        if np.linalg.norm(line[-1, :2] - line[0, :2]) < 7.0:
            skipped['stub'] += 1
            continue
        secs = wall_sections(line, z_bed)
        if secs is None:
            skipped['degenerate'] += 1
            continue
        w = sweep(secs)
        rms = straightness(line)
        fins.append((w, rms))

    print(f"[spike] {src.split('/')[-1]}: {len(regions)} regions -> {len(fins)} fins, "
          f"skipped {skipped}")
    if fins:
        rmss = [r for _, r in fins]
        print(f"[spike] contact-line RMS served: min {min(rmss):.2f} "
              f"max {max(rmss):.2f} mm (2-section wall could only do <=0.8)")
        bad = [w for w, _ in fins if not w.is_watertight]
        print(f"[spike] fin solids watertight: {len(fins)-len(bad)}/{len(fins)}")
        out = trimesh.util.concatenate([mesh] + [w for w, _ in fins])
        out.export(dst)
        print(f"[spike] wrote {dst}  bbox {np.round(out.extents,1)}")
    return len(regions), len(fins)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
