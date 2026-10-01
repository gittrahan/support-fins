# SPDX-License-Identifier: GPL-3.0-or-later
"""Install the built extension into a headless Blender and use it like a person would.

  blender --background --factory-startup --python-exit-code 1 \
      --python plugins/blender/tests/blender_smoke.py -- --package build/support_fins-<platform>.zip

Run with BLENDER_USER_* pointing at a scratch folder (run_blender.py does) so it
never touches your own Blender. From RemusTL's smoke test (PR #145).
"""
import argparse
import math
import pathlib
import sys
import tempfile
import types
import zipfile

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

args = argparse.ArgumentParser()
args.add_argument("--package", required=True)
args = args.parse_args(sys.argv[sys.argv.index("--") + 1:])
TMP = pathlib.Path(tempfile.mkdtemp(prefix="support-fins-smoke-"))
LBRACKET = pathlib.Path(__file__).resolve().parents[3] / "prototype" / "stress" / "models" / "lbracket.stl"

# ---- install the zip, as Install from Disk does --------------------------------
repo_dir = TMP / "extensions"
repo_dir.mkdir()
bpy.ops.preferences.extension_repo_add(name="Support Fins test", type="LOCAL",
                                       use_custom_directory=True, custom_directory=str(repo_dir))
repo = bpy.context.preferences.extensions.repos[-1]
bpy.ops.extensions.package_install_files(filepath=str(pathlib.Path(args.package).resolve()),
                                         repo=repo.module, enable_on_install=True, overwrite=True)
addon = sys.modules[f"bl_ext.{repo.module}.support_fins"]
engine, ui, ops = addon.engine, addon.ui, addon.operators
assert hasattr(bpy.types.Scene, "support_fins"), "extension not enabled"
print("INSTALLED", flush=True)

c = bpy.context
scene = c.scene
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()
bpy.ops.support_fins.millimetres()
assert engine.mm_per_unit(scene) == 1.0


def fins_of(part, roles=("fin",)):
    return engine.children(part, set(roles))


