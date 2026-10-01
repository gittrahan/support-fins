# SPDX-License-Identifier: GPL-3.0-or-later
"""Generate, Clear, Use millimetres. The geometry is the engine's (engine.py); these
only read the selection and report what came back."""
import bpy

from . import engine, ui


def active_part(context):
    return engine.part_for(context.active_object)


class SUPPORTFINS_OT_generate(bpy.types.Operator):
    bl_idname = "support_fins.generate"
    bl_label = "Generate fins"
    bl_description = "Place the website's support fins under the active part as it sits now"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        return context.mode == "OBJECT" and active_part(context) is not None

    def execute(self, context):
        part = active_part(context)
        context.window_manager.progress_begin(0, 1)
        try:
            report = engine.generate(part, context)
            ui.built(part)
        except Exception as e:  # noqa: BLE001 -- the engine's words go to the user
            self.report({"ERROR"}, str(e).splitlines()[0][:300])
            return {"CANCELLED"}
        finally:
            context.window_manager.progress_end()
        self.report({"INFO"}, report)
        return {"FINISHED"}


class SUPPORTFINS_OT_clear(bpy.types.Operator):
    bl_idname = "support_fins.clear"
    bl_label = "Clear fins"
    bl_description = "Delete the active part's fins"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        part = active_part(context)
        return context.mode == "OBJECT" and part is not None and bool(
            engine.children(part, {"fin"}))

    def execute(self, context):
        part = active_part(context)
        for o in engine.children(part, {"fin"}):
            engine.remove(o)
        ui.built(part)
        for k in ("sf_report", "sf_matrix", "sf_settings", "sf_mesh"):
            if k in part:
                del part[k]
        return {"FINISHED"}


class SUPPORTFINS_OT_millimetres(bpy.types.Operator):
    bl_idname = "support_fins.millimetres"
    bl_label = "Use millimetres"
    bl_description = ("Make one Blender unit one millimetre (Unit Scale 0.001), the usual 3D-printing "
                      "setup: an STL imported at 1:1 then reads in mm. Geometry isn't changed")
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        u = context.scene.unit_settings
        u.system, u.scale_length, u.length_unit = "METRIC", 0.001, "MILLIMETERS"
        return {"FINISHED"}


CLASSES = [SUPPORTFINS_OT_generate, SUPPORTFINS_OT_clear, SUPPORTFINS_OT_millimetres]
