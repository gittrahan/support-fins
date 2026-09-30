"""mini-racer, vendored into a plugin folder, for hosts whose Python can't pip-install
(Cura, FreeCAD's bundled Python). Used by their build.py scripts.

The wheel is tagged py3-none-<platform> (a ctypes library, no CPython ABI), so one copy
serves every Python of that platform. Wheels are cached per platform.
"""
import platform
import subprocess
import sys
import zipfile

MINI_RACER = "mini-racer==0.14.1"   # same pin as the Orca plugin's header

# wheel platform tag -> (package name suffix, what users call it, sys.platform, machine)
PLATFORMS = {
    "macosx_11_0_arm64": ("mac-arm64", "macOS (Apple silicon)", "darwin", "arm64"),
    "macosx_10_9_x86_64": ("mac-x64", "macOS (Intel)", "darwin", "x86_64"),
    "win_amd64": ("windows-x64", "Windows (64-bit)", "win32", "amd64"),
    "manylinux_2_27_x86_64": ("linux-x64", "Linux (x86-64)", "linux", "x86_64"),
    "manylinux_2_27_aarch64": ("linux-arm64", "Linux (ARM64)", "linux", "aarch64"),
}


def wheel_platform():
    """This machine's wheel platform tag."""
    if sys.platform == "darwin":
        return "macosx_11_0_arm64" if platform.machine() == "arm64" else "macosx_10_9_x86_64"
    if sys.platform == "win32":
        return "win_amd64"
    return "manylinux_2_27_aarch64" if platform.machine() in ("aarch64", "arm64") else "manylinux_2_27_x86_64"


def vendor_mini_racer(dest, plat, cache):
    """Unpack py_mini_racer/ for `plat` into dest/ (wheel cached in cache/<plat>/).
    Returns the wheel's file name."""
    wheels = cache / plat
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
