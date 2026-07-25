"""
SPIKE: can breakaway.py's fin placement survive geometry we didn't author?

breakaway_wall(bm, contact, t0, t1, z_bed) assumes the caller can hand it:
  (a) a contact(t) polyline along the part's TRUE LOWEST SURFACE under the overhang,
  (b) that is roughly STRAIGHT (it spans the wall with exactly two cross-sections),
  (c) with clear air all the way DOWN TO THE BED (the wall attaches to the plate only).

On hub.py that's free -- we generated the socket, so we know its axis and radius.
On a downloaded STL we know none of it. This measures how often (a)(b)(c) hold.

Per overhang region we report:
  REACH   does a downward ray from the region hit the bed, or the part again?
          (part -> breakaway.py cannot serve it: bed-only attachment is baked in)
  STRAIGHT RMS deviation of the extracted contact line from a best-fit 3D line,
          in mm. breakaway_wall spans it with 2 sections, so this is its error.
  SPAN    length of the contact line (a wall shorter than ~foot is not a wall)
"""
import sys
import numpy as np
import trimesh

OVERHANG_COS = 0.7071          # n_z < -cos(45deg)  => surface < 45deg from the plate
MIN_REGION_AREA = 12.0         # mm^2, ignore slivers
BED_EPS = 0.35                 # mm, faces this close to the plate are the bottom
RAYS_PER_REGION = 24
STRAIGHT_TOL = 0.8             # mm RMS; above this a 2-section wall mis-fits


def region_points(mesh, faces, n=1500):
    """Densify a region by sampling its SURFACE, not its vertices. A flat ledge is
    often just 2 triangles / 4 verts -- bucketing those starves the polyline even
    though it's the easiest case there is. Sample the faces instead."""
    sub = mesh.submesh([faces], append=True)
    try:
        pts, _ = trimesh.sample.sample_surface(sub, n)
        return np.vstack([np.asarray(sub.vertices), np.asarray(pts)])
    except Exception:
        return np.asarray(sub.vertices)


def contact_line(pts, n_samples=14):
    """Extract the lowest-surface polyline of a region, the way a fin generator
    would have to: principal horizontal axis, then min-z per bucket along it."""
    pts = np.asarray(pts)
    xy = pts[:, :2] - pts[:, :2].mean(axis=0)
    if np.allclose(xy, 0):
        return None
    # principal horizontal direction of the region
    axis = np.linalg.svd(xy, full_matrices=False)[2][0]
    t = xy @ axis
    lo, hi = t.min(), t.max()
    if hi - lo < 1e-6:
        return None
    edges = np.linspace(lo, hi, n_samples + 1)
    line = []
    for i in range(n_samples):
        m = (t >= edges[i]) & (t <= edges[i + 1])
        if not m.any():
            continue
        sel = pts[m]
        line.append(sel[np.argmin(sel[:, 2])])
    return np.array(line) if len(line) >= 3 else None


def straightness(line):
    """RMS distance of the polyline from its best-fit 3D line (mm)."""
    c = line.mean(axis=0)
    d = np.linalg.svd(line - c, full_matrices=False)[2][0]
    perp = (line - c) - np.outer((line - c) @ d, d)
    return float(np.sqrt((perp ** 2).sum(axis=1).mean()))


