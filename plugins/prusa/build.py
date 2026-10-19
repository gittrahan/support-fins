#!/usr/bin/env python3
"""Package the PrusaSlicer plugin.

  python3 plugins/prusa/build.py      # -> plugins/prusa/build/support-fins-prusa.zip

The slicer loads the bundle folder, so the download is the folder zipped, its
manifest stamped with the plugin's version (plugins/shared/version.py). The Lua
port has no engine bundle, so its version moves only when this folder does.
"""
import pathlib
import sys
import zipfile

HERE = pathlib.Path(__file__).resolve().parent
BUNDLE = HERE / "com.printfins.support-fins"
OUT = HERE / "build" / "support-fins-prusa.zip"

sys.path.insert(0, str(HERE.parent / "shared"))
from version import version, stamp  # noqa: E402


def main():
    v = version([HERE])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(BUNDLE.rglob("*")):
            if not f.is_file() or f.name == ".DS_Store":
                continue
            arc = f.relative_to(HERE).as_posix()
            if f.name == "manifest.json" and f.parent == BUNDLE:
                z.writestr(arc, stamp(f.read_text(encoding="utf-8"), '"version": "0.7.0"',
                                      f'"version": "{v}"', "manifest.json"))
            else:
                z.write(f, arc)
    print(f"built {OUT.relative_to(HERE.parent.parent)} {v} ({OUT.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
