"""A flat, near-upright face of the part, in its own frame (port of web/planes.js).

`grow_wall_patches` is the website's patch finder: it region-grows walls from
mesh facets with the same tolerances, so a body meshed in Fusion (including one
converted from an STL, one face per facet) gets exactly the website's patches.
`patches_from_mesh` groups only exactly-coplanar facets, as BRep faces would be.

The plane is `n . q = d` with `n` the outward normal, and the frame is

    n  out of the part
    u  across the face, always HORIZONTAL
    t  up the face, n x u, always with a positive z component

`d` is a SUPPORTING plane: it touches the outermost point of the face, so every
deviation `dn` is <= 0 and the standoff is a floor, not an average.
"""

import math

FLAT_TOL_IN = 1.20      # how far the surface may recede behind the plane, mm
MIN_PATCH_H = 4.0       # mm up the face
MIN_PATCH_W = 4.0       # mm across it


class Patch:
    def __init__(self, n, u, t, h, d, u0, u1, t0, t1, z0, z1, tris, area):
        self.n = n          # (x, y, z) outward unit normal
        self.u = u          # (x, y) horizontal unit vector across the face
        self.t = t          # (x, y, z) up the face
        self.h = h          # horizontal share of n
        self.d = d
        self.u0, self.u1 = u0, u1
        self.t0, self.t1 = t0, t1
        self.z0, self.z1 = z0, z1
        self.tris = tris    # per triangle: ((u, t, dn), (u, t, dn), (u, t, dn))
        self.area = area

    @property
    def lean_deg(self):
        return abs(math.degrees(math.asin(max(-1.0, min(1.0, self.n[2])))))

    def probe(self, u, t):
        """Signed distance of the real surface from the plane at (u, t), or None
        if the face doesn't cover that point."""
        for (ax, ay, ad), (bx, by, bd), (cx, cy, cd) in self.tris:
            den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
            if abs(den) < 1e-9:
                continue            # a sliver reads as "inside" everywhere
            l1 = ((by - cy) * (u - cx) + (cx - bx) * (t - cy)) / den
            l2 = ((cy - ay) * (u - cx) + (ax - cx) * (t - cy)) / den
            l3 = 1 - l1 - l2
            if l1 < -1e-9 or l2 < -1e-9 or l3 < -1e-9:
                continue
            return l1 * ad + l2 * bd + l3 * cd
        return None

    def point(self, w, u, t):
        """World point at frame coordinates: `w` out of the face, `u` across, `t` up."""
        dw = self.d + w
        return (self.n[0] * dw + self.u[0] * u + self.t[0] * t,
                self.n[1] * dw + self.u[1] * u + self.t[1] * t,
                self.n[2] * dw + self.t[2] * t)

    def t_at_z(self, w, z):
        """The `t` at which the plane offset by `w` crosses world height `z`."""
        return (z - self.n[2] * (self.d + w)) / self.t[2]


def _tri_normal_area(a, b, c):
    ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
    vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
    nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
    L = math.sqrt(nx * nx + ny * ny + nz * nz)
    if L < 1e-12:
        return (0.0, 0.0, 0.0), 0.0
    return (nx / L, ny / L, nz / L), L / 2


def make_patch(tris, normal=None):
    """Fit a patch to a face's triangles (print space, wound outward).

    `normal` overrides the area-weighted winding normal, for callers (Fusion)
    that know the face's outward normal exactly. Returns (patch, None) or
    (None, reason) when the face can't take a brace frame at all.
    """
    area = 0.0
    nx = ny = nz = 0.0
    for a, b, c in tris:
        (tx, ty, tz), ar = _tri_normal_area(a, b, c)
        nx += tx * ar
        ny += ty * ar
        nz += tz * ar
        area += ar
    if normal is not None:
        nx, ny, nz = normal
    nl = math.sqrt(nx * nx + ny * ny + nz * nz)
    if nl < 1e-9:
        return None, 'that face has no area'
    nx, ny, nz = nx / nl, ny / nl, nz / nl

    h = math.hypot(nx, ny)
    if h < 1e-6:
        return None, 'that face is flat (a top or a bottom), not a side — pick an upright face'
    ux, uy = -ny / h, nx / h
    # t = n x u, built from n's own horizontal direction (see planes.js fitPatch)
    tx, ty, tz = -nz * (nx / h), -nz * (ny / h), h

    d = max(v[0] * nx + v[1] * ny + v[2] * nz for t in tris for v in t)

    out = []
    dev_in = math.inf
    u0 = t0 = z0 = math.inf
    u1 = t1 = z1 = -math.inf
    for tri in tris:
        pts = []
        for x, y, z in tri:
            dn = x * nx + y * ny + z * nz - d
            u = x * ux + y * uy
            t = x * tx + y * ty + z * tz
            pts.append((u, t, dn))
            dev_in = min(dev_in, dn)
            u0, u1 = min(u0, u), max(u1, u)
            t0, t1 = min(t0, t), max(t1, t)
            z0, z1 = min(z0, z), max(z1, z)
        out.append(tuple(pts))

    if dev_in < -FLAT_TOL_IN:
        return None, 'that face is not flat enough to stand a brace against'
    if t1 - t0 < MIN_PATCH_H:
        return None, 'that face is too short to stand a brace against'
    if u1 - u0 < MIN_PATCH_W:
        return None, 'that face is too narrow to stand a brace against'
    return Patch((nx, ny, nz), (ux, uy), (tx, ty, tz), h, d,
                 u0, u1, t0, t1, z0, z1, out, area), None


