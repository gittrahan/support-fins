"""A stand-in for OrcaSlicer's embedded `orca` module, for offline tests.

Mirrors only what the Support Fins plugin touches, with the same shapes and
units as the real bindings (src/slic3r/plugin/host/*.cpp in OrcaSlicer 2.5-dev):
scaled int64 slice coords, 4x4 float64 matrices, float32 mesh vertices, and the
PluginResult enum for failures. Geometry ops (union_ex) are done with shapely,
standing in for Clipper.

The FakePrintObject slices its part with trimesh (an independent slicer) in a
PrusaSlicer-style frame: centred on the XY footprint, scaled 1e6 per mm, object
bottom at z = 0 -- so the plugin's frame calibration is actually exercised.
"""
import enum
import sys
import types

import numpy as np
import shapely
from shapely.geometry import Polygon as SPoly, MultiPolygon
from shapely.ops import unary_union

SCALE = 1e6  # scaled units per mm, as in libslic3r (SCALING_FACTOR = 1e-6)


class PluginResult(enum.Enum):
    Success = 0
    Skipped = 1
    RecoverableError = 2
    FatalError = 3


class ExecutionResult:
    def __init__(self, status, message=""):
        self.status, self.message = status, message

    @staticmethod
    def success(message="", data=""):
        return ExecutionResult(PluginResult.Success, message)

    @staticmethod
    def skipped(message=""):
        return ExecutionResult(PluginResult.Skipped, message)

    @staticmethod
    def failure(status, message, data=""):
        if not isinstance(status, PluginResult):  # the real binding raises TypeError too
            raise TypeError(f"failure(): status must be PluginResult, got {type(status).__name__}")
        return ExecutionResult(status, message)

    def __repr__(self):
        return f"{self.status.name}: {self.message}"


class SurfaceType(enum.Enum):
    stTop = 0
    stBottom = 1
    stInternal = 4
    stInternalSolid = 5


class FakePolygon:
    def __init__(self, arr):
        self._a = np.asarray(arr, dtype=np.int64)

    def as_array(self):
        return self._a


def _ring(x):
    if isinstance(x, FakePolygon):
        return x.as_array()
    a = np.asarray(x)
    if a.dtype != np.int64 or a.ndim != 2 or a.shape[1] != 2 or len(a) < 3:
        raise ValueError("polygon coordinates must be an (N,2) int64 ndarray (scaled coords)")
    return a


class ExPolygon:
    def __init__(self, contour, holes=None):
        self._p = SPoly(_ring(contour), [_ring(h) for h in (holes or [])])
        if not self._p.is_valid:
            self._p = shapely.make_valid(self._p)
            if not isinstance(self._p, SPoly):  # keep the biggest piece, like a bad ring would
                # (make_valid can also hand back polygons + stray lines, a GeometryCollection)
                polys = [g for g in getattr(self._p, "geoms", []) if isinstance(g, SPoly)]
                self._p = max(polys, key=lambda g: g.area) if polys else SPoly()

    @classmethod
    def _from(cls, sp):
        e = cls.__new__(cls)
        e._p = sp
        return e

    @property
    def contour(self):
        return FakePolygon(np.asarray(self._p.exterior.coords[:-1], dtype=np.int64))

    @property
    def holes(self):
        return [FakePolygon(np.asarray(r.coords[:-1], dtype=np.int64)) for r in self._p.interiors]

    def area(self):
        return self._p.area

    def offset(self, delta):
        g = self._p.buffer(delta, join_style=2, mitre_limit=3.0)
        geoms = g.geoms if hasattr(g, "geoms") else [g]
        return [ExPolygon._from(x) for x in geoms if isinstance(x, SPoly) and x.area > 0]

    def union_ex(self, other):
        u = self._p.union(other._p)
        geoms = u.geoms if hasattr(u, "geoms") else [u]
        return [ExPolygon._from(g) for g in geoms if isinstance(g, SPoly) and g.area > 0]


class Surface:
    def __init__(self, surface_type, expolygon):
        self.surface_type, self.expolygon = surface_type, expolygon


class SurfaceCollection:
    def __init__(self):
        self.surfaces = []

    def set(self, expolygons, surface_type):
        self.surfaces = [Surface(surface_type, e) for e in expolygons]

    def append(self, expolygons, surface_type):
        self.surfaces += [Surface(surface_type, e) for e in expolygons]


class LayerRegion:
    def __init__(self):
        self.slices = SurfaceCollection()


class Layer:
    def __init__(self, slice_z, print_z, height):
        self.slice_z, self.print_z, self.height = slice_z, print_z, height
        self._regions = [LayerRegion()]
        self.lslices_geom = None

    def regions(self):
        return self._regions

    def make_slices(self):
        polys = [s.expolygon._p for r in self._regions for s in r.slices.surfaces]
        self.lslices_geom = unary_union(polys) if polys else SPoly()

    def islands(self):
        if self.lslices_geom is None:
            self.make_slices()
        return self.lslices_geom


