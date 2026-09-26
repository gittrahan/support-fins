"""A small stand-in for Fusion's `adsk` modules: just enough of the API that
fins_command and fusion_bridge touch, so the Fusion side runs offline.

It models a design as a root component holding mesh bodies (an imported STL),
a construction plane for the bed, and a 'Supports' component made on demand.
What only real Fusion can confirm is listed in plugins/fusion/README.md.
"""

import math
import sys
import types


# ---------------------------------------------------------------- geometry
class Vec:
    def __init__(self, x=0.0, y=0.0, z=0.0):
        self.x, self.y, self.z = float(x), float(y), float(z)

    @classmethod
    def create(cls, x=0.0, y=0.0, z=0.0):
        return cls(x, y, z)

    def copy(self):
        return Vec(self.x, self.y, self.z)

    def asArray(self):
        return [self.x, self.y, self.z]

    def normalize(self):
        n = math.sqrt(self.x ** 2 + self.y ** 2 + self.z ** 2)
        if n:
            self.x, self.y, self.z = self.x / n, self.y / n, self.z / n
        return True

    def scaleBy(self, s):
        self.x, self.y, self.z = self.x * s, self.y * s, self.z * s
        return True

    def dotProduct(self, o):
        return self.x * o.x + self.y * o.y + self.z * o.z

    def crossProduct(self, o):
        return Vec(self.y * o.z - self.z * o.y, self.z * o.x - self.x * o.z,
                   self.x * o.y - self.y * o.x)

    def vectorTo(self, o):
        return Vec(o.x - self.x, o.y - self.y, o.z - self.z)

    def translateBy(self, v):
        self.x, self.y, self.z = self.x + v.x, self.y + v.y, self.z + v.z
        return True


