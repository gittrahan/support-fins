#!/usr/bin/env python3
"""Build the Blender extension (one zip per platform).

  python3 plugins/blender/build.py                      # this machine's platform
  python3 plugins/blender/build.py --platform macos-x64
  python3 plugins/blender/build.py --all                # every platform in BLENDER

-> plugins/blender/build/support_fins-<platform>.zip. Install it in Blender:
Edit > Preferences > Get Extensions > (menu) Install from Disk.

1. Copies support_fins/ and the shared Python host (plugins/shared/py/supportfins_host.py),
   and options.json, the schema the panel is built from.
2. Bundles the printfins.com engine (web/*.js, untouched) into fins_engine.js
   (plugins/shared/bundle.py; needs esbuild via npx).
3. Ships the mini-racer wheel for the platform and lists it in blender_manifest.toml:
   Blender installs an extension's wheels itself, so nothing is vendored by hand.
   Wheels are cached in build/wheels/ (plugins/shared/vendor.py). The wheel is
   flattened first (flat_wheel): Blender before 4.4 can't install mini-racer as
   published.
"""
import argparse
import csv
import io
import pathlib
import shutil
import sys
import tempfile
import zipfile

HERE = pathlib.Path(__file__).resolve().parent
SHARED = HERE.parent / "shared"
ROOT = HERE.parent.parent
OUT = HERE / "build"

sys.path.insert(0, str(SHARED))
from bundle import bundle_engine  # noqa: E402
from vendor import mini_racer_wheel, wheel_platform  # noqa: E402

# Blender's platform name -> mini-racer's wheel tag (the ones plugins/shared/vendor.py
# knows). Blender ships no Linux ARM build; mini-racer has no Windows ARM wheel.
BLENDER = {
    "macos-arm64": "macosx_11_0_arm64",
    "macos-x64": "macosx_10_9_x86_64",
    "windows-x64": "win_amd64",
    "linux-x64": "manylinux_2_27_x86_64",
}


def this_platform():
    tag = wheel_platform()
    for p, t in BLENDER.items():
        if t == tag:
            return p
    sys.exit(f"no Blender build for this machine ({tag}); pass --platform or --all")


def flat_wheel(src, dest_dir):
    """mini-racer's wheel with its package at the root, written to dest_dir/<same name>.

    It is published with py_mini_racer/ under mini_racer-X.data/purelib/. Blender 4.4+
    maps that into site-packages; 4.2 and 4.3 unpack it as is, so `import py_mini_racer`
    fails (seen in CI on 4.2.23). Moving the package to the root is the same install
    for every Blender and for pip: same files, same hashes, RECORD's paths updated.
    """
    dest = pathlib.Path(dest_dir) / pathlib.Path(src).name
    with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as zout:
        prefix = next(n.split("/", 1)[0] for n in zin.namelist() if ".data/" in n) + "/"
        def flat(name):
            for scheme in ("purelib/", "platlib/"):
                if name.startswith(prefix + scheme):
                    return name[len(prefix + scheme):]
            return name
        for info in zin.infolist():
            data = zin.read(info)
            if info.filename.endswith(".dist-info/RECORD"):
                rows = list(csv.reader(io.StringIO(data.decode("utf-8"))))
                out = io.StringIO()
                csv.writer(out, lineterminator="\n").writerows([[flat(r[0])] + r[1:] for r in rows if r])
                data = out.getvalue().encode("utf-8")
            info.filename = flat(info.filename)
            zout.writestr(info, data)
    return dest


def stage(dest, platform, engine_js):
    """The extension's files for `platform`, in dest/."""
    shutil.copytree(HERE / "support_fins", dest, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    shutil.copy2(SHARED / "py" / "supportfins_host.py", dest / "supportfins_host.py")
    shutil.copy2(SHARED / "engine" / "options.json", dest / "options.json")
    shutil.copy2(engine_js, dest / "fins_engine.js")
    shutil.copy2(HERE / "LICENSE", dest / "LICENSE")
    shutil.copy2(ROOT / "LICENSE", dest / "LICENSE-engine")   # web/*.js in the bundle: MIT
    whl = mini_racer_wheel(BLENDER[platform], OUT / "wheels")
    (dest / "wheels").mkdir()
    flat_wheel(whl, dest / "wheels")
    manifest = dest / "blender_manifest.toml"
    text = manifest.read_text(encoding="utf-8")
    # top-level keys: before the first [table], if there is one
    extra = f'platforms = ["{platform}"]\nwheels = ["./wheels/{whl.name}"]\n'
    at = text.find("\n[")
    text = text + extra if at < 0 else text[:at + 1] + extra + text[at:]
    manifest.write_text(text, encoding="utf-8")


def build(platform, engine_js):
    OUT.mkdir(exist_ok=True)
    zip_path = OUT / f"support_fins-{platform}.zip"
    with tempfile.TemporaryDirectory(dir=OUT) as tmp:
        tree = pathlib.Path(tmp) / "support_fins"
        stage(tree, platform, engine_js)
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
            for p in sorted(tree.rglob("*")):
                if p.is_file():
                    z.write(p, p.relative_to(tree).as_posix())
    return zip_path


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    group = ap.add_mutually_exclusive_group()
    group.add_argument("--platform", choices=sorted(BLENDER))
    group.add_argument("--all", action="store_true")
    args = ap.parse_args()
    platforms = sorted(BLENDER) if args.all else [args.platform or this_platform()]
    OUT.mkdir(exist_ok=True)
    js = bundle_engine(OUT / "fins_engine.js")
    for p in platforms:
        z = build(p, OUT / "fins_engine.js")
        print(f"built {z.relative_to(ROOT)} ({z.stat().st_size / 1e6:.1f} MB, engine {len(js) / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
