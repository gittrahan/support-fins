"""The Blender add-on's settings, without Blender: options.json ->
properties -> the engine's dialog values. (The real Blender run is blender_smoke.py.)

    python3 -m pytest -q plugins/blender/tests/

Pinned:
  - every options.json option becomes exactly one property, named after its key;
    bounded numbers carry the engine's range, so the panel can't hold a value the
    engine refuses; layer height (host-supplied) only a soft one;
  - the properties' defaults ARE the site's defaults, read straight back in the
    engine's units -- and the engine itself accepts them (host_options);
  - a percent property shows 0-100 and goes to the engine / 100.
"""
import json
import pathlib
import sys

import pytest

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "support_fins"))
import schema  # noqa: E402

SCHEMA = json.loads((HERE.parents[1] / "shared" / "engine" / "options.json").read_text(encoding="utf-8"))
SPECS = schema.specs(SCHEMA)
BY_KEY = {o["key"]: o for o in SCHEMA["options"]}


def test_every_option_is_one_property():
    assert [s["key"] for s in SPECS] == [o["key"] for o in SCHEMA["options"]]
    assert len({s["name"] for s in SPECS}) == len(SPECS)
    assert all(s["name"].isidentifier() for s in SPECS)
    assert next(s for s in SPECS if s["key"] == "sway.on")["name"] == "sway_on"
    assert [t for t, _ in schema.sections(SCHEMA)] == [s["label"] for s in SCHEMA["sections"]]


def test_defaults_read_back_as_the_sites_defaults():
    by_name = {s["name"]: s for s in SPECS}
    values = schema.dialog_values(SCHEMA, lambda name: by_name[name]["default"])
    for key, v in values.items():
        want = BY_KEY[key]["default"]
        assert v == pytest.approx(want) if isinstance(v, float) else v == want, key


def test_units_on_the_way_to_the_engine():
    set_to = {"material": "petg", "threshold": 50.0, "tines": False, "tineDensity": 35.0,
              "layerHeight": 0.16, "padStyle": "sure", "sway_on": True, "sway_gripFrom": 12.0,
              "sway_tineSpacing": 8.0, "sway_reach": 20.0, "cutout": "lattice", "coverage": 100.0}
    values = schema.dialog_values(SCHEMA, lambda n: set_to[n])
    assert values == pytest.approx({"material": "petg", "threshold": 50.0, "tines": False, "tineDensity": 0.35,
                                    "layerHeight": 0.16, "padStyle": "sure", "sway.on": True,
                                    "sway.gripFrom": 12.0, "sway.tineSpacing": 8.0, "sway.reach": 0.2,
                                    "cutout": "lattice", "coverage": 1.0})


def test_ranges_are_the_engines():
    for s in SPECS:
        o = BY_KEY[s["key"]]
        if s["kind"] != "float":
            continue
        scale = 100 if o.get("percent") else 1
        assert s["percent"] == bool(o.get("percent"))
        if o.get("hostSupplied"):
            assert (s["soft_min"], s["soft_max"]) == (o["min"] * scale, o["max"] * scale) and "max" not in s
        else:
            assert (s["min"], s["max"]) == pytest.approx((o["min"] * scale, o["max"] * scale)), s["key"]
        assert 1 <= s["step"] <= 100
    assert next(s for s in SPECS if s["key"] == "threshold")["label"] == "Overhang (°)"
    assert next(s for s in SPECS if s["key"] == "padStyle")["items"][1] == ("auto", "Auto", "")


@pytest.fixture(scope="module")
def engine(tmp_path_factory):
    pytest.importorskip("py_mini_racer", reason="needs mini-racer==0.14.1")
    sys.path.insert(0, str(HERE.parents[1] / "shared" / "py"))
    sys.path.insert(0, str(HERE.parents[1] / "shared"))
    import supportfins_host as host
    from bundle import bundle_engine
    js = bundle_engine(tmp_path_factory.mktemp("engine") / "fins_engine.js")
    return host, host.host_engine(js)


def test_the_engine_takes_what_the_panel_sends(engine):
    host, ctx = engine
    by_name = {s["name"]: s for s in SPECS}
    defaults = host.host_options(ctx, schema.dialog_values(SCHEMA, lambda n: by_name[n]["default"]))
    assert defaults["material"] == "pla" and "sway" not in defaults      # sway off: not sent
    tops = {s["name"]: s.get("max", s.get("soft_max")) if s["kind"] == "float" else s["default"] for s in SPECS}
    tops["sway_on"] = True
    opts = host.host_options(ctx, schema.dialog_values(SCHEMA, lambda n: tops[n]))
    assert opts["coverage"] == 1.0 and opts["sway"]["reach"] == 0.5     # 100 % and 50 % arrive / 100


def test_a_key_clash_is_refused():
    bad = json.loads(json.dumps(SCHEMA))
    bad["options"].append(dict(bad["options"][6], key="sway_on"))
    with pytest.raises(ValueError, match="duplicate property names"):
        schema.specs(bad)

