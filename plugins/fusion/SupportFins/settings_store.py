"""The dialogs' settings, remembered between sessions in a JSON file next to the add-in.

Both commands share the file (and the layer height, which has to match the
slicer either way). Each saves only its own keys and keeps the other's.
"""

import json
import os

PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'settings.json')

DEFAULTS = {
    # Insert Sway Brace
    'mode': 'pick',          # 'pick' or 'auto'
    'material': 'PLA',
    'layer_height': 0.2,     # mm (both commands)
    'gap': 0.2,              # mm
    'bite': 0.3,             # mm
    'tine_spacing': 6.0,     # mm
    'grip_from': 0.0,        # mm
    'depth_pct': 15,         # % of rib height
    'tines': True,
    # Insert Support Fins (the website's defaults)
    'fin_style': 'auto',     # 'auto', 'prop' or 'stabilize'
    'fin_tines': True,
    'fin_tine_density': 0,   # % (website slider 0..1)
    'fin_coverage': 50,      # % (website slider 0..1)
    'fin_bed_pad': True,
}


def _read():
    try:
        with open(PATH, encoding='utf-8') as fh:
            saved = json.load(fh)
        return saved if isinstance(saved, dict) else {}
    except (OSError, ValueError):
        return {}


def load():
    s = dict(DEFAULTS)
    s.update({k: v for k, v in _read().items() if k in DEFAULTS})
    return s


def save(s):
    merged = {k: v for k, v in _read().items() if k in DEFAULTS}
    merged.update({k: s[k] for k in DEFAULTS if k in s})
    try:
        with open(PATH, 'w', encoding='utf-8') as fh:
            json.dump(merged, fh, indent=2)
    except OSError:
        pass
