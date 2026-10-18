"""The Rhino plugin's settings and mesh welding, without Rhino: options.json -> dialog
controls -> the engine's dialog values. (The real Rhino run is rhino_smoke.py.)

    python3 -m pytest -q plugins/rhino/tests/

Pinned:
  - every options.json option becomes exactly one control, in its section; bounded
    numbers carry the engine's range; layer height (host-supplied) any positive value;
  - the controls' defaults ARE the site's defaults, read back in the engine's units --
    and the engine itself accepts them (host_options);
  - a percent control shows 0-100 and goes to the engine / 100;
  - settings saved in a document come back; a stale, retired or broken entry falls
    back to the defaults instead of failing;
  - the weld merges identical vertices only and drops collapsed triangles.
"""
import json
import pathlib
import sys

import numpy as np
import pytest

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "SupportFins" / "lib"))
import supportfins_rhino_core as core  # noqa: E402

SHARED = HERE.parents[1] / "shared"
SCHEMA = json.loads((SHARED / "engine" / "options.json").read_text(encoding="utf-8"))
SPECS = core.specs(SCHEMA)
BY_KEY = {o["key"]: o for o in SCHEMA["options"]}


def test_every_option_is_one_control():
    assert [s["key"] for s in SPECS] == [o["key"] for o in SCHEMA["options"]]
    assert [t for t, _ in core.sections(SCHEMA)] == [s["label"] for s in SCHEMA["sections"]]
    assert sum(len(specs) for _, specs in core.sections(SCHEMA)) == len(SPECS)


def test_ranges():
    for s in SPECS:
        o = BY_KEY[s["key"]]
        if s["kind"] != "number":
            continue
        scale = 100 if o.get("percent") else 1
        if o.get("hostSupplied"):
            assert s["min"] > 0 and s["max"] > o["max"]
        else:
            assert (s["min"], s["max"]) == pytest.approx((o["min"] * scale, o["max"] * scale))
        assert s["min"] <= s["default"] <= s["max"]
        assert round(s["step"], s["decimals"]) == pytest.approx(s["step"])


def test_defaults_read_back_as_the_sites_defaults():
    values = core.dialog_values(SCHEMA, core.defaults(SCHEMA))
    for key, v in values.items():
        want = BY_KEY[key]["default"]
        assert v == pytest.approx(want) if isinstance(v, float) else v == want, key


def test_units_on_the_way_to_the_engine():
    set_to = {"gap": 0.3, "tineDensity": 35.0, "sway.reach": 20.0, "coverage": 100.0,
              "padStyle": "sure", "tines": False}
    values = core.dialog_values(SCHEMA, set_to)
    assert values["gap"] == 0.3 and values["tineDensity"] == 0.35
    assert values["sway.reach"] == 0.2 and values["coverage"] == 1.0
    assert values["padStyle"] == "sure" and values["tines"] is False
    assert values["threshold"] == 45.0          # not set: the default


def test_saved_settings_round_trip():
    want = core.defaults(SCHEMA)
    want.update({"gap": 0.3, "cutout": "lattice", "sway.on": True, "tineDensity": 40.0})
    assert core.load_values(SCHEMA, core.dump_values(want)) == want


@pytest.mark.parametrize("text", [None, "", "not json", "[1, 2]", '{"gap": "wide"}',
                                  '{"gap": 9}', '{"cutout": "star"}', '{"tines": 1}',
                                  '{"Material": "PETG"}'])
def test_bad_saved_settings_fall_back_to_defaults(text):
    assert core.load_values(SCHEMA, text) == core.defaults(SCHEMA)


@pytest.fixture(scope="module")
def engine(tmp_path_factory):
    pytest.importorskip("py_mini_racer", reason="needs mini-racer==0.14.1")
    sys.path.insert(0, str(SHARED / "py"))
    sys.path.insert(0, str(SHARED))
    import supportfins_host as host
    from bundle import bundle_engine
    js = bundle_engine(tmp_path_factory.mktemp("engine") / "fins_engine.js")
    return host, host.host_engine(js)


def test_the_engine_takes_what_the_dialog_sends(engine):
    host, ctx = engine
    defaults = host.host_options(ctx, core.dialog_values(SCHEMA, core.defaults(SCHEMA)))
    assert defaults["gap"] == 0.2 and "sway" not in defaults      # sway off: not sent
    # every bounded number at the top of its control's range is still in the engine's
    tops = {s["key"]: s["max"] for s in SPECS if s["kind"] == "number" and s["max"] < 1e6}
    tops["sway.on"] = True
    opts = host.host_options(ctx, core.dialog_values(SCHEMA, tops))
    assert opts["coverage"] == 1.0 and opts["sway"]["reach"] == 0.5     # 100 % and 50 % arrive / 100
    assert opts["gap"] == 0.4


def test_weld_merges_identical_vertices_only():
    a, b, c, d = [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]
    near = [1, 1e-9, 0]                                   # not b: a gap stays a gap
    tris = np.array([[a, b, c], [b, d, c], [near, d, b], [a, a, c]], dtype=np.float64)
    verts, faces = core.weld(tris)
    assert len(verts) == 5
    assert len(faces) == 3                                # the collapsed [a, a, c] is gone
    np.testing.assert_array_equal(verts[faces], tris[:3])


def test_piece_names():
    assert core.piece_name("Bracket", {"id": 3, "kind": "prop"}) == "Bracket wall 3"
    assert core.piece_name("Bracket", {"id": 9, "kind": "pad"}) == "Bracket bed pad"
    assert core.piece_name("Bracket", {"id": 4, "kind": "newkind"}) == "Bracket newkind 4"
