#!/usr/bin/env python3
"""Build the single-file OrcaSlicer plugin.

  python3 plugins/orca/build.py            # -> plugins/orca/build/support_fins_orca.py

1. Bundles the printfins.com engine (web/*.js, untouched) plus the shared plugin
   bridge (plugins/shared/engine/bridge.js) into one IIFE (plugins/shared/bundle.py).
2. Inlines that bundle into src/support_fins_orca.py as ENGINE_JS.

The result is ONE .py file: drop it into OrcaSlicer (Plugins > Install local
plugin, or <data_dir>/orca_plugins/). Orca installs numpy and mini-racer itself
from the PEP 723 header on first load (it bundles uv for that).

Needs esbuild: see plugins/shared/bundle.py.
"""
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE / "build"
PLACEHOLDER = '"__FINS_ENGINE_JS__"'

sys.path.insert(0, str(HERE.parent / "shared"))
from bundle import bundle_engine  # noqa: E402


def main():
    js = bundle_engine(OUT / "fins_engine.js")
    src = (HERE / "src" / "support_fins_orca.py").read_text(encoding="utf-8")
    if src.count(PLACEHOLDER) != 1:
        sys.exit("placeholder for the engine bundle not found exactly once in src/support_fins_orca.py")
    # json.dumps yields a valid Python string literal (ASCII, escaped).
    out = src.replace(PLACEHOLDER, json.dumps(js))
    target = OUT / "support_fins_orca.py"
    target.write_text(out, encoding="utf-8")
    print(f"built {target.relative_to(HERE.parent.parent)} "
          f"({target.stat().st_size / 1024:.0f} KB, engine {len(js) / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
