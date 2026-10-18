"""Support Fins for Rhino: the part in, fin objects out. No fin geometry is computed
here: the website's engine runs in V8 (mini-racer, installed by Rhino from the
commands' `# r:` lines) through the shared Python host, supportfins_host.py.

Frames: the engine takes the part in millimetres, z up, as it sits in the model --
the bed is the world XY plane at the part's lowest point, so the part prints the way
it sits. Document units become millimetres through the model's unit system.

A Brep (or extrusion, or SubD) is meshed the way printfins.com tessellates a STEP:
0.01 mm chord, 0.1 rad. A mesh is used as it is.

Fins are mesh objects on the "Support Fins" layer, one per wall / brace / pad (the
engine's `pieces`), so any one can be selected, hidden or deleted. Each carries user
strings:
  sf_role  'fin' (SupportFins'), 'drawn' (SupportFinsDraw), 'overhangs' (the site's
           red and amber faces, on the locked "Support Fins::Overhangs" layer, so an
           overhang nothing holds is shown, not hidden)
  sf_part  the id of the part they belong to
The part carries sf_report (the last result line). The settings are saved in the
document (document strings), so they travel with the .3dm.
"""
import json
import os
import subprocess
import sys

import Rhino
import System
from Rhino.Geometry import Mesh, MeshingParameters

import supportfins_host as host
import supportfins_rhino_core as core

HERE = os.path.dirname(os.path.abspath(__file__))
SCHEMA = json.load(open(os.path.join(HERE, "options.json"), encoding="utf-8"))
SECTION, ENTRY = "SupportFins", "settings"
LAYER, OVER_LAYER = "Support Fins", "Overhangs"
# the site's STEP tessellation (web/step.js STEP_PARAMS): 0.01 mm chord, 0.1 rad
CHORD_MM, ANGLE_RAD = 0.01, 0.1
MIN_EDGE_MM = 0.0001          # Rhino's default, but in mm whatever the document's units
FIN_COLOR = (38, 115, 242)
DRAWN_COLOR = (242, 140, 26)
OVER_COLOR = (230, 10, 5)      # the site's red: overhangs the fins hold
SMALL_COLOR = (242, 166, 26)   # the site's amber: past the angle, too small to fin

_ctx = None


def _jit_allowed():
    """Whether this Rhino may run V8's JIT. macOS refuses JIT memory to a hardened app
    without the allow-jit entitlement, and V8 dies on it rather than falling back;
    jitless is ~25x slower on a big part. Rhino's .NET runtime needs that entitlement
    itself, but read it from the app's signature rather than assume."""
    if sys.platform != "darwin":
        return True
    app = os.path.abspath(os.path.join(Rhino.RhinoApp.GetExecutableDirectory().FullName, "..", ".."))
    try:
        out = subprocess.run(["codesign", "-d", "--entitlements", "-", "--xml", app],
                             capture_output=True, timeout=10).stdout
    except Exception:                 # noqa: BLE001 -- unknown: the safe, slow way
        return False
    return b"com.apple.security.cs.allow-jit" in out


def ctx():
    """The V8 context with the engine bundle (started once per Rhino session)."""
    global _ctx
    if _ctx is None:
        with open(os.path.join(HERE, "fins_engine.js"), encoding="utf-8") as fh:
            _ctx = host.host_engine(fh.read(), jit=_jit_allowed())
    return _ctx


# ---- settings --------------------------------------------------------------

def controls(doc):
    """The settings dialog's values saved in this document (the site's defaults if none)."""
    return core.load_values(SCHEMA, doc.Strings.GetValue(SECTION, ENTRY))


def save_controls(doc, values):
    doc.Strings.SetString(SECTION, ENTRY, core.dump_values(values))


def engine_options(doc, values=None):
    """The settings as engine options, checked by the engine (host_options)."""
    return host.host_options(ctx(), core.dialog_values(SCHEMA, values if values is not None else controls(doc)))


def visible(key, values):
    return host.host_visible(ctx(), key, core.dialog_values(SCHEMA, values))


# ---- the part --------------------------------------------------------------

def mm_per_unit(doc):
    units = doc.ModelUnitSystem
    # (UnitSystem.None is a Python keyword: by name)
    if units in (getattr(Rhino.UnitSystem, "None"), Rhino.UnitSystem.CustomUnits, Rhino.UnitSystem.Unset):
        raise ValueError(f"the document's units are {units}: set real units (Document Properties > Units) "
                         "so the part has a size in mm")
    return Rhino.RhinoMath.UnitScale(units, Rhino.UnitSystem.Millimeters)


