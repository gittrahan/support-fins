# SPDX-License-Identifier: GPL-3.0-or-later
"""The Support Fins panel (3D View sidebar) and its settings.

The settings are generated from options.json (schema.py), and a setting shows only
when the engine says it does something (options.json showIf, asked through
supportfins_host.host_visible) -- the same rule as the website and every plugin.
"""
import json
import textwrap

import bpy
from bpy.props import BoolProperty, EnumProperty, FloatProperty, PointerProperty

from . import engine, schema

# Parts whose mesh changed since their fins were built (depsgraph handler below).
# Session-only: comparing meshes on every redraw would be too slow.
EDITED = set()
_visible_cache = {}


def _overlays_changed(self, context):
    for obj in context.scene.objects:
        if obj.get("sf_role") == "overhangs":
            engine.set_hidden(obj, not self.show_overhangs)


def _settings_class():
    annotations = {}
    for s in engine.SPECS:
        common = {"name": s["label"], "description": s["description"]}
        if s["kind"] == "bool":
            annotations[s["name"]] = BoolProperty(default=s["default"], **common)
        elif s["kind"] == "enum":
            annotations[s["name"]] = EnumProperty(items=s["items"], default=s["default"], **common)
        else:
            limits = {k: s[k] for k in ("min", "max", "soft_min", "soft_max") if k in s}
            annotations[s["name"]] = FloatProperty(default=s["default"], step=s["step"], precision=s["precision"],
                                                   subtype="PERCENTAGE" if s["percent"] else "NONE",
                                                   **limits, **common)
    annotations["show_overhangs"] = BoolProperty(
        name="Show overhangs", default=True, update=_overlays_changed,
        description="Red: the overhangs the fins hold. Amber: past the angle but too small to fin, "
                    "as on printfins.com")
    return type("SupportFinsSettings", (bpy.types.PropertyGroup,), {"__annotations__": annotations})


SupportFinsSettings = _settings_class()


def visible(scene, key):
    values = engine.dialog_values(scene)
    cache_key = (key, json.dumps(values, sort_keys=True))
    if cache_key not in _visible_cache:
        if len(_visible_cache) > 512:
            _visible_cache.clear()
        _visible_cache[cache_key] = engine.host.host_visible(engine.ctx(), key, values)
    return _visible_cache[cache_key]


def _columns(context):
    """About how many characters fit on a sidebar label: Blender cuts a longer one
    off with an ellipsis instead of wrapping it."""
    region = context.region
    if region is None or region.type != "UI":
        return 42
    return max(16, int(region.width / context.preferences.system.ui_scale / 6.5) - 6)


def _wrapped(layout, text, icon="NONE", width=42):
    lines = textwrap.wrap(text, width) or [""]
    for i, line in enumerate(lines):
        layout.label(text=line, icon=icon if i == 0 else "BLANK1")


class SUPPORTFINS_PT_main(bpy.types.Panel):
    bl_label = "Support Fins"
    bl_idname = "SUPPORTFINS_PT_main"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Support Fins"

    def draw(self, context):
        layout = self.layout
        scene = context.scene
        cols = _columns(context)
        part = engine.part_for(context.active_object)
        if part is None:
            layout.label(text="Select the part to support", icon="INFO")
            return
        box = layout.box()
        box.label(text=part.name, icon="MESH_DATA")
        size = engine.size_mm(part, context)
        box.label(text="{:.1f} × {:.1f} × {:.1f} mm".format(*size))
        if size.max() > 1000 or size.max() < 1:
            _wrapped(box, "That size looks wrong for a print: is one Blender unit a millimetre?", "ERROR", cols)
            box.operator("support_fins.millimetres")

        try:
            engine.ctx()
        except Exception as e:  # noqa: BLE001 -- say why the engine won't start, don't crash the panel
            _wrapped(layout, f"The fin engine didn't start: {e}", "ERROR", cols)
            return

        col = layout.column(align=True)
        col.scale_y = 1.4
        col.operator("support_fins.generate", icon="MOD_BUILD")
        row = layout.row(align=True)
        row.operator("support_fins.draw", text="Draw wall", icon="GREASEPENCIL").kind = "WALL"
        row.operator("support_fins.draw", text="Lay face flat", icon="SNAP_FACE").kind = "FACE"

        report = part.get("sf_report")
        why = out_of_date(part, scene)
        if report or why:
            box = layout.box()
            if why:
                _wrapped(box, f"Out of date: {why}. Generate again.", "ERROR", cols)
            for i, line in enumerate(report.split("; ") if report else []):
                _wrapped(box, line, "CHECKMARK" if i == 0 else "ERROR", cols)
            if report:
                box.prop(scene.support_fins, "show_overhangs")

        settings = scene.support_fins
        for title, specs in schema.sections(engine.SCHEMA):
            shown = [s for s in specs if visible(scene, s["key"])]
            if not shown:
                continue
            col = layout.column(align=True)
            col.label(text=title)
            for s in shown:
                col.prop(settings, s["name"], slider=s.get("slider", False))

        row = layout.row(align=True)
        row.operator("support_fins.export_3mf", icon="EXPORT")
        row.operator("support_fins.clear", text="", icon="TRASH")


def out_of_date(part, scene):
    if part.as_pointer() in EDITED:
        return "the part was edited"
    return engine.out_of_date(part, scene)


@bpy.app.handlers.persistent
def _depsgraph_changed(scene, depsgraph):
    # Only note it here: no mesh evaluation or ID writes inside a depsgraph update.
    for u in depsgraph.updates:
        if u.is_updated_geometry and isinstance(u.id, bpy.types.Object):
            obj = u.id.original
            if "sf_matrix" in obj:
                EDITED.add(obj.as_pointer())


@bpy.app.handlers.persistent
def _file_loaded(*_):
    # EDITED is per session: an edit saved since the fins were built shows up as a
    # changed mesh fingerprint instead (once per file load; not per redraw).
    EDITED.clear()
    context = bpy.context
    for obj in bpy.data.objects:
        if obj.get("sf_mesh") and obj.type == "MESH":
            try:
                if engine.mesh_key(obj, context) != obj["sf_mesh"]:
                    EDITED.add(obj.as_pointer())
            except Exception:  # noqa: BLE001 -- e.g. not in this scene's depsgraph
                pass


def built(part):
    """Generate just ran: the fins match the mesh again."""
    EDITED.discard(part.as_pointer())


CLASSES = [SupportFinsSettings, SUPPORTFINS_PT_main]


def register():
    bpy.types.Scene.support_fins = PointerProperty(type=SupportFinsSettings)
    if _depsgraph_changed not in bpy.app.handlers.depsgraph_update_post:
        bpy.app.handlers.depsgraph_update_post.append(_depsgraph_changed)
    if _file_loaded not in bpy.app.handlers.load_post:
        bpy.app.handlers.load_post.append(_file_loaded)


def unregister():
    if _depsgraph_changed in bpy.app.handlers.depsgraph_update_post:
        bpy.app.handlers.depsgraph_update_post.remove(_depsgraph_changed)
    if _file_loaded in bpy.app.handlers.load_post:
        bpy.app.handlers.load_post.remove(_file_loaded)
    del bpy.types.Scene.support_fins
