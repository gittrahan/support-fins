"""The boundary between Fusion and the pure-Python brace maths.

Fusion works in centimetres in whatever orientation the user modelled in; the
maths works in PRINT SPACE (millimetres, z up, the bed at z = 0). A PrintFrame,
derived from the user's bed pick, converts between the two. This module also
meshes bodies for the maths and turns its prisms back into BRep bodies.
"""

import json

import adsk.core
import adsk.fusion

from .sway_core import sway
from .sway_core.geometry import Mesh, signed_volume
from .sway_core.patches import grow_wall_patches, patch_at_point

MM_PER_CM = 10.0
ATTR_GROUP = 'SupportFins'
ATTR_SWAY = 'sway'
SUPPORTS_NAME = 'Supports'
MESH_TOLERANCE_CM = 0.005   # 0.05 mm chord error, well under the tine bite


class BridgeError(Exception):
    """A problem with the user's picks, worded for the readout."""


def body_of(entity):
    """The solid or mesh body a picked entity belongs to (or is), else None."""
    face = adsk.fusion.BRepFace.cast(entity)
    if face:
        return face.body
    return adsk.fusion.BRepBody.cast(entity) or adsk.fusion.MeshBody.cast(entity) or None


def _model_up(app):
    """Fusion's up axis, from the modelling-orientation preference."""
    try:
        orient = app.preferences.generalPreferences.defaultModelingOrientation
        if orient == adsk.core.DefaultModelingOrientations.YUpModelingOrientation:
            return adsk.core.Vector3D.create(0, 1, 0), 'Y'
    except Exception:
        pass
    return adsk.core.Vector3D.create(0, 0, 1), 'Z'


# --------------------------------------------------------------------------
# Print frame
# --------------------------------------------------------------------------

def default_bed(design, app):
    """The origin plane square to Fusion's up axis: where a part usually stands."""
    root = design.rootComponent
    _, axis = _model_up(app)
    return root.xZConstructionPlane if axis == 'Y' else root.xYConstructionPlane


def only_body(design):
    """The design's one visible part body (solid or mesh, outside Supports), or
    None. Bodies in sub-components come back as assembly-context proxies."""
    root = design.rootComponent
    found = [b for coll in (root.bRepBodies, root.meshBodies) for b in coll
             if b.isVisible and not is_brace(b)]
    for occ in root.allOccurrences:
        if occ.component.name == SUPPORTS_NAME or not occ.isVisible:
            continue
        for coll in (occ.bRepBodies, getattr(occ, 'meshBodies', None) or []):
            found += [b for b in coll if b.isVisible]
    return found[0] if len(found) == 1 else None


class PrintFrame:
    """World (cm) <-> print space (mm, z up from the bed)."""

    def __init__(self, origin, x, y, z, note=None):
        self.note = note
        self.o = (origin.x, origin.y, origin.z)
        self.x = (x.x, x.y, x.z)
        self.y = (y.x, y.y, y.z)
        self.z = (z.x, z.y, z.z)

    @classmethod
    def from_bed(cls, bed, body, app=None):
        """The bed is a planar face or a construction plane. Up is whichever side
        of it the part is on, so a face of the part's own bottom works as well as
        a plane under it. A picked BODY means "it stands as modelled": the bed is
        under its lowest point, square to Fusion's up axis."""
        face = adsk.fusion.BRepFace.cast(bed)
        plane_ent = adsk.fusion.ConstructionPlane.cast(bed)
        bed_body = None if face else body_of(bed)
        note = None
        if bed_body:
            n, axis = _model_up(app or adsk.core.Application.get())
            origin = bed_body.boundingBox.minPoint     # lowest along an axis-aligned up
            note = ('Bed: under the lowest point of “%s”, with +%s up (Fusion’s up axis). '
                    'Pick a face or plane instead to stand it another way.' % (bed_body.name, axis))
        elif face:
            if face.geometry.surfaceType != adsk.core.SurfaceTypes.PlaneSurfaceType:
                raise BridgeError('The print bed has to be flat: pick a planar face or a construction plane.')
            origin = face.pointOnFace
            ok, n = face.evaluator.getNormalAtPoint(origin)
            if not ok:
                raise BridgeError('Couldn’t read the direction of the bed face.')
        elif plane_ent:
            geo = plane_ent.geometry
            origin, n = geo.origin, geo.normal
        else:
            raise BridgeError('The print bed has to be a planar face or a construction plane.')

        n = n.copy()
        n.normalize()
        bb = body.boundingBox
        mid = adsk.core.Point3D.create((bb.minPoint.x + bb.maxPoint.x) / 2,
                                       (bb.minPoint.y + bb.maxPoint.y) / 2,
                                       (bb.minPoint.z + bb.maxPoint.z) / 2)
        if origin.vectorTo(mid).dotProduct(n) < 0:
            n.scaleBy(-1)

        axes = [adsk.core.Vector3D.create(1, 0, 0), adsk.core.Vector3D.create(0, 1, 0),
                adsk.core.Vector3D.create(0, 0, 1)]
        ref = min(axes, key=lambda a: abs(a.dotProduct(n)))
        x = n.crossProduct(ref)
        x.normalize()
        y = n.crossProduct(x)
        y.normalize()
        return cls(origin, x, y, n, note)

    def to_print_xyz(self, px, py, pz):
        dx, dy, dz = px - self.o[0], py - self.o[1], pz - self.o[2]
        return ((dx * self.x[0] + dy * self.x[1] + dz * self.x[2]) * MM_PER_CM,
                (dx * self.y[0] + dy * self.y[1] + dz * self.y[2]) * MM_PER_CM,
                (dx * self.z[0] + dy * self.z[1] + dz * self.z[2]) * MM_PER_CM)

    def to_print(self, p):
        return self.to_print_xyz(p.x, p.y, p.z)

    def to_world_xyz(self, q):
        a, b, c = (v / MM_PER_CM for v in q)
        return tuple(self.o[k] + a * self.x[k] + b * self.y[k] + c * self.z[k] for k in range(3))

    def to_world(self, q):
        return adsk.core.Point3D.create(*self.to_world_xyz(q))

    def vec_to_world(self, v):
        w = adsk.core.Vector3D.create(*(v[0] * self.x[k] + v[1] * self.y[k] + v[2] * self.z[k]
                                        for k in range(3)))
        w.normalize()
        return w


