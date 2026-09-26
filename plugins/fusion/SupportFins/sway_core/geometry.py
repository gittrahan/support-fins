"""Small geometry kit: polygon clipping, a triangle mesh with a containment test,
and the convex prisms every brace piece is made of."""

import math


def clip(poly, f):
    """Sutherland-Hodgman: keep the part of `poly` where `f(v) >= 0`."""
    out = []
    n = len(poly)
    for i in range(n):
        a = poly[i]
        b = poly[(i + 1) % n]
        fa = f(a)
        fb = f(b)
        if fa >= 0:
            out.append(a)
        if (fa >= 0) != (fb >= 0):
            t = fa / (fa - fb)
            out.append(tuple(av + (bv - av) * t for av, bv in zip(a, b)))
    return out


def seg_dist(a, b, c, d):
    """Closest distance between 2D segments ab and cd (only x, y are read)."""
    def pt(p, q, r):
        dx = r[0] - q[0]
        dy = r[1] - q[1]
        L = dx * dx + dy * dy
        t = max(0.0, min(1.0, ((p[0] - q[0]) * dx + (p[1] - q[1]) * dy) / L)) if L > 0 else 0.0
        return math.hypot(p[0] - q[0] - dx * t, p[1] - q[1] - dy * t)

    def cross(o, p, q):
        return (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0])

    d1, d2 = cross(a, b, c), cross(a, b, d)
    d3, d4 = cross(c, d, a), cross(c, d, b)
    if ((d1 > 0) != (d2 > 0)) and ((d3 > 0) != (d4 > 0)):
        return 0.0
    return min(pt(a, c, d), pt(b, c, d), pt(c, a, b), pt(d, a, b))


class Mesh:
    """A closed triangle mesh in print space (mm, z up, bed at z = 0).

    `tris` is a sequence of triangles, each three (x, y, z) points, wound
    outward. Containment is by ray parity along +x, bucketed on a (y, z) grid,
    as in web/inside.js.
    """

    GRID = 48

    def __init__(self, tris):
        self.tris = [tuple(tuple(float(c) for c in v) for v in t) for t in tris]
        self._grid = None
        if self.tris:
            zs = [v[2] for t in self.tris for v in t]
            self.bottom = min(zs)
            self.top = max(zs)
        else:
            self.bottom = self.top = 0.0

    def _build_grid(self):
        ys = [v[1] for t in self.tris for v in t]
        zs = [v[2] for t in self.tris for v in t]
        y0, y1 = min(ys), max(ys)
        z0, z1 = min(zs), max(zs)
        G = self.GRID
        sy = (y1 - y0) / G or 1.0
        sz = (z1 - z0) / G or 1.0
        cells = [[] for _ in range(G * G)]

        def ci(v, lo, step):
            return max(0, min(G - 1, int((v - lo) / step)))

        for k, t in enumerate(self.tris):
            ya, yb = min(v[1] for v in t), max(v[1] for v in t)
            za, zb = min(v[2] for v in t), max(v[2] for v in t)
            for iy in range(ci(ya, y0, sy), ci(yb, y0, sy) + 1):
                for iz in range(ci(za, z0, sz), ci(zb, z0, sz) + 1):
                    cells[iy * G + iz].append(k)
        self._grid = (y0, z0, sy, sz, cells, y1, z1)

    def inside(self, x, y, z):
        """Is (x, y, z) inside the part? Ray parity along +x."""
        if not self.tris:
            return False
        if self._grid is None:
            self._build_grid()
        y0, z0, sy, sz, cells, y1, z1 = self._grid
        # A hair of irrational-ish offset so the ray never runs exactly along a
        # shared triangle edge (the diagonal of a block's side, say) and counts
        # the same crossing twice. Far below any real feature.
        y += 1.37e-7
        z += 2.11e-7
        if y < y0 or y > y1 or z < z0 or z > z1:
            return False
        G = self.GRID
        iy = max(0, min(G - 1, int((y - y0) / sy)))
        iz = max(0, min(G - 1, int((z - z0) / sz)))
        crossings = 0
        for k in cells[iy * G + iz]:
            (ax, ay, az), (bx, by, bz), (cx, cy, cz) = self.tris[k]
            d = (bz - cz) * (ay - cy) + (cy - by) * (az - cz)
            if abs(d) < 1e-12:
                continue
            l1 = ((bz - cz) * (y - cy) + (cy - by) * (z - cz)) / d
            l2 = ((cz - az) * (y - cy) + (ay - cy) * (z - cz)) / d
            l3 = 1 - l1 - l2
            if l1 < 0 or l2 < 0 or l3 < 0:
                continue
            if l1 * ax + l2 * bx + l3 * cx > x:
                crossings += 1
        return crossings % 2 == 1

    def ray_hit(self, origin, direction):
        return ray_hit(self.tris, origin, direction)


