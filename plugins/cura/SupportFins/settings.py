"""Support Fins settings for Cura: what the dialog shows and what the engine gets.

No Cura imports, so tests load it on its own. The settings themselves are the shared
options.json (the site's settings); this file only adds what is Cura's:

  * Layer height is Cura's own (hostSupplied: slicer): read from the profile, never
    asked, so it can't disagree with what Cura slices.
  * Material gets a first choice, "Match Cura": PLA or PETG follow the filament loaded
    for the part, anything else falls back to PLA and the readout says so.
  * Stale fins: tilting or scaling a part after its fins were added makes them wrong
    (they're a child object, so they tilt and scale WITH the part). Moving it, turning
    it about the vertical, or mirroring it doesn't: the fins follow and still fit.

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
        if isinstance(v, bool):
            return default
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


# Copolyesters weld to a support like PETG (web/materials.js), so they get PETG's
# wider clearances: PLA's would bite in and weld. Cura's bundled profiles call them
# PETG, PET, PET CF, CPE, CPE+, GFF CPE, CFF CPE; third parties add PCTG.
_PETG_LIKE = ("PETG", "PET", "CPE", "PCTG")


def cura_material(material_type):
    """Cura's material type (its 'material' metadata: "PLA", "Tough PLA", "PETG", "CPE",
    "ABS", ...) -> (engine material, what the readout says)."""
    name = material_type if material_type and material_type.lower() != "empty" else None
    t = (name or "").upper()
    if any(w in t.replace("+", " ").split() or t.startswith(w) for w in _PETG_LIKE):
        return "petg", f"PETG (Cura has {name})"
    if "PLA" in t:
        return "pla", f"PLA (Cura has {name})"
    return "pla", f"PLA (Cura has {name or 'no material'}, which fins have no profile for yet)"


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
    """A control's value as the dialog holds it -> the entry's units. A number field's
    text may use a decimal comma. Text that isn't a number is kept as typed, so Save
    refuses it by name instead of the field quietly saving something else."""
    o = next(o for o in schema["options"] if o["key"] == key)
    if o["type"] != "number":
        return shown
    if isinstance(shown, str):
        text = shown.strip().replace(",", ".")
        if text == "":
            return None                    # an emptied field: the default
        try:
            shown = float(text)
        except ValueError:
            return shown
    return float(shown) / (100 if o.get("percent") else 1)


def friendly_error(schema, message):
    """The engine's refusal ("sway.reach must be 0.05..0.5 (a percent control's value /
    100), got 0.9") in the dialog's own words and units: "Brace depth must be 5 to 50"."""
    for o in schema["options"]:
        if message.startswith(o["key"] + " "):
            if o["type"] == "number":
                k = 100 if o.get("percent") else 1
                unit = "%" if o.get("percent") else (" " + o["hint"] if o.get("hint") in ("mm", "°") else "")
                return f"{o['label']} must be a number from {_display(o['min'] * k):g} to {_display(o['max'] * k):g}{unit}"
            return f"{o['label']}: {message[len(o['key']) + 1:]}"
    return message


def _display(x):
    """0.15 * 100 is 15.000000000000002: round away float noise for the dialog."""
    return round(float(x), 6)


def pose(matrix):
    """What in a part's world transform decides its fins, as a plain tuple to keep on
    the fins node: which way is UP in the part's own frame (row 1 of the upper 3x3:
    Cura is Y-up), and its scale and shear (M^T M). A move, a turn about the vertical
    and a mirror leave both alone, and the fins (the part's child) still fit."""
    m = [[float(matrix[i][j]) for j in range(3)] for i in range(3)]
    up = m[1]
    gram = [sum(m[k][i] * m[k][j] for k in range(3)) for i in range(3) for j in range(i, 3)]
    return tuple(up + gram)


def is_stale(pose_then, matrix_now, tol=1e-6):
    """True when the part was tilted or scaled since its fins were computed."""
    if pose_then is None:
        return False
    return any(abs(a - b) > tol for a, b in zip(pose(matrix_now), pose_then))
