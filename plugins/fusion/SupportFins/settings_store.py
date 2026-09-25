"""The dialog's settings, remembered between sessions in a JSON file next to the add-in."""

import json
import os

PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'settings.json')

DEFAULTS = {
    'mode': 'pick',          # 'pick' or 'auto'
    'material': 'PLA',
    'layer_height': 0.2,     # mm
    'gap': 0.2,              # mm
    'bite': 0.3,             # mm
    'tine_spacing': 6.0,     # mm
    'grip_from': 0.0,        # mm
    'depth_pct': 15,         # % of rib height
    'tines': True,
}


def load():
    s = dict(DEFAULTS)
    try:
        with open(PATH, encoding='utf-8') as fh:
            saved = json.load(fh)
        s.update({k: v for k, v in saved.items() if k in DEFAULTS})
    except (OSError, ValueError):
        pass
    return s


def save(s):
    try:
        with open(PATH, 'w', encoding='utf-8') as fh:
            json.dump({k: s[k] for k in DEFAULTS if k in s}, fh, indent=2)
    except OSError:
        pass