def is_fin(obj):
    return bool(obj.Attributes.GetUserString("sf_role"))


def part_for(doc, obj):
    """What a selection means: a fin stands for its part."""
    if obj is None:
        return None
    if is_fin(obj):
        return doc.Objects.FindId(System.Guid(obj.Attributes.GetUserString("sf_part")))
    return obj


def part_mesh(obj, doc):
    """The part as one Rhino mesh, document units. Raises with a message for the
    user on anything that isn't a solid's surface."""
    geo = obj.Geometry
    name = obj.Name or "the part"
    if isinstance(geo, Rhino.Geometry.Mesh):
        mesh = geo.DuplicateMesh()
    elif isinstance(geo, Rhino.Geometry.SubD):
        mesh = Mesh.CreateFromSubD(geo, 4)
    else:
        brep = geo.ToBrep() if isinstance(geo, Rhino.Geometry.Extrusion) else geo
        if not isinstance(brep, Rhino.Geometry.Brep):
            raise ValueError(f"{name} is a {geo.ObjectType}: pick a solid, a surface or a mesh"
                             + (" (explode the block first)" if isinstance(geo, Rhino.Geometry.InstanceReferenceGeometry) else ""))
        k = mm_per_unit(doc)
        mp = MeshingParameters()
        mp.Tolerance = CHORD_MM / k
        mp.MinimumEdgeLength = MIN_EDGE_MM / k
        mp.RelativeTolerance = 0.0
        mp.GridAngle = ANGLE_RAD
        mp.RefineAngle = ANGLE_RAD
        mp.RefineGrid = True
        mp.SimplePlanes = False
        mp.JaggedSeams = False
        mesh = Mesh()
        # float64 like the site's STEP path: a float32 vertex 500 mm out is ~3e-5 mm of
        # noise, enough to move a tine (plugins/shared/ENGINE-SENSITIVITY.md)
        mesh.Vertices.UseDoublePrecisionVertices = True
        for m in Mesh.CreateFromBrep(brep, mp) or []:
            mesh.Append(m)
    if mesh is None or mesh.Faces.Count == 0:
        raise ValueError(f"{name} has no faces to hold up")
    mesh.Faces.ConvertQuadsToTriangles()
    return mesh


def mesh_soup(mesh, k):
    """A triangle mesh -> (M,3,3) float64 triangles, mm (k mm per document unit)."""
    import numpy as np
    pts = mesh.Vertices.ToPoint3dArray()
    P = np.array([(p.X, p.Y, p.Z) for p in pts], dtype=np.float64) * k
    tri = np.array(list(mesh.Faces.ToIntArray(True)), dtype=np.int64).reshape(-1, 3)
    soup = P[tri]
    if not np.isfinite(soup).all():
        raise ValueError("the part has a vertex that isn't a number")
    return soup


def part_soup(obj, doc):
    return mesh_soup(part_mesh(obj, doc), mm_per_unit(doc))


# ---- fin objects -----------------------------------------------------------

def _color(rgb):
    return System.Drawing.Color.FromArgb(*rgb)


def layer_index(doc, name, color, parent=None, locked=False):
    path = f"{parent.FullPath}::{name}" if parent is not None else name
    i = doc.Layers.FindByFullPath(path, -1)
    if i >= 0:
        return i
    layer = Rhino.DocObjects.Layer()
    layer.Name = name
    layer.Color = _color(color)
    layer.IsLocked = locked
    if parent is not None:
        layer.ParentLayerId = parent.Id
    return doc.Layers.Add(layer)


def fins_layer(doc):
    return layer_index(doc, LAYER, FIN_COLOR)


def overhangs_layer(doc):
    return layer_index(doc, OVER_LAYER, OVER_COLOR, parent=doc.Layers[fins_layer(doc)], locked=True)


def rhino_mesh(tris_mm, k):
    """(K,3,3) mm triangles -> a Rhino mesh in document units (double precision)."""
    verts, faces = core.weld(tris_mm)
    verts = verts / k
    mesh = Mesh()
    mesh.Vertices.UseDoublePrecisionVertices = True
    for x, y, z in verts.tolist():
        mesh.Vertices.Add(x, y, z)
    for a, b, c in faces.tolist():
        mesh.Faces.AddFace(a, b, c)
    mesh.Normals.ComputeNormals()
    mesh.Compact()
    return mesh


