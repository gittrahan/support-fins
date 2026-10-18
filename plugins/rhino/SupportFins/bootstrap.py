"""Inlined at the top of every command by build.py (# @bootstrap): a built command
is one script, run by Rhino from inside the plugin, so it can't import this file.
"""
import Rhino

PLUGIN_ID = "6a881861-fe75-4314-ba84-6f833da35639"   # = SupportFins.rhproj "id"


def _lib():
    """Put the plugin's shared files on sys.path: next to the built plugin (yak), or
    ../lib in a checkout's staged build (rhinocode script)."""
    import os
    import sys

    import System

    places = []
    try:
        rhp = Rhino.PlugIns.PlugIn.PathFromId(System.Guid(PLUGIN_ID))
        if rhp:
            d = os.path.dirname(str(rhp))
            places += [os.path.join(d, "shared", "lib"), os.path.join(d, "shared"), os.path.join(d, "lib")]
    except Exception:      # noqa: BLE001 -- not installed as a plugin
        pass
    if "__file__" in globals():
        places.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
    for p in places:
        if os.path.isfile(os.path.join(p, "supportfins_rhino.py")):
            if p not in sys.path:
                sys.path.insert(0, p)
            return
    raise RuntimeError("Support Fins: can't find the plugin's files (looked in "
                       + ", ".join(places) + "); reinstall it")
