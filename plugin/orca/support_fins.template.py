# /// script
# requires-python = ">=3.12"
# dependencies = ["numpy", "mini-racer", "shapely"]
#
# [tool.orcaslicer.plugin]
# name = "Support Fins"
# description = "printfins.com breakaway support fins for OrcaSlicer: add them automatically when you slice, or export each finned part as a .3mf."
# author = "Matthew Trahan"
# version = "@@VERSION@@"
# ///
"""
Support Fins for OrcaSlicer -- the printfins.com engine, run on your plate.

GENERATED FILE. Edit support_fins.template.py / engine_glue.js and re-run
build.py; the engine source below is bundled from web/ at @@ENGINE_REV@@.

Two ways to use it
------------------
  * "add fins when slicing" (slicing-pipeline capability): tick it under the
    Process preset's slicing-pipeline plugins and every slice gets fins -- no
    files, no import. Fins show in the sliced Preview, not the 3D editor.
  * "export finned .3mf" (script capability): run from the Plugins dialog; writes
    <part>-fins.3mf per part for File > Import, fins visible and editable.

How it works
------------
The fin engine is the website's own JavaScript (overhangs.js, fins.js, prop.js,
planes.js, inside.js, threemf.js), bundled into ENGINE_JS below and run in an
embedded V8 (mini-racer). No Python port: the plugin fins a part exactly the way
printfins.com's Auto mode does, and can't drift from it.

Orca's plugin API can't add objects to the plate (the model is read-only), but a
slicing-pipeline plugin may edit each layer's sliced outlines. So the slicing
mode cuts the fins at every layer height and unions them into the object's own
slices right after Orca slices it -- the same layers Orca would get from slicing
the exported part+fins .3mf. The script mode writes that .3mf instead.

Three sandbox rules shape the code:
  * mini-racer is imported and V8 started at MODULE LOAD. Orca audits every file
    open during execute(), and starting V8 reads its ICU data file -- a lazy start
    inside execute() is blocked (same trap trimesh hit in the probe).
  * V8 runs --jitless. Its JIT crashes (SIGTRAP) under mini-racer on macOS, and a
    hardened app like Orca may not grant JIT memory anyway. The interpreter is
    ~15x slower but still ~0.1-0.3s for a typical part, ~2s for a 44k-face one.
  * Writing to ~/Downloads is outside Orca's allowed roots, so Orca asks Yes/No
    per new file. On No we fall back to Orca's own data folder (always allowed).
"""
import base64
import hashlib
import json
import os

import orca
import numpy as np
from shapely.geometry import Polygon as SPolygon
from shapely.ops import unary_union

import py_mini_racer._dll as _mr_dll
from py_mini_racer import MiniRacer

ENGINE_JS = @@ENGINE_JS@@

# The website's defaults (index.html): Auto mode, bed pad on, tines on at the
# default density, 0.2mm layers, 50% coverage.
FIN_OPTS = {"mode": "auto", "bedPad": True, "tines": True, "tineDensity": 0.0,
            "layerHeight": 0.2, "coverage": 0.5}

OUT_DIR = os.path.expanduser("~/Downloads/support-fins")

try:
    _mr_dll.init_mini_racer(flags=("--single-threaded", "--jitless"),
                            ignore_duplicate_init=True)
    _ENGINE = MiniRacer()
    _ENGINE.eval(ENGINE_JS)
    _ENGINE_ERR = None
except Exception as e:  # keep the plugin loadable so the dialog can say why
    _ENGINE = None
    _ENGINE_ERR = e


def _fin_opts(layer_height=None):
    opts = dict(FIN_OPTS)
    if layer_height:
        opts["layerHeight"] = float(layer_height)
    return opts


def _world_tris(obj, vol):
    """One volume's triangles in PLATE space as an (M,3,3) array.

    orca.host gives volume-LOCAL vertices; the engine must see the part the way
    the user posed it on the plate, so apply instance @ volume. A mirrored
    transform (det < 0) flips the winding -- swap two corners to keep normals out.
    """
    mesh = vol.mesh()
    V = np.asarray(mesh.vertices(), dtype=np.float64)
    T = np.asarray(mesh.triangles(), dtype=np.int64)
    M = np.asarray(obj.instance(0).matrix(), dtype=np.float64) @ \
        np.asarray(vol.matrix(), dtype=np.float64)
    V = (np.c_[V, np.ones(len(V))] @ M.T)[:, :3]
    if np.linalg.det(M[:3, :3]) < 0:
        T = T[:, [0, 2, 1]]
    return V[T]


def _is_model_part(vol):
    """Skip modifiers / negative volumes when the API exposes it; the host docs
    don't list a volume-type accessor, so default to treating it as a part."""
    f = getattr(vol, "is_model_part", None)
    if f is None:
        return True
    try:
        return bool(f() if callable(f) else f)
    except Exception:
        return True


