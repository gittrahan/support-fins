# SPDX-License-Identifier: GPL-3.0-or-later
"""The part in, fin objects out. No fin geometry is computed here: the website's
engine runs in V8 (mini-racer, installed from the extension's wheel) through the
shared Python host, plugins/shared/py/supportfins_host.py.

Frames: the engine takes the part in millimetres, z up, as it sits in the scene --
the bed is the world XY plane at the part's lowest point, so the part prints the way
it sits. Blender units become millimetres through the scene's unit scale (Unit
Scale 0.001 = 1 unit is 1 mm, the usual 3D-printing setup).

Fins are objects parented to the part, one per wall / brace / pad (the engine's
`pieces`), so any one can be selected, hidden or deleted. Each carries sf_role 'fin'.
The part carries sf_report (the result line, after Generate) and sf_matrix /
sf_settings / sf_mesh (the pose, settings + unit scale, and a mesh fingerprint its
fins were built for -- set by Generate -- to tell the user when the fins are out of
date).
"""
import json
import pathlib

import bpy
import numpy as np
from mathutils import Vector

from . import schema, supportfins_host as host

HERE = pathlib.Path(__file__).resolve().parent
SCHEMA = json.loads((HERE / "options.json").read_text(encoding="utf-8"))
SPECS = schema.specs(SCHEMA)
FIN_COLOR = (0.15, 0.45, 0.95, 1.0)
KIND_NAMES = {"prop": "wall", "sway": "sway brace", "pad": "bed pad", "wedge": "wedge"}

_ctx = None


def ctx():
    """The V8 context with the engine bundle (started once, ~0.1 s). With V8's JIT:
    Blender's macOS app is signed to allow it (com.apple.security.cs.allow-jit), and
    jitless is ~25x slower on a big part. A Blender build without that entitlement
    would crash on JIT memory rather than fall back: check it on new major versions
    (codesign -d --entitlements - Blender.app)."""
    global _ctx
    if _ctx is None:
        _ctx = host.host_engine((HERE / "fins_engine.js").read_text(encoding="utf-8"), jit=True)
    return _ctx


# ---- the part --------------------------------------------------------------

def mm_per_unit(scene):
    # Unit Scale is a float32: 0.001 reads back as 0.0010000000475. Keep its 7 real
    # digits, so a 1:1 mm scene is exactly 1 and adds no float noise of its own
    # (tine placement moves under 1e-13 mm, plugins/shared/ENGINE-SENSITIVITY.md).
    return float(f"{scene.unit_settings.scale_length * 1000.0:.7g}")


def is_part(obj):
    return obj is not None and obj.type == "MESH" and not obj.get("sf_role")


def part_for(obj):
    """What a selection means: a fin stands for its part."""
    if obj is not None and obj.get("sf_role") and is_part(obj.parent):
        return obj.parent
    return obj if is_part(obj) else None


def part_soup(obj, context):
    """The part as the engine takes it: (M,3,3) float64 triangles, world, mm, with
    modifiers applied. Mirrored transforms keep their winding outward."""
    ev = obj.evaluated_get(context.evaluated_depsgraph_get())
    me = ev.to_mesh()
    try:
        me.calc_loop_triangles()
        co = np.empty(len(me.vertices) * 3, dtype=np.float32)
        me.vertices.foreach_get("co", co)
        tri = np.empty(len(me.loop_triangles) * 3, dtype=np.int32)
        me.loop_triangles.foreach_get("vertices", tri)
        m = np.array(ev.matrix_world, dtype=np.float64)
    finally:
        ev.to_mesh_clear()
    if not len(tri):
        raise ValueError(f"{obj.name} has no faces")
    world = co.reshape(-1, 3).astype(np.float64) @ m[:3, :3].T + m[:3, 3]
    soup = world[tri.reshape(-1, 3)] * mm_per_unit(context.scene)
    if np.linalg.det(m[:3, :3]) < 0:
        soup = soup[:, [0, 2, 1]]
    if not np.isfinite(soup).all():
        raise ValueError(f"{obj.name} has a vertex that isn't a number")
    return soup


def size_mm(obj, context):
    """The part's world size in mm (x, y, z), from its bounding box."""
    m = obj.matrix_world
    pts = np.array([tuple(m @ Vector(c)) for c in obj.bound_box])
    return (pts.max(axis=0) - pts.min(axis=0)) * mm_per_unit(context.scene)


# ---- settings --------------------------------------------------------------