def _add(*vs):
    return tuple(sum(c) for c in zip(*vs))


def _scale(v, s):
    return tuple(c * s for c in v)


class Prism:
    """A convex polygon extruded straight: the shape of every brace piece.

    The polygon `poly` is [(a, b), ...] in the plane spanned by unit vectors
    `ea`, `eb`; it is extruded along unit vector `ec` from c = lo to c = hi.
    The three axes are orthonormal. A world point is a*ea + b*eb + c*ec.

    `kind` is 'rib', 'foot' or 'tine'.
    """

    def __init__(self, kind, poly, lo, hi, ea, eb, ec):
        self.kind = kind
        self.poly = [tuple(p) for p in poly]
        self.lo = lo
        self.hi = hi
        self.ea = tuple(ea)
        self.eb = tuple(eb)
        self.ec = tuple(ec)

    def point(self, a, b, c):
        return _add(_scale(self.ea, a), _scale(self.eb, b), _scale(self.ec, c))

    def triangles(self):
        """Closed, outward-wound triangles (for tests and mesh export)."""
        n = len(self.poly)
        L = [self.point(a, b, self.lo) for a, b in self.poly]
        H = [self.point(a, b, self.hi) for a, b in self.poly]
        tris = []
        for i in range(n):
            j = (i + 1) % n
            tris.append((L[i], L[j], H[j]))
            tris.append((L[i], H[j], H[i]))
        for i in range(1, n - 1):
            tris.append((H[0], H[i], H[i + 1]))
            tris.append((L[0], L[i + 1], L[i]))
        if signed_volume(tris) < 0:
            tris = [(a, c, b) for a, b, c in tris]
        return tris

    def volume(self):
        area = 0.0
        n = len(self.poly)
        for i in range(n):
            a = self.poly[i]
            b = self.poly[(i + 1) % n]
            area += a[0] * b[1] - b[0] * a[1]
        return abs(area) / 2 * (self.hi - self.lo)

    def boxes(self):
        """How to build this prism from oriented boxes (a CAD kernel's cheapest
        solid): the polygon's bounding box in the prism's frame, minus one big box
        past every slanted edge. Returns (box, cutters); each is
        (center, length_dir, width_dir, length, width, height), height along ec.
        """
        As = [p[0] for p in self.poly]
        Bs = [p[1] for p in self.poly]
        a0, a1, b0, b1 = min(As), max(As), min(Bs), max(Bs)
        cmid = (self.lo + self.hi) / 2
        box = (self.point((a0 + a1) / 2, (b0 + b1) / 2, cmid), self.ea, self.eb,
               a1 - a0, b1 - b0, self.hi - self.lo)
        ca, cb = sum(As) / len(As), sum(Bs) / len(Bs)
        big = 4 * math.hypot(a1 - a0, b1 - b0) + 10
        cutters = []
        n = len(self.poly)
        for i in range(n):
            pa, pb = self.poly[i], self.poly[(i + 1) % n]
            dx, dy = pb[0] - pa[0], pb[1] - pa[1]
            L = math.hypot(dx, dy)
            if L < 1e-9 or abs(dx) < 1e-6 * L or abs(dy) < 1e-6 * L:
                continue                    # an axis-aligned edge lies on the box already
            ex, ey = dx / L, dy / L
            nx, ny = ey, -ex
            if (ca - pa[0]) * nx + (cb - pa[1]) * ny > 0:
                nx, ny = -nx, -ny           # point away from the polygon
            mx = (pa[0] + pb[0]) / 2 + nx * big / 2
            my = (pa[1] + pb[1]) / 2 + ny * big / 2
            e3 = tuple(ex * self.ea[k] + ey * self.eb[k] for k in range(3))
            n3 = tuple(nx * self.ea[k] + ny * self.eb[k] for k in range(3))
            cutters.append((self.point(mx, my, cmid), e3, n3, big, big, self.hi - self.lo + 2))
        return box, cutters

    def bbox(self):
        pts = [self.point(a, b, c) for a, b in self.poly for c in (self.lo, self.hi)]
        lo = tuple(min(p[k] for p in pts) for k in range(3))
        hi = tuple(max(p[k] for p in pts) for k in range(3))
        return lo, hi