def _object_name(obj, i):
    name = getattr(obj, "name", None)
    name = name() if callable(name) else name
    name = str(name or f"object-{i + 1}")
    stem = os.path.splitext(os.path.basename(name))[0]
    return "".join(c if c.isalnum() or c in "-_ ." else "_" for c in stem) or f"object-{i + 1}"


def _save(fname, data):
    """Write to ~/Downloads/support-fins; if Orca's permission prompt is refused,
    fall back to Orca's data folder, which plugins may always write."""
    for d in (OUT_DIR, os.path.join(_data_dir(), "support-fins")):
        try:
            os.makedirs(d, exist_ok=True)
            path = os.path.join(d, fname)
            with open(path, "wb") as f:
                f.write(data)
            return path
        except PermissionError:
            continue
    raise PermissionError("no writable folder (Downloads refused, data folder refused)")


def _data_dir():
    for name in ("data_dir",):
        f = getattr(orca, name, None) or getattr(orca.host, name, None)
        if callable(f):
            try:
                return str(f())
            except Exception:
                pass
    return os.path.expanduser("~/Library/Application Support/OrcaSlicer")


class SupportFins(orca.script.ScriptPluginCapabilityBase):
    def get_name(self):
        return "Support Fins — export finned .3mf"

    def execute(self):
        if _ENGINE is None:
            return orca.ExecutionResult.skipped(
                f"Support Fins engine failed to start ({type(_ENGINE_ERR).__name__}: "
                f"{_ENGINE_ERR}). Try reinstalling the plugin.")
        try:
            objs = list(orca.host.model().objects())
        except Exception as e:
            return orca.ExecutionResult.skipped(f"Couldn't read the plate ({e}).")
        if not objs:
            return orca.ExecutionResult.skipped("Nothing on the plate. Add a part, then run Support Fins.")

        saved, clean, failed, report = [], [], [], []
        for i, obj in enumerate(objs):
            name = _object_name(obj, i)
            try:
                parts = [_world_tris(obj, v) for v in obj.volumes() if _is_model_part(v)]
                tris = np.concatenate(parts) if parts else np.zeros((0, 3, 3))
                if not len(tris):
                    continue
                r = json.loads(_ENGINE.call(
                    "sfFinPart", tris.astype(np.float32).ravel().tolist(), name, FIN_OPTS,
                    timeout_sec=120))
            except Exception as e:
                failed.append(name)
                report.append(f"{name}: FAILED {type(e).__name__}: {e}")
                continue

            if not r["threemf"]:
                clean.append(name)
                report.append(f"{name}: no fins needed ({r['regions']} overhang regions, "
                              f"{r['unserved']} unserved)")
                continue
            try:
                path = _save(f"{name}-fins.3mf", base64.b64decode(r["threemf"]))
            except Exception as e:
                failed.append(name)
                report.append(f"{name}: fins built but not saved ({e})")
                continue
            saved.append(path)
            extras = (", bed pad" if r["pad"] else "") + \
                     (f", {r['unserved']} regions unserved" if r["unserved"] else "")
            report.append(f"{name}: {r['fins']} fins, {r['tines']} tines{extras} -> {path}")

        print("Support Fins\n  " + "\n  ".join(report))  # full detail -> Orca log

        # Orca's result dialog flattens newlines, so keep the message to a sentence
        # or two; the per-part detail goes to the log above.
        if not saved:
            msg = "No fins needed" if not failed else f"Couldn't fin {', '.join(failed)}"
            if clean:
                msg += f" ({', '.join(clean)} {'is' if len(clean) == 1 else 'are'} already printable as posed)"
            return orca.ExecutionResult.success(msg + ".")
        where = os.path.dirname(saved[0])
        msg = (f"Fins fitted to {len(saved)} of {len(saved) + len(clean) + len(failed)} parts, "
               f"saved to {where}. File > Import the .3mf, then delete the original part.")
        if failed:
            msg += f" Failed: {', '.join(failed)}."
        return orca.ExecutionResult.success(msg)


# ---- slice-time mode --------------------------------------------------------

_FIN_CACHE = {}          # sha1(part in slice frame + opts) -> fin triangle soup (K,3,3)
ALIGN_TOL_MM = 0.05      # our part cut vs Orca's own slice; beyond this, don't guess