class _Mesh:
    def __init__(self, V, T):
        self._V, self._T = V.astype(np.float32), T.astype(np.int32)

    def vertices(self):
        return self._V

    def triangles(self):
        return self._T


class FakeVolume:
    def __init__(self, V, T, matrix=None, part=True):
        self._mesh, self._m, self._part = _Mesh(V, T), (np.eye(4) if matrix is None else matrix), part

    def mesh(self):
        return self._mesh

    def matrix(self):
        return np.array(self._m, dtype=np.float64)

    def is_model_part(self):
        return self._part


class FakeModelObject:
    def __init__(self, volumes, oid=1):
        self._v, self._id = volumes, oid

    def volumes(self):
        return self._v

    def id(self):
        return self._id


class FakePrintObject:
    """Slices `trimesh_part` (already in OBJECT coords) through `trafo` like Orca."""

    def __init__(self, trimesh_part, trafo, layer_height=0.2, config=None):
        import trimesh
        self._trafo = np.array(trafo, dtype=np.float64)
        self._mo = FakeModelObject([FakeVolume(np.asarray(trimesh_part.vertices),
                                               np.asarray(trimesh_part.faces))])
        self._cfg = {"enable_support": "0", "layer_height": str(layer_height)}
        self._cfg.update(config or {})
        posed = trimesh_part.copy()
        posed.apply_transform(self._trafo)
        lo, hi = posed.bounds
        self.center_mm = np.array([(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2])
        self.zmin = lo[2]
        self.size_mm = hi - lo
        # PrusaSlicer-style frame: footprint centred at the origin, scaled ints.
        posed.apply_translation([-self.center_mm[0], -self.center_mm[1], -self.zmin])
        self.posed = posed
        self._layers = []
        z, h = 0.0, float(layer_height)
        while z + h <= posed.bounds[1][2] + 1e-9:
            L = Layer(slice_z=z + h / 2, print_z=z + h, height=h)
            sec = posed.section(plane_origin=[0, 0, z + h / 2], plane_normal=[0, 0, 1])
            if sec is not None:
                planar, to3d = sec.to_2D()
                for poly in planar.polygons_full:
                    # to_2D may shift/rotate; map back through to3d's XY part
                    ext = self._to_xy(np.asarray(poly.exterior.coords), to3d)
                    holes = [self._to_xy(np.asarray(r.coords), to3d) for r in poly.interiors]
                    L.regions()[0].slices.surfaces.append(Surface(
                        SurfaceType.stInternal,
                        ExPolygon(self._sc(ext), [self._sc(hh) for hh in holes])))
            L.make_slices()
            self._layers.append(L)
            z += h

    @staticmethod
    def _to_xy(pts2d, to3d):
        P = np.c_[pts2d[:, :2], np.zeros(len(pts2d)), np.ones(len(pts2d))] @ to3d.T
        return P[:-1, :2]

    @staticmethod
    def _sc(xy):
        return np.rint(xy * SCALE).astype(np.int64)

    def model_object(self):
        return self._mo

    def trafo(self):
        return self._trafo.copy()

    def bounding_box(self):
        w, h = self.size_mm[0] * SCALE, self.size_mm[1] * SCALE
        return (int(-w / 2), int(-h / 2), int(w / 2), int(h / 2))

    def layers(self):
        return self._layers

    def config_value(self, key):
        return self._cfg.get(key)


class _CapBase:
    _config = "{}"

    def get_config(self):
        return self._config


class Step(enum.Enum):
    posSlice = 0
    posPerimeters = 1


class Ctx:
    def __init__(self, obj, step=Step.posSlice):
        self.object, self.step = obj, step

    def config_value(self, key):
        return self.object.config_value(key) if self.object else None

    def cancelled(self):
        return False


def install():
    """Register this fake as `orca` in sys.modules and return it."""
    m = types.ModuleType("orca")
    m.PluginResult = PluginResult
    m.ExecutionResult = ExecutionResult
    m.host = types.SimpleNamespace(ExPolygon=ExPolygon, SurfaceType=SurfaceType)
    m.slicing = types.SimpleNamespace(SlicingPipelineCapabilityBase=_CapBase, Step=Step,
                                      unscale=lambda v: v / SCALE)
    m.script = types.SimpleNamespace(ScriptPluginCapabilityBase=_CapBase)
    m.base = object
    m.plugin = lambda cls: cls
    m.registered = []
    m.register_capability = m.registered.append
    sys.modules["orca"] = m
    return m
