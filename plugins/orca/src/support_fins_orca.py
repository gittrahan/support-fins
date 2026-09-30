# /// script
# requires-python = ">=3.12"
# dependencies = ["numpy>=2.0", "mini-racer==0.14.1"]
#
# [tool.orcaslicer.plugin]
# name = "Support Fins"
# description = "Adds printfins.com breakaway support fins under overhangs at slice time. Parts with Orca supports turned on are left alone."
# author = "Matthew Trahan (engine), J (Orca plugin)"
# version = "0.1.0"
# type = "slicing-pipeline"
# ///
"""Support Fins for OrcaSlicer -- fins added at slice time.

WHAT IT DOES
  When Orca slices a part, this plugin runs the printfins.com fin engine on the
  part as it sits on the plate, then adds the fin (and bed pad) cross-sections to
  every layer as ordinary printed geometry. Orca then builds walls, infill and
  G-code for the fins like any other part of the model. Nothing is exported or
  re-imported, and the fins follow the part: rotate it, re-slice, new fins.

WHY AT SLICE TIME
  Orca's model API is read-only for plugins (no add-object / import-mesh call), so
  fins can't be dropped onto the plate. The slicing pipeline IS writable: at
  Step.posSlice a plugin may edit each layer's slice polygons, and Orca's own
  samples ("Inset Every Slice", "Twistify") show the edits flowing through to
  perimeters, infill and G-code. A fin is geometry; after slicing, geometry is
  just per-layer polygons. So we slice the fin mesh ourselves and hand Orca the
  polygons it would have got from a finned STL.

WHICH PARTS GET FINS
  Every part on the plate whose "Enable support" is OFF. Turn Orca's supports on
  for a part and this plugin leaves it alone -- so the choice between fins and
  Orca supports is the existing per-object support toggle. `apply_to = "all"` in
  the plugin config ignores the toggle.

THE ENGINE
  The fin geometry is Matthew Trahan's printfins.com engine (MIT), unmodified,
  bundled from web/*.js with esbuild and run in an embedded V8 (mini-racer) --
  so the fins match the website instead of being a re-implementation that drifts.

LIMITS (spike)
  * The fins appear in the sliced Preview, not in the Prepare 3D view.
  * The slicing-pipeline API is marked research/experimental by Orca.
  * One fin set per print object (all instances of an object share it).
"""
import json
import os
import time

import orca

try:  # numpy and mini-racer are installed by Orca from the PEP 723 header above
    import numpy as np
except ImportError:  # pragma: no cover - surfaced to the user in execute()
    np = None

ENGINE_JS = "__FINS_ENGINE_JS__"   # replaced by build.py with the esbuild bundle

_DEFAULTS = {
    "enabled": True,
    "apply_to": "no-supports",   # "no-supports" | "all"
    "coverage": 0.5,             # 0..1, website slider default
    "tines": True,
    "tine_density": 0.0,         # 0..1, website slider default
    "bed_pad": True,
}

# ---------------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------------
# __SUPPORTFINS_HOST__ (build.py inlines plugins/shared/py/supportfins_host.py here:
# host_engine() starts V8 with the bundle, host_compute() runs it on a soup)


def _engine_ctx():
    """One V8 context per process (loading the engine costs ~3 ms).

    Started at module load (see the bottom of this section), because Orca's audit
    hook is off while plugins load but gates every file open during slicing, and V8
    reads its ICU data file when it starts.
    """
    if ENGINE_JS.startswith("__FINS_ENGINE"):
        raise RuntimeError("fin engine bundle missing -- run plugins/orca/build.py")
    return host_engine(ENGINE_JS)


if not ENGINE_JS.startswith("__FINS_ENGINE"):
    try:
        _engine_ctx()
    except Exception:  # pragma: no cover - retried (and reported) on first slice
        pass


def compute_fins(soup, layer_height, cfg):
    """Run the printfins.com engine on a posed part.

    soup: (M,3,3) float64 triangles, mm, in whatever frame the caller likes.
    Returns (fins (K,3,3) float64 in the SAME frame as `soup`, stats dict).
    """
    return host_compute(_engine_ctx(), soup, {
        "mode": "auto",
        "bedPad": bool(cfg["bed_pad"]),
        "tines": bool(cfg["tines"]),
        "tineDensity": float(cfg["tine_density"]),
        "coverage": float(cfg["coverage"]),
        "layerHeight": float(layer_height),
    })


