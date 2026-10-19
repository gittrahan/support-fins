"""Offline tests for the Orca plugin's Python side.

    python3 plugins/orca/build.py && python3 -m pytest -q plugins/orca/tests/

Runs the BUILT single-file plugin (engine bundle inlined) against fake_orca, a
stand-in for Orca's embedded module that slices parts with trimesh. What only a
real OrcaSlicer build can confirm is listed in plugins/orca/README.md.
"""
import importlib.util
import json
import pathlib
import sys

import numpy as np
import pytest
import trimesh
from shapely.geometry import Polygon as SPoly
from shapely.ops import unary_union

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import fake_orca  # noqa: E402

ORCA = fake_orca.install()
BUILT = HERE.parent / "build" / "support_fins_orca.py"
MODELS = HERE.parents[2] / "prototype" / "stress" / "models"


def load_plugin():
    if not BUILT.exists():
        pytest.skip("run plugins/orca/build.py first")
    spec = importlib.util.spec_from_file_location("support_fins_orca", BUILT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


SF = load_plugin()


def rot_x(deg, shift=(0, 0, 0), scale=1.0):
    m = trimesh.transformations.rotation_matrix(np.radians(deg), [1, 0, 0])
    m[:3, :3] *= scale
    m[:3, 3] = shift
    return m


# ------------------------------------------------------------------ frame
def test_slice_frame_round_trip_and_refusal():
    f = SF.SliceFrame(np.array([100.0, 50.0]), np.array([140.0, 70.0]),
                      (-20_000_000, -10_000_000, 20_000_000, 10_000_000), 1e-6)
    pts = f.to_scaled(np.array([[100.0, 50.0], [140.0, 70.0], [120.0, 60.0]]))
    assert pts.tolist() == [[-20_000_000, -10_000_000], [20_000_000, 10_000_000], [0, 0]]
    with pytest.raises(ValueError):  # bbox 3x too big: not the footprint we think
        SF.SliceFrame(np.array([0.0, 0.0]), np.array([40.0, 20.0]),
                      (-60_000_000, -30_000_000, 60_000_000, 30_000_000), 1e-6)


# ------------------------------------------------------------------ end to end
def expected_islands(po, fins_posed):
    """Independent answer: trimesh-slice the part and every fin shell, shapely-union."""
    out = []
    shells = SF.split_shells(fins_posed)
    for L in po.layers():
        z = L.slice_z
        polys = []
        for mesh in [po.posed] + [trimesh.Trimesh(*_weld(sh)) for sh in shells]:
            sec = mesh.section(plane_origin=[0, 0, z + SF.PLANE_NUDGE], plane_normal=[0, 0, 1])
            if sec is None:
                continue
            planar, to3d = sec.to_2D()
            for p in planar.polygons_full:
                ext = po._to_xy(np.asarray(p.exterior.coords), to3d)
                holes = [po._to_xy(np.asarray(r.coords), to3d) for r in p.interiors]
                polys.append(SPoly(ext * fake_orca.SCALE, [h * fake_orca.SCALE for h in holes]).buffer(0))
        out.append(unary_union(polys) if polys else SPoly())
    return out


def _weld(tris):
    V, inv = np.unique(np.round(tris.reshape(-1, 3), 6), axis=0, return_inverse=True)
    return V, inv.reshape(-1, 3)


def run_case(model, trafo, layer_height=0.2, config=None):
    part = trimesh.load(MODELS / f"{model}.stl")
    po = fake_orca.FakePrintObject(part, trafo, layer_height=layer_height)
    # the fins the plugin will compute, in the same centred frame as po.posed
    soup = SF.posed_part_soup(po)
    soup = soup - np.array([po.center_mm[0], po.center_mm[1], soup[:, :, 2].min()])
    fins, stats = SF.compute_fins(soup, layer_height, {**SF._DEFAULTS, **(config or {})})
    want = expected_islands(po, fins)
    cap = SF.SupportFinsSlicing()
    cap._config = json.dumps(config or {})
    res = cap.execute(fake_orca.Ctx(po))
    return po, res, want, stats


@pytest.mark.parametrize("model,deg,shift,scale,config", [
    ("cube", 45, (137.25, 88.5, 12.0), 1.0, None),     # parked off-centre, lifted
    ("wedge", 45, (40.0, 200.0, 0.0), 1.0, None),
    ("ramp", 45, (-30.0, 5.0, 0.0), 1.004, None),   # with XY/Z shrinkage compensation
])
def test_fins_land_exactly_where_a_finned_stl_would(model, deg, shift, scale, config):
    po, res, want, stats = run_case(model, rot_x(deg, shift, scale), config=config)
    assert res.status is fake_orca.PluginResult.Success, res
    assert stats["braces"] >= 1
    worst, total_fin = 0.0, 0.0
    for L, w in zip(po.layers(), want):
        got = L.islands()
        diff = got.symmetric_difference(w).area / fake_orca.SCALE ** 2   # mm^2
        worst = max(worst, diff)
    # tolerance: slicer vertex rounding (1 nm) and chord differences, per layer
    assert worst < 0.05, f"{res.message}: worst per-layer mismatch {worst:.4f} mm^2"
    assert " walls, " in res.message or " wall, " in res.message


def test_no_fins_still_reports_overhangs_left_bare(monkeypatch):
    # The torus case: nothing placed, but 2 overhangs too shallow -- never "no fins needed".
    part = trimesh.load(MODELS / "cube.stl")
    po = fake_orca.FakePrintObject(part, rot_x(45, (50, 50, 0)))
    monkeypatch.setattr(SF, "compute_fins", lambda *a: (np.zeros((0, 3, 3)), {"unserved": 2}))
    assert "2 overhangs are too shallow" in SF.inject_fins(po, dict(SF._DEFAULTS), 0.2, 1e-6)
    monkeypatch.setattr(SF, "compute_fins", lambda *a: (np.zeros((0, 3, 3)), {}))
    assert SF.inject_fins(po, dict(SF._DEFAULTS), 0.2, 1e-6) == "no fins needed"


def test_fins_that_reach_no_layer_are_not_reported_as_added(monkeypatch):
    part = trimesh.load(MODELS / "cube.stl")
    po = fake_orca.FakePrintObject(part, rot_x(45, (50, 50, 0)))
    far = np.array([[[0, 0, 900.0], [1, 0, 900.0], [0, 1, 901.0]]])   # above every layer
    monkeypatch.setattr(SF, "compute_fins", lambda *a: (far, {"braces": 1, "tines": 2}))
    assert "nothing was added" in SF.inject_fins(po, dict(SF._DEFAULTS), 0.2, 1e-6)


def test_fins_actually_add_material_under_the_overhang():
    po, res, want, _ = run_case("cube", rot_x(45, (50, 50, 0)))
    part_only = fake_orca.FakePrintObject(trimesh.load(MODELS / "cube.stl"), rot_x(45, (50, 50, 0)))
    added = sum(L.islands().area - P.islands().area for L, P in zip(po.layers(), part_only.layers()))
    assert added > 0, "no fin material was added"


def test_first_layer_fins_get_elephant_foot_compensation_like_orca():
    part = trimesh.load(MODELS / "cube.stl")
    tr = rot_x(45, (60, 60, 0))
    plain = fake_orca.FakePrintObject(part, tr)
    efc = fake_orca.FakePrintObject(part, tr, config={"elefant_foot_compensation": "0.1",
                                                      "elefant_foot_compensation_layers": "1"})
    raft = fake_orca.FakePrintObject(part, tr, config={"elefant_foot_compensation": "0.1", "raft_layers": "2"})
    for po in (plain, efc, raft):
        SF.SupportFinsSlicing().execute(fake_orca.Ctx(po))
    a0, e0, r0 = (po.layers()[0].islands().area for po in (plain, efc, raft))
    assert e0 < a0, "layer 0 fins were not compensated"
    assert r0 == a0, "compensation must be off on a raft, like Orca"
    assert efc.layers()[1].islands().area == plain.layers()[1].islands().area, "only the first layer shrinks"


def test_part_with_orca_supports_on_is_left_alone():
    part = trimesh.load(MODELS / "cube.stl")
    po = fake_orca.FakePrintObject(part, rot_x(45), config={"enable_support": "1"})
    before = [L.islands().area for L in po.layers()]
    res = SF.SupportFinsSlicing().execute(fake_orca.Ctx(po))
    assert "skipped" in res.message
    assert [L.islands().area for L in po.layers()] == before


def test_other_steps_and_disabled_config_do_nothing():
    part = trimesh.load(MODELS / "cube.stl")
    po = fake_orca.FakePrintObject(part, rot_x(45))
    before = [L.islands().area for L in po.layers()]
    cap = SF.SupportFinsSlicing()
    cap.execute(fake_orca.Ctx(po, step=fake_orca.Step.posPerimeters))
    cap._config = json.dumps({"enabled": False})
    assert "disabled" in cap.execute(fake_orca.Ctx(po)).message
    assert [L.islands().area for L in po.layers()] == before


def test_errors_are_reported_not_raised(monkeypatch):
    part = trimesh.load(MODELS / "cube.stl")
    po = fake_orca.FakePrintObject(part, rot_x(45))
    monkeypatch.setattr(SF, "compute_fins", lambda *a: (_ for _ in ()).throw(RuntimeError("boom")))
    res = SF.SupportFinsSlicing().execute(fake_orca.Ctx(po))
    assert res.status is fake_orca.PluginResult.RecoverableError and "boom" in res.message


def test_plugin_registers_its_capability():
    ORCA.registered.clear()
    SF.SupportFinsPlugin().register_capabilities()
    assert ORCA.registered == [SF.SupportFinsSlicing]


def test_mirrored_part_gets_the_same_fins_as_its_twin():
    """Orca's mirror tool leaves a matrix with det < 0, which flips every triangle's
    winding. The engine finds overhangs from face normals, so the plugin must put the
    winding back: a mirrored part gets the same fins as the same shape modelled
    mirrored. (Before the fix: lbracket at 35 deg dropped from 4 fins to 1.)"""
    part = trimesh.load(MODELS / "lbracket.stl")
    mirror = np.diag([-1.0, 1.0, 1.0, 1.0])
    po = fake_orca.FakePrintObject(part, rot_x(35) @ mirror)
    soup = SF.posed_part_soup(po)
    signed = np.einsum("ij,ij->i", soup[:, 0], np.cross(soup[:, 1], soup[:, 2])).sum() / 6
    assert signed > 0, "mirrored part came through inside-out"
    twin = part.copy()
    twin.apply_transform(mirror)                      # trimesh repairs the winding itself
    ref = fake_orca.FakePrintObject(twin, rot_x(35))
    _, s_mir = SF.compute_fins(soup, 0.2, dict(SF._DEFAULTS))
    _, s_ref = SF.compute_fins(SF.posed_part_soup(ref), 0.2, dict(SF._DEFAULTS))
    assert s_ref["braces"] >= 1
    assert (s_mir["braces"], s_mir["tines"]) == (s_ref["braces"], s_ref["tines"])


# ------------------------------------------------------------------ config
def _fin_area(config, model="lbracket", deg=40):
    po = fake_orca.FakePrintObject(trimesh.load(MODELS / f"{model}.stl"), rot_x(deg))
    before = sum(L.islands().area for L in po.layers())
    cap = SF.SupportFinsSlicing()
    cap._config = json.dumps(config)
    res = cap.execute(fake_orca.Ctx(po))
    return sum(L.islands().area for L in po.layers()) - before, res


def test_every_engine_setting_is_a_config_key():
    # the plugin's keys, then every options.json setting at its default; Orca's own
    # layer height is never one
    ctx = SF._engine_ctx()
    schema = SF.host_schema(ctx)
    cfg = SF.default_config()
    assert cfg["enabled"] is True and cfg["apply_to"] == "no-supports"
    for o in schema["options"]:
        if o.get("hostSupplied") == "slicer":
            assert o["key"] not in cfg, o["key"]
        else:
            assert cfg[o["key"]] == o["default"], o["key"]
    # the defaults as written build exactly what an empty config builds
    assert _fin_area(cfg)[0] == _fin_area({})[0] > 0


def test_older_config_names_still_work():
    ctx = SF._engine_ctx()
    old = {"enabled": True, "apply_to": "all", "coverage": 0.25, "tines": True,
           "tine_density": 0.4, "bed_pad": False}
    assert SF.engine_options(ctx, old, 0.16) == SF.engine_options(
        ctx, {"coverage": 0.25, "tines": True, "tineDensity": 0.4, "padStyle": "off"}, 0.16)
    # bed_pad true leaves the pad style alone
    assert SF.engine_options(ctx, {"bed_pad": True, "padStyle": "sure"}, 0.2)["padStyle"] == "sure"


def test_full_coverage_from_the_config_adds_walls():
    auto, _ = _fin_area({})
    full, res = _fin_area({"mode": "full"})
    assert full > auto * 1.2, f"Full {full:.0f} vs Auto {auto:.0f} mm2 of fin cross-section"
    assert "walls" in res.message


def test_a_bad_key_or_value_fails_the_slice_by_name():
    for config, want in (({"sparkle": 1}, "sparkle"), ({"mode": "draw"}, "mode"),
                         ({"gap": 3}, "gap"), ({"layerHeight": 0.1}, "Orca's own layer height")):
        _, res = _fin_area(config)
        assert res.status is fake_orca.PluginResult.RecoverableError and want in res.message, res.message
