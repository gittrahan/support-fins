"""Support Fins -- shared mesh slicing: triangle soup -> per-layer polygons.

For hosts whose API takes layer polygons instead of a mesh (Orca today): split the
engine's soup into closed shells, cross-section each shell at a layer's Z, and group
the loops into outers with holes. Pure numpy, no host types; the host unions the
shells with each other and with the part itself.

    for shell in split_shells(fins):
        for outer, holes in group_loops(slice_soup(shell, z)):
            ...

How each plugin gets this file:
  Orca     inlined into the single-file plugin by plugins/orca/build.py
  others   none yet; a plugin that needs it copies it in at build time, as Cura does the host
"""
try:  # Orca installs numpy from the plugin's PEP 723 header and reports a failed install itself
    import numpy as np
except ImportError:  # pragma: no cover
    np = None

# The engine emits fins as SEPARATE closed solids (wall, tines, pad) that overlap on
# purpose -- "the slicer unions them". So: split the soup into its closed shells,
# cross-section each shell on its own (where loop nesting is well defined), and let
# the host's own union (Orca: ExPolygon.union_ex) merge shells with each other and with
# the part. Winding is never trusted: outer vs hole comes from nesting depth, and the
# host normalises orientation itself (Orca: the ExPolygon constructor).

def _vkey(v, quantum=1e-4):
    return np.round(v / quantum).astype(np.int64)


def split_shells(tris):
    """Closed shells of a triangle soup: triangles are in the same shell when they
    share an EDGE. Two solids that merely touch at a vertex (a tine tip on a wall
    corner, say) stay separate, which keeps each shell's cross-section nesting sane."""
    n = len(tris)
    if n == 0:
        return []
    _, vid = np.unique(_vkey(tris.reshape(-1, 3)), axis=0, return_inverse=True)
    vid = vid.reshape(n, 3)
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    owner = {}
    for f, (a, b, c) in enumerate(vid):
        for u, v in ((a, b), (b, c), (c, a)):
            e = (u, v) if u < v else (v, u)
            g = owner.setdefault(e, f)
            if g != f:
                ra, rb = find(f), find(g)
                if ra != rb:
                    parent[rb] = ra
    roots = np.array([find(f) for f in range(n)])
    return [tris[roots == r] for r in np.unique(roots)]


PLANE_NUDGE = -1e-7  # mm


def slice_soup(tris, z, quantum=1e-6):
    """Cross-section ONE closed shell with the plane Z = z -> list of closed loops,
    each an (N,2) float64 array (orientation unspecified).

    The plane is nudged DOWN by 1e-7 mm so no vertex ever lies exactly on it. It
    matters: the engine sizes the bed pad to the layer height, so the pad's top face
    can land exactly on a layer's slice_z, and a face ON the plane is ambiguous
    (half the layer is pad). Orca's own slicer puts that layer INSIDE the solid --
    measured in an Orca 2.5 nightly: lbracket's pad top sits at z = 0.5 = slice_z of layer 3,
    and a finned STL sliced by Orca prints pad there. Nudging down gives the same
    answer, so the plugin's layers match a finned STL exactly."""
    if len(tris) == 0:
        return []
    z = z + PLANE_NUDGE
    zs = tris[:, :, 2]
    sel = (zs.min(axis=1) <= z) & (zs.max(axis=1) >= z)
    if not np.any(sel):
        return []
    t = tris[sel]
    above = (t[:, :, 2] - z) >= 0.0
    n_above = above.sum(axis=1)
    keep = (n_above == 1) | (n_above == 2)
    t, above = t[keep], above[keep]
    if len(t) == 0:
        return []
    d = t[:, :, 2] - z
    segs = []
    for p, dk, ab in zip(t, d, above):
        lone = int(np.nonzero(ab if ab.sum() == 1 else ~ab)[0][0])
        a, b = (lone + 1) % 3, (lone + 2) % 3
        segs.append((_edge_cross(p[lone], p[a], dk[lone], dk[a]),
                     _edge_cross(p[lone], p[b], dk[lone], dk[b])))
    return _chain(segs, quantum)


def _edge_cross(p0, p1, d0, d1):
    s = d0 / (d0 - d1)
    return (p0 + s * (p1 - p0))[:2]


def _chain(segs, quantum):
    """Join undirected segments into closed loops via shared endpoints."""
    key = lambda q: (round(float(q[0]) / quantum), round(float(q[1]) / quantum))
    at = {}
    for i, (p, q) in enumerate(segs):
        at.setdefault(key(p), []).append(i)
        at.setdefault(key(q), []).append(i)
    used = [False] * len(segs)
    loops = []
    for i in range(len(segs)):
        if used[i]:
            continue
        used[i] = True
        start, cur_pt = segs[i]
        loop = [start]
        start_key = key(start)
        closed = False
        for _ in range(len(segs)):
            k = key(cur_pt)
            if k == start_key:
                closed = True
                break
            loop.append(cur_pt)
            nxt = next((j for j in at.get(k, ()) if not used[j]), None)
            if nxt is None:
                break  # open chain: non-manifold input, drop it
            used[nxt] = True
            p, q = segs[nxt]
            cur_pt = q if key(p) == k else p
        if closed and len(loop) >= 3:
            loops.append(np.array(loop))
    return loops


def signed_area(loop):
    x, y = loop[:, 0], loop[:, 1]
    return 0.5 * float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


def point_in_loop(pt, loop):
    x, y = loop[:, 0], loop[:, 1]
    xn, yn = np.roll(x, -1), np.roll(y, -1)
    cond = (y > pt[1]) != (yn > pt[1])
    with np.errstate(divide="ignore", invalid="ignore"):
        xc = (xn - x) * (pt[1] - y) / (yn - y) + x
    return bool(np.count_nonzero(cond & (pt[0] < xc)) % 2)


def group_loops(loops, min_area=1e-4):
    """Loops of one shell -> [(outer, [holes])] by nesting depth (even = outer)."""
    loops = [lp for lp in loops if abs(signed_area(lp)) >= min_area]
    n = len(loops)
    contains = [[j for j in range(n) if j != i and point_in_loop(loops[i][0], loops[j])]
                for i in range(n)]
    depth = [len(c) for c in contains]
    outers = [i for i in range(n) if depth[i] % 2 == 0]
    groups = {i: [] for i in outers}
    for i in range(n):
        if depth[i] % 2 == 1:
            # its outer is the container exactly one level up
            parent = next((j for j in contains[i] if depth[j] == depth[i] - 1), None)
            if parent is not None:
                groups[parent].append(loops[i])
    return [(loops[i], groups[i]) for i in outers]
