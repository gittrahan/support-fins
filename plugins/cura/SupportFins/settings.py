"""Support Fins settings for Cura: what the dialog shows and what the engine gets.

No Cura imports, so tests load it on its own. The settings themselves are the shared
options.json (the site's settings); this file only adds what is Cura's:

  * Layer height is Cura's own (hostSupplied: slicer): read from the profile, never
    asked, so it can't disagree with what Cura slices.
  * Material gets a first choice, "Match Cura": PLA or PETG follow the filament loaded
    for the part, anything else falls back to PLA and the readout says so.
  * Stale fins: rotating or scaling a part after its fins were added makes them wrong
    (they're a child object, so they rotate and scale WITH the part); moving doesn't.

Values are kept in the ENTRY's units ({options.json key: value}); the dialog shows a
percent option x 100. They go to the engine through host_options, which checks them.
"""
import json

PREF = "support_fins/settings"   # one Cura preference: the dialog's values as JSON
MATCH_CURA = "cura"              # the Material choice that follows Cura's filament


def load(schema, stored):
    """Saved values (the preference's JSON string, or '') -> {key: value} for every
    option this host shows. Unknown or unreadable entries fall back to the default,
    so a schema change between versions never breaks the dialog."""
    try:
        saved = json.loads(stored) if stored else {}
    except ValueError:
        saved = {}
    if not isinstance(saved, dict):
        saved = {}
    values = {}
    for o in shown_options(schema):
        default = MATCH_CURA if o["key"] == "material" else o["default"]
        values[o["key"]] = _stored(o, saved.get(o["key"]), default)
    return values


def _stored(o, v, default):
    """A saved value as the dialog holds it. Settings files can hand back strings
    ("false", "0.5"); anything unreadable is the default rather than a guess."""
    if v is None:
        return default
    if o["type"] == "bool":
        if isinstance(v, bool):
            return v
        return {"true": True, "false": False}.get(str(v).lower(), default)
    if o["type"] == "number":
        try:
            n = float(v)
        except (TypeError, ValueError):
            return default
        return n if o["min"] <= n <= o["max"] else default
    ok = [c["value"] for c in o["choices"]] + ([MATCH_CURA] if o["key"] == "material" else [])
    return v if v in ok else default


def dump(values):
    return json.dumps(values, sort_keys=True)


def shown_options(schema):
    """The options a Cura dialog shows: all but the ones the slicer supplies itself."""
    return [o for o in schema["options"] if o.get("hostSupplied") != "slicer"]


def cura_material(material_type):
    """Cura's material type (its 'material' metadata: "PLA", "Tough PLA", "PETG", "ABS",
    ...) -> (engine material, what the readout says)."""
    t = (material_type or "").upper()
    if "PETG" in t:
        return "petg", f"PETG (Cura has {material_type})"
    if "PLA" in t:
        return "pla", f"PLA (Cura has {material_type})"
    shown = material_type or "no material"
    return "pla", f"PLA (Cura has {shown}, which fins have no profile for yet)"


def engine_values(values, material_type, layer_height):
    """Dialog values -> the {key: value} host_options takes, for one part.
    Returns (values, material line for the readout)."""
    out = dict(values)
    note = None
    if out.get("material", MATCH_CURA) == MATCH_CURA:
        out["material"], note = cura_material(material_type)
    else:
        note = f"{out['material'].upper()} (set in Support Fins settings)"
    out["layerHeight"] = float(layer_height)
    return out, note


def rows(schema, values, material_type):
    """What the QML dialog draws: one row per shown option, in the dialog's units
    (percent x 100), with the section heading on each section's first row."""
    titles = {s["id"]: s["label"] for s in schema["sections"]}
    out, last = [], None
    for o in shown_options(schema):
        k = 100 if o.get("percent") else 1
        row = {
            "key": o["key"], "type": o["type"], "label": o["label"], "hint": o.get("hint", ""),
            "tooltip": o["tooltip"], "slider": bool(o.get("slider")), "percent": bool(o.get("percent")),
            "section": titles[o["section"]] if o["section"] != last else "",
        }
        last = o["section"]
        v = values.get(o["key"], o["default"])
        if o["type"] == "number":
            row.update(value=_display(v * k), min=_display(o["min"] * k),
                       max=_display(o["max"] * k), step=_display(o["step"] * k))
        elif o["type"] == "choice":
            choices = [{"value": c["value"], "label": c["label"]} for c in o["choices"]]
            if o["key"] == "material":
                mat, note = cura_material(material_type)
                now = f"PLA, no profile for {material_type or 'none'}" if "no profile" in note else mat.upper()
                choices.insert(0, {"value": MATCH_CURA, "label": f"Match Cura (now {now})"})
            row.update(choices=choices, index=next(
                (i for i, c in enumerate(choices) if c["value"] == v), 0))
        else:
            row.update(value=bool(v))
        out.append(row)
    return out


def from_dialog(schema, key, shown):
    """A control's value as the dialog holds it -> the entry's units."""
    o = next(o for o in schema["options"] if o["key"] == key)
    if o["type"] == "number":
        return float(shown) / (100 if o.get("percent") else 1)
    return shown


def _display(x):
    """0.15 * 100 is 15.000000000000002: round away float noise for the dialog."""
    return round(float(x), 6)


def pose(matrix):
    """The part of a world transform that changes the fins (rotation + scale): its
    upper 3x3, as a plain tuple so it can be kept on the fins node."""
    return tuple(round(float(matrix[i][j]), 6) for i in range(3) for j in range(3))


def is_stale(pose_then, matrix_now):
    """True when the part was rotated or scaled since its fins were computed.
    Moving it (translation only) keeps the fins right: they're its child."""
    return pose_then is not None and pose(matrix_now) != tuple(pose_then)
