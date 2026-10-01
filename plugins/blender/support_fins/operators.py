# SPDX-License-Identifier: GPL-3.0-or-later
"""Generate, Draw wall, Lay face flat, Clear, Use millimetres. The geometry is the engine's
(engine.py); these only read clicks and selections and report what came back."""
import bpy
from bpy.props import EnumProperty
from bpy_extras import view3d_utils
from mathutils import Matrix, Vector

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
    bl_description = "Delete the active part's fins and drawn walls"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        part = active_part(context)
        # also with every fin deleted by hand: the result line and pose stamp remain
        return context.mode == "OBJECT" and part is not None and (
            bool(engine.children(part, {"fin", "drawn"})) or "sf_report" in part)

    def execute(self, context):
        part = active_part(context)
        for o in engine.children(part, {"fin", "drawn"}):
            engine.remove(o)
        ui.built(part)
        for k in ("sf_report", "sf_matrix", "sf_settings", "sf_mesh", "sf_drawn"):
            if k in part:
                del part[k]
        return {"FINISHED"}


def _ray(region, rv3d, event, obj, context):
    """Where the mouse ray hits obj: (hit, world point, world normal). `region` is the
    viewport's WINDOW region: the operator starts from the sidebar, and a modal keeps
    the region it started in, so context.region / mouse_region_x would be the panel's."""
    xy = (event.mouse_x - region.x, event.mouse_y - region.y)
    if not (0 <= xy[0] < region.width and 0 <= xy[1] < region.height):
        return False, None, None
    origin = view3d_utils.region_2d_to_origin_3d(region, rv3d, xy)
    direction = view3d_utils.region_2d_to_vector_3d(region, rv3d, xy)
    ev = obj.evaluated_get(context.evaluated_depsgraph_get())
    inv = ev.matrix_world.inverted()
    hit, co, normal, _ = ev.ray_cast(inv @ origin, (inv.to_3x3() @ direction).normalized())
    if not hit:
        return False, None, None
    world_normal = (ev.matrix_world.to_3x3().inverted().transposed() @ normal).normalized()
    return True, ev.matrix_world @ co, world_normal


class SUPPORTFINS_OT_draw(bpy.types.Operator):
    """Click on the part: two points for a wall, or one face to lay on the bed.
    From RemusTL's Blender extension (PR #145)."""
    bl_idname = "support_fins.draw"
    bl_label = "Draw on part"
    bl_options = {"REGISTER", "UNDO"}

    kind: EnumProperty(items=[("WALL", "Draw wall", "Click two points under an overhang"),
                              ("FACE", "Lay face flat", "Click a face to put it down on the bed")],
                       options={"HIDDEN", "SKIP_SAVE"})

    @classmethod
    def poll(cls, context):
        return (context.mode == "OBJECT" and context.area is not None
                and context.area.type == "VIEW_3D" and active_part(context) is not None)

    def invoke(self, context, event):
        self._part = active_part(context)
        self._a = None
        self._hover = None
        self._area = context.area
        self._region = next(r for r in context.area.regions if r.type == "WINDOW")
        self._rv3d = context.space_data.region_3d
        self._handle = bpy.types.SpaceView3D.draw_handler_add(self._preview, (), "WINDOW", "POST_VIEW")
        self._say("click the first end of the wall, under the overhang" if self.kind == "WALL"
                  else "click the face to put down on the bed")
        context.window_manager.modal_handler_add(self)
        return {"RUNNING_MODAL"}

    def _say(self, text):
        self._area.header_text_set(f"Support Fins: {text}  ·  Esc / right click cancels")

    def _preview(self):
        if self._a is None or self._hover is None:
            return
        import gpu
        from gpu_extras.batch import batch_for_shader
        # POLYLINE: a plain line width is ignored on Metal / Vulkan
        shader = gpu.shader.from_builtin("POLYLINE_UNIFORM_COLOR")
        batch = batch_for_shader(shader, "LINES", {"pos": [self._a, self._hover]})
        region = bpy.context.region
        gpu.state.depth_test_set("NONE")
        shader.bind()
        shader.uniform_float("viewportSize", (region.width, region.height))
        shader.uniform_float("lineWidth", 3.0)
        shader.uniform_float("color", engine.DRAWN_COLOR)
        batch.draw(shader)
        gpu.state.depth_test_set("LESS_EQUAL")

    def _finish(self):
        if self._handle:
            bpy.types.SpaceView3D.draw_handler_remove(self._handle, "WINDOW")
            self._handle = None
        self._area.header_text_set(None)
        self._area.tag_redraw()

    def modal(self, context, event):
        # Any error ends the tool cleanly: no preview handler or header text left behind
        # (an undo or a delete mid-tool can pull the part out from under it).
        try:
            return self._step(context, event)
        except Exception as e:  # noqa: BLE001
            self._finish()
            self.report({"ERROR"}, str(e).splitlines()[0][:300])
            return {"CANCELLED"}

    def _step(self, context, event):
        if event.type in {"ESC", "RIGHTMOUSE"}:
            self._finish()
            return {"CANCELLED"}
        if event.type == "MOUSEMOVE" and self._a is not None:
            hit, p, _ = _ray(self._region, self._rv3d, event, self._part, context)
            self._hover = p if hit else None
            self._area.tag_redraw()
        if event.type == "LEFTMOUSE" and event.value == "PRESS":
            hit, p, n = _ray(self._region, self._rv3d, event, self._part, context)
            if not hit:
                return {"PASS_THROUGH"}       # off the part, or a click in the panel
            if self.kind == "FACE":
                self._finish()
                lay_face_flat(self._part, n, context)
                self.report({"INFO"}, "Face is down: Generate fins for this pose")
                return {"FINISHED"}
            if self._a is None:
                self._a = p
                self._say("click the other end")
                return {"RUNNING_MODAL"}
            self._finish()
            wall, reason = engine.draw_wall(self._part, self._a, p, context)
            if wall is None:
                self.report({"WARNING"}, f"No wall: {reason}")
                return {"CANCELLED"}
            self.report({"INFO"}, f"Added {wall.name}")
            return {"FINISHED"}
        return {"PASS_THROUGH"}


def lay_face_flat(part, world_normal, context):
    """Turn the part so the face with this normal points down, about the middle of its
    bounding box, keeping its lowest point where it was. Its fins are for the old pose,
    so they go (drawn walls stay: Generate re-stands them)."""
    k = engine.mm_per_unit(context.scene)
    low = part_lowest(part, context)
    rot = Vector(world_normal).rotation_difference(Vector((0, 0, -1))).to_matrix().to_4x4()
    centre = sum((part.matrix_world @ Vector(c) for c in part.bound_box), Vector()) / 8
    part.matrix_world = Matrix.Translation(centre) @ rot @ Matrix.Translation(-centre) @ part.matrix_world
    context.view_layer.update()
    part.matrix_world.translation.z += (low - part_lowest(part, context)) / k
    for o in engine.children(part, {"fin"}):
        engine.remove(o)
    context.view_layer.update()


def part_lowest(part, context):
    return float(engine.part_soup(part, context)[..., 2].min())


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


CLASSES = [SUPPORTFINS_OT_generate, SUPPORTFINS_OT_clear, SUPPORTFINS_OT_draw,
           SUPPORTFINS_OT_millimetres]
