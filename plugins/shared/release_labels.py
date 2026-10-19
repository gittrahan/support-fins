#!/usr/bin/env python3
"""Label each plugins-latest download with its plugin version and engine commit.

  python3 plugins/shared/release_labels.py DIST SHA   # one "path#label" line per file

The publish job feeds these lines to `gh release upload`, so every asset's label reads
e.g. "Fusion add-in 0.7.754 · engine 28ed79c". printfins.com's Plugins menu reads the
labels back through the GitHub API (CORS-open, unlike the download URLs) to show which
build each download is. The version is the one the plugin's build stamped into it
(version.py, from the same checkout). Files no rule matches are an error, so a new
download can't go up unlabelled.
"""
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from version import all_versions  # noqa: E402

# (file name pattern, plugin name, its folder under plugins/)
RULES = [
    (r"support_fins_orca\.py", "OrcaSlicer plugin", "orca"),
    (r"SupportFins\.zip", "Fusion add-in", "fusion"),
    (r"SupportFins-(.+)\.curapackage", "Cura plugin", "cura"),
    (r"support-fins-prusa\.zip", "PrusaSlicer plugin", "prusa"),
    (r"support_fins-(.+)\.zip", "Blender extension", "blender"),
    (r"support-fins-freecad-(.+)\.zip", "FreeCAD add-on", "freecad"),
    (r"support-fins-solidworks\.zip", "SolidWorks add-in", "solidworks"),
    (r"support-fins\.mjs", "Command line", "cli"),
    (r"support-fins-mcp\.mjs", "MCP server", "mcp"),
]


def label(name, sha, versions):
    for pattern, plugin, folder in RULES:
        m = re.fullmatch(pattern, name)
        if m:
            parts = [f"{plugin} {versions[folder]}"]
            if m.groups():
                parts.append(m.group(1))
            parts.append(f"engine {sha[:7]}")
            return " · ".join(parts)
    raise SystemExit(f"no label rule for {name}; add one to {__file__}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    dist, sha = pathlib.Path(sys.argv[1]), sys.argv[2]
    versions = all_versions()
    for f in sorted(dist.iterdir()):
        print(f"{f}#{label(f.name, sha, versions)}")
