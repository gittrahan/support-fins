"""Tests for the shared mesh slicing (plugins/shared/py/supportfins_slice.py).

    pip install pytest numpy trimesh
    python3 -m pytest -q plugins/shared/py/tests/

The Orca plugin inlines this module; plugins/orca/tests check the same code end to
end, against layers Orca itself would slice from a finned STL.
"""
import pathlib
import sys

import numpy as np
import trimesh

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import supportfins_slice as S  # noqa: E402


def loops_area(groups):
    return sum(abs(S.signed_area(o)) - sum(abs(S.signed_area(h)) for h in hs) for o, hs in groups)


def test_cube_cross_section_is_one_square():
    box = trimesh.creation.box((10, 20, 30))
    box.apply_translation([0, 0, 15])
    loops = S.slice_soup(np.asarray(box.triangles), 7.3)
    assert len(loops) == 1
    assert abs(abs(S.signed_area(loops[0])) - 200.0) < 1e-9


def test_hole_is_grouped_under_its_outer():
    tube = trimesh.creation.annulus(r_min=4, r_max=10, height=20, sections=64)
    tube.apply_translation([0, 0, 10])
    groups = S.group_loops(S.slice_soup(np.asarray(tube.triangles), 10.1))
    assert len(groups) == 1 and len(groups[0][1]) == 1
    ring = tube.section(plane_origin=[0, 0, 10.1], plane_normal=[0, 0, 1]).to_2D()[0].area
    assert abs(loops_area(groups) - ring) / ring < 1e-9


def test_winding_is_not_trusted():
    box = trimesh.creation.box((10, 10, 10))
    box.apply_translation([0, 0, 5])
    flipped = np.asarray(box.triangles)[:, ::-1, :]  # every face inside-out
    groups = S.group_loops(S.slice_soup(flipped, 5.0))
    assert len(groups) == 1 and abs(loops_area(groups) - 100.0) < 1e-9


def test_face_exactly_on_the_plane_counts_as_inside_like_orca():
    # Orca puts a layer whose slice plane touches a top face INSIDE the solid
    # (verified against a real Orca 2.5 slice of a finned STL in an Orca 2.5 nightly).
    box = trimesh.creation.box((10, 10, 10))
    box.apply_translation([0, 0, 5])
    top = S.slice_soup(np.asarray(box.triangles), 10.0)                 # top face ON the plane
    assert len(top) == 1 and abs(abs(S.signed_area(top[0])) - 100.0) < 1e-5
    assert S.slice_soup(np.asarray(box.triangles), 0.0) == []           # bottom face ON the plane


def test_overlapping_solids_split_into_shells():
    a = trimesh.creation.box((10, 10, 10))
    b = trimesh.creation.box((10, 10, 10))
    b.apply_translation([5, 0, 0])            # overlaps a, shares no edges
    soup = np.concatenate([a.triangles, b.triangles])
    shells = S.split_shells(soup)
    assert sorted(len(s) for s in shells) == [12, 12]
