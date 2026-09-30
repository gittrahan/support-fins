#!/usr/bin/env python3
"""Build the single-file OrcaSlicer plugin.

  python3 plugins/orca/build.py            # -> plugins/orca/build/support_fins_orca.py

1. Bundles the printfins.com engine (web/*.js, untouched) plus the shared plugin
   bridge (plugins/shared/engine/bridge.js) into one IIFE (plugins/shared/bundle.py).
2. Inlines that bundle into src/support_fins_orca.py as ENGINE_JS, and each shared
   Python module in INLINE (plugins/shared/py/) at its marker line.

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
SHARED_PY = HERE.parent / "shared" / "py"
# shared module -> the marker line in src/support_fins_orca.py it replaces
INLINE = {
    "supportfins_host.py": "# __SUPPORTFINS_HOST__",
    "supportfins_slice.py": "# __SUPPORTFINS_SLICE__",
}

sys.path.insert(0, str(HERE.parent / "shared"))
from bundle import bundle_engine  # noqa: E402


def main():
    js = bundle_engine(OUT / "fins_engine.js")
    src = (HERE / "src" / "support_fins_orca.py").read_text(encoding="utf-8")
    if src.count(PLACEHOLDER) != 1:
        sys.exit("placeholder for the engine bundle not found exactly once in src/support_fins_orca.py")
    lines = src.splitlines(keepends=True)
    for name, marker in INLINE.items():
        at = [i for i, line in enumerate(lines) if line.startswith(marker)]
        if len(at) != 1:
            sys.exit(f"{marker} not found exactly once in src/support_fins_orca.py")
        code = (SHARED_PY / name).read_text(encoding="utf-8")
        lines[at[0]] = (f"# --- inlined from plugins/shared/py/{name} ---\n"
                        f"{code}# --- end {name[:-3]} ---\n")
    # json.dumps yields a valid Python string literal (ASCII, escaped).
    out = "".join(lines).replace(PLACEHOLDER, json.dumps(js))
    target = OUT / "support_fins_orca.py"
    target.write_text(out, encoding="utf-8")
    print(f"built {target.relative_to(HERE.parent.parent)} "
          f"({target.stat().st_size / 1024:.0f} KB, engine {len(js) / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
