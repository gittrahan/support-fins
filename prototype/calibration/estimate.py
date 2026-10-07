#!/usr/bin/env python3
"""Copy the user-facing coupons into the site and slice each for its time and filament.

The site serves only web/, so the Calibrate menu's files are copies of the coupons'
committed print/ files in web/calibration/ (tests/calibrate.test.js checks they still
match). Each is sliced once with PrusaSlicer's command line at its default profile
(the printer it starts on, PLA, 0.2 mm layers, no slicer supports) and the
estimate goes in web/calibration/coupons.json, which the menu shows on each row.

    python3 prototype/calibration/estimate.py          # after any coupon's print/ changes

PRUSASLICER=/path/to/PrusaSlicer overrides the binary.
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
WEB = HERE.parent.parent / 'web' / 'calibration'
# menu order; the file each row downloads (web/ui/calibrate.js lists the same names)
COUPONS = [
    ('angle', 'angle-coupon.stl'),
    ('gap', 'gap-coupon.3mf'),
    ('grip', 'grip-coupon.3mf'),
    ('pad', 'pad-coupon.3mf'),
    ('bore', 'bore-coupon.3mf'),
    ('sampler', 'sampler-coupon.3mf'),
]
SLICER = os.environ.get('PRUSASLICER') or next(
    (str(p) for p in sorted(Path('/Applications').glob('PrusaSlicer*.app/Contents/MacOS/PrusaSlicer'))), 'prusa-slicer')
# G-code printer_model -> the name a user knows
PRINTERS = {'COREONE': 'Core One', 'MK4S': 'MK4S', 'MK4': 'MK4', 'MINI': 'MINI', 'XL': 'XL'}


def minutes(text):
    """'1h 5m 59s' -> 66 (rounded up to the minute)"""
    d = {u: int(n) for n, u in re.findall(r'(\d+)([dhms])', text)}
    s = d.get('d', 0) * 86400 + d.get('h', 0) * 3600 + d.get('m', 0) * 60 + d.get('s', 0)
    return -(-s // 60)


def slice_one(src, tmp):
    out = Path(tmp) / (src.stem + '.gcode')
    # --center: a 3MF's objects may sit off the default bed; centring moves them
    # together, so a two-object coupon stays in register. No supports flag: the
    # default profile's 'enforcers only' already adds none (and --support-material=0
    # aborts PrusaSlicer 3.0 alpha12)
    subprocess.run([SLICER, '--export-gcode', '--center', '125,105',
                    '-o', str(out), str(src)], check=True, capture_output=True)
    g = out.read_text(errors='replace')
    if not re.search(r'^; printer_model = \S', g, re.M):
        raise SystemExit(f'{src.name}: the slicer named no printer profile -- run PrusaSlicer once to pick one')
    pick = lambda key: re.search(rf'^; {re.escape(key)} = (.*)$', g, re.M).group(1).strip()
    return {
        'minutes': minutes(pick('estimated printing time (normal mode)')),
        'grams': round(float(pick('total filament used [g]')), 1),
        'profile': f"PrusaSlicer, {PRINTERS.get(pick('printer_model'), pick('printer_model'))}, "
                   f"{pick('filament_type')}, {pick('layer_height')} mm layers",
    }


def main():
    WEB.mkdir(parents=True, exist_ok=True)
    data, profile = {}, None
    with tempfile.TemporaryDirectory() as tmp:
        for name, file in COUPONS:
            src = HERE / name / 'print' / file
            shutil.copyfile(src, WEB / file)
            est = slice_one(src, tmp)
            profile = profile or est['profile']
            # the hash ties the estimate to this exact file (tests/calibrate.test.js)
            data[file] = {'minutes': est['minutes'], 'grams': est['grams'],
                          'sha256': hashlib.sha256(src.read_bytes()).hexdigest()}
            print(f"{file}: {est['minutes']} min, {est['grams']} g")
    (WEB / 'coupons.json').write_text(json.dumps({'profile': profile, 'coupons': data}, indent=2) + '\n')
    print(f'-> {WEB / "coupons.json"} ({profile})')


if __name__ == '__main__':
    main()
