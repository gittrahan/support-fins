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

import supportfins_props as props

HERE = os.path.dirname(os.path.abspath(__file__))
SCHEMA = json.load(open(os.path.join(HERE, "options.json"), encoding="utf-8"))
SPECS = props.specs(SCHEMA)
SETTING_NAMES = {s["name"] for s in SPECS}
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
    fins follow the Body's tip), anything else with a shape (a Link's included) or a
    mesh is itself."""
    import Part
    parent = obj.getParentGeoFeatureGroup() if hasattr(obj, "getParentGeoFeatureGroup") else None
    if parent is not None and parent.isDerivedFrom("PartDesign::Body"):
        return parent
    if is_fins(obj):
        return None
    if obj.isDerivedFrom("Mesh::Feature"):
        return obj
    try:
        return None if Part.getShape(obj).isNull() else obj
    except Exception:                          # noqa: BLE001 -- not a shape: not a part
        return None


def parent_placement(obj):
    """Where obj's container puts it in the document (identity at the top level).
    Not obj's own placement: that's in its shape already."""
    parent = obj.getParentGeoFeatureGroup() if hasattr(obj, "getParentGeoFeatureGroup") else None
    return parent.getGlobalPlacement() if parent is not None else App.Placement()


def containers(obj):
    """The groups (App::Part, Body, ...) above obj, innermost first: moving any of them
    moves the part, so the fins depend on them too."""
    out, parent = [], obj.getParentGeoFeatureGroup() if hasattr(obj, "getParentGeoFeatureGroup") else None
    while parent is not None and parent not in out:
        out.append(parent)
        parent = parent.getParentGeoFeatureGroup()
    return out


def where(fins):
    """Where the fins' part sits in the document, and where the fins' own group does:
    if either moves, the fins are stale."""
    return (str(parent_placement(fins.Source)), str(parent_placement(fins)))


def part_soup(src):
    """The part's triangles in document coordinates, (M,3,3) float64, mm."""
    import numpy as np
    import Mesh
    if src.isDerivedFrom("Mesh::Feature"):
        mesh = Mesh.Mesh(src.Mesh)
        mesh.Placement = src.getGlobalPlacement()
    else:
        import MeshPart
        import Part
        # getShape carries the object's own placement (a Link's placement too, which
        # getGlobalPlacement can't give); its containers' placements go on top
        shape = Part.getShape(src, "", needSubElement=False, transform=True).copy()
        shape.Placement = parent_placement(src).multiply(shape.Placement)
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
        add("App::PropertyLinkListHidden", "Containers", props.GROUP,
            "The groups the part sits in: moving one moves the part, so the fins follow")
        self._adding = True
        try:
            for s in SPECS:
                add(s["type"], s["name"], s["group"], s["tooltip"], s["default"], s.get("labels"))
        finally:
            self._adding = False

    def onDocumentRestored(self, obj):
        self.add_properties(obj)

    def onChanged(self, obj, prop):
        if getattr(self, "_adding", False) or "Restore" in obj.State:
            return
        if prop == "Source":
            self.follow_containers(obj)
        elif prop in SETTING_NAMES:
            # show/hide at once, even with Auto update off or after a failed compute
            try:
                self.show_relevant(obj)
            except Exception:                  # noqa: BLE001 -- never block editing a value
                pass

    def mustExecute(self, obj):
        """Moving a group the part sits in changes no shape, so FreeCAD reruns nothing
        downstream: recompute when the part, or these fins, moved since the last run."""
        return obj.Source is not None and getattr(self, "_placed", None) not in (None, where(obj))

    def follow_containers(self, obj):
        want = [c for c in containers(obj.Source) if obj not in c.OutListRecursive] if obj.Source else []
        if list(obj.Containers) != want:
            obj.Containers = want

    def execute(self, obj):
        forced, self._force = getattr(self, "_force", False), False
        if not obj.AutoUpdate and not forced and obj.Mesh.CountFacets:
            if not obj.Report.startswith(OUT_OF_DATE):
                obj.Report = OUT_OF_DATE + obj.Report
            return
        try:
            if obj.Source is None:
                raise ValueError("pick the part these fins hold up (Source)")
            self.follow_containers(obj)
            h, ctx = host()
            values = props.dialog_values(SCHEMA, lambda name: getattr(obj, name))
            options = h.host_options(ctx, values)
            fins, stats = h.host_compute(ctx, part_soup(obj.Source), options)
        except Exception as e:
            # the old mesh stays on screen: say it's not this result
            obj.Report = f"Error: {e}"
            App.Console.PrintError(f"Support Fins ({obj.Label}): {e}\n")
            raise
        import Mesh
        mesh = Mesh.Mesh()
        if len(fins):
            mesh.addFacets(fins.tolist())
            # the fins are in document coordinates; if this object sits in a placed group,
            # undo the group's placement so it draws where the part is. (Its own
            # Placement needs nothing: assigning Mesh resets it to the mesh's, identity.)
            mesh.transform(parent_placement(obj).inverse().toMatrix())
        obj.Mesh = mesh
        self._placed = where(obj)
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
    try:
        for doc in docs:
            doc.recompute()
    finally:
        # if the part failed to recompute, execute never ran: don't leave the next,
        # unrelated recompute forced past Auto update
        for obj in objs:
            obj.Proxy._force = False
