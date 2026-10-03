"""Render probe.js --dump output: where a build holds the overhang and where it doesn't.
Red = overhang left unheld, green = held, amber = in a region under MIN_REGION_AREA the
engine never looks at (red-amber unheld, green-amber held), orange = supports, grey = part.
Two views from below plus a plan view from straight under the part.

    deno run -A prototype/examples/probe.js --dir prototype/examples/reports --poses up,X45,Y45,suggested --dump /tmp/held
    python3 prototype/examples/render_held.py /tmp/held [out_dir]      # one PNG per case
"""
import json, os, sys, glob
import numpy as np
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection

COL = {(1, 0): [0.11, 0.62, 0.47, 0.95], (0, 0): [0.84, 0.10, 0.11, 0.95],
       (1, 1): [0.55, 0.75, 0.30, 0.95], (0, 1): [0.95, 0.55, 0.10, 0.95]}

def view3d(ax, d, elev, azim):
    part = np.array(d['part'])
    ax.add_collection3d(Poly3DCollection(part, facecolors=[0.80, 0.80, 0.82, 0.25], edgecolors='none'))
    if d['sup']:
        ax.add_collection3d(Poly3DCollection(np.array(d['sup']), facecolors=[0.88, 0.54, 0.17, 0.55], edgecolors='none'))
    if d['over']:
        ax.add_collection3d(Poly3DCollection(np.array([o[0] for o in d['over']]),
                            facecolors=[COL[(o[1], o[2])] for o in d['over']], edgecolors='none'))
    lo, hi = part.reshape(-1, 3).min(0), part.reshape(-1, 3).max(0)
    c, r = (lo + hi) / 2, (hi - lo).max() / 2
    ax.set_xlim(c[0] - r, c[0] + r); ax.set_ylim(c[1] - r, c[1] + r); ax.set_zlim(0, 2 * r)
    ax.view_init(elev=elev, azim=azim); ax.set_axis_off()

def plan(ax, d):
    part = np.array(d['part']).mean(1)
    ax.scatter(part[:, 0], part[:, 1], s=0.3, c='#cccccc', rasterized=True)
    if d['sup']:
        sup = np.array(d['sup']).mean(1)
        ax.scatter(sup[:, 0], sup[:, 1], s=0.3, c='#e08a2c', alpha=.4, rasterized=True)
    if d['over']:
        o = np.array([np.mean(x[0], 0) for x in d['over']])
        c = [COL[(x[1], x[2])] for x in d['over']]
        ax.scatter(o[:, 0], o[:, 1], s=2, c=c)
    ax.set_aspect('equal'); ax.invert_yaxis(); ax.set_title('plan, from below', fontsize=10)

src = sys.argv[1]; out = sys.argv[2] if len(sys.argv) > 2 else src
os.makedirs(out, exist_ok=True)
for f in sorted(glob.glob(f'{src}/*.json')):
    d = json.load(open(f))
    if not d['area']:
        continue   # no overhang this way up: nothing to show
    fig = plt.figure(figsize=(16, 5.5), dpi=90)
    view3d(fig.add_subplot(131, projection='3d'), d, -20, -60)
    view3d(fig.add_subplot(132, projection='3d'), d, -20, 30)
    plan(fig.add_subplot(133), d)
    a = d['area']
    fig.suptitle(f"{d['title']}: {d['walls']} walls, held {100 * d['held'] / a:.0f}% of {a:.0f} mm² overhang "
                 f"({100 * d['small'] / a:.0f}% of it in regions too small to be seen)   "
                 "green held / red unheld / amber = too-small region", fontsize=11)
    plt.tight_layout(); p = f"{out}/{os.path.basename(f)[:-5]}.png"; plt.savefig(p); plt.close(fig); print(p)
