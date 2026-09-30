#!/usr/bin/env python3
"""Build the FreeCAD add-on folder.

  python3 plugins/freecad/build.py                  # -> plugins/freecad/build/SupportFins/
  python3 plugins/freecad/build.py --install DIR    # + copy it to DIR/Mod/SupportFins

1. Copies SupportFins/ and the shared Python host (plugins/shared/py/supportfins_host.py).
2. Bundles the printfins.com engine (web/*.js, untouched) into fins_engine.js
   (plugins/shared/bundle.py; needs esbuild via npx), and copies options.json.
3. Vendors mini-racer (this machine's platform) into vendor/py_mini_racer/
   (plugins/shared/vendor.py): FreeCAD's bundled Python has no V8 of its own, and
   macOS FreeCAD ships no Qt WebEngine either, so this is the only runner.

DIR is FreeCAD's user data folder (Help > About > Copy to clipboard shows it; on macOS
~/Library/Application Support/FreeCAD). Restart FreeCAD after installing.
"""
import pathlib
import shutil
import sys

HERE = pathlib.Path(__file__).resolve().parent
SHARED = HERE.parent / "shared"
OUT = HERE / "build"
ADDON = OUT / "SupportFins"
ROOT = HERE.parent.parent

sys.path.insert(0, str(SHARED))
from bundle import bundle_engine  # noqa: E402
from vendor import vendor_mini_racer, wheel_platform  # noqa: E402


def build():
    if ADDON.exists():
        shutil.rmtree(ADDON)
    shutil.copytree(HERE / "SupportFins", ADDON, ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copy2(SHARED / "py" / "supportfins_host.py", ADDON / "supportfins_host.py")
    shutil.copy2(SHARED / "engine" / "options.json", ADDON / "options.json")
    js = bundle_engine(ADDON / "fins_engine.js")
    whl = vendor_mini_racer(ADDON / "vendor", wheel_platform(), OUT / "wheels")
    return len(js), whl


def main():
    args = sys.argv[1:]
    dest = None
    if args[:1] == ["--install"]:
        if len(args) != 2:
            sys.exit("--install takes FreeCAD's user data folder")
        dest = pathlib.Path(args[1]).expanduser() / "Mod" / "SupportFins"
    elif args:
        sys.exit(f"unknown arguments {' '.join(args)}; see the docstring")
    js, whl = build()
    size = sum(p.stat().st_size for p in ADDON.rglob("*") if p.is_file())
    print(f"built {ADDON.relative_to(ROOT)} ({size / 1e6:.0f} MB; engine {js / 1024:.0f} KB; {whl})")
    if dest:
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(ADDON, dest)
        print(f"installed to {dest}")


if __name__ == "__main__":
    main()
