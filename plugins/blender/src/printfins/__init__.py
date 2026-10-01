# SPDX-License-Identifier: GPL-3.0-or-later
bl_info={"name":"PrintFins","author":"PrintFins contributors; geometry by gittrahan","version":(0,3,0),
 "blender":(4,2,0),"location":"View3D > Sidebar > PrintFins","description":"Offline FDM breakaway fins with separate STL/3MF parts","category":"3D View"}
import bpy
from . import core, operators, ui, preferences, workflow, viewport
_classes=preferences.CLASSES+[ui.PF_Settings]+operators.CLASSES+workflow.CLASSES+ui.CLASSES[1:]
def register():
    for cls in _classes: bpy.utils.register_class(cls)
    bpy.types.Scene.pf=bpy.props.PointerProperty(type=ui.PF_Settings)
    try: bpy.app.translations.register(__name__,{"it_IT":{(ctx,k):v for k,v in ui.IT.items() for ctx in ("*","Operator","UI_Events_KeyMaps")}})
    except ValueError: pass
    viewport.register()
    if not bpy.app.timers.is_registered(ui.watch): bpy.app.timers.register(ui.watch,first_interval=1,persistent=True)
    if ui.depsgraph_changed not in bpy.app.handlers.depsgraph_update_post: bpy.app.handlers.depsgraph_update_post.append(ui.depsgraph_changed)
def unregister():
    viewport.unregister()
    if core.JOB: core.cancel(core.JOB); core.JOB=None
    core.BUSY=False
    if bpy.app.timers.is_registered(ui.watch): bpy.app.timers.unregister(ui.watch)
    if ui.depsgraph_changed in bpy.app.handlers.depsgraph_update_post: bpy.app.handlers.depsgraph_update_post.remove(ui.depsgraph_changed)
    bpy.app.translations.unregister(__name__)
    del bpy.types.Scene.pf
    for cls in reversed(_classes): bpy.utils.unregister_class(cls)
