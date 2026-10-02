#!/usr/bin/env python3
"""Build the FreeCAD add-on folder.

  python3 plugins/freecad/build.py                  # -> plugins/freecad/build/SupportFins/
  python3 plugins/freecad/build.py --install DIR    # + copy it to DIR/Mod/SupportFins
  python3 plugins/freecad/build.py --all            # + build/support-fins-freecad-<platform>.zip
                                                    #   for every platform (the downloads)

1. Copies SupportFins/ and the shared Python host (plugins/shared/py/supportfins_host.py).
2. Bundles the printfins.com engine (web/*.js, untouched) into fins_engine.js
   (plugins/shared/bundle.py; needs esbuild via npx), and copies options.json.
3. Vendors mini-racer (this machine's platform) into vendor/py_mini_racer/
   (plugins/shared/vendor.py): FreeCAD's bundled Python has no V8 of its own, and
   macOS FreeCAD ships no Qt WebEngine either, so this is the only runner.

A zip holds the SupportFins/ folder for one platform (the V8 library is that
platform's); users unzip it into DIR/Mod/. The platform names are Cura's
(plugins/shared/vendor.py PLATFORMS).

DIR is FreeCAD's user data folder (Help > About > Copy to clipboard shows it; on macOS
~/Library/Application Support/FreeCAD). Restart FreeCAD after installing.
"""
import pathlib
import shutil
import sys
import tempfile
import zipfile

HERE = pathlib.Path(__file__).resolve().parent
SHARED = HERE.parent / "shared"
OUT = HERE / "build"
ADDON = OUT / "SupportFins"
ROOT = HERE.parent.parent

sys.path.insert(0, str(SHARED))
from bundle import bundle_engine  # noqa: E402
from vendor import PLATFORMS, vendor_mini_racer, wheel_platform  # noqa: E402


def stage(dest, plat, engine_js):
    """The add-on folder for wheel platform `plat`, in dest/. Returns the wheel's name."""
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(HERE / "SupportFins", dest, ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copy2(SHARED / "py" / "supportfins_host.py", dest / "supportfins_host.py")
    shutil.copy2(SHARED / "engine" / "options.json", dest / "options.json")
    shutil.copy2(engine_js, dest / "fins_engine.js")
    return vendor_mini_racer(dest / "vendor", plat, OUT / "wheels")


def build():
    js = bundle_engine(OUT / "fins_engine.js")
    whl = stage(ADDON, wheel_platform(), OUT / "fins_engine.js")
    return len(js), whl


def package(plat):
    """build/support-fins-freecad-<platform>.zip: SupportFins/ for `plat`."""
    zip_path = OUT / f"support-fins-freecad-{PLATFORMS[plat][0]}.zip"
    with tempfile.TemporaryDirectory(dir=OUT) as tmp:
        tree = pathlib.Path(tmp) / "SupportFins"
        stage(tree, plat, OUT / "fins_engine.js")
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
            for f in sorted(tree.rglob("*")):
                if f.is_file():
                    z.write(f, f.relative_to(tree.parent).as_posix())
    return zip_path


def main():
    args = sys.argv[1:]
    dest = None
    every = args == ["--all"]
    if args[:1] == ["--install"]:
        if len(args) != 2:
            sys.exit("--install takes FreeCAD's user data folder")
        dest = pathlib.Path(args[1]).expanduser() / "Mod" / "SupportFins"
    elif args and not every:
        sys.exit(f"unknown arguments {' '.join(args)}; see the docstring")
    js, whl = build()
    size = sum(p.stat().st_size for p in ADDON.rglob("*") if p.is_file())
    print(f"built {ADDON.relative_to(ROOT)} ({size / 1e6:.0f} MB; engine {js / 1024:.0f} KB; {whl})")
    if dest:
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(ADDON, dest)
        print(f"installed to {dest}")
    if every:
        for old in OUT.glob("support-fins-freecad-*.zip"):
            old.unlink()                 # no stale zips next to fresh ones
        for plat in PLATFORMS:
            z = package(plat)
            print(f"built {z.relative_to(ROOT)} ({z.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
