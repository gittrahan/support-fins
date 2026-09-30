#!/usr/bin/env python3
"""Build the Cura plugin folder.

  python3 plugins/cura/build.py            # -> plugins/cura/build/SupportFins/

1. Copies SupportFins/ and the shared Python host (plugins/shared/py/supportfins_host.py).
2. Bundles the printfins.com engine (web/*.js, untouched) into fins_engine.js
   (plugins/shared/bundle.py; needs esbuild via npx).
3. Vendors mini-racer into vendor/py_mini_racer/: Cura's Python can't pip-install,
   so the plugin carries it. The wheel is tagged py3-none-<platform> (a ctypes
   library, no CPython ABI), so one copy serves every Cura Python of that platform.
   Default: this machine's platform. Wheels are cached in build/wheels/.

Install the result by copying (or linking) build/SupportFins into Cura's plugins
folder (Help > Show Configuration Folder > plugins) and restarting Cura.
"""
import pathlib
import platform
import shutil
import subprocess
import sys
import zipfile

HERE = pathlib.Path(__file__).resolve().parent
SHARED = HERE.parent / "shared"
OUT = HERE / "build"
PLUGIN = OUT / "SupportFins"
MINI_RACER = "mini-racer==0.14.1"   # same pin as the Orca plugin's header

sys.path.insert(0, str(SHARED))
from bundle import bundle_engine  # noqa: E402


def wheel_platform():
    if sys.platform == "darwin":
        return "macosx_11_0_arm64" if platform.machine() == "arm64" else "macosx_10_9_x86_64"
    if sys.platform == "win32":
        return "win_amd64"
    return "manylinux_2_27_x86_64"


def vendor_mini_racer(dest, plat):
    wheels = OUT / "wheels" / plat
    if not list(wheels.glob("*.whl")):
        subprocess.run([sys.executable, "-m", "pip", "download", "--quiet", "--no-deps",
                        "--only-binary=:all:", "--platform", plat, "-d", str(wheels), MINI_RACER],
                       check=True)
    (whl,) = wheels.glob("*.whl")
    with zipfile.ZipFile(whl) as z:
        for name in z.namelist():
            # mini_racer-X.data/purelib/py_mini_racer/<file>
            head, sep, rel = name.partition("/purelib/")
            if sep and rel.startswith("py_mini_racer/"):
                target = dest / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(z.read(name))
    return whl.name


def main():
    plat = sys.argv[1] if len(sys.argv) > 1 else wheel_platform()
    if PLUGIN.exists():
        shutil.rmtree(PLUGIN)
    shutil.copytree(HERE / "SupportFins", PLUGIN,
                    ignore=shutil.ignore_patterns("__pycache__", "dev_*"))
    shutil.copy2(SHARED / "py" / "supportfins_host.py", PLUGIN / "supportfins_host.py")
    js = bundle_engine(PLUGIN / "fins_engine.js")
    whl = vendor_mini_racer(PLUGIN / "vendor", plat)
    size = sum(p.stat().st_size for p in PLUGIN.rglob("*") if p.is_file())
    print(f"built {PLUGIN.relative_to(HERE.parent.parent)} ({size / 1e6:.0f} MB; "
          f"engine {len(js) / 1024:.0f} KB; {whl})")


if __name__ == "__main__":
    main()