# --------------------------------------------------------------------------
# Reading the part
# --------------------------------------------------------------------------

class Part:
    """A body in print space: its mesh, its wall patches, and an exact
    containment test."""

    def __init__(self, body, frame):
        self.body = body
        self.frame = frame
        self.is_mesh = adsk.fusion.MeshBody.cast(body) is not None
        self.mesh = Mesh(_body_triangles(body, frame))
        if not self.mesh.tris:
            raise BridgeError('Couldn’t mesh the body “%s”.' % body.name)
        self.groups = grow_wall_patches(self.mesh)
        self.patches = [p for p, _ in self.groups]

    def inside(self, x, y, z):
        if self.is_mesh:
            return self.mesh.inside(x, y, z)
        try:
            res = self.body.pointContainment(self.frame.to_world((x, y, z)))
            return res == adsk.fusion.PointContainment.PointInsidePointContainment
        except Exception:
            return self.mesh.inside(x, y, z)

    def patch_at(self, point):
        return patch_at_point(self.mesh, self.groups, point, tol=1.0)


def _body_triangles(body, frame):
    """The body's triangles in print space, wound outward. A mesh body (an
    imported STL) is used as it is; a solid body is meshed finely."""
    native = body.nativeObject if body.assemblyContext else body
    if adsk.fusion.MeshBody.cast(native):
        mesh = native.displayMesh
    else:
        calc = native.meshManager.createMeshCalculator()
        calc.setQuality(adsk.fusion.TriangleMeshQualityOptions.HighQualityTriangleMesh)
        calc.surfaceTolerance = MESH_TOLERANCE_CM
        mesh = calc.calculate()
    c = mesh.nodeCoordinatesAsDouble
    idx = mesh.nodeIndices

    m = body.assemblyContext.transform2.asArray() if body.assemblyContext else None
    pts = []
    for i in range(0, len(c), 3):
        x, y, z = c[i], c[i + 1], c[i + 2]
        if m:
            x, y, z = (m[0] * x + m[1] * y + m[2] * z + m[3],
                       m[4] * x + m[5] * y + m[6] * z + m[7],
                       m[8] * x + m[9] * y + m[10] * z + m[11])
        pts.append(frame.to_print_xyz(x, y, z))
    tris = [(pts[idx[i]], pts[idx[i + 1]], pts[idx[i + 2]]) for i in range(0, len(idx), 3)]
    if signed_volume(tris) < 0:
        tris = [(a, c_, b) for a, b, c_ in tris]
    return tris


# --------------------------------------------------------------------------
# Building bodies
# --------------------------------------------------------------------------

def _box(tbm, frame, center, ea, eb, la, lb, lc):
    obb = adsk.core.OrientedBoundingBox3D.create(frame.to_world(center), frame.vec_to_world(ea),
                                                 frame.vec_to_world(eb), la / MM_PER_CM,
                                                 lb / MM_PER_CM, lc / MM_PER_CM)
    return tbm.createBox(obb)


def prism_body(tbm, pr, frame):
    """A convex prism as a temporary BRep body: a box, with the slanted edges cut."""
    box, cutters = pr.boxes()
    body = _box(tbm, frame, *box)
    for c in cutters:
        tbm.booleanOperation(body, _box(tbm, frame, *c), adsk.fusion.BooleanTypes.DifferenceBooleanType)
    return body


