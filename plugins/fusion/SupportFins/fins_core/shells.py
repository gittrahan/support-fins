"""Turn the engine's triangle soup into indexed meshes Fusion can take as bodies.

The engine emits every fin as several SEPARATE closed solids that overlap on
purpose (the wall, each tine, the pad) and leaves it to the slicer to union them.
So the soup is split into its closed shells (triangles that share vertices),
then shells whose boxes overlap are grouped: a wall and the tines that ride on it
end up as one body the user can hide or delete as "a fin".

Pure Python, millimetres, no adsk imports.
"""

QUANTUM = 1e-4      # mm: vertices closer than this are the same vertex
TOUCH = 0.05        # mm: shells whose boxes come this close are one group


def _key(x, y, z, q=QUANTUM):
    return (round(x / q), round(y / q), round(z / q))


class Group:
    """One body's worth of triangles, welded: coords (flat, mm) and indices."""

    def __init__(self, coords, indices, kind):
        self.coords = coords
        self.indices = indices
        self.kind = kind            # 'fin' or 'pad'

    @property
    def triangle_count(self):
        return len(self.indices) // 3

    def bbox(self):
        c = self.coords
        return (min(c[0::3]), min(c[1::3]), min(c[2::3]),
                max(c[0::3]), max(c[1::3]), max(c[2::3]))

    def misoriented_edges(self):
        """Edges two triangles walk the SAME way: a flipped neighbour. 0 when every
        shell is consistently wound (Fusion flags anything else as 'not oriented')."""
        seen = {}
        idx = self.indices
        for t in range(0, len(idx), 3):
            a, b, c = idx[t], idx[t + 1], idx[t + 2]
            for e in ((a, b), (b, c), (c, a)):
                seen[e] = seen.get(e, 0) + 1
        return sum(1 for n in seen.values() if n > 1)

    def open_edges(self):
        """Edges used by one triangle only: 0 for a closed mesh (each shell is)."""
        count = {}
        idx = self.indices
        for t in range(0, len(idx), 3):
            a, b, c = idx[t], idx[t + 1], idx[t + 2]
            for e in ((a, b), (b, c), (c, a)):
                k = (e[0], e[1]) if e[0] < e[1] else (e[1], e[0])
                count[k] = count.get(k, 0) + 1
        return sum(1 for n in count.values() if n == 1)


def split_shells(soup):
    """Triangle indices (into `soup`, 9 floats each) grouped by shared vertices."""
    n = len(soup) // 9
    parent = list(range(n))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    owner = {}
    for t in range(n):
        base = t * 9
        for v in range(3):
            k = _key(soup[base + 3 * v], soup[base + 3 * v + 1], soup[base + 3 * v + 2])
            o = owner.get(k)
            if o is None:
                owner[k] = t
            else:
                ra, rb = find(o), find(t)
                if ra != rb:
                    parent[rb] = ra
    shells = {}
    for t in range(n):
        shells.setdefault(find(t), []).append(t)
    return list(shells.values())


def _tri_box(soup, tris):
    xs, ys, zs = [], [], []
    for t in tris:
        b = t * 9
        xs += (soup[b], soup[b + 3], soup[b + 6])
        ys += (soup[b + 1], soup[b + 4], soup[b + 7])
        zs += (soup[b + 2], soup[b + 5], soup[b + 8])
    return (min(xs), min(ys), min(zs), max(xs), max(ys), max(zs))


def _boxes_touch(a, b, tol=TOUCH):
    return all(a[i] - tol <= b[i + 3] and b[i] - tol <= a[i + 3] for i in range(3))


