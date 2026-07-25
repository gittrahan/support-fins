"""
SPIKE part 3: can we SUGGEST the orientation, or must the user always pick?

Design premise: manual rotate is always available; the suggester is a ranked list
with an honest confidence, never an auto-apply.

Candidates = the part's own resting poses (convex-hull stable poses -- these are the
orientations where a real flat face lands on the plate, which is what we want anyway)
PLUS tilted variants of each about the longest horizontal axis (the Slant3D "on a
slant" case; those need a bed pad since they rest on an edge).

Scored on four things we can actually measure without knowing the load:
  HEIGHT     z extent -> print time proxy (taller = more layers = slower)
  BED        contact area on the plate -> adhesion
  OVERHANG   overhang area that needs support at all
  FINNABLE   fraction of overhang regions that are tall+long enough for a real fin
             (from spike part 2: short overhangs degenerate into splayed sheets)
  LONGAXIS   angle of the part's longest axis from vertical. 90deg = lying in the
             layer plane = strong. 0deg = standing = layer lines across the length
             = the weak orientation people accidentally pick.

CONFIDENCE is the honest part. The long-axis proxy is only meaningful when the part
HAS a dominant long axis (elongated). For a blobby part we cannot guess the load
direction, so we say so and defer to the user.
"""
import sys
import numpy as np
import trimesh

from spike_overhangs import OVERHANG_COS, MIN_REGION_AREA, contact_line, region_points

MIN_WALL_H = 4.0          # below this the fin profile degenerates (spike part 2)


def elongation(mesh):
    """Ratio of longest to second-longest principal extent, and the long axis.
    >1.5 means the part has a real dominant axis and the strength proxy applies."""
    v = np.asarray(mesh.vertices) - np.asarray(mesh.vertices).mean(axis=0)
    _, s, vt = np.linalg.svd(v, full_matrices=False)
    return float(s[0] / max(s[1], 1e-9)), vt[0]


def metrics(mesh):
    m = mesh.copy()
    m.apply_translation([0, 0, -m.bounds[0][2]])
    nz = m.face_normals[:, 2]
    tz = m.triangles[:, :, 2]
    bed_area = float(m.area_faces[tz.max(axis=1) < 0.35].sum())
    over = (nz < -OVERHANG_COS) & (tz.min(axis=1) >= 0.35)
    idx = np.flatnonzero(over)
    over_area = float(m.area_faces[idx].sum())

    finnable = tall = 0
    if len(idx):
        adj = m.face_adjacency
        keep = over[adj[:, 0]] & over[adj[:, 1]]
        regs = [c for c in trimesh.graph.connected_components(adj[keep], nodes=idx)
                if m.area_faces[c].sum() >= MIN_REGION_AREA]
        for r in regs:
            line = contact_line(region_points(m, r))
            if line is None:
                continue
            finnable += 1
            h = float(np.min(line[:, 2])) - 0.2
            span = float(np.linalg.norm(line[-1, :2] - line[0, :2]))
            if h >= MIN_WALL_H and span >= 7.0:
                tall += 1
        finnable = len(regs)
    return dict(height=float(m.extents[2]), bed=bed_area, over=over_area,
                regions=finnable, real_fins=tall)


def candidates(mesh, tilts=(0, 30, 45)):
    out = []
    poses, probs = trimesh.poses.compute_stable_poses(mesh, n_samples=1)
    for i, (T, p) in enumerate(zip(poses[:5], probs[:5])):
        base = mesh.copy()
        base.apply_transform(T)
        for t in tilts:
            m = base.copy()
            if t:
                ext = m.extents
                ax = [1, 0, 0] if ext[1] >= ext[0] else [0, 1, 0]   # tilt about long horiz axis
                m.apply_transform(trimesh.transformations.rotation_matrix(
                    np.radians(t), ax, m.centroid))
            out.append((f"pose{i}" + (f"+{t}deg" if t else ""), t, float(p), m))
    return out


def main(src):
    mesh = trimesh.load(src, force='mesh')
    elong, axis = elongation(mesh)
    print(f"\n{'='*90}\n{src.split('/')[-1]}   bbox {np.round(mesh.extents,1)}   "
          f"elongation {elong:.2f}  -> strength proxy "
          f"{'APPLIES' if elong >= 1.5 else 'UNRELIABLE (blobby, load direction unknown)'}")

    rows = []
    for name, tilt, prob, m in candidates(mesh):
        d = metrics(m)
        # angle of the part's long axis from vertical, in THIS orientation
        R = np.eye(3)
        a = m.principal_inertia_transform[:3, :3].T @ np.array([0, 0, 1.0])
        _, ax_now = elongation(m)
        long_from_vert = np.degrees(np.arccos(abs(np.clip(ax_now[2], -1, 1))))
        rows.append((name, d, long_from_vert, prob))

    print(f"  {'orientation':16} {'height':>7} {'bed mm2':>8} {'overhang':>9} "
          f"{'regions':>8} {'real fins':>10} {'longaxis':>9}  {'rest':>5}")
    best = None
    for name, d, lav, prob in rows:
        flag = ''
        if d['regions'] and d['real_fins'] == 0:
            flag = ' <- all overhangs too short to fin'
        print(f"  {name:16} {d['height']:7.1f} {d['bed']:8.0f} {d['over']:9.0f} "
              f"{d['regions']:8d} {d['real_fins']:10d} {lav:8.0f}d {prob:5.2f}{flag}")
        # score: want long axis lying down, few overhangs, and any overhangs FINNABLE
        s = (lav / 90.0) * 2.0 - d['over'] / 500.0 - d['height'] / 100.0
        if d['regions'] and d['real_fins'] == 0:
            s -= 1.5
        if best is None or s > best[1]:
            best = (name, s, lav, d)

    name, s, lav, d = best
    conf = 'HIGH' if elong >= 1.5 else 'LOW'
    print(f"  => suggests {name}: long axis {lav:.0f}deg from vertical, "
          f"{d['real_fins']}/{d['regions']} overhangs finnable, {d['height']:.0f}mm tall")
    print(f"  => CONFIDENCE {conf}"
          + ('' if conf == 'HIGH' else '  (present as a hint, keep the user in the driver seat)'))


if __name__ == '__main__':
    for p in sys.argv[1:]:
        try:
            main(p)
        except Exception as e:
            print(f"\n{p}: FAILED {type(e).__name__}: {e}")
