#!/usr/bin/env python3
"""Grip coupon, split: the same part and walls as print/grip-coupon.3mf, but saved as TWO
objects -- the part, and every support as its own object -- the way Clough42 splits his
designed support ("Split to objects", not parts; local reference in the repo owner's notes,
GitHub #38). As one object the slicer runs one perimeter through part and tine, so the tine
welds; as two, each keeps its own perimeter and the tine only touches.

Supports are cut at the part's surface first (anything inside the part removed: tines already
end there since #168, so this trims slivers). Compare the print with the merged grip print,
rung for rung: same walls, same tines, only the object split differs.

    python3 prototype/calibration/grip/gen.py && deno run -A prototype/calibration/grip/build.js \
      && python3 prototype/calibration/grip/split.py      # -> out/grip-coupon-split.3mf

Print the 3MF. If the slicer asks to load it as one object with several parts, say NO (parts
of one object are unioned -- the weld again). Never Arrange: it moves the supports off the part.
"""
import io
import re
import zipfile
from pathlib import Path

import numpy as np
import trimesh

OUT = Path(__file__).resolve().parent / 'out'
NS = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02'


def read_objects(path):
    """{id: Trimesh} for every mesh object in a 3MF (the site's writer: 1 part, 2 supports)."""
    xml = zipfile.ZipFile(path).read('3D/3dmodel.model').decode()
    objs = {}
    for oid, body in re.findall(r'<object id="(\d+)"[^>]*><mesh>(.*?)</mesh></object>', xml, re.S):
        v = np.array(re.findall(r'<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"', body), float)
        f = np.array(re.findall(r'<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"', body), int)
        objs[int(oid)] = trimesh.Trimesh(v, f, process=False)
    return objs


def mesh_xml(oid, m, name):
    vs = ''.join(f'<vertex x="{x:.5f}" y="{y:.5f}" z="{z:.5f}"/>' for x, y, z in m.vertices)
    ts = ''.join(f'<triangle v1="{a}" v2="{b}" v3="{c}"/>' for a, b, c in m.faces)
    return (f'<object id="{oid}" type="model" name="{name}"><mesh><vertices>{vs}</vertices>'
            f'<triangles>{ts}</triangles></mesh></object>')


objs = read_objects(OUT / 'grip-coupon.3mf')
part, sup = objs[1], objs[2]
# Both items get the SAME transform: the coupon's centre to (90, 90), on any bed 180 mm up.
# Two objects keep their 3MF positions; one centred on the origin would sit half off the bed.
c = part.bounds.mean(axis=0)
BED = f'1 0 0 0 1 0 0 0 1 {90 - c[0]:.5f} {90 - c[1]:.5f} 0'
bodies = sup.split(only_watertight=False)
assert all(b.is_watertight for b in bodies), 'a support body is not closed'
cut = [trimesh.boolean.difference([b, part], engine='manifold') for b in bodies]
cut = [m for m in cut if len(m.faces)]
assert all(m.is_watertight for m in cut), 'a cut support body is not closed'
supports = trimesh.util.concatenate(cut)
print(f'split: {len(bodies)} support bodies, {sup.volume - supports.volume:.3f} mm3 trimmed inside the part')

model = (f'<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="{NS}">'
         '<metadata name="Application">Support Fins</metadata><metadata name="Title">Grip coupon (split)</metadata>'
         '<resources>' + mesh_xml(1, part, 'Grip coupon') + mesh_xml(2, supports, 'Supports (own object)')
         + f'</resources><build><item objectid="1" transform="{BED}"/><item objectid="2" transform="{BED}"/>'
           '</build></model>')
src = zipfile.ZipFile(OUT / 'grip-coupon.3mf')
buf = io.BytesIO()
with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
    for n in src.namelist():
        z.writestr(n, model if n == '3D/3dmodel.model' else src.read(n))
(OUT / 'grip-coupon-split.3mf').write_bytes(buf.getvalue())
print(f'wrote {OUT / "grip-coupon-split.3mf"}')