def brace_body(rib, frame):
    """One brace (rib + foot + tines) as a single temporary BRep body."""
    tbm = adsk.fusion.TemporaryBRepManager.get()
    body = None
    for pr in rib.prisms:
        b = prism_body(tbm, pr, frame)
        if body is None:
            body = b
        else:
            tbm.booleanOperation(body, b, adsk.fusion.BooleanTypes.UnionBooleanType)
    return body


def _rib_meta(rib, frame):
    """What a later run needs to keep new braces clear of this one, in world cm
    so it survives a different bed pick."""
    return json.dumps({
        'foot': [frame.to_world_xyz(p) for p in rib.foot],
        'levels': [{'a': frame.to_world_xyz(L['a']), 'b': frame.to_world_xyz(L['b'])} for L in rib.levels],
        'halfW': rib.half_w, 'th': rib.th, 'height': rib.height, 'tines': rib.tines,
    })


def is_brace(body):
    """Was this body made by this add-in?"""
    try:
        return body.attributes.itemByName(ATTR_GROUP, ATTR_SWAY) is not None
    except Exception:
        return False


def _identity():
    return adsk.core.Matrix3D.create()


def supports_target(design, create):
    """Where braces live: (component, its transform to world), or (None, None).

    Normally a 'Supports' component beside the part. A Part Design document
    allows only one component, so there the braces go into the root component
    as bodies of their own (the part's geometry is still never touched).
    """
    root = design.rootComponent
    for occ in root.occurrences:
        if occ.component.name == SUPPORTS_NAME:
            return occ.component, occ.transform2
    if any(is_brace(b) for b in root.bRepBodies):
        return root, _identity()
    if not create:
        return None, None
    try:
        occ = root.occurrences.addNewComponent(_identity())
    except RuntimeError:
        return root, _identity()        # a single-component Part Design document
    occ.component.name = SUPPORTS_NAME
    return occ.component, occ.transform2


def existing_brace_data(design):
    """The braces already in the design, in world cm, read ONCE when the dialog
    opens. Read later and it would include the command's own preview bodies,
    and every pick would clash with its own preview."""
    comp, xf = supports_target(design, create=False)
    if comp is None:
        return []
    m = xf.asArray()

    def world(p):
        x, y, z = p
        return (m[0] * x + m[1] * y + m[2] * z + m[3],
                m[4] * x + m[5] * y + m[6] * z + m[7],
                m[8] * x + m[9] * y + m[10] * z + m[11])

    out = []
    for body in comp.bRepBodies:
        attr = body.attributes.itemByName(ATTR_GROUP, ATTR_SWAY)
        if not attr:
            continue
        try:
            d = json.loads(attr.value)
            out.append({'foot': [world(p) for p in d['foot']],
                        'levels': [(world(L['a']), world(L['b'])) for L in d['levels']],
                        'halfW': d['halfW'], 'th': d['th'], 'height': d['height']})
        except (KeyError, ValueError, TypeError):
            continue
    return out


def braces_in_frame(data, frame):
    """existing_brace_data() as Rib stand-ins in this print frame, for the clash check."""
    out = []
    for d in data:
        foot = [frame.to_print_xyz(*p) for p in d['foot']]
        levels = []
        for a, b in d['levels']:
            pa, pb = frame.to_print_xyz(*a), frame.to_print_xyz(*b)
            levels.append({'z': pa[2], 'a': pa, 'b': pb})
        out.append(sway.Rib(True, foot=foot, levels=levels, half_w=d['halfW'],
                            th=d['th'], height=d['height']))
    return out


def add_braces(design, ribs, frame):
    """Put the braces into the 'Supports' component (or, in a Part Design
    document, the root component) as one body each, inside a base feature in a
    parametric design. Returns the new bodies."""
    if not ribs:
        return []
    tbm = adsk.fusion.TemporaryBRepManager.get()
    comp, xf = supports_target(design, create=True)

    temps = [brace_body(r, frame) for r in ribs]
    inv = xf.copy()
    inv.invert()
    for b in temps:
        tbm.transform(b, inv)

    n0 = sum(1 for b in comp.bRepBodies if is_brace(b))
    if design.designType == adsk.fusion.DesignTypes.ParametricDesignType:
        bf = comp.features.baseFeatures.add()
        bf.startEdit()
        try:
            for b in temps:
                comp.bRepBodies.add(b, bf)
        finally:
            bf.finishEdit()
        bf.name = 'Sway braces'
        added = [bf.bodies.item(i) for i in range(bf.bodies.count)]
    else:
        added = [comp.bRepBodies.add(b) for b in temps]

    for i, (body, rib) in enumerate(zip(added, ribs)):
        body.name = 'Sway brace %d' % (n0 + i + 1)
        body.attributes.add(ATTR_GROUP, ATTR_SWAY, _rib_meta(rib, frame))
    return added
