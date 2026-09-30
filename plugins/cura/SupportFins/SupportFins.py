"""Support Fins for UltiMaker Cura: host glue only.

Extensions > Support Fins > Add Support Fins runs the printfins.com engine (the
website's web/*.js, bundled) on each selected part as it sits on the plate, and adds
the fins + bed pad as a "Support Fins" object parented to the part: it moves with the
part, Ctrl+Z takes it back off, and a second run replaces it.

Nothing about fins is computed here -- this file reads Cura's mesh, hands it to the
shared host (supportfins_host.py) and adds the result back. Geometry changes go in
web/, and reach Cura at the next build.

Tines touch the part rather than bite into it: Cura's "Remove Mesh Intersection"
(global, on by default) trims the overlap between the part and the fins object.
That's kept on purpose -- the tines snap off cleanly (local issue 015).
"""
import os

from cura.CuraApplication import CuraApplication
from cura.Operations.SetParentOperation import SetParentOperation
from cura.Scene.BuildPlateDecorator import BuildPlateDecorator
from cura.Scene.CuraSceneNode import CuraSceneNode
from cura.Scene.SliceableObjectDecorator import SliceableObjectDecorator
from UM.Extension import Extension
from UM.Job import Job
from UM.Logger import Logger
from UM.Math.Vector import Vector
from UM.Mesh.MeshData import MeshData, calculateNormalsFromIndexedVertices
from UM.Message import Message
from UM.Operations.AddSceneNodeOperation import AddSceneNodeOperation
from UM.Operations.GroupedOperation import GroupedOperation
from UM.Operations.RemoveSceneNodeOperation import RemoveSceneNodeOperation
from UM.Scene.Iterator.DepthFirstIterator import DepthFirstIterator
from UM.Scene.Selection import Selection
from UM.Settings.SettingInstance import SettingInstance

from . import frames
from . import supportfins_host as host

HERE = os.path.dirname(os.path.abspath(__file__))
TITLE = "Support Fins"
FINS_NAME = "Support Fins"

# PR 1: the website's defaults. The settings dialog (generated from the shared
# options schema) replaces these.
OPTIONS = {"mode": "auto", "bedPad": True, "tines": True, "tineDensity": 0.0, "coverage": 0.5}


def is_fins(node):
    return isinstance(node, CuraSceneNode) and node.getName() == FINS_NAME


class FinsJob(Job):
    """Runs the engine off the UI thread: ~1-3 s for a small part on macOS (--jitless)."""

    def __init__(self, soups, options):
        super().__init__()
        self._soups = soups
        self._options = options

    def run(self):
        with open(os.path.join(HERE, "fins_engine.js"), encoding="utf-8") as f:
            js = f.read()
        ctx = host.host_engine(js, vendor_dir=os.path.join(HERE, "vendor"))
        self.setResult([host.host_compute(ctx, soup, self._options) for soup in self._soups])


