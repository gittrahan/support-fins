#!/usr/bin/env python3
"""Tine coupon, step 3: the KISS ledges (which ones: out/key.json). Cut their supports at the part's surface
(each closed body minus the part), so no tine reaches inside it, and rewrite
out/tine-coupon.3mf with them as their OWN build item. A slicer unions the parts of
one object -- the site's 3MF puts part and supports in one, so a tine touching the
part merges into its outline -- but slices separate objects separately: the part
keeps its full outer wall and a kiss tine only touches it.

    python3 prototype/calibration/tine/kiss.py      # after gen.py + build.js
"""
import io
import re
import zipfile
from pathlib import Path

import numpy as np
import trimesh

OUT = Path(__file__).resolve().parent / 'out'
NS = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02'
# Both items placed together, on any bed 180 mm or bigger (A1 mini up): two objects
# keep their 3MF positions, and centred on the origin half the coupon is off the bed.
# The coupon is 156 mm long, so it spans x 12-168. Arrange splits the two apart.
BED = '1 0 0 0 1 0 0 0 1 90 90 0'


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


objs = read_objects(OUT / 'tine-coupon.3mf')
part, sup = objs[1], objs[2]
raw = trimesh.load(OUT / 'tine-kiss-raw.stl')
bodies = raw.split(only_watertight=False)
assert all(b.is_watertight for b in bodies), 'a kiss support body is not closed'
cut = [trimesh.boolean.difference([b, part], engine='manifold') for b in bodies]
kiss = trimesh.util.concatenate([m for m in cut if len(m.faces)])
assert all(m.is_watertight for m in cut if len(m.faces)), 'a cut kiss body is not closed'
inside = part.contains(kiss.triangles_center)
print(f'kiss: {len(bodies)} bodies cut, {len(kiss.faces)} faces, '
      f'{(raw.volume - kiss.volume):.3f} mm3 removed (inside the part), {inside.sum()} faces still inside')

model = (f'<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="{NS}">'
         '<metadata name="Application">Support Fins</metadata><metadata name="Title">Tine coupon</metadata>'
         '<resources>' + mesh_xml(1, part, 'Tine coupon') + mesh_xml(2, sup, 'Supports')
         + '<object id="3" type="model" name="Tine coupon"><components><component objectid="1"/>'
           '<component objectid="2"/></components></object>'
         + mesh_xml(4, kiss, 'Kiss supports (own object)')
         + f'</resources><build><item objectid="3" transform="{BED}"/>'
           f'<item objectid="4" transform="{BED}"/></build></model>')
src = zipfile.ZipFile(OUT / 'tine-coupon.3mf')
buf = io.BytesIO()
with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
    for n in src.namelist():
        z.writestr(n, model if n == '3D/3dmodel.model' else src.read(n))
(OUT / 'tine-coupon.3mf').write_bytes(buf.getvalue())
# the merged STL can't keep objects apart: rewrite it with the cut kiss supports so
# it at least matches the geometry (print the 3MF)
trimesh.util.concatenate([part, sup, kiss]).export(OUT / 'tine-coupon.stl')
trimesh.util.concatenate([sup, kiss]).export(OUT / 'tine-fins.stl')   # what render.py colours
print(f'wrote {OUT / "tine-coupon.3mf"} (kiss supports as their own object) + .stl')