# ---------------------------------------------------------------------------------
# Mesh -> per-layer polygons (pure numpy; no Orca types)
# ---------------------------------------------------------------------------------
# The engine emits fins as SEPARATE closed solids (wall, tines, pad) that overlap on
# purpose -- "the slicer unions them". So: split the soup into its closed shells,
# cross-section each shell on its own (where loop nesting is well defined), and let
# Orca's own union (ExPolygon.union_ex) merge shells with each other and with the part.
# Winding is never trusted: outer vs hole comes from nesting depth, and Orca's
# ExPolygon constructor normalises orientation itself.

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


# ---------------------------------------------------------------------------------
# Print frame -> Orca's slice frame
# ---------------------------------------------------------------------------------
class SliceFrame:
    """Affine map from the print-frame (mm, object bottom at z=0) to slice coords.

    Orca slices each object in its own XY frame, in scaled integer units, and does
    not expose the centring offset directly. PrintObject.bounding_box() does give
    the sliced footprint in that frame, so we calibrate: the posed part's XY
    bounding box (mm) must land exactly on it. That also absorbs XY shrinkage
    compensation, which Orca applies as a scale in the object transform.
    """

    def __init__(self, part_xy_min, part_xy_max, slice_bbox, unit):
        (bx0, by0, bx1, by1) = slice_bbox
        w_mm = part_xy_max - part_xy_min
        if w_mm[0] <= 0 or w_mm[1] <= 0:
            raise ValueError("degenerate part footprint")
        self.sx = (bx1 - bx0) / w_mm[0]
        self.sy = (by1 - by0) / w_mm[1]
        self.tx = bx0 - part_xy_min[0] * self.sx
        self.ty = by0 - part_xy_min[1] * self.sy
        nominal = 1.0 / unit
        # Shrinkage compensation is a few percent at most. Anything else means the
        # bbox isn't the footprint we think it is -- refuse rather than misplace fins.
        for s in (self.sx, self.sy):
            if not (0.9 * nominal < s < 1.1 * nominal):
                raise ValueError(f"slice frame calibration off: scale {s:.1f} vs nominal {nominal:.1f}")

    def to_scaled(self, loop):
        out = np.empty((len(loop), 2), dtype=np.int64)
        out[:, 0] = np.rint(loop[:, 0] * self.sx + self.tx)
        out[:, 1] = np.rint(loop[:, 1] * self.sy + self.ty)
        return out


# ---------------------------------------------------------------------------------
# Orca glue
# ---------------------------------------------------------------------------------
def _cfg(self):
    try:
        src = json.loads(self.get_config() or "{}")
    except (AttributeError, TypeError, ValueError):
        src = {}
    cfg = dict(_DEFAULTS)
    for k, v in src.items():
        if k in cfg:
            cfg[k] = v
    return cfg


def _truthy(v):
    return str(v).strip().lower() in ("1", "true", "yes", "on")


def posed_part_soup(print_object):
    """The part as Orca slices it: model-part volumes through the object->print
    transform, as (M,3,3) float64. Modifiers, negative volumes and support
    enforcers/blockers are not part of the solid and are skipped."""
    mo = print_object.model_object()
    trafo = np.asarray(print_object.trafo(), dtype=np.float64)
    chunks = []
    for vol in mo.volumes():
        if not vol.is_model_part():
            continue
        mesh = vol.mesh()
        V = np.asarray(mesh.vertices(), dtype=np.float64)
        T = np.asarray(mesh.triangles(), dtype=np.int64)
        if len(T) == 0:
            continue
        M = trafo @ np.asarray(vol.matrix(), dtype=np.float64)
        Vh = V @ M[:3, :3].T + M[:3, 3]
        tris = Vh[T]
        if np.linalg.det(M[:3, :3]) < 0:
            # A mirrored part flips every triangle's winding; the engine reads
            # overhangs from face normals, so restore outward-facing order.
            tris = tris[:, [0, 2, 1], :]
        chunks.append(tris)
    if not chunks:
        return np.empty((0, 3, 3))
    return np.concatenate(chunks, axis=0)


