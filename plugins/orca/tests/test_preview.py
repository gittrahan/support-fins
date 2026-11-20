"""The preview panel (src/preview.py, #477), run as Orca runs it: the Script's async execute
on its own thread and event loop, the panel's messages on the calling ("UI") thread."""
import asyncio
import base64
import importlib.util
import pathlib
import sys
import threading
import time

import numpy as np
import pytest
import trimesh

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import fake_orca  # noqa: E402

ORCA = sys.modules.get("orca") or fake_orca.install()
BUILT = HERE.parent / "build" / "support_fins_orca.py"
MODELS = HERE.parents[2] / "prototype" / "stress" / "models"


def load():
    if not BUILT.exists():
        pytest.skip("run plugins/orca/build.py first")
    spec = importlib.util.spec_from_file_location("support_fins_orca_preview", BUILT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


SF = load()


def obj(name, model="torus.stl", matrix=None, config=None, oid=1):
    m = trimesh.load(MODELS / model)
    vol = fake_orca.FakeVolume(np.asarray(m.vertices), np.asarray(m.faces))
    return fake_orca.FakeModelObject([vol], oid=oid, name=name,
                                     instances=[fake_orca.FakeInstance(matrix)], config=config)


def rot_x(deg, shift=(0, 0, 0)):
    m = trimesh.transformations.rotation_matrix(np.radians(deg), [1, 0, 0])
    m[:3, 3] = shift
    return m


class Running:
    """execute() on a worker thread with its own loop, as Orca's Script runtime runs it."""

    def __init__(self, cap):
        self.cap, self.result = cap, None
        self.t = threading.Thread(target=lambda: setattr(self, "result", asyncio.run(cap.execute())), daemon=True)
        self.t.start()
        for _ in range(200):
            if cap._queue is not None:
                break
            time.sleep(0.01)
        self.panel = ORCA.panels[-1]

    def say(self, **msg):   # the page posting, delivered on the UI thread
        self.panel.on_message(msg)

    def wait_for(self, command, n=1, timeout=120):
        end = time.time() + timeout
        while time.time() < end:
            hits = [p for p in self.panel.posts if p["command"] == command]
            if len(hits) >= n:
                return hits[n - 1]
            time.sleep(0.02)
        raise AssertionError(f"no {command!r} post: {self.panel.posts}")

    def close(self):
        self.panel.close()
        self.t.join(30)
        assert not self.t.is_alive()


@pytest.fixture
def plate():
    ORCA.panels.clear()
    ORCA.plate = fake_orca.FakeModel([obj("torus"), obj("cube", "cube.stl", rot_x(30, (50, 0, 20)), oid=2)])
    ORCA.presets = fake_orca.FakePresetBundle()
    yield ORCA.plate


def test_the_preview_is_registered_with_the_slicer():
    ORCA.registered.clear()
    SF.SupportFinsPlugin().register_capabilities()
    assert ORCA.registered == [SF.SupportFinsSlicing, SF.SupportFinsPreview]
    assert SF.SupportFinsPreview().get_name() == "Preview fins"


def test_the_page_is_built_into_the_plugin():
    assert SF.PREVIEW_PAGE.startswith("<!--") and "var SFV" in SF.PREVIEW_PAGE
    assert "/*__SF_PREVIEW_JS__*/" not in SF.PREVIEW_PAGE


def test_open_list_preview_close(plate):
    run = Running(SF.SupportFinsPreview())
    assert run.panel.kw["dock"] == "right" and run.panel.html == SF.PREVIEW_PAGE
    run.say(command="ready")
    parts = run.wait_for("parts")["parts"]
    assert [p["name"] for p in parts] == ["torus", "cube"] and parts[1]["faces"] == 12
    run.say(command="preview", id=1)
    assert run.wait_for("busy")["id"] == 1
    res = run.wait_for("result")
    assert res["id"] == 1 and res["name"] == "cube" and res["skipped"] == ""
    assert res["report"].startswith("1 wall") or "wall" in res["report"]
    part = np.frombuffer(base64.b64decode(res["part"]), "<f4").reshape(-1, 3, 3)
    cls = np.frombuffer(base64.b64decode(res["cls"]), "u1")
    fins = np.frombuffer(base64.b64decode(res["fins"]), "<f4").reshape(-1, 3, 3)
    assert len(part) == 12 == len(cls) and cls.max() == 1 and len(fins) > 0
    # centred on its footprint, bottom on the plate, fins in the same frame
    lo, hi = part.reshape(-1, 3).min(0), part.reshape(-1, 3).max(0)
    assert abs(lo[0] + hi[0]) < 1e-3 and abs(lo[1] + hi[1]) < 1e-3 and abs(lo[2]) < 1e-3
    assert fins.reshape(-1, 3)[:, 2].min() > -1e-3
    run.close()
    assert run.result.status == ORCA.PluginResult.Success


def test_the_same_fins_as_the_slice(plate):
    """The panel builds what inject_fins builds for the same part on the plate."""
    run = Running(SF.SupportFinsPreview())
    run.say(command="preview", id=1)
    res = run.wait_for("result")
    run.close()
    po = fake_orca.FakePrintObject(trimesh.load(MODELS / "cube.stl"), rot_x(30, (50, 0, 20)))
    msg = SF.inject_fins(po, dict(SF._DEFAULTS), 0.2, 1e-6, {}, nozzle=0.4)
    assert res["report"] == msg


def test_bare_overhangs_come_with_the_tilt_hint(plate):
    run = Running(SF.SupportFinsPreview())
    run.say(command="preview", id=0)
    res = run.wait_for("result")
    run.close()
    assert "too shallow" in res["report"] and "(Lay on face, F)" in res["report"]


def test_a_part_left_to_orca_supports_says_so(plate):
    plate._o[1] = obj("cube", "cube.stl", rot_x(30), config={"enable_support": "1"}, oid=2)
    run = Running(SF.SupportFinsPreview())
    run.say(command="preview", id=1)
    res = run.wait_for("result")
    run.close()
    assert "Orca supports are on" in res["skipped"]


def test_a_gone_part_is_an_error_not_a_crash(plate):
    run = Running(SF.SupportFinsPreview())
    run.say(command="preview", id=7)
    err = run.wait_for("error")
    assert "no longer on the plate" in err["error"]
    run.say(command="preview", id=1)   # and the panel still works
    run.wait_for("result")
    run.close()


def test_a_second_run_shows_the_open_panel(plate):
    cap = SF.SupportFinsPreview()
    run = Running(cap)
    run.panel.hide()
    again = asyncio.run(cap.execute())
    assert run.panel.shown and "already open" in again.message and len(ORCA.panels) == 1
    run.close()


def test_the_panel_uses_the_slicers_settings(plate):
    slicer = SF.SupportFinsSlicing()
    slicer._config = '{"mode": "full", "padStyle": "off"}'
    try:
        run = Running(SF.SupportFinsPreview())
        run.say(command="preview", id=1)
        res = run.wait_for("result")
        run.close()
    finally:
        SF._SLICING.clear()
    po = fake_orca.FakePrintObject(trimesh.load(MODELS / "cube.stl"), rot_x(30, (50, 0, 20)))
    assert res["report"] == SF.inject_fins(po, {**SF._DEFAULTS, "mode": "full", "padStyle": "off"},
                                           0.2, 1e-6, {}, nozzle=0.4)


def test_a_huge_part_draws_only_what_matters(plate, monkeypatch):
    monkeypatch.setattr(SF, "PREVIEW_DRAW_MAX", 10)
    run = Running(SF.SupportFinsPreview())
    run.say(command="preview", id=1)
    res = run.wait_for("result")
    run.close()
    cls = np.frombuffer(base64.b64decode(res["cls"]), "u1")
    assert res["partial"] and len(cls) and cls.min() >= 1 and res["faces"] == 12
