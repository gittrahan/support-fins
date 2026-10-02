"""Developer smoke test in the real Cura. Inert unless dev_autorun.json sits next to
this file:

    {"rotate_x": 35, "slice": true,
     "settings": {"material": "petg", "tines": "false"}, "dialog": true, "stale": true}

Then every model opened (e.g. `open -a "UltiMaker Cura" part.stl`) is tilted, gets
fins, and is put through re-run / undo / remove / undo; each step goes to
dev_log.jsonl, and with "slice" the sliced G-code to dev_plate<N>.gcode. Optional:
"settings" is saved as the dialog would save it before the first run; "dialog" opens
the settings dialog and logs what it shows; "stale" rotates the part after the last
run and presses Update on the "out of date" message. Used to check the plugin end to
end without clicking (plugins/cura/README.md, "Developing").
"""
import json
import math
import os
import time

from PyQt6.QtCore import QTimer

from cura.CuraApplication import CuraApplication
from UM.Math.Quaternion import Quaternion
from UM.Math.Vector import Vector
from UM.Scene.SceneNode import SceneNode

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG = os.path.join(HERE, "dev_autorun.json")
LOG = os.path.join(HERE, "dev_log.jsonl")


def hook(ext):
    if os.path.exists(CONFIG):
        with open(CONFIG) as f:
            _Run(ext, json.load(f))


def log(**kw):
    kw["t"] = time.strftime("%H:%M:%S")
    with open(LOG, "a") as f:
        f.write(json.dumps(kw, default=str) + "\n")


