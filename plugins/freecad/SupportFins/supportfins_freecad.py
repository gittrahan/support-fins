"""The SupportFins object: breakaway support fins for a part, recomputed when it changes.

A Mesh::FeaturePython linked to its Source part. On recompute it tessellates the part
the way printfins.com tessellates a STEP (same OpenCascade mesher, same tolerances),
runs the site's engine through the shared host (plugins/shared/py/supportfins_host.py,
V8 via vendored mini-racer) and stores the fins + bed pad as its mesh. No fin geometry
is computed here.

The bed is the document's XY plane at the part's lowest point: the part prints the way
it sits in the model, z up. Rotate the part (its Placement) to change the pose.

Auto update (on by default) recomputes with the part. Off, the fins keep their last
result and the report says they're out of date until Update Support Fins runs.
"""
import json
import os
import sys

import FreeCAD as App

import props

HERE = os.path.dirname(os.path.abspath(__file__))
SCHEMA = json.load(open(os.path.join(HERE, "options.json"), encoding="utf-8"))
SPECS = props.specs(SCHEMA)
# the site's STEP tessellation (web/step.js STEP_PARAMS): 0.01 mm chord, 0.1 rad
LINEAR_DEFLECTION, ANGULAR_DEFLECTION = 0.01, 0.1
FIN_COLOR = (0.15, 0.45, 0.95)
OUT_OF_DATE = "Out of date (Auto update is off): run Update Support Fins. Last result: "

_ctx = None


def host():
    """The shared Python host, and its V8 context (started once, ~0.4 s)."""
    global _ctx
    for p in (HERE, os.path.join(HERE, "vendor")):
        if p not in sys.path:
            sys.path.insert(0, p)
    import supportfins_host as h
    if _ctx is None:
        with open(os.path.join(HERE, "fins_engine.js"), encoding="utf-8") as fh:
            _ctx = h.host_engine(fh.read(), vendor_dir=os.path.join(HERE, "vendor"))
    return h, _ctx


def is_fins(obj):
    return getattr(getattr(obj, "Proxy", None), "Type", None) == "SupportFins"


def source_for(obj):
    """What a selection means: a feature inside a PartDesign Body is that Body (so the
    fins follow the Body's tip), anything else with a shape or a mesh is itself."""
    parent = obj.getParentGeoFeatureGroup() if hasattr(obj, "getParentGeoFeatureGroup") else None
    if parent is not None and parent.isDerivedFrom("PartDesign::Body"):
        return parent
    if is_fins(obj):
        return None
    if obj.isDerivedFrom("Mesh::Feature") or (hasattr(obj, "Shape") and not obj.Shape.isNull()):
        return obj
    return None


def part_soup(src):
    """The part's triangles in document coordinates, (M,3,3) float64, mm."""
    import numpy as np
    import Mesh
    pl = src.getGlobalPlacement()
    if src.isDerivedFrom("Mesh::Feature"):
        mesh = Mesh.Mesh(src.Mesh)
        mesh.Placement = pl
    else:
        import MeshPart
        shape = src.Shape.copy()
        shape.Placement = pl
        mesh = MeshPart.meshFromShape(Shape=shape, LinearDeflection=LINEAR_DEFLECTION,
                                      AngularDeflection=ANGULAR_DEFLECTION, Relative=False)
    pts, tris = mesh.Topology
    if not tris:
        raise ValueError(f"{src.Label} has no triangles to hold up")
    P = np.array([(p.x, p.y, p.z) for p in pts], dtype=np.float64)
    return P[np.asarray(tris, dtype=np.int64)]


class SupportFins:
    Type = "SupportFins"

    def __init__(self, obj):
        obj.Proxy = self
        self.add_properties(obj)

    def add_properties(self, obj):
        """Adds whatever is missing, so a file saved by an older add-on gains new
        engine options (at their defaults) when it opens."""
        have = set(obj.PropertiesList)

        def add(kind, name, group, tip, value=None, enum=None):
            if name in have:
                return
            obj.addProperty(kind, name, group, tip)
            if enum is not None:
                setattr(obj, name, enum)
            if value is not None:
                setattr(obj, name, value)

        add("App::PropertyLink", "Source", props.GROUP, "The part the fins hold up")
        add("App::PropertyBool", "AutoUpdate", props.GROUP,
            "Recompute the fins whenever the part or a setting changes. Off: keep the last "
            "fins until Update Support Fins", True)
        add("App::PropertyString", "Report", props.GROUP,
            "What the engine placed, and what it couldn't reach")
        obj.setEditorMode("Report", 1)            # read-only
        for s in SPECS:
            add(s["type"], s["name"], s["group"], s["tooltip"], s["default"], s.get("labels"))

    def onDocumentRestored(self, obj):
        self.add_properties(obj)

    def execute(self, obj):
        forced, self._force = getattr(self, "_force", False), False
        if not obj.AutoUpdate and not forced and obj.Mesh.CountFacets:
            if not obj.Report.startswith(OUT_OF_DATE):
                obj.Report = OUT_OF_DATE + obj.Report
            return
        if obj.Source is None:
            raise ValueError("pick the part these fins hold up (Source)")
        h, ctx = host()
        values = props.dialog_values(SCHEMA, lambda name: getattr(obj, name))
        options = h.host_options(ctx, values)
        fins, stats = h.host_compute(ctx, part_soup(obj.Source), options)
        import Mesh
        mesh = Mesh.Mesh()
        if len(fins):
            mesh.addFacets(fins.tolist())
        obj.Mesh = mesh
        obj.Report = h.host_report(stats)
        App.Console.PrintMessage(f"Support Fins ({obj.Source.Label}): {obj.Report}\n")
        self.show_relevant(obj, values)

    def show_relevant(self, obj, values=None):
        """Hide the settings the engine would ignore (the site hides those controls)."""
        h, ctx = host()
        if values is None:
            values = props.dialog_values(SCHEMA, lambda name: getattr(obj, name))
        for s in SPECS:
            obj.setEditorMode(s["name"], 0 if h.host_visible(ctx, s["key"], values) else 2)

    def dumps(self):
        return None

    def loads(self, state):
        return None


class ViewProviderSupportFins:
    def __init__(self, vobj):
        vobj.Proxy = self

    def attach(self, vobj):
        self.Object = vobj.Object

    def getIcon(self):
        return os.path.join(HERE, "Resources", "icons", "SupportFins.svg")

    def dumps(self):
        return None

    def loads(self, state):
        return None


def make(src, doc=None):
    """A SupportFins object for `src` (not recomputed yet)."""
    doc = doc or src.Document
    obj = doc.addObject("Mesh::FeaturePython", "SupportFins")
    SupportFins(obj)
    obj.Source = src
    obj.Label = f"{src.Label} fins"
    if App.GuiUp:
        ViewProviderSupportFins(obj.ViewObject)
        obj.ViewObject.ShapeColor = FIN_COLOR
        # the bed pad is a thin skirt seen almost edge-on: one-sided lighting draws it black
        obj.ViewObject.Lighting = "Two side"
    return obj


def update(objs):
    """Recompute these fins now, Auto update or not."""
    docs = set()
    for obj in objs:
        obj.Proxy._force = True
        obj.touch()
        docs.add(obj.Document)
    for doc in docs:
        doc.recompute()
