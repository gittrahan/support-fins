# /// script
# requires-python = ">=3.12"
# dependencies = ["numpy>=2.0", "mini-racer==0.14.1"]
#
# [tool.orcaslicer.plugin]
# name = "Support Fins"
# description = "Adds printfins.com breakaway support fins under overhangs at slice time. Parts with Orca supports turned on are left alone."
# author = "Matthew Trahan (engine), J (Orca plugin)"
# version = "0.7.0"
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
VERSION = "0.7.0"   # stamped by build.py (plugins/shared/version.py), as the header's

# The plugin's own config keys, and its whole default config: Orca's "Restore defaults"
# writes this back as the stored config, so a default listing every setting would pin
# those users to today's defaults for good. Every other key is a setting from options.json, the
# schema every plugin dialog is built from (mode, gap, threshold, padStyle, cutout,
# sway.on, ...), in the engine's units: a percent setting is value / 100, as
# coverage 0.5 always was here. They go to the engine through host_options, which
# checks each one, so a typo or a bad value fails the slice with the engine's own
# message rather than quietly printing default fins.
_DEFAULTS = {
    "enabled": True,
    "apply_to": "no-supports",   # "no-supports" | "all"
}
# Older configs' names: tine_density is tineDensity; bed_pad false is padStyle "off".
_ALIASES = {"tine_density": "tineDensity"}

# ---------------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------------
# host_engine() starts V8 with the bundle, host_compute() runs it on a soup
# __SUPPORTFINS_HOST__ (build.py inlines plugins/shared/py/supportfins_host.py here)


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


def compute_fins(soup, layer_height, cfg, nozzle=None):
    """Run the printfins.com engine on a posed part.

    soup: (M,3,3) float64 triangles, mm, in whatever frame the caller likes.
    nozzle: the part's nozzle diameter (mm), which sizes the walls and tines; None = 0.4.
    Returns (fins (K,3,3) float64 in the SAME frame as `soup`, stats dict).
    """
    ctx = _engine_ctx()
    return host_compute(ctx, soup, engine_options(ctx, cfg, layer_height, nozzle))


def engine_options(ctx, cfg, layer_height, nozzle=None):
    """The plugin config -> checked engine options (raises ValueError on a bad key or
    value). Layer height and nozzle are always the slice's own (options.json
    hostSupplied); a nozzle of None leaves the engine's 0.4."""
    values = {k: v for k, v in cfg.items() if k not in _DEFAULTS}
    # hand-written JSON says 1 / 0 (or "1" / "0") for on / off
    for o in host_schema(ctx)["options"]:
        v = values.get(o["key"])
        if o["type"] == "bool" and not isinstance(v, bool) and str(v).strip() in ("0", "1"):
            values[o["key"]] = str(v).strip() == "1"
    for old, new in _ALIASES.items():
        if old in values:
            values.setdefault(new, values[old])
            del values[old]
    bed_pad = values.pop("bed_pad", True)
    if bed_pad is False or str(bed_pad).strip().lower() in ("0", "false", "no", "off"):
        values.setdefault("padStyle", "off")
    if "layerHeight" in values:
        raise ValueError("layerHeight is Orca's own layer height: remove it from the plugin config")
    values["layerHeight"] = float(layer_height)
    if "nozzle" in values:
        raise ValueError("nozzle is Orca's own nozzle diameter: remove it from the plugin config")
    if nozzle:
        values["nozzle"] = float(nozzle)
    return host_options(ctx, values)


def _nozzle(print_object, ctx=None):
    """The nozzle (mm) that prints this object's walls, from Orca's printer settings
    ("0.4,0.6" or a list, one per extruder; wall_filament picks, 1-based). None
    when Orca doesn't say, which keeps the engine's 0.4."""
    def val(key):
        for src in (print_object, ctx):
            try:
                v = src.config_value(key) if src is not None else None
            except Exception:
                v = None
            if v not in (None, ""):
                return v
        return None
    raw = val("nozzle_diameter")
    if raw is None:
        return None
    sizes = list(raw) if isinstance(raw, (list, tuple)) else str(raw).split(",")
    try:
        sizes = [float(s) for s in sizes]
        idx = max(0, int(val("wall_filament") or 1) - 1)
    except (TypeError, ValueError):
        return None
    if not sizes:
        return None
    size = sizes[min(idx, len(sizes) - 1)]
    return size if size > 0 else None


# ---------------------------------------------------------------------------------
# Mesh -> per-layer polygons
# ---------------------------------------------------------------------------------
# split_shells() -> slice_soup() per layer -> group_loops() into outers with holes
# __SUPPORTFINS_SLICE__ (build.py inlines plugins/shared/py/supportfins_slice.py here)


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
    if not isinstance(src, dict):
        src = {}
    return {**_DEFAULTS, **src}   # unknown keys are kept: the engine refuses them by name


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


def inject_fins(print_object, cfg, layer_height, unit, log=None, nozzle=None):
    """Compute fins for one PrintObject and add them to its layers. Returns a
    short human-readable result string. If `log` is a dict it is filled with
    diagnostics (frame calibration, per-layer fin area) for the spike."""
    log = {} if log is None else log
    soup = posed_part_soup(print_object)
    if len(soup) == 0:
        return "no model-part volumes"
    zmin = soup[:, :, 2].min()
    soup = soup - np.array([0.0, 0.0, zmin])       # object bottom at z = 0, like slice_z
    fins, stats = compute_fins(soup, layer_height, cfg, nozzle)
    if len(fins) == 0:
        # Quality first: no fins can still mean overhangs left bare, so say so.
        bare = stats.get("unserved") or stats.get("floating") or stats.get("smallHoleRegions")
        return host_report(stats) if bare else "no fins needed"
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
    log["layers_touched"] = touched
    report = host_report(stats)   # the same line every plugin shows
    if touched == 0:   # placed, but no layer took them: the overhangs are still bare
        report += "; none of it reached a layer, so nothing was added (see support_fins_log.jsonl)"
    return report


class SupportFinsSlicing(orca.slicing.SlicingPipelineCapabilityBase):
    def get_name(self):
        return "Support Fins"

    def get_default_config(self):
        return dict(_DEFAULTS)

    def execute(self, ctx):
        if ctx.step != orca.slicing.Step.posSlice or ctx.object is None:
            return orca.ExecutionResult.success()
        cfg = _cfg(self)
        if not _truthy(cfg["enabled"]):
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
        nozzle = _nozzle(po, ctx)
        log = {"object_id": _safe(lambda: po.id()), "layer_height": lh, "nozzle": nozzle, "started": time.time(),
               "version": VERSION}
        try:
            msg = inject_fins(po, cfg, lh, orca.slicing.unscale(1), log, nozzle=nozzle)
        except Exception as e:  # never break a slice over fins; report and carry on
            log["error"] = f"{type(e).__name__}: {e}"
            _write_log(log)
            # a config the engine refused says so in its own words; anything else is a bug
            why = str(e) if isinstance(e, ValueError) else f"{type(e).__name__}: {e}"
            return orca.ExecutionResult.failure(orca.PluginResult.RecoverableError,
                                                f"Support Fins: {why}")
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
