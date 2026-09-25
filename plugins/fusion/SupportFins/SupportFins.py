"""Support Fins for Autodesk Fusion: supports that live in the model.

Phase 1 adds one command, Solid > Create > Insert Sway Brace.
"""

import importlib
import sys
import traceback

import adsk.core

_ui = None
_command = None


def _fresh_command_module():
    """Import sway_command anew. Fusion's Stop/Run re-runs this file but keeps
    the add-in's other modules cached, so edits to them wouldn't load until
    Fusion restarted. Dropping them from the cache makes Run pick up the files
    on disk."""
    prefix = __name__ + '.'
    for name in [n for n in sys.modules if n.startswith(prefix)]:
        del sys.modules[name]
    return importlib.import_module('.sway_command', __name__)


def run(context):
    global _ui, _command
    try:
        app = adsk.core.Application.get()
        _ui = app.userInterface
        _command = _fresh_command_module()
        _command.start(app, _ui)
    except Exception:
        if _ui:
            _ui.messageBox('Support Fins failed to start:\n%s' % traceback.format_exc())


def stop(context):
    try:
        if _ui and _command:
            _command.stop(_ui)
    except Exception:
        if _ui:
            _ui.messageBox('Support Fins failed to stop:\n%s' % traceback.format_exc())