def patches_from_mesh(mesh, angle_tol_deg=0.5, dist_tol=0.01):
    """Group a mesh's triangles into flat faces (coplanar and edge-connected),
    as a BRep would have them, and fit a patch to each. Returns a list of
    (patch, triangle indices) for the faces that fit."""
    tris = mesh.tris
    info = []
    for a, b, c in tris:
        n, ar = _tri_normal_area(a, b, c)
        info.append((n, ar, n[0] * a[0] + n[1] * a[1] + n[2] * a[2]))

    def key(p):
        return tuple(round(c, 5) for c in p)

    by_edge = {}
    for k, t in enumerate(tris):
        for i in range(3):
            e = frozenset((key(t[i]), key(t[(i + 1) % 3])))
            by_edge.setdefault(e, []).append(k)

    cos_tol = math.cos(math.radians(angle_tol_deg))
    seen = [False] * len(tris)
    groups = []
    for seed in range(len(tris)):
        if seen[seed] or info[seed][1] == 0:
            continue
        sn, _, sd = info[seed]
        seen[seed] = True
        group = [seed]
        stack = [seed]
        while stack:
            k = stack.pop()
            t = tris[k]
            for i in range(3):
                for g in by_edge[frozenset((key(t[i]), key(t[(i + 1) % 3])))]:
                    if seen[g] or info[g][1] == 0:
                        continue
                    gn, _, gd = info[g]
                    if gn[0] * sn[0] + gn[1] * sn[1] + gn[2] * sn[2] < cos_tol:
                        continue
                    if abs(gd - sd) > dist_tol:
                        continue
                    seen[g] = True
                    group.append(g)
                    stack.append(g)
        groups.append(group)

    out = []
    for g in groups:
        p, _ = make_patch([tris[k] for k in g])
        if p is not None:
            out.append((p, g))
    return out


# The website's region-growing patch finder (web/planes.js findWallPatches),
# for faceted meshes where near-coplanar facets should read as one wall.
MAX_LEAN_DEG = 45
NORMAL_AGREE_DEG = 35
GROW_SLACK = 0.35
MIN_PATCH_AREA = 25.0


def grow_wall_patches(mesh):
    """Grow patches from seed facets, judging every candidate against the SEED's
    plane (so a curved surface can't creep into a wall). Returns a list of
    (patch, triangle indices), largest area first."""
    tris = mesh.tris
    info = [_tri_normal_area(*t) for t in tris]
    lean = math.sin(math.radians(MAX_LEAN_DEG)) + 1e-6
    agree = math.cos(math.radians(NORMAL_AGREE_DEG))
    upright = [abs(n[2]) <= lean and math.hypot(n[0], n[1]) > 1e-9 and ar > 0 for n, ar in info]

    def key(p):
        return tuple(round(c, 5) for c in p)

    by_edge = {}
    for k, t in enumerate(tris):
        for i in range(3):
            by_edge.setdefault(frozenset((key(t[i]), key(t[(i + 1) % 3]))), []).append(k)

    seeds = sorted((k for k in range(len(tris)) if upright[k]), key=lambda k: -info[k][1])
    taken = [False] * len(tris)
    out = []
    for seed in seeds:
        if taken[seed]:
            continue
        sn = info[seed][0]
        sd = sum(v[0] * sn[0] + v[1] * sn[1] + v[2] * sn[2] for v in tris[seed]) / 3
        taken[seed] = True
        faces = [seed]
        total = info[seed][1]
        queue = [seed]
        while queue:
            f = queue.pop()
            t = tris[f]
            for i in range(3):
                for g in by_edge[frozenset((key(t[i]), key(t[(i + 1) % 3])))]:
                    if taken[g] or not upright[g]:
                        continue
                    gn = info[g][0]
                    if gn[0] * sn[0] + gn[1] * sn[1] + gn[2] * sn[2] < agree:
                        continue
                    dns = [v[0] * sn[0] + v[1] * sn[1] + v[2] * sn[2] - sd for v in tris[g]]
                    if max(dns) > GROW_SLACK or min(dns) < -FLAT_TOL_IN:
                        continue
                    taken[g] = True
                    faces.append(g)
                    total += info[g][1]
                    queue.append(g)
        if total < MIN_PATCH_AREA:
            continue
        p, _ = make_patch([tris[k] for k in faces])
        if p is not None:
            out.append((p, faces))
    out.sort(key=lambda pf: -pf[0].area)
    return out


def patch_at_point(mesh, groups, point, tol=0.5):
    """The patch under a clicked point (print space): (patch, None) or
    (None, reason). `groups` is grow_wall_patches' (or patches_from_mesh's) result."""
    from .geometry import nearest_triangle
    k, dist = nearest_triangle(mesh.tris, point)
    if k < 0 or dist > tol:
        return None, 'that spot isn’t on the part'
    for p, faces in groups:
        if k in faces:
            return p, None
    n, _ = _tri_normal_area(*mesh.tris[k])
    if abs(n[2]) > math.sin(math.radians(MAX_LEAN_DEG)):
        return None, 'that face is a top, a bottom or an overhang, not a side — pick an upright face'
    return None, 'that face is too small or curved to stand a brace against'
