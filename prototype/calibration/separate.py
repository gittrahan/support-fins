#!/usr/bin/env python3
"""Convert a coupon's committed print/ 3MF to the site's export form: the supports as
their OWN object (the site's Export > 3MF since #199), so the slicer keeps them apart
and a tine only touches the part.

The meshes are copied verbatim -- the same vertices, to the digit, as the file that
was printed -- and only the object names and the <build> change: two items sharing
one transform, the site's rule (threemf.js bedShift): the pair's footprint centred
at (90, 90), never closer than 5 mm to the bed's 0 edge. Nothing is trimmed (unlike
grip/split.py's experiment), because the site doesn't trim either.

    python3 prototype/calibration/separate.py gap grip pad span lip   # print/<name>-coupon.3mf in place

A file that's already two objects is left alone.
"""
import io
import re
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
CENTRE = 90


def fmt(v):
    """threemf.js fmt: up to 6 decimals, no trailing zeros"""
    s = f'{v:.6f}'.rstrip('0').rstrip('.')
    return '0' if s in ('-0', '') else s


def convert(name):
    path = HERE / name / 'print' / f'{name}-coupon.3mf'
    src = zipfile.ZipFile(path)
    xml = src.read('3D/3dmodel.model').decode()
    if '<components>' not in xml:
        print(f'{name}: already separate, left alone')
        return
    meshes = dict(re.findall(r'<object id="(\d)" type="model"[^>]*>(<mesh>.*?</mesh>)</object>', xml, re.S))
    assert set(meshes) == {'1', '2'}, f'{name}: expected part (1) + supports (2), got {sorted(meshes)}'
    title = re.search(r'<metadata name="Title">(.*?)</metadata>', xml).group(1)
    xs, ys = [], []
    for body in meshes.values():
        for x, y in re.findall(r'<vertex x="([^"]+)" y="([^"]+)"', body):
            xs.append(float(x)); ys.append(float(y))
    lx, hx, ly, hy = min(xs), max(xs), min(ys), max(ys)
    tx = max(CENTRE - (lx + hx) / 2, 5 - lx)
    ty = max(CENTRE - (ly + hy) / 2, 5 - ly)
    t = f'1 0 0 0 1 0 0 0 1 {fmt(tx)} {fmt(ty)} 0'
    head = xml[:xml.index('<resources>')]
    model = (head + '<resources>'
             + f'<object id="1" type="model" name="{title}">{meshes["1"]}</object>'
             + f'<object id="2" type="model" name="{title} supports">{meshes["2"]}</object>'
             + f'</resources><build><item objectid="1" transform="{t}"/><item objectid="2" transform="{t}"/></build></model>')
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as z:
        for info in src.infolist():
            data = model.encode() if info.filename == '3D/3dmodel.model' else src.read(info.filename)
            z.writestr(info.filename, data, compress_type=info.compress_type)  # stored stays stored, deflated (pad) stays deflated
    path.write_bytes(buf.getvalue())
    print(f'{name}: two objects, shared transform {fmt(tx)}, {fmt(ty)}')


if __name__ == '__main__':
    for n in sys.argv[1:]:
        convert(n)