class SupportFins(Extension):
    def __init__(self):
        super().__init__()
        self.setMenuName(TITLE)
        self.addMenuItem("Add Support Fins", self.addToSelection)
        self.addMenuItem("Remove Support Fins", self.removeFromSelection)
        self._job = None
        self._pending = None
        self._progress = None
        self.last_report = []
        from . import devrun
        devrun.hook(self)

    # -- the menu -------------------------------------------------------------------
    def addToSelection(self):
        if self._job is not None:
            Message("Still computing the last fins.", title=TITLE).show()
            return
        parts = self._selected_parts()
        if not parts:
            Message("Select a part on the plate first.", title=TITLE).show()
            return
        self.addTo(parts)

    def removeFromSelection(self):
        parts = self._selected_parts()
        root = CuraApplication.getInstance().getController().getScene().getRoot()
        pool = [c for p in parts for c in p.getChildren()] if parts else list(DepthFirstIterator(root))
        doomed = [n for n in pool if is_fins(n)]
        if not doomed:
            return
        op = GroupedOperation()
        for n in doomed:
            op.addOperation(RemoveSceneNodeOperation(n))
        op.push()

    # -- add ------------------------------------------------------------------------
    def addTo(self, parts):
        """Snapshot each part's world mesh on the UI thread, compute in a Job."""
        stack = CuraApplication.getInstance().getGlobalContainerStack()
        options = dict(OPTIONS, layerHeight=float(stack.getProperty("layer_height", "value")))
        soups, poses = [], []
        for part in parts:
            md = part.getMeshData().getTransformed(part.getWorldTransformation())
            soups.append(frames.part_soup(md.getVertices(),
                                          md.getIndices() if md.hasIndices() else None))
            poses.append(part.getWorldTransformation().getData().copy())
        self._progress = Message("Computing fins…", lifetime=0, dismissable=False,
                                 progress=-1, title=TITLE)
        self._progress.show()
        self._pending = (parts, poses)
        self._job = FinsJob(soups, options)
        # A bound method, not a lambda: Uranium's Signal holds plain functions weakly.
        self._job.finished.connect(self._onJobFinished)
        self._job.start()

    def _onJobFinished(self, job):
        # emitted on the worker thread; the scene is only touched on the UI thread
        CuraApplication.getInstance().callLater(self._finished, job)

    def _finished(self, job):
        parts, poses = self._pending
        self._job = self._pending = None
        if self._progress:
            self._progress.hide()
            self._progress = None
        if job.getError() is not None:
            Logger.log("e", "Support Fins: engine failed: %r", job.getError())
            Message(f"The fin engine failed: {job.getError()}", title=TITLE,
                    message_type=Message.MessageType.ERROR).show()
            return
        lines = []
        op = GroupedOperation()
        for part, pose, (fins, stats) in zip(parts, poses, job.getResult()):
            name = part.getName()
            if part.getParent() is None:
                continue                                  # deleted while computing
            if not (part.getWorldTransformation().getData() == pose).all():
                lines.append(f"{name}: moved while computing, run Add Support Fins again")
                continue
            for old in part.getChildren():
                if is_fins(old):
                    op.addOperation(RemoveSceneNodeOperation(old))
            if len(fins):
                node = self._fins_node(fins)
                # Add at the root in world space, then parent: SetParentOperation keeps
                # the world position, and Cura's drop-to-plate leaves children alone.
                op.addOperation(AddSceneNodeOperation(node, part.getParent()))
                op.addOperation(SetParentOperation(node, part))
            lines.append((f"{name}: " if len(parts) > 1 else "") + host.host_report(stats))
        op.push()
        stack = CuraApplication.getInstance().getGlobalContainerStack()
        if stack.getProperty("support_enable", "value"):
            lines.append("Cura's own supports are on too. Turn them off to print with fins only")
        self.last_report = lines
        Message("\n".join(lines), title=TITLE).show()

    def _fins_node(self, fins):
        verts, idx, centre = frames.fins_mesh(fins)
        node = CuraSceneNode()
        node.setName(FINS_NAME)
        node.setSelectable(True)
        normals = calculateNormalsFromIndexedVertices(verts, idx, len(idx))
        node.setMeshData(MeshData(vertices=verts, indices=idx, normals=normals))
        node.setPosition(Vector(*centre))
        plate = CuraApplication.getInstance().getMultiBuildPlateModel().activeBuildPlate
        node.addDecorator(BuildPlateDecorator(plate))
        node.addDecorator(SliceableObjectDecorator())
        # The engine's fins are separate closed shells that overlap on purpose and
        # expect the slicer to union them. Cura's default already does; pin it.
        stack = node.callDecoration("getStack")
        top = stack.getTop()
        inst = SettingInstance(stack.getSettingDefinition("meshfix_union_all"), top)
        inst.setProperty("value", True)
        inst.resetState()
        top.addInstance(inst)
        return node

    # -- selection ------------------------------------------------------------------
    def _selected_parts(self):
        """Selected parts; a selected fins object counts as its part. Groups are skipped
        (their mesh lives in the children) -- ungroup first."""
        out = []
        for n in Selection.getAllSelectedObjects():
            if is_fins(n):
                n = n.getParent()
            if n is None or n in out or n.callDecoration("isGroup") or n.getMeshData() is None:
                continue
            out.append(n)
        return out
