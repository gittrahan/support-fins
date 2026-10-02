#!/usr/bin/env python3
"""Render a coupon build: part grey, supports orange, from below-front and above.

    python3 prototype/calibration/render.py gap      # -> gap/out/gap-coupon.png
"""
import sys
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import trimesh  # noqa: E402
from mpl_toolkits.mplot3d.art3d import Poly3DCollection  # noqa: E402

name = sys.argv[1]
out = Path(__file__).resolve().parent / name / 'out'
both = trimesh.load(out / f'{name}-coupon.stl')
fins_path = out / f'{name}-fins.stl'
fins = trimesh.load(fins_path) if fins_path.exists() else None
fig = plt.figure(figsize=(13, 6), dpi=110)
lo, hi = both.bounds
c, r = (lo + hi) / 2, (hi - lo).max() / 2
for i, (elev, azim, title) in enumerate([(-20, -60, 'from below'), (35, -60, 'from above')]):
    ax = fig.add_subplot(1, 2, i + 1, projection='3d')
    ax.add_collection3d(Poly3DCollection(both.triangles, facecolors=(0.78, 0.78, 0.82, 0.35), edgecolors='none'))
    if fins is not None:
        ax.add_collection3d(Poly3DCollection(fins.triangles, facecolors=(0.95, 0.55, 0.10, 1), edgecolors='none'))
    ax.set_xlim(c[0] - r, c[0] + r); ax.set_ylim(c[1] - r, c[1] + r); ax.set_zlim(0, 2 * r)
    ax.view_init(elev=elev, azim=azim); ax.set_axis_off(); ax.set_title(f'{name} coupon, {title}')
fig.tight_layout()
fig.savefig(out / f'{name}-coupon.png')
print(f'wrote {out / f"{name}-coupon.png"}')
