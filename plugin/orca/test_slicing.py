#!/usr/bin/env python3
"""
Run the slice-time capability of dist/support_fins.py against a fake Orca slice.

    <python3.12 w/ numpy mini-racer shapely trimesh networkx> plugin/orca/test_slicing.py a.stl ...

For each STL it poses the part the way a user might in Orca (rotated, moved off
centre, lifted onto the bed), builds a stand-in PrintObject that follows Orca's
frame rules (PrintApply.cpp: trafo = instance matrix with XY translation zeroed;
PrintObject.cpp: slices centred on raw_bounding_box's XY centre), and fills each
layer with the part's outline cut by TRIMESH's slicer -- independent of the
plugin's own cutter. After the hook runs, every layer must match trimesh's cut of
part + fins together (what Orca would slice from the exported .3mf), to within
AREA_TOL of the layer's area.
"""
import importlib.util
import json
import math
import os
import sys
import types

import numpy as np
import trimesh
from shapely.ops import unary_union

HERE = os.path.dirname(os.path.abspath(__file__))
SCALE = 1e-6          # Orca's SCALING_FACTOR: mm per scaled unit
AREA_TOL = 0.01       # symmetric-difference area / layer area


# ---- stand-in orca.host / orca.slicing -----------------------------------------
class Ring:
    def __init__(s, a): s.a = np.asarray(a, dtype=np.int64)
    def as_array(s): return s.a


class ExPolygon:
    def __init__(s, contour, holes=None):
        s.contour = Ring(contour)
        s.holes = [Ring(h) for h in (holes or [])]


class Surface:
    def __init__(s, t, e): s.surface_type, s.expolygon = t, e


class SurfaceCollection:
    def __init__(s, surfaces): s.surfaces = surfaces
    def set(s, expolys, t): s.surfaces = [Surface(t, e) for e in expolys]


class Region:
    def __init__(s, surfaces): s.slices = SurfaceCollection(surfaces)


class Layer:
    def __init__(s, z, surfaces): s.slice_z, s.r, s.made = z, [Region(surfaces)], 0
    def regions(s): return s.r
    def make_slices(s): s.made += 1


def shapely_to_ex(geom):
    out = []
    for p in getattr(geom, "geoms", [geom]):
        if p.is_empty:
            continue
        out.append(ExPolygon(np.rint(np.asarray(p.exterior.coords)[:-1] / SCALE),
                             [np.rint(np.asarray(r.coords)[:-1] / SCALE) for r in p.interiors]))
    return out


def ex_to_shapely(surfaces):
    from shapely.geometry import Polygon
    return unary_union([Polygon(s.expolygon.contour.a * SCALE,
                                [h.a * SCALE for h in s.expolygon.holes]) for s in surfaces])


def cut(mesh, z):
    """Trimesh's own cross-section -> shapely (mm)."""
    sec = mesh.section(plane_origin=[0, 0, z], plane_normal=[0, 0, 1])
    if sec is None:
        return None
    planar, to3d = sec.to_2D(to_2D=np.eye(4))
    return unary_union(planar.polygons_full) if planar.polygons_full else None


def fake_orca():
    m = types.ModuleType("orca")
    ok = lambda message="", data="": types.SimpleNamespace(kind="success", message=message)
    skip = lambda message="": types.SimpleNamespace(kind="skipped", message=message)
    m.ExecutionResult = types.SimpleNamespace(success=ok, skipped=skip)
    base = type("Base", (), {})
    m.script = types.SimpleNamespace(ScriptPluginCapabilityBase=base)
    m.slicing = types.SimpleNamespace(
        SlicingPipelineCapabilityBase=base,
        Step=types.SimpleNamespace(posSlice="posSlice", posPerimeters="posPerimeters"),
        unscale=lambda v: v * SCALE)
    m.host = types.SimpleNamespace(ExPolygon=ExPolygon,
                                   SurfaceType=types.SimpleNamespace(stInternal="stInternal"))
    m.base, m.plugin, m.register_capability = base, (lambda c: c), (lambda c: None)
    return m


