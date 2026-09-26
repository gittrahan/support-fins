"""Support Fins for Autodesk Fusion: supports that live in the model.

Two commands under Solid > Create:
  Insert Support Fins  the website's fins (engine run in V8, see engine_host.py)
  Insert Sway Brace    tapered buttress ribs for tall parts (sway_core, pure Python)
"""

import importlib
import sys
import traceback

import adsk.core

_ui = None
_commands = []

COMMAND_MODULES = ('.fins_command', '.sway_command')


def _fresh_command_modules():
    """Import the command modules anew. Fusion's Stop/Run re-runs this file but
    keeps the add-in's other modules cached, so edits to them wouldn't load until
    Fusion restarted. Dropping them from the cache makes Run pick up the files
    on disk. (The V8 runtime itself stays loaded: a DLL can't be unloaded.)"""
    prefix = __name__ + '.'
    for name in [n for n in sys.modules if n.startswith(prefix)]:
        del sys.modules[name]
    return [importlib.import_module(m, __name__) for m in COMMAND_MODULES]


def run(context):
    global _ui
    try:
        app = adsk.core.Application.get()
        _ui = app.userInterface
        _commands.clear()
        for mod in _fresh_command_modules():
            mod.start(app, _ui)
            _commands.append(mod)
    except Exception:
        if _ui:
            _ui.messageBox('Support Fins failed to start:\n%s' % traceback.format_exc())


def stop(context):
    for mod in reversed(_commands):
        try:
            if _ui:
                mod.stop(_ui)
        except Exception:
            if _ui:
                _ui.messageBox('Support Fins failed to stop:\n%s' % traceback.format_exc())
    _commands.clear()