def _slice_frame_tris(po):
    """The object's model parts in the frame its layer slices live in.

    From PrintObject.cpp / PrintApply.cpp: slices are cut from the mesh under
    trafo_centered() = trafo() (first instance's matrix with XY translation zeroed,
    shrinkage compensation applied) followed by an XY shift of -center_offset, the
    XY centre of ModelObject::raw_bounding_box() (model parts under the instance
    matrix with no offset). The binding exposes trafo() but not the centre, so
    rebuild it the same way; _check_alignment() then verifies against Orca's cut.
    """
    mo = po.model_object()
    T = np.asarray(po.trafo(), dtype=np.float64)
    inst = np.asarray(mo.instance(0).matrix(), dtype=np.float64).copy()
    inst[:3, 3] = 0.0
    frame, raw = [], []
    for vol in mo.volumes():
        if not _is_model_part(vol):
            continue
        mesh = vol.mesh()
        V = np.asarray(mesh.vertices(), dtype=np.float64)
        F = np.asarray(mesh.triangles(), dtype=np.int64)
        VM = np.asarray(vol.matrix(), dtype=np.float64)
        Vh = np.c_[V, np.ones(len(V))]
        M = T @ VM
        W = (Vh @ M.T)[:, :3]
        if np.linalg.det(M[:3, :3]) < 0:
            F = F[:, [0, 2, 1]]
        frame.append(W[F])
        raw.append((Vh @ (inst @ VM).T)[:, :3])
    if not frame:
        return None
    raw = np.concatenate(raw)
    center = (raw[:, :2].min(0) + raw[:, :2].max(0)) / 2.0
    tris = np.concatenate(frame)
    tris[:, :, :2] -= center
    return tris


class Welded:
    """A triangle soup welded once (1e-5 mm) so crossing edges are shared between
    faces, with per-face z extents to skip faces a layer doesn't cross."""

    def __init__(self, tris):
        V, inv = np.unique(np.round(tris.reshape(-1, 3), 5), axis=0, return_inverse=True)
        self.V, self.F = V, inv.reshape(-1, 3)
        z = V[self.F][:, :, 2]
        self.zlo, self.zhi = z.min(1), z.max(1)


def _cut(mesh, z):
    """Cross-section of a Welded mesh at height z -> shapely geometry (mm).

    Every crossing face contributes one segment oriented with the solid on its
    left (outward normal to the right), and segments chain edge-to-edge into
    closed loops. CCW loops are material, CW loops are holes.
    """
    if not isinstance(mesh, Welded):
        mesh = Welded(mesh)
    F = mesh.F[(mesh.zlo <= z + 1e-5) & (mesh.zhi >= z - 1e-5)]
    if not len(F):
        return None
    V = mesh.V
    d = V[:, 2] - z
    if np.any(np.abs(d[F]) < 1e-7):       # plane through a vertex: nudge off it
        d = V[:, 2] - (z + 2e-6)
    up = d > 0
    n_up = up[F].sum(1)
    F = F[(n_up == 1) | (n_up == 2)]
    if not len(F):
        return None

    E = np.stack([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]], axis=1)   # (k,3,2)
    crosses = up[E[:, :, 0]] != up[E[:, :, 1]]                          # 2 per face
    pick = np.argsort(~crosses, axis=1, kind="stable")[:, :2]
    rows = np.arange(len(F))[:, None]
    e = E[rows, pick]                                                   # (k,2,2)
    a, b = e[..., 0], e[..., 1]
    t = d[a] / (d[a] - d[b])
    P = V[a][..., :2] + t[..., None] * (V[b][..., :2] - V[a][..., :2])  # (k,2,2)
    keys = np.minimum(a, b) * len(V) + np.maximum(a, b)                 # (k,2)

    tri = V[F]
    n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])[:, :2]
    dvec = P[:, 1] - P[:, 0]
    flip = (dvec[:, 1] * n[:, 0] - dvec[:, 0] * n[:, 1]) < 0            # right normal . n < 0
    P[flip] = P[flip][:, ::-1]
    keys[flip] = keys[flip][:, ::-1]

    # Two solids that touch along an edge (the fin engine's parts overlap by
    # design) share it with FOUR faces, so an edge can start two segments. Keep
    # them all and let a loop pass through the shared point either way -- every
    # loop is unioned below, so which way it pairs up doesn't change the result.
    nxt = {}
    for (k0, k1), (p0, _) in zip(keys, P):
        nxt.setdefault(int(k0), []).append((int(k1), p0))
    outers, holes = [], []
    while nxt:
        start = next(iter(nxt))
        k, p = nxt[start].pop()
        if not nxt[start]:
            del nxt[start]
        loop = [p]
        while k != start and k in nxt:
            k2, p = nxt[k].pop()
            if not nxt[k]:
                del nxt[k]
            k = k2
            loop.append(p)
        if k != start or len(loop) < 3:
            continue                                  # open chain (non-manifold): drop
        L = np.asarray(loop)
        signed = 0.5 * np.sum(L[:, 0] * np.roll(L[:, 1], -1) - np.roll(L[:, 0], -1) * L[:, 1])
        poly = SPolygon(L)
        if not poly.is_valid:
            poly = poly.buffer(0)
        if not poly.is_empty:
            (outers if signed > 0 else holes).append(poly)
    if not outers:
        return None
    geom = unary_union(outers)
    if holes:
        geom = geom.difference(unary_union(holes))
    return geom


