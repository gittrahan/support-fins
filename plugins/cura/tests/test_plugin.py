"""Cura plugin tests that don't need Cura: the frame mapping, and the part -> engine
-> fins round trip through it.

    python3 plugins/cura/build.py && python3 -m pytest -q plugins/cura/tests/

The Cura glue (menu, Job, scene operations, undo) is checked in the real Cura with
SupportFins/devrun.py; see plugins/cura/README.md.
"""
import importlib.util
import math
import pathlib

import numpy as np
import pytest

HERE = pathlib.Path(__file__).resolve().parent
BUILT = HERE.parent / "build" / "SupportFins"
ROOT = HERE.parent.parent.parent


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# frames.py has no Cura imports, so it loads on its own (the package __init__ doesn't)
frames = load("sf_frames", HERE.parent / "SupportFins" / "frames.py")


def rot_x(deg):
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def lbracket():
    data = (ROOT / "web" / "dev-models" / "lbracket.stl").read_bytes()
    n = int(np.frombuffer(data, dtype="<u4", count=1, offset=80)[0])
    rec = np.frombuffer(data, dtype=np.dtype([("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")]),
                        count=n, offset=84)
    return rec["v"].astype(np.float64)


def test_frames_round_trip():
    p = np.random.default_rng(1).normal(size=(50, 3)) * 40
    assert np.allclose(frames.cura_from_engine(frames.engine_from_cura(p)), p)
    # engine up (+z) is Cura up (+y)
    assert np.allclose(frames.cura_from_engine([0, 0, 1]), [0, 1, 0])


def test_a_tilt_about_x_is_the_same_angle_in_both_frames():
    p = np.random.default_rng(2).normal(size=(20, 3))
    tilted_in_cura = frames.cura_from_engine(p) @ rot_x(35).T
    assert np.allclose(frames.engine_from_cura(tilted_in_cura), p @ rot_x(35).T)


def test_the_mapping_keeps_winding():
    # a proper rotation (det +1): outward normals stay outward, so Cura shades fins right
    m = np.stack([frames.cura_from_engine(e) for e in np.eye(3)])
    assert np.isclose(np.linalg.det(m), 1.0)


def test_indexed_and_soup_meshes_give_the_same_soup():
    tris = np.random.default_rng(3).normal(size=(8, 3, 3))
    verts = tris.reshape(-1, 3)
    idx = np.arange(len(verts)).reshape(-1, 3)
    assert np.allclose(frames.part_soup(verts, idx), frames.part_soup(verts))


def test_fins_mesh_is_centred_on_its_node():
    fins = np.random.default_rng(4).normal(size=(10, 3, 3)) * 10 + [100, -30, 7]
    verts, idx, centre = frames.fins_mesh(fins)
    assert verts.dtype == np.float32 and idx.shape == (10, 3)
    assert np.allclose((verts.min(axis=0) + verts.max(axis=0)) / 2, 0, atol=1e-4)
    assert np.allclose(verts + centre, frames.cura_from_engine(fins.reshape(-1, 3)), atol=1e-4)


@pytest.fixture(scope="module")
def host():
    if not (BUILT / "fins_engine.js").exists():
        pytest.skip("run plugins/cura/build.py first")
    mod = load("sf_host", BUILT / "supportfins_host.py")
    ctx = mod.host_engine((BUILT / "fins_engine.js").read_text(encoding="utf-8"))
    return mod, ctx


def test_a_part_on_curas_plate_gets_the_sites_fins(host):
    mod, ctx = host
    # lbracket tilted 35 deg about X and parked off-centre on Cura's plate (Y up)
    engine_part = lbracket() @ rot_x(35).T
    engine_part[..., 2] -= engine_part[..., 2].min()
    cura_part = frames.cura_from_engine(engine_part) + [60, 0, -25]
    soup = frames.part_soup(cura_part.reshape(-1, 3))
    fins, stats = mod.host_compute(ctx, soup, {"layerHeight": 0.2})
    assert (stats["braces"], stats["tines"]) == (4, 20)      # the site's result
    verts, _, centre = frames.fins_mesh(fins)
    world = verts + centre
    assert abs(world[:, 1].min()) < 1e-3                    # the pad is on the plate
    # and under the part, not at the origin
    assert abs((world[:, 0].min() + world[:, 0].max()) / 2 - 60) < 5
    assert mod.host_report(stats) == "4 walls, 20 tines"