def signed_volume(tris):
    V = 0.0
    for a, b, c in tris:
        V += (a[0] * (b[1] * c[2] - b[2] * c[1])
              + a[1] * (b[2] * c[0] - b[0] * c[2])
              + a[2] * (b[0] * c[1] - b[1] * c[0]))
    return V / 6


def is_closed(tris, tol=1e-6):
    """Every directed edge is matched by exactly one reversed edge."""
    def key(p):
        return tuple(round(c / tol) for c in p)

    edges = {}
    for t in tris:
        for i in range(3):
            e = (key(t[i]), key(t[(i + 1) % 3]))
            edges[e] = edges.get(e, 0) + 1
    for (a, b), n in edges.items():
        if edges.get((b, a), 0) != n:
            return False
    return True


def closest_on_triangle(p, a, b, c):
    """Closest point to p on triangle abc (Ericson, Real-Time Collision Detection)."""
    def sub(u, v):
        return (u[0] - v[0], u[1] - v[1], u[2] - v[2])

    def dot(u, v):
        return u[0] * v[0] + u[1] * v[1] + u[2] * v[2]

    ab, ac, ap = sub(b, a), sub(c, a), sub(p, a)
    d1, d2 = dot(ab, ap), dot(ac, ap)
    if d1 <= 0 and d2 <= 0:
        return a
    bp = sub(p, b)
    d3, d4 = dot(ab, bp), dot(ac, bp)
    if d3 >= 0 and d4 <= d3:
        return b
    vc = d1 * d4 - d3 * d2
    if vc <= 0 and d1 >= 0 and d3 <= 0:
        v = d1 / (d1 - d3)
        return (a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v)
    cp = sub(p, c)
    d5, d6 = dot(ab, cp), dot(ac, cp)
    if d6 >= 0 and d5 <= d6:
        return c
    vb = d5 * d2 - d1 * d6
    if vb <= 0 and d2 >= 0 and d6 <= 0:
        w = d2 / (d2 - d6)
        return (a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w)
    va = d3 * d6 - d5 * d4
    if va <= 0 and (d4 - d3) >= 0 and (d5 - d6) >= 0:
        w = (d4 - d3) / ((d4 - d3) + (d5 - d6))
        return (b[0] + (c[0] - b[0]) * w, b[1] + (c[1] - b[1]) * w, b[2] + (c[2] - b[2]) * w)
    denom = 1 / (va + vb + vc)
    v, w = vb * denom, vc * denom
    return (a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w)


def nearest_triangle(tris, p):
    """(index, distance) of the triangle nearest point p."""
    best, best_d = -1, math.inf
    for k, (a, b, c) in enumerate(tris):
        q = closest_on_triangle(p, a, b, c)
        d = math.dist(p, q)
        if d < best_d:
            best, best_d = k, d
    return best, best_d


def in_box(p, box, eps=0.0):
    """Is point p inside an oriented box (center, length_dir, width_dir, l, w, h)?"""
    c, e1, e2, l, w, h = box
    e3 = (e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0])
    d = (p[0] - c[0], p[1] - c[1], p[2] - c[2])
    return all(abs(d[0] * e[0] + d[1] * e[1] + d[2] * e[2]) <= half + eps
               for e, half in ((e1, l / 2), (e2, w / 2), (e3, h / 2)))


def ray_hit(tris, origin, direction):
    """The nearest point where the ray origin + t*direction (t > 0) meets a
    triangle, or None (Moller-Trumbore)."""
    ox, oy, oz = origin
    dx, dy, dz = direction
    best = math.inf
    for (ax, ay, az), (bx, by, bz), (cx, cy, cz) in tris:
        e1x, e1y, e1z = bx - ax, by - ay, bz - az
        e2x, e2y, e2z = cx - ax, cy - ay, cz - az
        px, py, pz = dy * e2z - dz * e2y, dz * e2x - dx * e2z, dx * e2y - dy * e2x
        det = e1x * px + e1y * py + e1z * pz
        if abs(det) < 1e-12:
            continue
        inv = 1.0 / det
        tx, ty, tz = ox - ax, oy - ay, oz - az
        u = (tx * px + ty * py + tz * pz) * inv
        if u < 0 or u > 1:
            continue
        qx, qy, qz = ty * e1z - tz * e1y, tz * e1x - tx * e1z, tx * e1y - ty * e1x
        v = (dx * qx + dy * qy + dz * qz) * inv
        if v < 0 or u + v > 1:
            continue
        t = (e2x * qx + e2y * qy + e2z * qz) * inv
        if 1e-9 < t < best:
            best = t
    if best == math.inf:
        return None
    return (ox + dx * best, oy + dy * best, oz + dz * best)