def analyse(path):
    mesh = trimesh.load(path, force='mesh')
    mesh.remove_unreferenced_vertices()
    # normalize: sit it on the plate, in the orientation the file ships in
    mesh.apply_translation([0, 0, -mesh.bounds[0][2]])
    if path.endswith('.obj'):                     # bunny ships in metres-ish units
        mesh.apply_scale(120.0 / max(mesh.extents))
        mesh.apply_translation([0, 0, -mesh.bounds[0][2]])
    z_bed = 0.0

    print(f"\n{'='*72}\n{path.split('/')[-1]}")
    print(f"  {len(mesh.faces):,} faces, bbox {np.round(mesh.extents,1)} mm, "
          f"watertight={mesh.is_watertight}")

    nz = mesh.face_normals[:, 2]
    tri_z = mesh.triangles[:, :, 2]
    on_bed = tri_z.max(axis=1) < z_bed + BED_EPS
    over = (nz < -OVERHANG_COS) & (~on_bed)
    idx = np.flatnonzero(over)
    a_over = float(mesh.area_faces[idx].sum())
    print(f"  overhang faces: {len(idx):,} / {len(mesh.faces):,} "
          f"({100*len(idx)/len(mesh.faces):.1f}%), area {a_over:.0f} mm^2")
    if len(idx) == 0:
        print("  -> designed support-free in this orientation. nothing to do.")
        return

    # cluster contiguous overhang faces into regions
    adj = mesh.face_adjacency
    keep = over[adj[:, 0]] & over[adj[:, 1]]
    comps = trimesh.graph.connected_components(adj[keep], nodes=idx)
    regions = [c for c in comps if mesh.area_faces[c].sum() >= MIN_REGION_AREA]
    print(f"  regions: {len(comps)} raw -> {len(regions)} above {MIN_REGION_AREA} mm^2")

    stats = {'bed': 0, 'part': 0, 'straight': 0, 'curved': 0, 'stub': 0, 'noline': 0}
    rows = []
    for r in sorted(regions, key=lambda c: -mesh.area_faces[c].sum()):
        pts = region_points(mesh, r)
        area = float(mesh.area_faces[r].sum())

        # (c) REACH: fire rays straight down from the region's underside
        cen = mesh.triangles[r].mean(axis=1)
        pick = cen[np.random.default_rng(0).choice(
            len(cen), min(RAYS_PER_REGION, len(cen)), replace=False)]
        origins = pick - np.array([0, 0, 0.05])
        hit = mesh.ray.intersects_any(
            ray_origins=origins,
            ray_directions=np.tile([0, 0, -1.0], (len(origins), 1)))
        blocked = float(hit.mean())
        reach = 'PART' if blocked > 0.5 else 'bed'
        stats['part' if reach == 'PART' else 'bed'] += 1

        # (a)(b) CONTACT LINE
        line = contact_line(pts)
        if line is None:
            stats['noline'] += 1
            rows.append((area, reach, blocked, None, None))
            continue
        span = float(np.linalg.norm(line[-1, :2] - line[0, :2]))
        rms = straightness(line)
        if span < 7.0:
            stats['stub'] += 1
        elif rms <= STRAIGHT_TOL:
            stats['straight'] += 1
        else:
            stats['curved'] += 1
        rows.append((area, reach, blocked, span, rms))

    print(f"  {'area mm^2':>10} {'reach':>6} {'blocked':>8} {'span mm':>8} {'RMS mm':>7}")
    for area, reach, blocked, span, rms in rows[:10]:
        s = f"{span:8.1f}" if span is not None else "     n/a"
        r = f"{rms:7.2f}" if rms is not None else "    n/a"
        print(f"  {area:10.0f} {reach:>6} {blocked:8.0%} {s} {r}")
    if len(rows) > 10:
        print(f"  ... {len(rows)-10} more")

    n = max(1, len(regions))
    print(f"  VERDICT: bed-reachable {stats['bed']}/{n}  |  over-part {stats['part']}/{n}"
          f"  |  straight-enough {stats['straight']}/{n}"
          f"  curved {stats['curved']}  stub {stats['stub']}  no-line {stats['noline']}")
    servable = sum(1 for a, reach, b, span, rms in rows
                   if reach == 'bed' and span is not None and span >= 7.0
                   and rms is not None and rms <= STRAIGHT_TOL)
    print(f"  ** breakaway_wall() can serve {servable}/{n} regions as-is "
          f"({100*servable/n:.0f}%) **")


if __name__ == '__main__':
    for p in sys.argv[1:]:
        try:
            analyse(p)
        except Exception as e:
            print(f"\n{p}: FAILED {type(e).__name__}: {e}")
