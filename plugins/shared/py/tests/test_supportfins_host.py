"""Tests for the shared Python host (plugins/shared/py/supportfins_host.py).

    pip install pytest numpy mini-racer==0.14.1
    python3 -m pytest -q plugins/shared/py/tests/

Needs esbuild for the bundle (plugins/shared/bundle.py fetches it with npx).
"""
import json
import math
import os
import pathlib
import subprocess
import sys

import numpy as np
import pytest

HERE = pathlib.Path(__file__).resolve().parent
PY = HERE.parent
ROOT = PY.parent.parent.parent
sys.path.insert(0, str(PY))
sys.path.insert(0, str(PY.parent))
from bundle import bundle_engine  # noqa: E402
import supportfins_host as host  # noqa: E402


@pytest.fixture(scope="session")
def bundle_path(tmp_path_factory):
    path = tmp_path_factory.mktemp("engine") / "fins_engine.js"
    bundle_engine(path)
    return path


@pytest.fixture(scope="session")
def ctx(bundle_path):
    return host.host_engine(bundle_path.read_text(encoding="utf-8"))


def lbracket_35():
    """lbracket.stl tilted 35 deg about X, the plugins' reference part."""
    data = (ROOT / "prototype" / "stress" / "models" / "lbracket.stl").read_bytes()
    n = int(np.frombuffer(data, dtype="<u4", count=1, offset=80)[0])
    rec = np.frombuffer(data, dtype=np.dtype([("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")]),
                        count=n, offset=84)
    v = rec["v"].astype(np.float64)
    c, s = math.cos(math.radians(35)), math.sin(math.radians(35))
    y, z = v[..., 1].copy(), v[..., 2].copy()
    v[..., 1], v[..., 2] = y * c - z * s, y * s + z * c
    return v


def test_same_fins_as_the_site(ctx):
    # the counts the website and node give lbracket @35 X at 0.2 mm (015 spike, Node ref)
    fins, stats = host.host_compute(ctx, lbracket_35(), {"layerHeight": 0.2})
    assert stats["braces"] == 4 and stats["tines"] == 20
    assert fins.shape == (stats["finTriangles"] + stats["padTriangles"], 3, 3)
    assert fins.dtype == np.float64


def test_fins_come_back_in_the_callers_frame(ctx):
    soup = lbracket_35()
    fins0, stats0 = host.host_compute(ctx, soup, {"layerHeight": 0.2})
    shift = np.array([137.25, -42.5, 5.0])      # parked somewhere on a plate, lifted
    fins1, stats1 = host.host_compute(ctx, soup + shift, {"layerHeight": 0.2})
    assert stats1 == stats0
    # the engine returns float32; a shift of this size moves points by < 1e-4 mm
    assert np.abs((fins1 - shift) - fins0).max() < 1e-4
    # the pad sits where the part meets the bed
    assert abs(fins1[..., 2].min() - (soup[..., 2].min() + shift[2])) < 1e-4


def test_pieces_split_the_fins_one_object_each(ctx):
    soup = lbracket_35()
    fins, stats = host.host_compute(ctx, soup, {"layerHeight": 0.2})
    fins2, stats2, pieces, over, small = host.host_compute_pieces(ctx, soup, {"layerHeight": 0.2})
    assert stats2 == stats and np.array_equal(fins2, fins)
    seen = np.zeros(len(fins), dtype=int)
    for p in pieces:
        for a, b in p["ranges"]:
            seen[a:b] += 1
    assert (seen == 1).all()
    assert sum(p["kind"] == "prop" for p in pieces) == stats["braces"] + stats["props"]
    assert [p["kind"] for p in pieces].count("pad") == 1
    # the engine's red faces, as indices into the caller's soup
    assert over.dtype == np.int64 and len(over) > 0 and over.max() < len(soup)
    t = soup[over]
    normals = np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0])
    assert (normals[:, 2] < 0).all()   # overhangs face down
    assert small.dtype == np.int64 and not set(small) & set(over)


def tilted_block():
    """tests/draw.test.js's part: a 40x60x12 block tilted 45 deg about X, min z = 0."""
    v = np.array([[x, y, z] for x in (-20, 20) for y in (-30, 30) for z in (-6, 6)], dtype=np.float64)
    quads = [(0, 2, 6, 4), (1, 5, 7, 3), (0, 4, 5, 1), (2, 3, 7, 6), (0, 1, 3, 2), (4, 6, 7, 5)]
    tris = np.array([[v[a], v[b], v[c]] for q in quads for a, b, c in ((q[0], q[1], q[2]), (q[0], q[2], q[3]))])
    c = s = math.sqrt(0.5)
    y, z = tris[..., 1].copy(), tris[..., 2].copy()
    tris[..., 1], tris[..., 2] = y * c - z * s, y * s + z * c
    tris[..., 2] -= tris[..., 2].min()
    return tris