def _elephant_foot(print_object):
    """(compensation mm, layers) as Orca will apply it; 0 when printing on a raft."""
    def num(key, cast, default):
        try:
            v = print_object.config_value(key)
            return cast(v) if v not in (None, "") else default
        except (TypeError, ValueError):
            return default
    if num("raft_layers", int, 0) > 0:
        return 0.0, 0
    return max(0.0, num("elefant_foot_compensation", float, 0.0)), max(1, num("elefant_foot_compensation_layers", int, 1))


def _shrink_keep_thin(expolys, delta_scaled):
    """Inward offset for elephant-foot compensation. A thin fin wall that would lose
    most of its width keeps its original outline -- Orca's own compensation also
    protects features below a minimum width rather than erasing them."""
    if delta_scaled <= 0:
        return expolys
    out = []
    for e in expolys:
        shrunk = e.offset(-delta_scaled)
        kept = sum(x.area() for x in shrunk)
        out.extend(shrunk if kept >= 0.5 * e.area() else [e])
    return out


def _bbox_overlap(a, b):
    return not (a[2] < b[0] or b[2] < a[0] or a[3] < b[1] or b[3] < a[1])


def _expoly_bbox(e):
    c = np.asarray(e.contour.as_array())
    return (c[:, 0].min(), c[:, 1].min(), c[:, 0].max(), c[:, 1].max())


def add_fins_to_layer(layer, fin_expolys):
    """Merge fin ExPolygons into the layer's first region, unioning with any part
    slice they overlap (tines are meant to fuse), then re-derive the islands."""
    regions = layer.regions()
    if not regions or not fin_expolys:
        return 0
    region = regions[0]
    existing = [(s.surface_type, s.expolygon) for s in region.slices.surfaces]
    # Copy: set()/append() below invalidate references into the live collection.
    existing = [(t, orca.host.ExPolygon(e.contour, list(e.holes))) for t, e in existing]
    boxes = [_expoly_bbox(e) for _, e in existing]
    added = 0
    for fin in fin_expolys:
        merged, mtype, mbox = fin, orca.host.SurfaceType.stInternal, _expoly_bbox(fin)
        keep, keep_boxes = [], []
        for (t, e), bb in zip(existing, boxes):
            if _bbox_overlap(bb, mbox):
                u = merged.union_ex(e)
                if len(u) == 1:          # they really overlapped: fuse, keep the part's type
                    merged, mtype, mbox = u[0], t, _expoly_bbox(u[0])
                    continue
            keep.append((t, e))
            keep_boxes.append(bb)
        existing, boxes = keep + [(mtype, merged)], keep_boxes + [mbox]
        added += 1
    by_type = {}
    for t, e in existing:
        by_type.setdefault(t, []).append(e)
    items = list(by_type.items())
    region.slices.set(items[0][1], items[0][0])
    for t, es in items[1:]:
        region.slices.append(es, t)
    layer.make_slices()
    return added


