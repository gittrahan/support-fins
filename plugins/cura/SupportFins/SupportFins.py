"""Support Fins for UltiMaker Cura: host glue only.

Extensions > Support Fins > Add Support Fins runs the printfins.com engine (the
website's web/*.js, bundled) on each selected part as it sits on the plate, and adds
the fins + bed pad as a "Support Fins" object parented to the part: it moves with the
part, Ctrl+Z takes it back off, and a second run replaces it. Add is one click with the
saved settings; Support Fins Settings... opens the dialog (SettingsDialog.qml, built
from the shared options.json by settings.py). Rotating or scaling a part with fins
offers an Update instead of re-running on its own.

Nothing about fins is computed here -- this file reads Cura's mesh, hands it to the
shared host (supportfins_host.py) and adds the result back. Geometry changes go in
web/, and reach Cura at the next build.

Tines touch the part rather than bite into it: Cura's "Remove Mesh Intersection"
(global, on by default) trims the overlap between the part and the fins object.
That's kept on purpose -- the tines snap off cleanly (local issue 015).
"""
import os
import threading

from PyQt6.QtCore import QObject, pyqtProperty, pyqtSignal, pyqtSlot

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
from . import settings
from . import supportfins_host as host

HERE = os.path.dirname(os.path.abspath(__file__))
TITLE = "Support Fins"
FINS_NAME = "Support Fins"



def is_fins(node):
    return isinstance(node, CuraSceneNode) and node.getName() == FINS_NAME


# One V8 context per Cura process, shared by the Job (worker thread) and the dialog
# (UI thread). V8 isn't safe to enter from two threads at once: every use holds LOCK.
LOCK = threading.Lock()
_ctx = None


def engine():
    global _ctx
    if _ctx is None:
        with open(os.path.join(HERE, "fins_engine.js"), encoding="utf-8") as f:
            _ctx = host.host_engine(f.read(), vendor_dir=os.path.join(HERE, "vendor"))
    return _ctx


class FinsJob(Job):
    """Runs the engine off the UI thread: ~1-3 s for a small part on macOS (--jitless)."""

    def __init__(self, soups, values):
        super().__init__()
        self._soups = soups
        self._values = values   # per part: {options.json key: value}, checked by host_options

    def run(self):
        with LOCK:
            ctx = engine()
            self.setResult([host.host_compute(ctx, soup, host.host_options(ctx, values))
                            for soup, values in zip(self._soups, self._values)])


