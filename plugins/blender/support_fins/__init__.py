# SPDX-License-Identifier: GPL-3.0-or-later
"""Support Fins for Blender: printfins.com's breakaway support fins under a part.

The fins are the website's engine (web/*.js, bundled), run in V8 through the shared
plugin host -- see engine.py. Panel: 3D View > Sidebar > Support Fins.
"""
import bpy

from . import operators, ui


def register():
    for cls in ui.CLASSES + operators.CLASSES:
        bpy.utils.register_class(cls)
    ui.register()


def unregister():
    ui.unregister()
    for cls in reversed(ui.CLASSES + operators.CLASSES):
        bpy.utils.unregister_class(cls)
