#!/usr/bin/env python3
"""Label each plugins-latest download with its plugin version and engine commit.

  python3 plugins/shared/release_labels.py DIST SHA   # one "path#label" line per file

The publish job feeds these lines to `gh release upload`, so every asset's label reads
e.g. "Fusion add-in 0.6.2 · engine 28ed79c". printfins.com's Plugins menu reads the
labels back through the GitHub API (CORS-open, unlike the download URLs) to show which
build each download is. A plugin with no version of its own (FreeCAD, the command line)
shows the engine commit only. Files no rule matches are an error, so a new download
can't go up unlabelled.
"""
import json
import pathlib
import re
import sys
import tomllib

PLUGINS = pathlib.Path(__file__).resolve().parent.parent


def _pep723():
    m = re.search(r'^# version = "([^"]+)"', (PLUGINS / "orca/src/support_fins_orca.py").read_text(), re.M)
    return m.group(1)


def _json(rel):
    return json.loads((PLUGINS / rel).read_text())["version"]


# (file name pattern, plugin name, its version or None)
RULES = [
    (r"support_fins_orca\.py", "OrcaSlicer plugin", _pep723),
    (r"SupportFins\.zip", "Fusion add-in", lambda: _json("fusion/SupportFins/SupportFins.manifest")),
    (r"SupportFins-(.+)\.curapackage", "Cura plugin", lambda: _json("cura/SupportFins/plugin.json")),
    (r"support-fins-prusa\.zip", "PrusaSlicer plugin", lambda: _json("prusa/com.printfins.support-fins/manifest.json")),
    (r"support_fins-(.+)\.zip", "Blender extension",
     lambda: tomllib.loads((PLUGINS / "blender/support_fins/blender_manifest.toml").read_text())["version"]),
    (r"support-fins-freecad-(.+)\.zip", "FreeCAD add-on", None),
    (r"support-fins\.mjs", "Command line", None),
]


def label(name, sha):
    for pattern, plugin, version in RULES:
        m = re.fullmatch(pattern, name)
        if m:
            parts = [plugin]
            if version:
                parts[0] += f" {version()}"
            if m.groups():
                parts.append(m.group(1))
            parts.append(f"engine {sha[:7]}")
            return " · ".join(parts)
    raise SystemExit(f"no label rule for {name}; add one to {__file__}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    dist, sha = pathlib.Path(sys.argv[1]), sys.argv[2]
    for f in sorted(dist.iterdir()):
        print(f"{f}#{label(f.name, sha)}")
