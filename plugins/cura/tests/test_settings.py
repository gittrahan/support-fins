"""The Cura settings layer (SupportFins/settings.py): what the dialog shows, what the
engine gets, and when fins go stale. No Cura needed.

    python3 plugins/cura/build.py && python3 -m pytest -q plugins/cura/tests/
"""
import json
import math

import numpy as np
import pytest

from test_plugin import BUILT, HERE, ROOT, frames, lbracket, load, rot_x

settings = load("sf_settings", HERE.parent / "SupportFins" / "settings.py")
SCHEMA = json.loads((ROOT / "plugins" / "shared" / "engine" / "options.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def host():
    if not (BUILT / "fins_engine.js").exists():
        pytest.skip("run plugins/cura/build.py first")
    mod = load("sf_host_settings", BUILT / "supportfins_host.py")
    return mod, mod.host_engine((BUILT / "fins_engine.js").read_text(encoding="utf-8"))


def test_first_run_is_the_sites_defaults_with_curas_material():
    values = settings.load(SCHEMA, "")
    assert values["material"] == settings.MATCH_CURA
    assert values["coverage"] == 0.5 and values["tines"] is True and values["padStyle"] == "auto"
    assert "layerHeight" not in values          # Cura's profile supplies it, never asked


def test_a_broken_or_old_preference_falls_back_to_defaults():
    assert settings.load(SCHEMA, "{not json") == settings.load(SCHEMA, "")
    assert settings.load(SCHEMA, "[1, 2]") == settings.load(SCHEMA, "")
    kept = settings.load(SCHEMA, json.dumps({"coverage": 0.8, "retired_option": 1}))
    assert kept["coverage"] == 0.8 and "retired_option" not in kept
    # strings as a settings file hands them back; nonsense is the default, not a guess
    odd = settings.load(SCHEMA, json.dumps({"tines": "false", "coverage": "0.25", "threshold": 400,
                                            "cutout": "stars", "material": "petg"}))
    assert odd["tines"] is False and odd["coverage"] == 0.25 and odd["threshold"] == 45
    assert odd["cutout"] == "none" and odd["material"] == "petg"
    rows = {r["key"]: r for r in settings.rows(SCHEMA, odd, "PLA")}
    assert rows["tines"]["value"] is False                  # the dialog shows it off
    assert settings.load(SCHEMA, settings.dump(kept)) == kept


@pytest.mark.parametrize("cura, material, says", [
    ("PLA", "pla", "PLA (Cura has PLA)"),
    ("Tough PLA", "pla", "PLA (Cura has Tough PLA)"),
    ("PETG", "petg", "PETG (Cura has PETG)"),
    ("ABS", "pla", "no profile"),
    (None, "pla", "no material"),
])
def test_match_cura_follows_the_loaded_filament(cura, material, says):
    got, note = settings.cura_material(cura)
    assert got == material and says in note


def test_engine_values_resolve_the_material_and_add_curas_layer_height():
    values = settings.load(SCHEMA, "")
    out, note = settings.engine_values(values, "PETG", 0.12)
    assert out["material"] == "petg" and out["layerHeight"] == 0.12 and "PETG" in note
    pinned, note = settings.engine_values(dict(values, material="pla"), "PETG", 0.2)
    assert pinned["material"] == "pla" and note == "PLA (set in Support Fins settings)"   # the user's pick beats Cura's


def test_dialog_rows_show_percents_and_curas_material():
    rows = {r["key"]: r for r in settings.rows(SCHEMA, settings.load(SCHEMA, ""), "PETG")}
    assert "layerHeight" not in rows
    assert (rows["coverage"]["value"], rows["coverage"]["max"], rows["coverage"]["step"]) == (50, 100, 5)
    assert rows["sway.reach"]["value"] == 15              # not 15.000000000000002
    mat = rows["material"]
    assert mat["choices"][0] == {"value": "cura", "label": "Match Cura (now PETG)"} and mat["index"] == 0
    assert settings.rows(SCHEMA, {}, "ABS")[0]["choices"][0]["label"] == "Match Cura (now PLA, no profile for ABS)"
    assert settings.from_dialog(SCHEMA, "coverage", 50) == 0.5
    assert settings.from_dialog(SCHEMA, "threshold", 40) == 40


def test_each_section_heading_appears_once():
    heads = [r["section"] for r in settings.rows(SCHEMA, {}, "PLA") if r["section"]]
    assert heads == [s["label"] for s in SCHEMA["sections"]]


def test_moving_keeps_fins_rotating_or_scaling_makes_them_stale():
    def world(rot=np.eye(3), scale=1.0, move=(0, 0, 0)):
        m = np.eye(4)
        m[:3, :3] = rot * scale
        m[:3, 3] = move
        return m
    then = settings.pose(world(rot_x(35)))
    assert not settings.is_stale(then, world(rot_x(35), move=(40, 0, -12)))
    assert settings.is_stale(then, world(rot_x(40)))
    assert settings.is_stale(then, world(rot_x(35), scale=1.1))
    assert not settings.is_stale(None, world())            # no fins yet: nothing to be stale


def test_saved_settings_reach_the_engine(host):
    mod, ctx = host
    engine_part = lbracket() @ rot_x(35).T
    engine_part[..., 2] -= engine_part[..., 2].min()
    soup = frames.part_soup(frames.cura_from_engine(engine_part).reshape(-1, 3))
    defaults, _ = settings.engine_values(settings.load(SCHEMA, ""), "PLA", 0.2)
    _, stats = mod.host_compute(ctx, soup, mod.host_options(ctx, defaults))
    assert (stats["braces"], stats["tines"]) == (4, 20)      # the site's result, as PR 1
    # stored like Cura's preferences hand them back: "false" is off, not on
    stored = settings.load(SCHEMA, json.dumps({"tines": "false", "coverage": 0.5}))
    off, _ = settings.engine_values(stored, "PLA", 0.2)
    _, stats = mod.host_compute(ctx, soup, mod.host_options(ctx, off))
    assert stats["tines"] == 0 and stats["braces"] + stats["props"] == 4   # plain walls, still 4
    assert mod.host_report(stats) == "4 walls, 0 tines"
    with pytest.raises(ValueError) as bad:
        mod.host_options(ctx, {"coverage": 50})
    assert str(bad.value).startswith("coverage must be 0..1") and "\n" not in str(bad.value)
    # the dialog's view of the same values: tine grip hides with tines off
    assert mod.host_visible(ctx, "tineDensity", {"tines": "false"}) is False