class _Run:
    _alive = []   # keep the runner alive: Uranium's signals hold slots weakly

    def __init__(self, ext, cfg):
        self.ext, self.cfg = ext, cfg
        self._alive.append(self)
        CuraApplication.getInstance().fileCompleted.connect(self.on_file)
        log(step="dev_autorun", cfg=cfg)

    def on_file(self, name):
        QTimer.singleShot(1500, self.start)

    def start(self):
        app = CuraApplication.getInstance()
        root = app.getController().getScene().getRoot()
        self.part = [n for n in root.getChildren() if n.callDecoration("isSliceable")][-1]
        rx = float(self.cfg.get("rotate_x", 0))
        if rx:
            self.part.rotate(Quaternion.fromAngleAxis(math.radians(rx), Vector.Unit_X),
                             SceneNode.TransformSpace.World)
        if "settings" in self.cfg:
            from . import settings
            app.getPreferences().setValue(settings.PREF, settings.dump(self.cfg["settings"]))
            log(step="settings saved", settings=self.cfg["settings"])
        self.steps = [self.add_unselected, self.readd, self.undo, self.remove, self.undo, self.slice]
        if self.cfg.get("dialog"):
            self.steps.insert(0, self.dialog)
        if self.cfg.get("stale"):
            self.steps += [self.rotate, self.update]
        QTimer.singleShot(1500, self.next)

    def fins(self):
        return [c for c in self.part.getChildren() if c.getName() == "Support Fins"]

    def next(self):
        if self.ext._job is not None:           # wait for the engine
            QTimer.singleShot(300, self.next)
            return
        if self.steps:
            self.steps.pop(0)()
            QTimer.singleShot(800, self.next)

    def report(self, step):
        f = self.fins()
        b = f[0].getBoundingBox() if f else None
        log(step=step, fins_children=len(f),
            extruders=[self.part.callDecoration("getActiveExtruderPosition"),
                       f[0].callDecoration("getActiveExtruderPosition") if f else None],
            fins_bbox=[round(v, 3) for v in (b.left, b.bottom, b.back, b.right, b.top, b.front)] if b else None,
            fins_triangles=(f[0].getMeshData().getFaceCount() if f else 0),
            report=self.ext.last_report)

    def add(self):
        t = time.time()
        self.ext.addTo([self.part])
        self.t0 = t
        self.steps.insert(0, lambda: self.report("added (%.1f s)" % (time.time() - self.t0)))

    def add_unselected(self):
        """Add with NOTHING selected: the menu's path, which fins every part on the plate."""
        from UM.Scene.Selection import Selection
        Selection.clear()
        self.t0 = time.time()
        self.ext.addToSelection()
        self.steps.insert(0, lambda: self.report("added, nothing selected (%.1f s)" % (time.time() - self.t0)))

    def readd(self):
        self.ext.addTo([self.part])
        self.steps.insert(0, lambda: self.report("re-added: still one fins object"))

    def undo(self):
        CuraApplication.getInstance().getOperationStack().undo()
        self.report("after undo")

    def remove(self):
        from UM.Scene.Selection import Selection
        Selection.clear()
        Selection.add(self.part)
        self.ext.removeFromSelection()
        self.report("after remove")

    def slice(self):
        if not self.cfg.get("slice"):
            return
        backend = CuraApplication.getInstance().getBackend()
        backend.backendDone.connect(self.dump)
        backend.forceSlice()

    def dump(self):
        scene = CuraApplication.getInstance().getController().getScene()
        for plate, chunks in getattr(scene, "gcode_dict", {}).items():
            path = os.path.join(HERE, "dev_plate%s.gcode" % plate)
            with open(path, "w") as f:
                f.write("".join(chunks))
            text = "".join(chunks)
            log(step="sliced", path=path, fins_layers=text.count(";MESH:Support Fins"))

    def dialog(self):
        self.ext.showSettings()
        d = self.ext._dialog
        log(step="dialog", opened=d is not None and d.isVisible(),
            rows=[(r["key"], r.get("value", r.get("index"))) for r in self.ext.rows],
            visible=list(self.ext.visible))
        if d is not None:
            QTimer.singleShot(700, lambda: d.grabWindow().save(os.path.join(HERE, "dev_dialog.png")))
        QTimer.singleShot(900, self.dialog_edits)
        self.steps.insert(0, lambda: None)      # give the screenshot + edits time

    def dialog_edits(self):
        self.ext.setValue("tines", False)
        log(step="dialog: tines off", visible=list(self.ext.visible))
        self.ext.setValue("sway.reach", "70")        # a percent field typed out of range
        log(step="dialog: brace depth 70", saved=self.ext.save(), error=self.ext.error)
        self.ext.setValue("sway.reach", "15")
        self.ext.setValue("sway.tineSpacing", "7,5")   # a decimal comma
        from . import settings
        saved = self.ext.save()
        stored = settings.load(self.ext.schema(), CuraApplication.getInstance().getPreferences().getValue(settings.PREF))
        log(step="dialog: tine spacing 7,5", saved=saved, stored=stored.get("sway.tineSpacing"))
        if self.ext._dialog is not None:
            self.ext._dialog.close()

    def stale(self):
        m = getattr(self.part, "support_fins_stale", None)
        return m is not None and m.visible

    def rotate(self):
        # a turn about Cura's vertical (Y): the fins still fit, no prompt
        self.part.rotate(Quaternion.fromAngleAxis(math.radians(30), Vector.Unit_Y),
                         SceneNode.TransformSpace.World)
        log(step="turned 30 deg on the plate", stale=self.stale())
        # a tilt about a horizontal axis: prompt; closed with X, a further tilt prompts again
        self.part.rotate(Quaternion.fromAngleAxis(math.radians(10), Vector.Unit_Z),
                         SceneNode.TransformSpace.World)
        log(step="tilted 10 deg", stale=self.stale())
        self.part.support_fins_stale.hide(send_signal=False)       # what the X does
        self.part.rotate(Quaternion.fromAngleAxis(math.radians(5), Vector.Unit_Z),
                         SceneNode.TransformSpace.World)
        self.report("closed with X, tilted 5 more: stale=%s" % self.stale())

    def update(self):
        msg = getattr(self.part, "support_fins_stale", None)
        if msg is None:
            log(step="update: no stale message to press")
            return
        self.ext._onStaleAction(msg, "update")
        self.steps.insert(0, lambda: self.report("updated: stale=%s" % self.stale()))