def pose(mesh, rx, rz, xy):
    """Instance matrix: rotate, then translate so it sits on the bed at `xy`."""
    R = trimesh.transformations.euler_matrix(math.radians(rx), 0, math.radians(rz))
    zmin = trimesh.transform_points(mesh.vertices, R)[:, 2].min()
    return trimesh.transformations.translation_matrix([xy[0], xy[1], -zmin]) @ R


def fake_print_object(mesh, inst, name, layer_h):
    trafo = inst.copy()
    trafo[0, 3] = trafo[1, 3] = 0.0                          # PrintApply.cpp:153
    no_off = inst.copy()
    no_off[:3, 3] = 0.0
    raw = trimesh.transform_points(mesh.vertices, no_off)
    center = (raw[:, :2].min(0) + raw[:, :2].max(0)) / 2     # raw_bounding_box centre
    centered = mesh.copy()
    centered.apply_transform(trafo)
    centered.apply_translation([-center[0], -center[1], 0])  # trafo_centered()

    top = centered.bounds[1][2]
    zs = np.arange(layer_h / 2, top, layer_h)
    layers = []
    for z in zs:
        g = cut(centered, z)
        layers.append(Layer(float(z), [Surface("stInternal", e)
                                       for e in (shapely_to_ex(g) if g is not None else [])]))

    vol = types.SimpleNamespace(
        mesh=lambda: types.SimpleNamespace(vertices=lambda: mesh.vertices.astype(np.float32),
                                           triangles=lambda: mesh.faces.astype(np.int32)),
        matrix=lambda: np.eye(4), is_model_part=lambda: True)
    mo = types.SimpleNamespace(name=name, volumes=lambda: [vol],
                               instance=lambda i: types.SimpleNamespace(matrix=lambda: inst))
    po = types.SimpleNamespace(layers=lambda: layers, trafo=lambda: trafo, model_object=lambda: mo)
    return po, centered


def main(paths):
    sys.modules["orca"] = fake_orca()
    spec = importlib.util.spec_from_file_location("sf", os.path.join(HERE, "dist", "support_fins.py"))
    plugin = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(plugin)
    cap = plugin.SupportFinsAtSlice()
    layer_h = 0.2
    failures = 0

    for path in paths:
        mesh = trimesh.load(path, force="mesh")
        for rx, rz, xy, mirror in [(0, 0, (0, 0), False), (35, 20, (80, -45), False),
                                   (0, 0, (-30, 60), True)]:
            m = mesh
            inst = pose(m, rx, rz, xy)
            if mirror:                                       # mirrored in the INSTANCE, as Orca does
                inst = inst @ np.diag([-1.0, 1, 1, 1])
            name = f"{os.path.basename(path)} rx{rx} rz{rz}{' mirrored' if mirror else ''}"
            po, centered = fake_print_object(m, inst, name, layer_h)
            before = [ex_to_shapely(l.regions()[0].slices.surfaces) for l in po.layers()]

            ctx = types.SimpleNamespace(step="posSlice", object=po, cancelled=lambda: False,
                                        config_value=lambda k: layer_h)
            r = cap.execute(ctx)

            fins = plugin._FIN_CACHE and list(plugin._FIN_CACHE.values())[-1]
            worst, changed = 0.0, 0
            if r.kind == "success" and "added" in r.message:
                fin_mesh = trimesh.Trimesh(fins.V, fins.F, process=True)
                # The fins are several overlapping closed solids (walls, tines, pad).
                # A slicer cuts each solid and unions them; cutting the whole soup at
                # once would even-odd the overlaps into holes. So cut body by body.
                bodies = fin_mesh.split(only_watertight=False)
                for layer, b in zip(po.layers(), before):
                    after = ex_to_shapely(layer.regions()[0].slices.surfaces)
                    fg = unary_union([g for g in (cut(bd, layer.slice_z) for bd in bodies)
                                      if g is not None])
                    want = unary_union([g for g in (b, fg) if g is not None and not g.is_empty])
                    if want.is_empty:
                        continue
                    changed += not after.equals(b)
                    worst = max(worst, after.symmetric_difference(want).area / max(want.area, 1e-9))
            ok = r.kind == "success" and worst <= AREA_TOL
            failures += not ok
            print(f"{'PASS' if ok else 'FAIL'}  {name}: {r.message}  "
                  f"[{changed} layers changed, worst layer mismatch {100 * worst:.2f}%]")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
