"""Render compare.js's output: raster off | raster on, seen from below-front.
Green = held overhang, red = unheld, blue = normal-pass wall, orange = raster wall.

    python3 prototype/examples/render.py compare.json out.png
"""
import json, sys
import numpy as np
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection

def panel(ax, part, build, label):
    fc = np.tile([0.78, 0.78, 0.80, 0.35], (len(part), 1))
    for f, h in build['held']:
        fc[f] = [0.20, 0.65, 0.30, 0.9] if h else [0.90, 0.25, 0.20, 0.9]
    ax.add_collection3d(Poly3DCollection(part, facecolors=fc, edgecolors='none'))
    if build['walls']:
        ax.add_collection3d(Poly3DCollection(
            [w[:3] for w in build['walls']], edgecolors='none',
            facecolors=[[0.95, 0.60, 0.10, 1] if w[3] else [0.15, 0.40, 0.90, 1] for w in build['walls']]))
    lo, hi = part.reshape(-1, 3).min(0), part.reshape(-1, 3).max(0)
    c, r = (lo + hi) / 2, (hi - lo).max() / 2
    ax.set_xlim(c[0] - r, c[0] + r); ax.set_ylim(c[1] - r, c[1] + r); ax.set_zlim(0, 2 * r)
    ax.view_init(elev=-18, azim=-60); ax.set_axis_off()
    held = 'n/a' if build['heldFrac'] is None else f"{100 * build['heldFrac']:.0f}%"
    ax.set_title(f"{label}: {build['nWalls']} walls, {held} held", fontsize=11)

d = json.load(open(sys.argv[1]))
part = np.array(d['part'])
fig = plt.figure(figsize=(12, 6), dpi=110)
panel(fig.add_subplot(121, projection='3d'), part, d['off'], 'raster off')
panel(fig.add_subplot(122, projection='3d'), part, d['on'], 'raster on')
fig.suptitle(d['title'] + '   green held / red unheld overhang, blue normal wall, orange raster wall', fontsize=10)
plt.tight_layout(); plt.savefig(sys.argv[2])