def group_shells(soup, shells):
    """Shells grouped by overlapping boxes: lists of triangle indices."""
    boxes = [_tri_box(soup, s) for s in shells]
    parent = list(range(len(shells)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    # Big walls first, so each tine joins the wall it rides on.
    order = sorted(range(len(shells)), key=lambda i: -len(shells[i]))
    for ii, i in enumerate(order):
        for j in order[ii + 1:]:
            if _boxes_touch(boxes[i], boxes[j]):
                ri, rj = find(i), find(j)
                if ri != rj:
                    parent[rj] = ri
    groups = {}
    for i in order:
        groups.setdefault(find(i), []).extend(shells[i])
    return list(groups.values())


def weld(soup, tris, kind):
    """The triangles `tris` of `soup` as one indexed mesh. Triangles that weld down
    to a sliver (two corners on one vertex) are dropped; Fusion rejects them."""
    index = {}
    coords, indices = [], []
    for t in tris:
        b = t * 9
        tri = []
        for v in range(3):
            x, y, z = soup[b + 3 * v], soup[b + 3 * v + 1], soup[b + 3 * v + 2]
            k = _key(x, y, z)
            i = index.get(k)
            if i is None:
                i = index[k] = len(coords) // 3
                coords += (x, y, z)
            tri.append(i)
        if tri[0] != tri[1] and tri[1] != tri[2] and tri[0] != tri[2]:
            indices += tri
    return Group(coords, indices, kind)


def orient(group):
    """Wind every closed shell of `group` consistently and outward, in place.

    The engine's bed pad comes out with some triangles flipped (every edge is shared
    by two triangles, but ~4% of neighbours walk their shared edge the same way).
    Slicers shrug that off; Fusion marks the mesh 'not oriented, no positive volume'.
    Walk each shell from one triangle, flipping any neighbour that disagrees, then
    flip the whole shell if it encloses negative volume. Edges shared by more than
    two triangles are left alone (no consistent answer exists there)."""
    idx = group.indices
    c = group.coords
    n = len(idx) // 3
    by_edge = {}
    for t in range(n):
        for k in range(3):
            a, b = idx[3 * t + k], idx[3 * t + (k + 1) % 3]
            by_edge.setdefault((a, b) if a < b else (b, a), []).append(t)

    def walks(t, a, b):
        """Does triangle t walk the edge a -> b (rather than b -> a)?"""
        for k in range(3):
            if idx[3 * t + k] == a and idx[3 * t + (k + 1) % 3] == b:
                return True
        return False

    def flip(t):
        idx[3 * t + 1], idx[3 * t + 2] = idx[3 * t + 2], idx[3 * t + 1]

    done = [False] * n
    for seed in range(n):
        if done[seed]:
            continue
        done[seed] = True
        shell, stack = [seed], [seed]
        while stack:
            t = stack.pop()
            for k in range(3):
                a, b = idx[3 * t + k], idx[3 * t + (k + 1) % 3]
                tris = by_edge[(a, b) if a < b else (b, a)]
                if len(tris) != 2:
                    continue
                u = tris[0] if tris[1] == t else tris[1]
                if done[u]:
                    continue
                if walks(u, a, b):          # same direction as t: u is flipped
                    flip(u)
                done[u] = True
                shell.append(u)
                stack.append(u)
        vol = 0.0
        for t in shell:
            i, j, k = idx[3 * t], idx[3 * t + 1], idx[3 * t + 2]
            ax, ay, az = c[3 * i], c[3 * i + 1], c[3 * i + 2]
            bx, by, bz = c[3 * j], c[3 * j + 1], c[3 * j + 2]
            cx, cy, cz = c[3 * k], c[3 * k + 1], c[3 * k + 2]
            vol += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)
        if vol < 0:
            for t in shell:
                flip(t)
    return group


def fin_groups(fins, fin_triangles):
    """The engine's output as bodies: fins first (grouped wall + tines), then pads.

    fins           flat soup, fin triangles first, then bed-pad triangles (the order
                   fins_entry.js returns them in)
    fin_triangles  how many of them are fin triangles (stats['finTriangles'])
    """
    n = len(fins) // 9
    split = max(0, min(n, int(fin_triangles)))
    out = []
    for kind, lo, hi in (('fin', 0, split), ('pad', split, n)):
        if hi <= lo:
            continue
        part = fins[lo * 9:hi * 9]
        for g in group_shells(part, split_shells(part)):
            w = weld(part, g, kind)
            if w.indices:
                out.append(orient(w))
    # left to right, then front to back: a stable order for the names
    out.sort(key=lambda g: (g.kind != 'fin', round(g.bbox()[0], 1), round(g.bbox()[1], 1)))
    return out


def signed_volume(group):
    """Volume enclosed by the group's triangles (positive when wound outward)."""
    c, idx = group.coords, group.indices
    vol = 0.0
    for t in range(0, len(idx), 3):
        i, j, k = idx[t], idx[t + 1], idx[t + 2]
        ax, ay, az = c[3 * i], c[3 * i + 1], c[3 * i + 2]
        bx, by, bz = c[3 * j], c[3 * j + 1], c[3 * j + 2]
        cx, cy, cz = c[3 * k], c[3 * k + 1], c[3 * k + 2]
        vol += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)
    return vol / 6.0
