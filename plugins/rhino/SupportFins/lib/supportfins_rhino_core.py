"""Support Fins for Rhino: the parts that don't need Rhino, so tests run in plain Python.

  specs / dialog_values   options.json -> the settings dialog's controls, and back to
                          the engine's dialog values (supportfins_host.host_options checks
                          them). A new engine option shows up in the dialog without
                          touching the plugin.
  load_values / dump_values
                          the dialog's values as saved in the .3dm (document strings,
                          one JSON entry), so a file's fins can be rebuilt as they were
  weld                    (K,3,3) triangles -> vertices + faces for a Rhino mesh
  piece_name              what each fin object is called in the document

Units: a percent option shows 0-100 like the site's slider and goes to the engine as
value / 100. A host-supplied number (layer height) keeps options.json's range as the
dialog's range only: any positive value goes.
"""
import json

KIND_NAMES = {"prop": "wall", "sway": "sway brace", "pad": "bed pad", "wedge": "wedge"}


def _unit(option):
    hint = option.get("hint", "")
    return hint.split(" ")[0] if hint.startswith(("mm", "°")) else ""


def _decimals(step):
    text = f"{step:.6f}".rstrip("0")
    return len(text.split(".")[1]) if "." in text else 0


def specs(schema):
    """One dict per option, what an Eto control needs: key, kind ('bool' | 'number' |
    'choice'), section (label), label, tooltip, default and, by kind: choices
    [(value, label)]; min, max, step, decimals, percent. Numbers are in the CONTROL's
    units (percent = x 100)."""
    sections = {s["id"]: s["label"] for s in schema["sections"]}
    out = []
    for o in schema["options"]:
        unit = _unit(o)
        spec = {"key": o["key"], "kind": o["type"], "section": sections[o["section"]],
                "label": o["label"] + (f" ({unit})" if unit else ""), "tooltip": o.get("tooltip", "")}
        if o["type"] == "bool":
            spec["default"] = bool(o["default"])
        elif o["type"] == "choice":
            spec["default"] = o["default"]
            spec["choices"] = [(c["value"], c["label"]) for c in o["choices"]]
        else:
            scale = 100.0 if o.get("percent") else 1.0
            step = o["step"] * scale
            spec.update(default=float(o["default"]) * scale, percent=bool(o.get("percent")),
                        step=step, decimals=_decimals(step),
                        min=0.001 if o.get("hostSupplied") else o["min"] * scale,
                        max=1e6 if o.get("hostSupplied") else o["max"] * scale)
        out.append(spec)
    return out


def sections(schema):
    """[(section label, [spec, ...])] in options.json's order, for the dialog."""
    by = {}
    for s in specs(schema):
        by.setdefault(s["section"], []).append(s)
    return [(sec["label"], by[sec["label"]]) for sec in schema["sections"] if sec["label"] in by]


def defaults(schema):
    """{key: control value} at the site's defaults."""
    return {s["key"]: s["default"] for s in specs(schema)}


def dialog_values(schema, controls):
    """{options.json key: value in the ENGINE's units} from {key: control value}.
    A key missing from `controls` takes its default."""
    values = {}
    for s in specs(schema):
        v = controls.get(s["key"], s["default"])
        if s["kind"] == "number":
            # six places: an Eto stepper's double can carry float noise past the range
            v = round(float(v) / 100.0 if s["percent"] else float(v), 6)
        elif s["kind"] == "bool":
            v = bool(v)
        values[s["key"]] = v
    return values


def load_values(schema, text):
    """The dialog's control values saved in a document (dump_values' text, or None).
    Keys the engine no longer takes are dropped, a choice no longer offered or a
    value of the wrong type or out of range falls back to the default, and new
    options take theirs."""
    out = defaults(schema)
    try:
        saved = json.loads(text) if text else {}
    except ValueError:
        saved = {}
    if not isinstance(saved, dict):
        saved = {}
    for s in specs(schema):
        v = saved.get(s["key"])
        if s["kind"] == "bool" and isinstance(v, bool):
            out[s["key"]] = v
        elif s["kind"] == "choice" and v in [c[0] for c in s["choices"]]:
            out[s["key"]] = v
        elif s["kind"] == "number" and isinstance(v, (int, float)) and not isinstance(v, bool) \
                and s["min"] <= v <= s["max"]:
            out[s["key"]] = float(v)
    return out


def dump_values(controls):
    return json.dumps(controls, sort_keys=True)


def weld(tris):
    """(K,3,3) triangles -> (vertices (N,3), faces (F,3)). Vertices are merged only
    where they are identical: no tolerance that could close a print gap. Triangles
    the weld collapses are dropped (a Rhino mesh face needs three vertices)."""
    import numpy as np
    verts, inverse = np.unique(np.ascontiguousarray(tris, dtype=np.float64).reshape(-1, 3),
                               axis=0, return_inverse=True)
    faces = inverse.reshape(-1, 3)
    keep = (faces[:, 0] != faces[:, 1]) & (faces[:, 1] != faces[:, 2]) & (faces[:, 0] != faces[:, 2])
    return verts, faces[keep]


def piece_name(part_name, piece):
    """'Bracket wall 3', 'Bracket bed pad': one object per engine piece."""
    label = KIND_NAMES.get(piece["kind"], piece["kind"])
    return f"{part_name} {label}" if piece["kind"] == "pad" else f"{part_name} {label} {piece['id']}"