def _to_shapely(expoly, mm):
    shell = expoly.contour.as_array() * mm
    holes = [h.as_array() * mm for h in expoly.holes]
    return SPolygon(shell, holes)


def _to_expolygons(geom, per_mm):
    out = []
    for poly in getattr(geom, "geoms", [geom]):
        if poly.is_empty or poly.geom_type != "Polygon":
            continue
        shell = np.rint(np.asarray(poly.exterior.coords)[:-1] * per_mm).astype(np.int64)
        holes = [np.rint(np.asarray(r.coords)[:-1] * per_mm).astype(np.int64)
                 for r in poly.interiors]
        holes = [h for h in holes if len(h) >= 3]
        if len(shell) >= 3:
            out.append(orca.host.ExPolygon(shell, holes))
    return out


def _check_alignment(po, part, mm):
    """Cut our reconstructed part at a mid layer and compare with Orca's own slice.

    Guards the frame reconstruction: if Orca ever changes how it centres objects,
    we'd rather add no fins than add them in the wrong place.
    """
    layers = po.layers()
    for layer in layers[len(layers) // 2:] + layers[:len(layers) // 2]:
        orca_geom = unary_union([_to_shapely(s.expolygon, mm)
                                 for r in layer.regions() for s in r.slices.surfaces])
        if orca_geom.is_empty or orca_geom.area < 1.0:
            continue
        ours = _cut(part, layer.slice_z)
        if ours is None or ours.is_empty:
            return None
        a, b = orca_geom.centroid, ours.centroid
        return float(np.hypot(a.x - b.x, a.y - b.y))
    return None


class SupportFinsAtSlice(orca.slicing.SlicingPipelineCapabilityBase):
    def get_name(self):
        return "Support Fins — add fins when slicing"

    def execute(self, ctx):
        if ctx.step != orca.slicing.Step.posSlice or ctx.object is None:
            return orca.ExecutionResult.success()
        if _ENGINE is None:
            return orca.ExecutionResult.skipped(f"Support Fins engine failed to start: {_ENGINE_ERR}")
        po = ctx.object
        name = po.model_object().name or "object"
        mm = orca.slicing.unscale(1)          # mm per scaled unit (never hardcode)
        per_mm = 1.0 / mm

        part = _slice_frame_tris(po)
        if part is None or not po.layers():
            return orca.ExecutionResult.success(f"{name}: nothing to fin")

        try:
            layer_h = ctx.config_value("layer_height")
        except Exception:
            layer_h = None
        opts = _fin_opts(layer_h)
        key = hashlib.sha1(part.astype(np.float32).tobytes() +
                           json.dumps(opts, sort_keys=True).encode()).hexdigest()
        fins = _FIN_CACHE.get(key)
        if fins is None:
            r = json.loads(_ENGINE.call("sfFinTris", part.astype(np.float32).ravel().tolist(),
                                        opts, timeout_sec=120))
            fins = np.asarray(r["tris"], dtype=np.float64).reshape(-1, 3, 3)
            fins = Welded(fins) if len(fins) else None
            _FIN_CACHE[key] = fins
        if fins is None:
            return orca.ExecutionResult.success(f"{name}: no fins needed")

        off = _check_alignment(po, Welded(part), mm)
        if off is None or off > ALIGN_TOL_MM:
            return orca.ExecutionResult.skipped(
                f"{name}: fins NOT added -- couldn't line up with Orca's slice "
                f"(offset {'?' if off is None else f'{off:.3f}'} mm). Use the .3mf export instead.")

        internal = orca.host.SurfaceType.stInternal
        zlo, zhi = fins.zlo.min(), fins.zhi.max()
        touched = 0
        for layer in po.layers():
            if not zlo <= layer.slice_z <= zhi:
                continue
            if ctx.cancelled():
                break
            fin_geom = _cut(fins, layer.slice_z)
            if fin_geom is None or fin_geom.is_empty:
                continue
            region = layer.regions()[0]
            existing = [_to_shapely(s.expolygon, mm) for s in region.slices.surfaces]
            merged = unary_union(existing + [fin_geom])
            region.slices.set(_to_expolygons(merged, per_mm), internal)
            layer.make_slices()
            touched += 1
        return orca.ExecutionResult.success(
            f"{name}: fins added to {touched} layers (align {off:.3f} mm)")


@orca.plugin
class SupportFinsPlugin(orca.base):
    def register_capabilities(self):
        orca.register_capability(SupportFins)
        orca.register_capability(SupportFinsAtSlice)