def dialog_values(scene):
    s = scene.support_fins
    return schema.dialog_values(SCHEMA, lambda name: getattr(s, name))


def engine_options(scene):
    """The panel's values, checked by the engine (supportfins_host.host_options)."""
    return host.host_options(ctx(), dialog_values(scene))


def settings_key(scene):
    # the unit scale too: the same part at another scale is another size in mm
    return json.dumps({**dialog_values(scene), "mmPerUnit": mm_per_unit(scene)}, sort_keys=True)


def matrix_key(obj):
    return json.dumps([round(x, 9) for row in obj.matrix_world for x in row])


def mesh_key(obj, context):
    """A cheap fingerprint of the part's evaluated mesh (count + coordinate sums), to
    notice an edit made before the file was saved and reopened."""
    ev = obj.evaluated_get(context.evaluated_depsgraph_get())
    me = ev.to_mesh()
    try:
        co = np.empty(len(me.vertices) * 3, dtype=np.float32)
        me.vertices.foreach_get("co", co)
    finally:
        ev.to_mesh_clear()
    sums = co.reshape(-1, 3).astype(np.float64).sum(axis=0) if len(co) else np.zeros(3)
    return json.dumps([len(co) // 3] + [round(float(v), 4) for v in sums])


def stamp(part, context):
    """Record what the part's fins are built for: its pose, settings and mesh."""
    part["sf_matrix"] = matrix_key(part)
    part["sf_settings"] = settings_key(context.scene)
    part["sf_mesh"] = mesh_key(part, context)


def out_of_date(part, scene):
    """Why the fins no longer match the part's pose or the settings,
    or None. Edits to the mesh itself are caught by ui.py's handlers."""
    if "sf_matrix" not in part:
        return None
    if part.get("sf_matrix") != matrix_key(part):
        return "the part moved"
    if part.get("sf_settings") != settings_key(scene):
        return "the settings changed"
    return None


# ---- fin objects -----------------------------------------------------------

def children(part, roles):
    return [o for o in part.children if o.get("sf_role") in roles]


def remove(obj):
    data = obj.data
    bpy.data.objects.remove(obj, do_unlink=True)
    if data is not None and data.users == 0:
        bpy.data.meshes.remove(data)


def _material(name, color):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.diffuse_color = color
    return mat


def _mesh(name, tris_mm, scene, role, color):
    """(K,3,3) world-mm triangles -> a mesh in world Blender units. Vertices are
    welded only where they are identical: no tolerance that could close a print gap."""
    verts, inverse = np.unique(np.ascontiguousarray(tris_mm.reshape(-1, 3)), axis=0, return_inverse=True)
    faces = inverse.reshape(-1, 3)
    faces = faces[(faces[:, 0] != faces[:, 1]) & (faces[:, 1] != faces[:, 2]) & (faces[:, 0] != faces[:, 2])]
    me = bpy.data.meshes.new(name)
    me.from_pydata((verts / mm_per_unit(scene)).tolist(), [], faces.tolist())
    me.update()
    me.materials.append(_material("Support Fins " + role, color))
    return me


def mesh_object(name, tris_mm, part, scene, role, color):
    """(K,3,3) world-mm triangles -> an object parented to `part`, left where it is."""
    obj = bpy.data.objects.new(name, _mesh(name, tris_mm, scene, role, color))
    for c in part.users_collection:
        c.objects.link(obj)
    obj.parent = part
    obj.matrix_parent_inverse = part.matrix_world.inverted()
    obj["sf_role"] = role
    obj.color = color
    return obj


def generate(part, context):
    """Replace the part's fins with the engine's for its current pose and settings.
    Returns the report line."""
    scene = context.scene
    soup = part_soup(part, context)
    options = engine_options(scene)
    # The engine call first: if it fails, the scene is still as it was.
    fins, stats, pieces, _over, _small = host.host_compute_pieces(ctx(), soup, options)

    for o in children(part, {"fin"}):
        remove(o)
    for p in pieces:
        tris = np.concatenate([fins[a:b] for a, b in p["ranges"]])
        if len(tris):
            label = KIND_NAMES.get(p["kind"], p["kind"])
            mesh_object(f"{part.name} {label} {p['id']}" if p["kind"] != "pad" else f"{part.name} {label}",
                        tris, part, scene, "fin", FIN_COLOR)

    report = host.host_report(stats)
    part["sf_report"] = report
    stamp(part, context)
    return report

