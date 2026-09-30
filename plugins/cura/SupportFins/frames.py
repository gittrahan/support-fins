"""Cura <-> engine frames. Pure numpy, no Cura imports, so it's tested without Cura.

Cura's scene is Y-up with the build plate on XZ; the engine (like the website) is
Z-up. A point maps as

    engine (x, y, z)  ->  Cura (x, z, -y)          Cura (X, Y, Z)  ->  engine (X, -Z, Y)

which is a proper rotation (-90 deg about X), so a tilt about X is the same angle in
both frames and winding survives. CustomSupportsCylinder flips trimesh meshes into
Cura the same way.
"""
import numpy as np


def engine_from_cura(points):
    p = np.asarray(points, dtype=np.float64)
    return np.stack([p[..., 0], -p[..., 2], p[..., 1]], axis=-1)


def cura_from_engine(points):
    p = np.asarray(points, dtype=np.float64)
    return np.stack([p[..., 0], p[..., 2], -p[..., 1]], axis=-1)


def part_soup(vertices, indices=None):
    """A Cura mesh already in world space (MeshData.getTransformed) -> engine soup.

    vertices  (N,3) Cura world coordinates, mm
    indices   (M,3) triangle indices, or None when the vertices are a plain soup
    Returns (M,3,3) float64 triangles in the engine's Z-up frame.
    """
    v = np.asarray(vertices, dtype=np.float64)
    tris = v[np.asarray(indices)] if indices is not None else v.reshape(-1, 3, 3)
    return engine_from_cura(tris)


def fins_mesh(fins):
    """Engine fin triangles -> what a Cura node needs.

    fins  (K,3,3) engine-frame triangles in the same world frame as the part soup
    Returns (vertices (3K,3) float32 centred on the mesh, indices (K,3) int32,
             centre (3,) float64 in Cura world coordinates). The node goes at `centre`,
             so Cura's gizmos pivot on the fins rather than the plate origin.
    """
    pts = cura_from_engine(np.asarray(fins, dtype=np.float64).reshape(-1, 3))
    centre = (pts.min(axis=0) + pts.max(axis=0)) / 2
    verts = (pts - centre).astype(np.float32)
    idx = np.arange(len(verts), dtype=np.int32).reshape(-1, 3)
    return verts, idx, centre
