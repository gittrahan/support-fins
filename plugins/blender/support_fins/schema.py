# SPDX-License-Identifier: GPL-3.0-or-later
"""options.json -> Blender properties, and back to the engine's dialog values.

No bpy imports, so tests run in plain Python. The panel's settings are properties
generated from options.json (the one schema every plugin's dialog is built from,
plugins/shared/README.md), so a new engine option shows up here without touching
this add-on, with the site's label, range, default and tooltip.

Units: a percent option shows 0-100 like the site's slider and goes to the engine
as value / 100. A host-supplied number (layer height) keeps options.json's range as
a soft range only: the user's own value is used as is.
"""


def prop_name(key):
    """'sway.on' -> 'sway_on': a Blender property name for an options.json key."""
    return key.replace(".", "_")


def _unit(option):
    hint = option.get("hint", "")
    return hint.split(" ")[0] if hint.startswith(("mm", "°")) else ""


def _decimals(step):
    text = f"{step:.6f}".rstrip("0")
    return max(0, len(text.split(".")[1])) if "." in text else 0


def specs(schema):
    """One dict per option, what a bpy property needs:
    key, name (property name), kind ('bool' | 'float' | 'enum'), label, description,
    default and, by kind: items (enum); min/max or soft_min/soft_max, step, precision,
    percent (float). Float values are in the PROPERTY's units (percent = x 100)."""
    sections = {s["id"]: s["label"] for s in schema["sections"]}
    out = []
    for o in schema["options"]:
        unit = _unit(o)
        spec = {"key": o["key"], "name": prop_name(o["key"]), "section": sections[o["section"]],
                "label": o["label"] + (f" ({unit})" if unit else ""),
                "description": o.get("tooltip", "")}
        if o["type"] == "bool":
            spec.update(kind="bool", default=bool(o["default"]))
        elif o["type"] == "choice":
            spec.update(kind="enum", default=o["default"],
                        items=[(c["value"], c["label"], "") for c in o["choices"]])
        else:
            scale = 100.0 if o.get("percent") else 1.0
            step = o["step"] * scale
            spec.update(kind="float", default=float(o["default"]) * scale, percent=bool(o.get("percent")),
                        # Blender's step is in hundredths, 1..100
                        step=min(100, max(1, round(step * 100))), precision=_decimals(step),
                        slider=bool(o.get("slider")))
            lo, hi = o["min"] * scale, o["max"] * scale
            if o.get("hostSupplied"):
                spec.update(min=0.001, soft_min=lo, soft_max=hi)
            else:
                spec.update(min=lo, max=hi)
        out.append(spec)
    names = [s["name"] for s in out]
    dupes = {n for n in names if names.count(n) > 1}
    if dupes:
        raise ValueError(f"options.json keys give duplicate property names: {sorted(dupes)}")
    return out


def dialog_values(schema, read):
    """{options.json key: value in the ENGINE's units} from the properties.
    read(name) -> the property's value. Pass the result to supportfins_host.host_options,
    which checks it."""
    values = {}
    for s in specs(schema):
        v = read(s["name"])
        if s["kind"] == "float":
            v = float(v) / 100.0 if s["percent"] else float(v)
        elif s["kind"] == "bool":
            v = bool(v)
        values[s["key"]] = v
    return values


def sections(schema):
    """[(section label, [spec, ...])] in options.json's order, for the panel."""
    by = {}
    for s in specs(schema):
        by.setdefault(s["section"], []).append(s)
    return [(sec["label"], by[sec["label"]]) for sec in schema["sections"] if sec["label"] in by]
