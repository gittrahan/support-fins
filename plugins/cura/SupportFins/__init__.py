# Support Fins for UltiMaker Cura -- see plugins/cura/README.md.
import os
import sys

# mini-racer ships inside the plugin (Cura's Python can't pip-install it).
_VENDOR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vendor")
if _VENDOR not in sys.path:
    sys.path.insert(0, _VENDOR)

from . import SupportFins  # noqa: E402


def getMetaData():
    return {}


def register(app):
    return {"extension": SupportFins.SupportFins()}
