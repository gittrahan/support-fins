#!/usr/bin/env python3
"""Build the Cura plugin folder.

  python3 plugins/cura/build.py              # -> plugins/cura/build/SupportFins/ (this machine)
  python3 plugins/cura/build.py win_amd64    # the folder for another platform
  python3 plugins/cura/build.py --package    # + build/SupportFins-<platform>.curapackage
  python3 plugins/cura/build.py --all        # a .curapackage for every platform in PLATFORMS

1. Copies SupportFins/ and the shared Python host (plugins/shared/py/supportfins_host.py).
2. Bundles the printfins.com engine (web/*.js, untouched) into fins_engine.js
   (plugins/shared/bundle.py; needs esbuild via npx).
3. Vendors mini-racer into vendor/py_mini_racer/: Cura's Python can't pip-install,
   so the plugin carries it. The wheel is tagged py3-none-<platform> (a ctypes
   library, no CPython ABI), so one copy serves every Cura Python of that platform.
   Default: this machine's platform. Wheels are cached in build/wheels/.

4. Writes platform.json: which platform this build's V8 library is for, so the plugin
   can say "wrong download" instead of failing to load it.

Install the folder by copying (or linking) build/SupportFins into Cura's plugins
folder (Help > Show Configuration Folder > plugins) and restarting Cura; or drag a
.curapackage onto Cura. A package is one platform's: the V8 library is 30-75 MB, so
five small downloads beat one ~300 MB-installed universal package (Matthew,
2026-09-30; the Marketplace, which takes one package, is decided when we submit).
"""
import json
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
ROOT = HERE.parent.parent

# wheel platform tag -> (package name suffix, what users call it, sys.platform, machine)
PLATFORMS = {
    "macosx_11_0_arm64": ("mac-arm64", "macOS (Apple silicon)", "darwin", "arm64"),
    "macosx_10_9_x86_64": ("mac-x64", "macOS (Intel)", "darwin", "x86_64"),
    "win_amd64": ("windows-x64", "Windows (64-bit)", "win32", "amd64"),
    "manylinux_2_27_x86_64": ("linux-x64", "Linux (x86-64)", "linux", "x86_64"),
    "manylinux_2_27_aarch64": ("linux-arm64", "Linux (ARM64)", "linux", "aarch64"),
}

sys.path.insert(0, str(SHARED))
from bundle import bundle_engine  # noqa: E402


def wheel_platform():
    if sys.platform == "darwin":
        return "macosx_11_0_arm64" if platform.machine() == "arm64" else "macosx_10_9_x86_64"
    if sys.platform == "win32":
        return "win_amd64"
    return "manylinux_2_27_aarch64" if platform.machine() in ("aarch64", "arm64") else "manylinux_2_27_x86_64"


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


def build(plat):
    """The plugin folder for one platform -> (engine size, wheel name)."""
    if PLUGIN.exists():
        shutil.rmtree(PLUGIN)
    shutil.copytree(HERE / "SupportFins", PLUGIN,
                    ignore=shutil.ignore_patterns("__pycache__", "dev_*"))
    shutil.copy2(SHARED / "py" / "supportfins_host.py", PLUGIN / "supportfins_host.py")
    shutil.copy2(SHARED / "engine" / "options.json", PLUGIN / "options.json")   # the dialog reads it without V8
    js = bundle_engine(PLUGIN / "fins_engine.js")
    whl = vendor_mini_racer(PLUGIN / "vendor", plat)
    suffix, label, os_name, machine = PLATFORMS[plat]
    (PLUGIN / "platform.json").write_text(json.dumps(
        {"wheel": plat, "name": label, "os": os_name, "machine": machine}, indent=2) + "\n")
    return len(js), whl


def package(plat):
    """Zip the built folder as a .curapackage: package.json at the root, the plugin
    under files/plugins/SupportFins/ (Cura moves files/plugins to plugins/<package_id>,
    so it lands in plugins/SupportFins/SupportFins/, the usual layout), and the licence.
    The file name carries no version, so the release's download links stay put."""
    meta = json.loads((HERE / "SupportFins" / "plugin.json").read_text(encoding="utf-8"))
    suffix, label, _, _ = PLATFORMS[plat]
    info = {
        "package_id": "SupportFins",
        "package_type": "plugin",
        "display_name": meta["name"],
        "description": f"{meta['description']} This package is for {label}.",
        "package_version": meta["version"],
        "sdk_version": meta["supported_sdk_versions"][0],
        "website": "https://printfins.com",
        "author": {"author_id": "printfins", "display_name": meta["author"],
                   "website": "https://printfins.com"},
        "tags": ["support", "supports", "breakaway"],
    }
    target = OUT / f"SupportFins-{suffix}.curapackage"
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as z:
        entry = zipfile.ZipInfo("package.json", date_time=(2026, 1, 1, 0, 0, 0))
        entry.external_attr = 0o644 << 16
        z.writestr(entry, json.dumps(info, indent=2) + "\n", zipfile.ZIP_DEFLATED)
        z.write(ROOT / "LICENSE", "LICENSE")
        for f in sorted(PLUGIN.rglob("*")):
            if f.is_file() and "__pycache__" not in f.parts:
                z.write(f, "files/plugins/SupportFins/" + f.relative_to(PLUGIN).as_posix())
    return target


def main():
    flags = {a for a in sys.argv[1:] if a.startswith("--")}
    if flags - {"--package", "--all"}:
        sys.exit(f"unknown option {', '.join(sorted(flags - {'--package', '--all'}))}; "
                 "use --package or --all")
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if args and "--all" in flags:
        sys.exit("--all builds every platform; leave out the platform")
    for old in OUT.glob("SupportFins-*.curapackage") if "--all" in flags else ():
        old.unlink()                     # no stale packages next to fresh ones
    here = wheel_platform()
    # --all: this machine's platform last, so build/SupportFins ends up runnable here
    plats = (sorted(PLATFORMS, key=lambda t: t == here) if "--all" in sys.argv
             else [args[0] if args else here])
    for plat in plats:
        if plat not in PLATFORMS:
            sys.exit(f"unknown platform {plat}; one of: {', '.join(PLATFORMS)}")
        js, whl = build(plat)
        size = sum(p.stat().st_size for p in PLUGIN.rglob("*") if p.is_file())
        line = (f"built {PLUGIN.relative_to(ROOT)} ({size / 1e6:.0f} MB; "
                f"engine {js / 1024:.0f} KB; {whl})")
        if "--package" in sys.argv or "--all" in sys.argv:
            pkg = package(plat)
            line += f" -> {pkg.relative_to(ROOT)} ({pkg.stat().st_size / 1e6:.0f} MB)"
        print(line)


if __name__ == "__main__":
    main()
