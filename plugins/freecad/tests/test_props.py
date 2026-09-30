"""The FreeCAD add-on's settings, without FreeCAD: options.json -> properties -> the
engine's dialog values. (The real FreeCAD run is smoke.py, local only.)

    python3 -m pytest -q plugins/freecad/tests/test_props.py

Pinned:
  - every options.json option becomes exactly one property, with a readable unique
    name, in a "Support Fins: <section>" group; bounded numbers carry the engine's
    range so the editor can't hold a value the engine refuses;
  - the properties' defaults ARE the site's defaults: read straight back, they give
    options.json's defaults in the engine's units (no control the math ignores, and
    none that starts somewhere the site doesn't);
  - a percent property goes to the engine / 100, a choice by its value, a Quantity by
    its .Value.
"""
import json
import pathlib
import sys

import pytest

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "SupportFins"))
import supportfins_props as props  # noqa: E402

SCHEMA = json.loads((HERE.parents[1] / "shared" / "engine" / "options.json").read_text(encoding="utf-8"))
SPECS = props.specs(SCHEMA)
BY_KEY = {o["key"]: o for o in SCHEMA["options"]}


class Quantity:
    """What FreeCAD hands back for a Length or Angle property."""

    def __init__(self, v):
        self.Value = v


def test_every_option_is_one_property():
    assert [s["key"] for s in SPECS] == [o["key"] for o in SCHEMA["options"]]
    assert len({s["name"] for s in SPECS}) == len(SPECS)
    for s in SPECS:
        assert s["name"].isidentifier() and s["name"][0].isupper(), s["name"]
        assert s["group"].startswith("Support Fins: "), s["group"]


@pytest.mark.parametrize("key,name,kind", [
    ("material", "Material", "App::PropertyEnumeration"),
    ("threshold", "Overhang", "App::PropertyFloatConstraint"),
    ("tines", "Tines", "App::PropertyBool"),
    ("tineDensity", "TineGrip", "App::PropertyPercent"),
    ("layerHeight", "LayerHeight", "App::PropertyLength"),
    ("padStyle", "BedPad", "App::PropertyEnumeration"),
    ("sway.on", "SwayBraces", "App::PropertyBool"),
    ("sway.gripFrom", "BraceGripFrom", "App::PropertyFloatConstraint"),
    ("coverage", "WideFaceCoverage", "App::PropertyPercent"),
])
def test_names_and_types(key, name, kind):
    s = next(s for s in SPECS if s["key"] == key)
    assert (s["name"], s["type"]) == (name, kind)


def test_defaults_read_back_as_the_sites_defaults():
    # what a fresh fins object holds, as FreeCAD would hand it back
    def read(name):
        s = next(s for s in SPECS if s["name"] == name)
        v = s["default"]
        if s["type"] == "App::PropertyLength":
            return Quantity(float(v))
        return v[0] if s["type"] == "App::PropertyFloatConstraint" else v
    values = props.dialog_values(SCHEMA, read)
    for key, v in values.items():
        assert v == pytest.approx(BY_KEY[key]["default"]) if isinstance(v, float) else v == BY_KEY[key]["default"], key


def test_units_on_the_way_to_the_engine():
    set_to = {"Material": "PETG", "Overhang": 50.0, "Tines": False, "TineGrip": 35,
              "LayerHeight": Quantity(0.16), "BedPad": "Sure hold", "SwayBraces": True,
              "BraceGripFrom": 12.0, "BraceTineSpacing": 8.0, "BraceDepth": 20,
              "Cutouts": "Lattice", "WideFaceCoverage": 100}
    values = props.dialog_values(SCHEMA, lambda n: set_to[n])
    assert values == {"material": "petg", "threshold": 50.0, "tines": False, "tineDensity": 0.35,
                      "layerHeight": 0.16, "padStyle": "sure", "sway.on": True, "sway.gripFrom": 12.0,
                      "sway.tineSpacing": 8.0, "sway.reach": 0.2, "cutout": "lattice", "coverage": 1.0}


def test_bounded_numbers_carry_the_engines_range():
    # the editor can't hold a value optionsFromDialog would refuse
    for s in SPECS:
        o = BY_KEY[s["key"]]
        if s["type"] == "App::PropertyFloatConstraint":
            assert s["default"] == (o["default"], o["min"], o["max"], o["step"]), s["key"]
        if o["type"] == "number" and not o.get("percent") and not o.get("hostSupplied"):
            assert s["type"] == "App::PropertyFloatConstraint", s["key"]
    assert next(s for s in SPECS if s["key"] == "threshold")["tooltip"].endswith("(°)")
    assert next(s for s in SPECS if s["key"] == "layerHeight")["type"] == "App::PropertyLength"


def test_choice_labels_come_from_the_schema():
    pad = next(s for s in SPECS if s["key"] == "padStyle")
    assert pad["labels"] == [c["label"] for c in BY_KEY["padStyle"]["choices"]]
    assert pad["default"] == "Auto"


def test_a_label_clash_is_refused():
    bad = json.loads(json.dumps(SCHEMA))
    bad["options"].append(dict(bad["options"][0], key="other"))
    with pytest.raises(ValueError, match="duplicate property names"):
        props.specs(bad)
