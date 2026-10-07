#!/usr/bin/env python3
"""Every calibration coupon on one plate: one 3MF for a 256 x 256 bed (Bambu X1/P1/A1).

Reads each coupon's committed print/ file -- the 3MF (part and supports as two objects
in register, as the site exports them; the tine coupon's KISS tines likewise) or, for the angle
coupon, its STL (no supports) -- and lays them out in rows, each coupon its own
named object at a fixed position.

    python3 prototype/calibration/plate.py      # -> out/all-coupons.3mf

Print settings the coupons need: 0.2 mm layers, 0.2 mm first layer, adaptive /
variable layer height OFF (gap), and NEVER Arrange (it splits every coupon's
supports from its part). Each coupon's own README entry says what to read off it.
"""
import io
import re
import zipfile
from pathlib import Path

import numpy as np
import trimesh

HERE = Path(__file__).resolve().parent
BED, GAP = 256.0, 6.0
# rows, front to back; each row left to right
# (bore v2 is 106 mm long: it rides with angle, since pad + bore no longer fit 256)
# (cutout/ and sampler/ aren't on it: the plate is full -- 238 x 235 mm -- and either
# would push a row past 256; print them on their own)
ROWS = [['pad'], ['span', 'slender'], ['tine', 'grip'], ['foot', 'gap', 'lip'], ['angle', 'bore']]
NS = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02'


def read_3mf(path):
    """[[mesh, ...] per build item] with each item's translation applied."""
    xml = zipfile.ZipFile(path).read('3D/3dmodel.model').decode()
    meshes, comps = {}, {}
    for oid, attrs, body in re.findall(r'<object id="(\d+)"([^>]*)>(.*?)</object>', xml, re.S):
        if '<mesh>' in body:
            v = np.array(re.findall(r'<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"', body), float)
            f = np.array(re.findall(r'<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"', body), int)
            meshes[int(oid)] = trimesh.Trimesh(v, f, process=False)
        else:
            comps[int(oid)] = [int(c) for c in re.findall(r'<component objectid="(\d+)"', body)]
    items = []
    for oid, rest in re.findall(r'<item objectid="(\d+)"([^>]*)>', xml):
        t = re.search(r'transform="([^"]+)"', rest)
        off = np.array([float(x) for x in t.group(1).split()][9:12]) if t else np.zeros(3)
        parts = [meshes[c].copy() for c in comps.get(int(oid), [int(oid)])]
        for m in parts:
            m.apply_translation(off)
        items.append(parts)
    return items


def load(name):
    """A coupon: its build items (lists of meshes), in its own frame."""
    if name == 'angle':
        return [[trimesh.load(HERE / 'angle/print/angle-coupon.stl')]]
    return read_3mf(HERE / f'{name}/print/{name}-coupon.3mf')


def bounds(items):
    allv = np.vstack([m.vertices for it in items for m in it])
    return allv.min(0), allv.max(0)


coupons = {n: load(n) for row in ROWS for n in row}
placed = []                                   # (name, items, translation)
y = GAP
for row in ROWS:
    x, depth = GAP, 0.0
    for n in row:
        lo, hi = bounds(coupons[n])
        placed.append((n, coupons[n], np.array([x - lo[0], y - lo[1], -lo[2]])))
        x += hi[0] - lo[0] + GAP
        depth = max(depth, hi[1] - lo[1])
    assert x <= BED, f'row {row} is {x:.1f} mm wide'
    y += depth + GAP
assert y <= BED, f'plate is {y:.1f} mm deep'
# centre the whole layout on the bed, from where everything actually landed
lo_all = np.min([bounds(it)[0] + t for _, it, t in placed], axis=0)
hi_all = np.max([bounds(it)[1] + t for _, it, t in placed], axis=0)
used = hi_all - lo_all
shift = np.array([(BED - used[0]) / 2 - lo_all[0], (BED - used[1]) / 2 - lo_all[1], 0])
assert (lo_all + shift)[:2].min() >= 0 and (hi_all + shift)[:2].max() <= BED, 'off the bed'

objs, items, oid = [], [], 1


def mesh_xml(i, m, name):
    vs = ''.join(f'<vertex x="{a:.5f}" y="{b:.5f}" z="{c:.5f}"/>' for a, b, c in m.vertices)
    ts = ''.join(f'<triangle v1="{a}" v2="{b}" v3="{c}"/>' for a, b, c in m.faces)
    return f'<object id="{i}" type="model" name="{name}"><mesh><vertices>{vs}</vertices><triangles>{ts}</triangles></mesh></object>'


for n, its, t in placed:
    for k, parts in enumerate(its):
        # a second item is the supports as their own object (the site's 3MF since #199);
        # the tine coupon's is its kiss tines
        label = n if k == 0 else f'{n} kiss tines (own object)' if n == 'tine' else f'{n} supports'
        ids = []
        for j, m in enumerate(parts):
            # an assembly's meshes say part / supports; a lone item is just its label
            name = (f'{label} {"part" if j == 0 else "supports"}' if len(parts) > 1
                    else label if k else f'{n} part')
            objs.append(mesh_xml(oid, m, name))
            ids.append(oid)
            oid += 1
        if len(ids) > 1:
            objs.append(f'<object id="{oid}" type="model" name="{label}"><components>'
                        + ''.join(f'<component objectid="{i}"/>' for i in ids) + '</components></object>')
            ids = [oid]
            oid += 1
        tx, ty, tz = t + shift
        items.append(f'<item objectid="{ids[0]}" transform="1 0 0 0 1 0 0 0 1 {tx:.4f} {ty:.4f} {tz:.4f}"/>')
    lo, hi = bounds(its)[0] + t + shift, bounds(its)[1] + t + shift
    print(f'  {n:8s} x {lo[0]:5.1f}-{hi[0]:5.1f}  y {lo[1]:5.1f}-{hi[1]:5.1f}  h {hi[2]:4.1f}')

model = (f'<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="{NS}">'
         '<metadata name="Application">Support Fins</metadata><metadata name="Title">All calibration coupons</metadata>'
         '<resources>' + ''.join(objs) + '</resources><build>' + ''.join(items) + '</build></model>')
src = zipfile.ZipFile(HERE / 'gap/print/gap-coupon.3mf')   # the site writer's [Content_Types] + rels
buf = io.BytesIO()
with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
    for name in src.namelist():
        z.writestr(name, model if name == '3D/3dmodel.model' else src.read(name))
out = HERE / 'out'
out.mkdir(exist_ok=True)
(out / 'all-coupons.3mf').write_bytes(buf.getvalue())
print(f'wrote {out / "all-coupons.3mf"}: {len(placed)} coupons, {len(items)} objects, '
      f'{used[0]:.0f} x {used[1]:.0f} mm on a {BED:.0f} mm bed')