def add_mesh(doc, tris_mm, name, layer, color, role, part):
    attr = doc.CreateDefaultAttributes()
    attr.LayerIndex = layer
    attr.Name = name
    attr.ColorSource = Rhino.DocObjects.ObjectColorSource.ColorFromObject
    attr.ObjectColor = _color(color)
    attr.SetUserString("sf_role", role)
    attr.SetUserString("sf_part", str(part.Id))
    oid = doc.Objects.AddMesh(rhino_mesh(tris_mm, mm_per_unit(doc)), attr)
    return None if oid == System.Guid.Empty else oid


def fins_of(doc, part, roles):
    return [o for o in (doc.Objects.FindByUserString("sf_part", str(part.Id), True) or [])
            if o.Attributes.GetUserString("sf_role") in roles and not o.IsDeleted]


def remove(doc, objs):
    # ignoreModes: a plain Delete skips objects that are locked, hidden or on a locked
    # or hidden layer -- the overhangs' layer is locked, and a user may hide a fin
    for o in objs:
        doc.Objects.Delete(Rhino.DocObjects.ObjRef(o.Id), True, True)


def label(part):
    return part.Name or "Part"


def generate(doc, part):
    """Replace the part's fins with the engine's for its current pose and settings, and
    refresh the red / amber overhang faces. Drawn walls are left as they are. Returns
    the report line."""
    import numpy as np
    soup = part_soup(part, doc)
    options = engine_options(doc)
    # the engine first: if it fails, the document is still as it was
    fins, stats, pieces, over, small = host.host_compute_pieces(ctx(), soup, options)

    remove(doc, fins_of(doc, part, {"fin", "overhangs"}))
    layer = fins_layer(doc)
    dropped = []      # Rhino refused the mesh: say so, never leave a fin out quietly
    for p in pieces:
        tris = np.concatenate([fins[a:b] for a, b in p["ranges"]]) if p["ranges"] else fins[:0]
        name = core.piece_name(label(part), p)
        if len(tris) and add_mesh(doc, tris, name, layer, FIN_COLOR, "fin", part) is None:
            dropped.append(name)
    over_layer = overhangs_layer(doc)
    for faces, what, color in ((over, "overhangs", OVER_COLOR), (small, "too small to fin", SMALL_COLOR)):
        if len(faces):
            add_mesh(doc, soup[faces], f"{label(part)} {what}", over_layer, color, "overhangs", part)

    report = host.host_report(stats)
    if dropped:
        report += f"; Rhino refused {len(dropped)} fin mesh{'es' if len(dropped) > 1 else ''} " \
                  f"(not added: {', '.join(dropped)})"
    _set_report(doc, part, report)
    return report


def draw_wall(doc, part, a, b, soup=None):
    """A wall from a to b (Point3d, document units: where the clicks hit the part).
    soup: the part's part_soup, if the caller has it (meshing a curved Brep at 0.01 mm
    takes a while: once per Draw session, not per wall).
    Returns (the wall's id, the result line) or (None, the engine's reason)."""
    k = mm_per_unit(doc)
    if soup is None:
        soup = part_soup(part, doc)
    tris, info = host.host_draw_wall(ctx(), soup, [a.X * k, a.Y * k, a.Z * k],
                                     [b.X * k, b.Y * k, b.Z * k], engine_options(doc))
    if tris is None:
        return None, info
    n = len(fins_of(doc, part, {"drawn"})) + 1
    wall = add_mesh(doc, tris, f"{label(part)} drawn wall {n}", fins_layer(doc), DRAWN_COLOR, "drawn", part)
    if wall is None:
        return None, "Rhino refused the wall's mesh"
    tines = info.get("tines", 0)
    return wall, (f"drawn wall {info.get('length', 0):.1f} mm long, {info.get('height', 0):.1f} mm tall, "
                  f"{tines} tine{'' if tines == 1 else 's'}")


def _set_report(doc, part, report):
    attr = part.Attributes.Duplicate()
    attr.SetUserString("sf_report", report)
    doc.Objects.ModifyAttributes(part, attr, True)