def closed(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    ok = not any(e.is_boundary for e in bm.edges)
    bm.free()
    return ok


def generate():
    assert bpy.ops.support_fins.generate() == {"FINISHED"}
    c.view_layer.update()


def select(obj):
    for o in c.selected_objects:
        o.select_set(False)
    obj.select_set(True)
    c.view_layer.objects.active = obj


# ---- lbracket tilted 35 deg: the plugins' reference part ------------------------
bpy.ops.wm.stl_import(filepath=str(LBRACKET))
part = c.active_object
part.rotation_euler.x = math.radians(35)
c.view_layer.update()
generate()
report = part["sf_report"]
walls = [o for o in fins_of(part) if " wall " in o.name]
pads = [o for o in fins_of(part) if o.name.endswith("bed pad")]
assert report.startswith("4 walls, "), report
tines = int(report.split(", ")[1].split()[0])
assert abs(tines - 20) <= 3, report        # 20 on the site; tines move with float noise
assert len(walls) == 4 and len(pads) == 1, [o.name for o in fins_of(part)]
assert all(closed(o) for o in fins_of(part)), "a fin object isn't closed"
low = engine.part_soup(part, c)[..., 2].min()
for o in fins_of(part):
    assert o.parent == part
    z = min((o.matrix_world @ v.co).z for v in o.data.vertices)
    assert z >= low - 1e-3, f"{o.name} goes below the bed ({z} < {low})"
assert engine.out_of_date(part, scene) is None and ui.out_of_date(part, scene) is None, ui.out_of_date(part, scene)
print("LBRACKET", report, flush=True)

# out of date: moved, settings, edited -- and Generate makes it current again
part.location.x += 5
c.view_layer.update()
assert ui.out_of_date(part, scene) == "the part moved"
generate()
assert ui.out_of_date(part, scene) is None
scene.support_fins.material = "petg"
assert ui.out_of_date(part, scene) == "the settings changed"
generate()
assert part["sf_report"].startswith("4 walls, ")
scene.support_fins.material = "pla"
generate()
bm = bmesh.new()
bm.from_mesh(part.data)
bm.verts.ensure_lookup_table()
bm.verts[0].co.z += 0.5
bm.to_mesh(part.data)
bm.free()
part.data.update()
c.view_layer.update()
assert ui.out_of_date(part, scene) == "the part was edited", ui.out_of_date(part, scene)
generate()
assert ui.out_of_date(part, scene) is None
# an edit saved before the file was reopened: the mesh fingerprint catches it
ui._file_loaded()
assert ui.out_of_date(part, scene) is None, "a fresh load called unedited fins out of date"
bm = bmesh.new()
bm.from_mesh(part.data)
bm.verts.ensure_lookup_table()
bm.verts[0].co.z -= 0.5
bm.to_mesh(part.data)
bm.free()
part.data.update()
ui.EDITED.clear()                      # as after a reload: the session's note is gone
ui._file_loaded()
assert ui.out_of_date(part, scene) == "the part was edited"
generate()
# the unit scale is part of what the fins were built for
scene.unit_settings.scale_length = 0.01
assert ui.out_of_date(part, scene) == "the settings changed"
bpy.ops.support_fins.millimetres()
assert ui.out_of_date(part, scene) is None
print("OUT_OF_DATE", flush=True)

# settings come from options.json, and hide when the engine would ignore them
assert ui.visible(scene, "tineDensity") is True
scene.support_fins.tines = False
assert ui.visible(scene, "tineDensity") is False
generate()
assert ", 0 tines" in part["sf_report"], part["sf_report"]
scene.support_fins.tines = True
assert engine.dialog_values(scene)["coverage"] == 0.5          # 50 % in the panel
scene.support_fins.padStyle = "off"
generate()
assert not [o for o in fins_of(part) if o.name.endswith("bed pad")]
scene.support_fins.padStyle = "auto"

# the panel draws, in every state it has
class Layout:
    def __getattr__(self, name):
        return lambda *a, **k: self
    def operator(self, *a, **k):
        return types.SimpleNamespace()
for state in ("fins", "out of date", "no part"):
    if state == "out of date":
        part.location.x += 1
    if state == "no part":
        c.view_layer.objects.active = None
    ui.SUPPORTFINS_PT_main.draw(types.SimpleNamespace(layout=Layout()), c)
select(part)
print("PANEL", flush=True)

# ---- export: the part + its fins, one 3MF ------------------------------------
generate()
out = TMP / "lbracket.3mf"
assert bpy.ops.support_fins.export_3mf(filepath=str(out)) == {"FINISHED"}
with zipfile.ZipFile(out) as z:
    model = z.read("3D/3dmodel.model").decode()
assert model.count("<object ") == 1 + len(fins_of(part)) + 1, "part + fins + the assembly"
print("EXPORT_3MF", flush=True)

# ---- Draw mode on tests/draw.test.js's tilted block ---------------------------
me = bpy.data.meshes.new("block")
bm = bmesh.new()
bmesh.ops.create_cube(bm, size=1.0)
bmesh.ops.scale(bm, vec=Vector((40, 60, 12)), verts=bm.verts)
bm.to_mesh(me)
bm.free()
block = bpy.data.objects.new("block", me)
scene.collection.objects.link(block)
block.matrix_world = Matrix.Rotation(math.radians(45), 4, "X")
c.view_layer.update()
block.location.z -= engine.part_soup(block, c)[..., 2].min()
c.view_layer.update()
select(block)
wall, reason = engine.draw_wall(block, (-8, -5, 11.97), (8, -5, 11.97), c)
assert wall is not None, reason
assert wall.parent == block and wall["sf_role"] == "drawn" and closed(wall)
none, reason = engine.draw_wall(block, (-8, -5, 11.97), (-6, -5, 11.97), c)
assert none is None and "too short" in reason, reason
# a drawn wall alone (no Generate yet) is for this pose: moving the part says so
assert ui.out_of_date(block, scene) is None
block.location.x += 3
c.view_layer.update()
assert ui.out_of_date(block, scene) == "the part moved", ui.out_of_date(block, scene)
block.location.x -= 3
c.view_layer.update()
generate()                                   # Generate re-stands the drawn wall too
assert len(fins_of(block, ["drawn"])) == 1 and wall.visible_get()
assert "drawn walls not built" not in block["sf_report"]
print("DRAW_WALL", block["sf_report"], flush=True)

# ---- Lay face flat: the clicked face ends on the bed, same lowest point ----------
low = engine.part_soup(block, c)[..., 2].min()
normal = block.matrix_world.to_3x3() @ Vector((0, 1, 0))      # the 40x12 end face
ops.lay_face_flat(block, normal, c)
soup = engine.part_soup(block, c)
assert abs(soup[..., 2].min() - low) < 1e-4
n = np.cross(soup[:, 1] - soup[:, 0], soup[:, 2] - soup[:, 0])
n /= np.linalg.norm(n, axis=1)[:, None]
down = n[:, 2] < -0.99999          # (float32 vertices: the turn lands to ~1e-7 rad)
assert down.sum() == 2, "the end face is two triangles"
assert np.abs(soup[down][..., 2] - low).max() < 1e-3, "the clicked face isn't on the bed"
assert not fins_of(block), "the old pose's fins are still there"
assert ui.out_of_date(block, scene) == "the part moved"
generate()                                   # the drawn wall is re-stood or says why not
w = fins_of(block, ["drawn"])[0]
assert w.visible_get() or "drawn walls not built" in block["sf_report"], block["sf_report"]
if not w.visible_get():                      # not built: no old-pose wall left to export
    assert len(w.data.polygons) == 0
print("LAY_FLAT", block["sf_report"], flush=True)

# ---- units: a part read in metres is called out ------------------------------
scene.unit_settings.scale_length = 1.0
assert engine.size_mm(part, c).max() > 1000
scene.unit_settings.scale_length = 0.001

select(part)
for o in fins_of(part):                      # every fin deleted by hand: Clear still
    engine.remove(o)                         # clears the result line and pose stamp
assert bpy.ops.support_fins.clear.poll()
bpy.ops.support_fins.clear()
assert not engine.children(part, {"fin"}) and "sf_report" not in part and "sf_matrix" not in part
select(block)
for o in engine.children(block, {"fin", "drawn"}):   # drawn walls only, deleted by hand:
    engine.remove(o)                                  # Clear still clears the pose stamp
del block["sf_report"]
assert bpy.ops.support_fins.clear.poll()
bpy.ops.support_fins.clear()
assert "sf_matrix" not in block and "sf_drawn" not in block
print("SMOKE_PASS", flush=True)