class Matrix3D:
    def __init__(self, m=None):
        self.m = list(m) if m else [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

    @classmethod
    def create(cls):
        return cls()

    def copy(self):
        return Matrix3D(self.m)

    def asArray(self):
        return list(self.m)

    def invert(self):
        # rigid transforms only (rotation + translation), which is all a test uses
        m = self.m
        r = [[m[0], m[1], m[2]], [m[4], m[5], m[6]], [m[8], m[9], m[10]]]
        t = [m[3], m[7], m[11]]
        rt = [[r[j][i] for j in range(3)] for i in range(3)]
        ti = [-sum(rt[i][k] * t[k] for k in range(3)) for i in range(3)]
        self.m = [rt[0][0], rt[0][1], rt[0][2], ti[0], rt[1][0], rt[1][1], rt[1][2], ti[1],
                  rt[2][0], rt[2][1], rt[2][2], ti[2], 0, 0, 0, 1]
        return True


class BBox:
    def __init__(self, lo, hi):
        self.minPoint, self.maxPoint = Vec(*lo), Vec(*hi)


# ---------------------------------------------------------------- entities
class Attributes:
    def __init__(self):
        self.d = {}

    def itemByName(self, group, name):
        v = self.d.get((group, name))
        return types.SimpleNamespace(value=v) if v is not None else None

    def add(self, group, name, value):
        self.d[(group, name)] = value


class _Castable:
    @classmethod
    def cast(cls, obj):
        return obj if isinstance(obj, cls) else None


class DisplayMesh:
    def __init__(self, coords, indices):
        self.nodeCoordinatesAsDouble = coords
        self.nodeIndices = indices


class MeshBody(_Castable):
    _n = 0

    def __init__(self, coords_cm, indices, name='Body', component=None):
        MeshBody._n += 1
        self.entityToken = 'mesh-%d' % MeshBody._n
        self.name = name
        self.coords = list(coords_cm)
        self.indices = list(indices) if indices else list(range(len(coords_cm) // 3))
        self.displayMesh = DisplayMesh(self.coords, self.indices)
        self.attributes = Attributes()
        self.isVisible = True
        self.assemblyContext = None
        self.nativeObject = self
        self.parentComponent = component
        self.isValid = True
        c = self.coords
        self.boundingBox = BBox((min(c[0::3]), min(c[1::3]), min(c[2::3])),
                                (max(c[0::3]), max(c[1::3]), max(c[2::3])))


    def createForAssemblyContext(self, occ):
        return self


class BRepBody(_Castable):
    pass


class BRepFace(_Castable):
    pass


class ConstructionPlane(_Castable):
    def __init__(self, origin, normal):
        self.geometry = types.SimpleNamespace(origin=Vec(*origin), normal=Vec(*normal))
        self.entityToken = 'plane-%s-%s' % (origin, normal)


class Collection(list):
    @property
    def count(self):
        return len(self)

    def item(self, i):
        return self[i]


class MeshBodies(Collection):
    def __init__(self, comp):
        super().__init__()
        self.comp = comp
        self.editing = None       # the base feature being edited, in a parametric design
        self.imported = []        # STL paths imported with add()

    def add(self, path, units, base_feature=None):
        """Import a binary STL, as current Fusion does it: the body is named after
        the file, and in a parametric design each import is its own 'Base Mesh
        Feature' in the timeline (a base feature passed in is left empty)."""
        import os
        import struct
        if base_feature is not None and self.editing is not base_feature:
            raise RuntimeError('a base feature passed in must be in edit')
        assert units == MeshUnits.CentimeterMeshUnit
        with open(path, 'rb') as fh:
            data = fh.read()
        n = struct.unpack_from('<I', data, 80)[0]
        assert len(data) == 84 + 50 * n, 'binary STL expected'
        coords = []
        for t in range(n):
            coords += struct.unpack_from('<9f', data, 84 + 50 * t + 12)
        name = os.path.splitext(os.path.basename(path))[0]
        b = MeshBody(coords, None, name, self.comp)
        self.append(b)
        self.imported.append(path)
        if self.comp.design.designType == DesignTypes.ParametricDesignType:
            tl = self.comp.design.timeline
            tl.append(TimelineItem('Base Mesh Feature%d' % (len(tl) + 1)))
        return Collection([b])

    def addByTriangleMeshData(self, coords, indices, normals, normal_indices):
        if self.comp.design.designType == DesignTypes.ParametricDesignType:
            # real Fusion accepts this but the body belongs to no feature and the
            # browser never lists it: the add-in must not use it in parametric designs
            raise RuntimeError('addByTriangleMeshData in a parametric design')
        assert normals == [] and normal_indices == []
        assert len(coords) % 3 == 0 and len(indices) % 3 == 0
        assert max(indices) < len(coords) // 3
        b = MeshBody(coords, indices, 'Body%d' % (len(self) + 1), self.comp)
        self.append(b)
        return b


class BaseFeature:
    def __init__(self, comp):
        self.comp = comp
        self.name = 'Base Feature'
        self.meshBodies = Collection()

    def startEdit(self):
        self.comp.meshBodies.editing = self

    def finishEdit(self):
        self.comp.meshBodies.editing = None


class Component:
    def __init__(self, design, name):
        self.design = design
        self.name = name
        self.bRepBodies = Collection()
        self.meshBodies = MeshBodies(self)
        self.occurrences = Occurrences(self)
        self.allOccurrences = self.occurrences
        self.features = types.SimpleNamespace(baseFeatures=types.SimpleNamespace(
            add=lambda: self._add_bf()))
        self.base_features = []
        self.xYConstructionPlane = ConstructionPlane((0, 0, 0), (0, 0, 1))
        self.xZConstructionPlane = ConstructionPlane((0, 0, 0), (0, 1, 0))

    def _add_bf(self):
        bf = BaseFeature(self)
        self.base_features.append(bf)
        return bf


class Occurrence:
    def __init__(self, comp, xf):
        self.component = comp
        self.transform2 = xf
        self.isVisible = True
        self.bRepBodies = comp.bRepBodies
        self.meshBodies = comp.meshBodies


class Occurrences(Collection):
    def __init__(self, parent):
        super().__init__()
        self.parent = parent

    def addNewComponent(self, xf):
        comp = Component(self.parent.design, 'Component%d' % (len(self) + 1))
        occ = Occurrence(comp, xf.copy())
        self.append(occ)
        return occ


class MeshUnits:
    CentimeterMeshUnit = 0
    MillimeterMeshUnit = 1


class TimelineItem:
    def __init__(self, name):
        self.name = name


class TimelineGroups(Collection):
    def __init__(self, timeline):
        super().__init__()
        self.timeline = timeline

    def add(self, start, end):
        assert 0 <= start < end < len(self.timeline), (start, end, len(self.timeline))
        g = types.SimpleNamespace(name='Group', start=start, end=end)
        self.append(g)
        return g


class Timeline(Collection):
    def __init__(self):
        super().__init__()
        self.timelineGroups = TimelineGroups(self)


class DesignTypes:
    DirectDesignType = 0
    ParametricDesignType = 1


class Design(_Castable):
    def __init__(self, parametric=True):
        self.designType = DesignTypes.ParametricDesignType if parametric else DesignTypes.DirectDesignType
        self.timeline = Timeline()
        self.rootComponent = Component(self, 'Root')


# ---------------------------------------------------------------- app + inputs
class Selection:
    def __init__(self, entity):
        self.entity = entity


class SelInput:
    def __init__(self, entities=()):
        self.items = list(entities)

    @property
    def selectionCount(self):
        return len(self.items)

    def selection(self, i):
        return Selection(self.items[i])


class Val:
    def __init__(self, value):
        self.value = value


class Slider:
    def __init__(self, v):
        self.valueOne = v


class Drop:
    def __init__(self, name):
        self.selectedItem = types.SimpleNamespace(name=name)


class Inputs(dict):
    def itemById(self, k):
        return self[k]


class _Handler:
    def __init__(self, *a, **k):
        pass


def install(up='Z'):
    """Register fake `adsk`, `adsk.core` and `adsk.fusion` modules; return the fake app."""
    adsk = types.ModuleType('adsk')
    core = types.ModuleType('adsk.core')
    fusion = types.ModuleType('adsk.fusion')
    core.Vector3D = core.Point3D = Vec
    core.Matrix3D = Matrix3D
    core.DefaultModelingOrientations = types.SimpleNamespace(YUpModelingOrientation='Y',
                                                             ZUpModelingOrientation='Z')
    core.SurfaceTypes = types.SimpleNamespace(PlaneSurfaceType='plane')
    core.DropDownStyles = types.SimpleNamespace(TextListDropDownStyle=0)
    core.CommandTerminationReason = types.SimpleNamespace(CompletedTerminationReason=1)
    core.ValueInput = types.SimpleNamespace(createByString=lambda s: s)
    for name in ('CommandCreatedEventHandler', 'InputChangedEventHandler',
                 'ValidateInputsEventHandler', 'CommandEventHandler', 'SelectionEventHandler',
                 'MouseEventHandler'):
        setattr(core, name, _Handler)
    fusion.Design = Design
    fusion.MeshBody = MeshBody
    fusion.BRepBody = BRepBody
    fusion.BRepFace = BRepFace
    fusion.ConstructionPlane = ConstructionPlane
    fusion.DesignTypes = DesignTypes
    fusion.MeshUnits = MeshUnits
    fusion.TemporaryBRepManager = types.SimpleNamespace(get=lambda: None)
    fusion.BooleanTypes = types.SimpleNamespace(DifferenceBooleanType=0, UnionBooleanType=1)
    fusion.PointContainment = types.SimpleNamespace(PointInsidePointContainment=0)
    fusion.TriangleMeshQualityOptions = types.SimpleNamespace(HighQualityTriangleMesh=0)
    adsk.core, adsk.fusion = core, fusion
    sys.modules.update({'adsk': adsk, 'adsk.core': core, 'adsk.fusion': fusion})

    app = types.SimpleNamespace(
        preferences=types.SimpleNamespace(generalPreferences=types.SimpleNamespace(
            defaultModelingOrientation=up)),
        activeProduct=None, userInterface=None, logged=[])
    app.log = app.logged.append
    core.Application = types.SimpleNamespace(get=lambda: app)
    return app