class SupportFins(QObject, Extension):
    def __init__(self, parent=None):
        QObject.__init__(self, parent)
        Extension.__init__(self)
        self.setMenuName(TITLE)
        self.addMenuItem("Add Support Fins", self.addToSelection)
        self.addMenuItem("Remove Support Fins", self.removeFromSelection)
        self.addMenuItem("Support Fins Settings…", self.showSettings)
        self._job = None
        self._pending = None
        self._progress = None
        self._dialog = None
        self._schema = None
        self._draft = {}
        self._rows = []
        self._visible = []
        self._error = ""
        self._watched = set()      # ids of parts whose transformationChanged we listen to
        self._stale = {}           # id(part) -> its "Fins are out of date" Message
        self.last_report = []
        CuraApplication.getInstance().getPreferences().addPreference(settings.PREF, "")
        from . import devrun
        devrun.hook(self)

    # -- the menu -------------------------------------------------------------------
    @pyqtSlot()
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
        app = CuraApplication.getInstance()
        layer = app.getGlobalContainerStack().getProperty("layer_height", "value")
        saved = settings.load(self.schema(), app.getPreferences().getValue(settings.PREF))
        soups, poses, values, notes = [], [], [], []
        for part in parts:
            md = part.getMeshData().getTransformed(part.getWorldTransformation())
            soups.append(frames.part_soup(md.getVertices(),
                                          md.getIndices() if md.hasIndices() else None))
            poses.append(part.getWorldTransformation().getData().copy())
            v, note = settings.engine_values(saved, self._material_type(part), layer)
            values.append(v)
            notes.append(note)
        self._progress = Message("Computing fins…", lifetime=0, dismissable=False,
                                 progress=-1, title=TITLE)
        self._progress.show()
        self._pending = (parts, poses, notes)
        self._job = FinsJob(soups, values)
        # A bound method, not a lambda: Uranium's Signal holds plain functions weakly.
        self._job.finished.connect(self._onJobFinished)
        self._job.start()

    def _onJobFinished(self, job):
        # emitted on the worker thread; the scene is only touched on the UI thread
        CuraApplication.getInstance().callLater(self._finished, job)

    def _finished(self, job):
        parts, poses, notes = self._pending
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
        for part, pose, note, (fins, stats) in zip(parts, poses, notes, job.getResult()):
            name = part.getName()
            if part.getParent() is None:
                continue                                  # deleted while computing
            if not (part.getWorldTransformation().getData() == pose).all():
                lines.append(f"{name}: moved while computing, run Add Support Fins again")
                continue
            for old in part.getChildren():
                if is_fins(old):
                    op.addOperation(RemoveSceneNodeOperation(old))
            self._clear_stale(part)
            if len(fins):
                node = self._fins_node(fins)
                node.support_fins_pose = settings.pose(pose)
                self._watch(part)
                # Add at the root in world space, then parent: SetParentOperation keeps
                # the world position, and Cura's drop-to-plate leaves children alone.
                op.addOperation(AddSceneNodeOperation(node, part.getParent()))
                op.addOperation(SetParentOperation(node, part))
            lines.append((f"{name}: " if len(parts) > 1 else "") + host.host_report(stats)
                         + f"; material {note}")
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

    def _material_type(self, part):
        """Cura's material type ("PLA", "PETG", ...) loaded for this part's extruder."""
        mgr = CuraApplication.getInstance().getExtruderManager()
        pos = part.callDecoration("getActiveExtruderPosition")
        stack = mgr.getExtruderStack(int(pos)) if pos is not None else None
        stack = stack or mgr.getActiveExtruderStack()
        return stack.material.getMetaDataEntry("material") if stack else None

    # -- stale fins ------------------------------------------------------------------
    def _watch(self, part):
        if id(part) not in self._watched:
            self._watched.add(id(part))
            part.transformationChanged.connect(self._onPartTransformed)

    def _onPartTransformed(self, node):
        # The part re-emits its children's changes too; only its own pose matters.
        fins = [c for c in node.getChildren() if is_fins(c)] if node is not None else []
        if not fins or id(node) in self._stale:
            return
        if not settings.is_stale(getattr(fins[0], "support_fins_pose", None),
                                 node.getWorldTransformation().getData()):
            return
        msg = Message(f"{node.getName()} was rotated or scaled, so its fins no longer fit it.",
                      title="Fins are out of date", lifetime=0)
        msg.addAction("update", "Update", "", "Compute the fins again for the new pose")
        msg.actionTriggered.connect(self._onStaleAction)
        msg.support_fins_part = node
        self._stale[id(node)] = msg
        msg.show()

    def _onStaleAction(self, msg, action):
        part = msg.support_fins_part
        msg.hide()
        self._stale.pop(id(part), None)
        if action == "update" and part.getParent() is not None and self._job is None:
            self.addTo([part])

    def _clear_stale(self, part):
        msg = self._stale.pop(id(part), None)
        if msg:
            msg.hide()

    # -- the settings dialog ---------------------------------------------------------
    def schema(self):
        if self._schema is None:
            with LOCK:
                self._schema = host.host_schema(engine())
        return self._schema

    def showSettings(self):
        app = CuraApplication.getInstance()
        self._draft = settings.load(self.schema(), app.getPreferences().getValue(settings.PREF))
        self._rows = settings.rows(self.schema(), self._draft, self._material_type_for_dialog())
        self._set_error("")
        self._update_visible()
        self.rowsChanged.emit()
        if self._dialog is None:
            self._dialog = app.createQmlComponent(os.path.join(HERE, "SettingsDialog.qml"), {"manager": self})
        if self._dialog is not None:
            self._dialog.show()

    def _material_type_for_dialog(self):
        parts = self._selected_parts()
        if parts:
            return self._material_type(parts[0])
        stack = CuraApplication.getInstance().getExtruderManager().getActiveExtruderStack()
        return stack.material.getMetaDataEntry("material") if stack else None

    rowsChanged = pyqtSignal()
    visibleChanged = pyqtSignal()
    errorChanged = pyqtSignal()

    @pyqtProperty("QVariantList", notify=rowsChanged)
    def rows(self):
        return self._rows

    @pyqtProperty("QStringList", notify=visibleChanged)
    def visible(self):
        return self._visible

    @pyqtProperty(str, notify=errorChanged)
    def error(self):
        return self._error

    @pyqtSlot(str, "QVariant")
    def setValue(self, key, shown):
        self._draft[key] = settings.from_dialog(self.schema(), key, shown)
        self._update_visible()

    @pyqtSlot(result=bool)
    def save(self):
        """Check the draft with the engine (same check as a run), then keep it."""
        app = CuraApplication.getInstance()
        layer = app.getGlobalContainerStack().getProperty("layer_height", "value")
        try:
            with LOCK:
                host.host_options(engine(), settings.engine_values(self._draft, None, layer)[0])
        except Exception as e:  # the engine names the bad setting
            self._set_error(f"Not saved: {e}")
            return False
        app.getPreferences().setValue(settings.PREF, settings.dump(self._draft))
        self._set_error("")
        return True

    def _update_visible(self):
        values = dict(self._draft)
        if values.get("material") == settings.MATCH_CURA:
            values.pop("material")   # not an engine value; visibility never depends on it
        with LOCK:
            ctx = engine()
            self._visible = [r["key"] for r in self._rows if host.host_visible(ctx, r["key"], values)]
        self.visibleChanged.emit()

    def _set_error(self, text):
        self._error = text
        self.errorChanged.emit()
