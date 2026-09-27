#!/usr/bin/env python3
"""Real-world examples from Thingi10K (Thingiverse files, each with its own license).

They are NOT committed: this writes them to prototype/examples/real/ (git-ignored)
with real/CREDITS.md naming each file's thing, author and license. Needs the
`thingi10k` package; the first run downloads the ~10 GB npz variant.

    pip install thingi10k
    python3 prototype/examples/fetch_thingi.py [--cache DIR]

`mini` entries are also written scaled to 32 mm tall (`*_32mm.stl`), a tabletop
miniature, since most Thingiverse figures are modelled at desk-toy size.
"""
import argparse, re, struct
from pathlib import Path
import numpy as np
import thingi10k

PICKS = {  # file_id: family. Picked by eye from a contact sheet: whole, upright objects
    # miniatures / figures (also written at 32 mm)
    409624: 'mini', 139645: 'mini', 740391: 'mini', 110699: 'mini', 101619: 'mini',
    95037: 'mini',
    # curved / organic
    64957: 'curved', 69930: 'curved', 80557: 'curved', 72881: 'curved', 274379: 'curved',
    87355: 'curved', 1777452: 'curved', 1601406: 'curved', 98480: 'curved',
    # tall / high ceilings (branching)
    1368053: 'tall', 99982: 'tall', 66773: 'tall', 67856: 'tall',
}

def write_stl(path, v, f):
    tri = v[f].astype(np.float32)
    n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
    rec = np.zeros(len(f), dtype=[('n', '<f4', 3), ('v', '<f4', (3, 3)), ('a', '<u2')])
    rec['n'], rec['v'] = n, tri
    with open(path, 'wb') as fh:
        fh.write(b'thingi10k'.ljust(80, b' ') + struct.pack('<I', len(f)) + rec.tobytes())

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', default=None, help='thingi10k cache dir')
    a = ap.parse_args()
    thingi10k.init(cache_dir=a.cache)
    out = Path(__file__).parent / 'real'
    out.mkdir(exist_ok=True)
    credits = ['# Real-world examples (Thingi10K, not committed)', '',
               'Each file keeps its Thingiverse license; used here for local testing only.', '',
               '| file | family | thing | author | license |', '|---|---|---|---|---|']
    for e in thingi10k.dataset(file_id=list(PICKS)):
        fam = PICKS[e['file_id']]
        slug = re.sub(r'[^a-z0-9]+', '_', e['name'].lower()).strip('_')[:28]
        stem = f"{fam}_{slug}_{e['file_id']}"
        v, f = thingi10k.load_file(e['file_path'])
        v = np.asarray(v, float); f = np.asarray(f, int)
        write_stl(out / f'{stem}.stl', v, f)
        if fam == 'mini':
            h = np.ptp(v[:, 2])  # figures are modelled Z-up
            write_stl(out / f'{stem}_32mm.stl', v * (32.0 / h), f)
        credits.append(f"| {stem} | {fam} | [{e['name'].strip()}](https://www.thingiverse.com/thing:{e['thing_id']}) "
                       f"| {e['author']} | {e['license']} |")
        print(stem, len(f), np.round(np.ptp(v, axis=0), 1))
    (out / 'CREDITS.md').write_text('\n'.join(credits) + '\n')

if __name__ == '__main__':
    main()
