"""options.json -> FreeCAD properties, and back to the engine's dialog values.

No FreeCAD imports, so tests run in plain Python. The fins object's settings are
ordinary properties generated from options.json (the one schema every plugin's
dialog is built from): the property editor IS the dialog, and a new engine option
shows up here without touching this add-on.

Units: a percent option is an App::PropertyPercent (0-100, like the site's slider)
and goes to the engine as value / 100. Other numbers are App::PropertyFloatConstraint
with options.json's range and step, so the editor can't hold a value the engine would
refuse (FreeCAD 1.0's Length/Angle properties take no limits); the unit goes in the
tooltip. The exception is a host-supplied number (layer height): its range is the
dialog's, not a limit, so it's an App::PropertyLength and any positive value goes.
"""
import re

GROUP = "Support Fins"


def prop_name(option):
    """'Wide-face coverage' -> 'WideFaceCoverage': the label, as a property name."""
    return "".join(w[:1].upper() + w[1:] for w in re.split(r"[^A-Za-z0-9]+", option["label"]) if w)


def prop_type(option):
    t = option["type"]
    if t == "bool":
        return "App::PropertyBool"
    if t == "choice":
        return "App::PropertyEnumeration"
    if option.get("percent"):
        return "App::PropertyPercent"
    if option.get("hostSupplied"):
        return "App::PropertyLength"
    return "App::PropertyFloatConstraint"


def specs(schema):
    """One dict per option: key, name, type, group, tooltip, default (property units)
    and, for a choice, its labels in order."""
    sections = {s["id"]: s["label"] for s in schema["sections"]}
    out = []
    for o in schema["options"]:
        unit = o.get("hint", "").split(" ")[0] if o.get("hint", "").startswith(("mm", "°")) else ""
        tip = o.get("tooltip", "") + (f" ({unit})" if unit else "")
        spec = {"key": o["key"], "name": prop_name(o), "type": prop_type(o),
                "group": f"{GROUP}: {sections[o['section']]}", "tooltip": tip}
        if o["type"] == "choice":
            spec["labels"] = [c["label"] for c in o["choices"]]
            spec["default"] = next(c["label"] for c in o["choices"] if c["value"] == o["default"])
        elif o.get("percent"):
            spec["default"] = int(round(o["default"] * 100))
        elif spec["type"] == "App::PropertyFloatConstraint":
            # FreeCAD sets a constraint from (value, min, max, step)
            spec["default"] = (float(o["default"]), float(o["min"]), float(o["max"]), float(o["step"]))
        else:
            spec["default"] = o["default"]
        out.append(spec)
    names = [s["name"] for s in out]
    dupes = {n for n in names if names.count(n) > 1}
    if dupes:
        raise ValueError(f"options.json labels give duplicate property names: {sorted(dupes)}")
    return out


def dialog_values(schema, read):
    """{options.json key: value in the ENGINE's units} from the object's properties.

    read(name) -> the property's value: a bool, an enumeration label, an int percent,
    a float, or a FreeCAD Quantity (anything with .Value, in mm).
    Pass the result to supportfins_host.host_options, which checks it.
    """
    by_key = {o["key"]: o for o in schema["options"]}
    values = {}
    for s in specs(schema):
        o, v = by_key[s["key"]], read(s["name"])
        if o["type"] == "choice":
            v = next(c["value"] for c in o["choices"] if c["label"] == v)
        elif o["type"] == "number":
            v = float(getattr(v, "Value", v))
            if o.get("percent"):
                v = v / 100.0
        values[s["key"]] = v
    return values