def test_draw_wall_lands_under_the_line_anywhere_on_the_plate(ctx):
    soup = tilted_block()
    a, b = (-8.0, -5.0, 11.97), (8.0, -5.0, 11.97)   # under the underside, ~12 mm up
    wall, stats = host.host_draw_wall(ctx, soup, a, b, {})
    assert wall is not None, stats
    assert stats["tines"] > 0 and wall.dtype == np.float64
    # stands on the bed, under the drawn line, between its ends
    assert abs(wall[..., 2].min()) < 1e-4
    assert -8.5 < wall[..., 0].min() and wall[..., 0].max() < 8.5
    shift = np.array([137.25, -42.5, 5.0])
    moved, stats1 = host.host_draw_wall(ctx, soup + shift, np.add(a, shift), np.add(b, shift), {})
    assert stats1 == stats and np.abs((moved - shift) - wall).max() < 1e-4


def test_draw_wall_says_why_not(ctx):
    wall, reason = host.host_draw_wall(ctx, tilted_block(), (-8, -5, 11.97), (-6, -5, 11.97), {})
    assert wall is None and "too short" in reason
    with pytest.raises(ValueError, match="finite"):
        host.host_draw_wall(ctx, tilted_block(), (-8, -5, float("nan")), (8, -5, 11.97), {})


def test_options_reach_the_engine(ctx):
    _, on = host.host_compute(ctx, lbracket_35(), {"layerHeight": 0.2})
    _, off = host.host_compute(ctx, lbracket_35(), {"layerHeight": 0.2, "bedPad": False, "tines": False})
    assert on["padTriangles"] > 0 and off["padTriangles"] == 0
    assert off["tines"] == 0


def test_dialog_values_go_through_the_engine(ctx):
    schema = host.host_schema(ctx)
    assert any(o["key"] == "padStyle" for o in schema["options"])
    opts = host.host_options(ctx, {"material": "petg", "sway.on": "true", "sway.reach": 0.2,
                                   "tines": "False", "layerHeight": None})
    assert opts == {"material": "petg", "tines": False, "sway": {"on": True, "reach": 0.2}}
    with pytest.raises(Exception, match="coverage"):
        host.host_options(ctx, {"coverage": 50})   # forgot the /100: refused, not clamped
    assert host.host_visible(ctx, "tineDensity", {}) is True
    assert host.host_visible(ctx, "tineDensity", {"tines": False}) is False
    fins, stats = host.host_compute(ctx, lbracket_35(), {**host.host_options(ctx, {"material": "petg"}),
                                                          "layerHeight": 0.2})
    assert stats["braces"] == 4


def test_vendor_dir_under_a_pyinstaller_app(bundle_path):
    """Cura is a PyInstaller app: mini-racer then looks in sys._MEIPASS. host_engine
    must find the vendored copy anyway and give the app its _MEIPASS back."""
    import py_mini_racer
    vendor = pathlib.Path(py_mini_racer.__file__).resolve().parent.parent
    code = f"""
import sys, json
sys._MEIPASS = "/nonexistent/app/bundle"
sys.path.insert(0, {str(PY)!r})
import supportfins_host as host
ctx = host.host_engine(open({str(bundle_path)!r}).read(), vendor_dir={str(vendor)!r})
print(json.dumps([sys._MEIPASS, ctx.eval("typeof SupportFinsEngine.computeFinsB64")]))
"""
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr
    assert json.loads(out.stdout.strip().splitlines()[-1]) == ["/nonexistent/app/bundle", "function"]


def test_report_says_what_was_not_reached():
    assert host.host_report({"braces": 1, "tines": 1}) == "1 wall, 1 tine"
    line = host.host_report({"braces": 3, "tines": 12, "unserved": 2, "floating": 1, "floatingDrop": 4.25})
    assert line.startswith("3 walls, 12 tines; 2 overhangs are too shallow for a fin this way up")
    assert "one piece isn't joined to the rest: it starts 4.2 mm up, held only by supports" in line
    assert "the first starts 1.0 mm up" in host.host_report({"floating": 2, "floatingDrop": 1})
    # sway braces hold the tall sides, not an overhang: named apart, never added to the walls
    assert host.host_report({"braces": 1, "tines": 1, "swayBraces": 4}) == "1 wall, 1 tine, 4 sway braces"
    assert host.host_report({"braces": 2, "swayBraces": 1}) == "2 walls, 0 tines, 1 sway brace"