def inject_fins(print_object, cfg, layer_height, unit, log=None):
    """Compute fins for one PrintObject and add them to its layers. Returns a
    short human-readable result string. If `log` is a dict it is filled with
    diagnostics (frame calibration, per-layer fin area) for the spike."""
    log = {} if log is None else log
    soup = posed_part_soup(print_object)
    if len(soup) == 0:
        return "no model-part volumes"
    zmin = soup[:, :, 2].min()
    soup = soup - np.array([0.0, 0.0, zmin])       # object bottom at z = 0, like slice_z
    fins, stats = compute_fins(soup, layer_height, cfg)
    if len(fins) == 0:
        return "no fins needed"
    pts = soup.reshape(-1, 3)
    bbox = print_object.bounding_box()
    frame = SliceFrame(pts[:, :2].min(axis=0), pts[:, :2].max(axis=0), bbox, unit)
    log.update({
        "part_faces": int(len(soup)), "part_size_mm": (pts.max(axis=0) - pts.min(axis=0)).round(4).tolist(),
        "slice_bbox_scaled": list(bbox), "unit": unit,
        "frame_scale": [frame.sx, frame.sy], "frame_scale_vs_nominal": [frame.sx * unit, frame.sy * unit],
        "engine": stats, "fin_triangles": int(len(fins)), "layers": [],
    })
    shells = split_shells(fins)
    shell_z = [(sh[:, :, 2].min(), sh[:, :, 2].max()) for sh in shells]
    efc_mm, efc_layers = _elephant_foot(print_object)
    log["elephant_foot"] = [efc_mm, efc_layers]
    touched = 0
    for layer_id, layer in enumerate(print_object.layers()):
        z = float(layer.slice_z)
        expolys = []
        for sh, (z0, z1) in zip(shells, shell_z):
            if z < z0 or z > z1:
                continue
            for outer, holes in group_loops(slice_soup(sh, z)):
                expolys.append(orca.host.ExPolygon(frame.to_scaled(outer),
                                                   [frame.to_scaled(h) for h in holes]))
        if expolys and efc_mm > 0 and layer_id < efc_layers:
            # Orca shrinks the first layer(s) by the elephant-foot compensation at
            # slice time, BEFORE our hook runs, so the part is already compensated and
            # the fins are not. Match it (measured in an Orca 2.5 nightly: without this the first
            # layer of a finned STL and of the plugin differ by the 0.1 mm EFC).
            shrink = efc_mm - (efc_mm / efc_layers) * layer_id
            expolys = _shrink_keep_thin(expolys, int(round(shrink / unit)))
        if expolys and add_fins_to_layer(layer, expolys):
            touched += 1
            log["layers"].append([round(z, 4), round(sum(e.area() for e in expolys) * unit * unit, 4)])
    return (f"{stats.get('braces', 0)} fin(s), {stats.get('tines', 0)} tine(s) "
            f"on {touched} layer(s)")


class SupportFinsSlicing(orca.slicing.SlicingPipelineCapabilityBase):
    def get_name(self):
        return "Support Fins"

    def get_default_config(self):
        return _DEFAULTS

    def execute(self, ctx):
        if ctx.step != orca.slicing.Step.posSlice or ctx.object is None:
            return orca.ExecutionResult.success()
        cfg = _cfg(self)
        if not cfg["enabled"]:
            return orca.ExecutionResult.success("Support Fins: disabled in plugin config")
        if np is None:
            return orca.ExecutionResult.failure(orca.PluginResult.RecoverableError,
                                                "Support Fins needs numpy (install failed?)")
        po = ctx.object
        if cfg["apply_to"] != "all" and _truthy(po.config_value("enable_support")):
            return orca.ExecutionResult.success("Support Fins: skipped (Orca supports are on for this part)")
        try:
            lh = float(po.config_value("layer_height") or ctx.config_value("layer_height") or 0.2)
        except (TypeError, ValueError):
            lh = 0.2
        log = {"object_id": _safe(lambda: po.id()), "layer_height": lh, "started": time.time()}
        try:
            msg = inject_fins(po, cfg, lh, orca.slicing.unscale(1), log)
        except Exception as e:  # never break a slice over fins; report and carry on
            log["error"] = f"{type(e).__name__}: {e}"
            _write_log(log)
            return orca.ExecutionResult.failure(orca.PluginResult.RecoverableError,
                                                f"Support Fins: {type(e).__name__}: {e}")
        log["result"] = msg
        log["seconds"] = round(time.time() - log["started"], 3)
        _write_log(log)
        return orca.ExecutionResult.success(f"Support Fins: {msg}")


def _safe(fn):
    try:
        return fn()
    except Exception:
        return None


def _write_log(entry):
    """Spike diagnostics: append one JSON line per sliced object next to the plugin
    (support_fins_log.jsonl). Best effort -- never fails the slice."""
    try:
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "support_fins_log.jsonl")
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, default=str) + "\n")
    except Exception:
        pass


@orca.plugin
class SupportFinsPlugin(orca.base):
    def register_capabilities(self):
        orca.register_capability(SupportFinsSlicing)
