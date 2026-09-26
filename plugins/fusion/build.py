#!/usr/bin/env python3
"""Build the Fusion add-in.

  python3 plugins/fusion/build.py                 # engine bundle + the Windows zip
  python3 plugins/fusion/build.py --platform macosx_arm64 --platform macosx_x86_64
                                                  # the macOS zips (not yet tested in Fusion)
  python3 plugins/fusion/build.py --no-vendor     # engine bundle only (dev, tests)
  python3 plugins/fusion/build.py --slim          # + SupportFins.zip: no runtime inside
                                                  #   (~100 KB); it fetches mini-racer once
                                                  #   from PyPI, SHA-256 pinned (engine_host)
  python3 plugins/fusion/build.py --here win_amd64
                                                  # also vendor mini-racer into the source
                                                  # folder, for a linked (junction) install

1. Bundles the printfins.com engine (web/*.js, untouched) with the shared bridge
   into SupportFins/engine/fins_engine.js (plugins/shared/bundle.py, as Orca does).
2. Vendors mini-racer, because Fusion's embedded Python has no pip: the wheel for
   each platform is downloaded (pip download) and its py_mini_racer package is
   unpacked into lib/<platform>/. mini-racer wheels are py3-none, so they don't
   care which Python Fusion ships.
3. Zips SupportFins/ per platform into plugins/fusion/build/, e.g.
   SupportFins-win_amd64.zip. Unzip into Fusion's AddIns folder and Run.
   Only Windows is built by default: it is the platform the add-in has been run
   on in Fusion. The macOS builds exist but ship once someone tests them there.

Needs esbuild (see plugins/shared/bundle.py) and, unless --no-vendor, pip and network.
"""
import argparse
import pathlib
import shutil
import subprocess
import sys
import tempfile
import zipfile

HERE = pathlib.Path(__file__).resolve().parent
ADDIN = HERE / 'SupportFins'
OUT = HERE / 'build'
CACHE = OUT / 'wheels'

MINI_RACER = 'mini-racer==0.14.1'   # the version the Orca plugin pins
PLATFORMS = {                        # lib/<tag> -> pip --platform
    'win_amd64': 'win_amd64',
    'macosx_arm64': 'macosx_11_0_arm64',
    'macosx_x86_64': 'macosx_10_9_x86_64',
}
RELEASED = ['win_amd64']            # built by default (and by CI); the rest on request
SKIP = {'__pycache__', 'settings.json', '.env', '.vscode', 'lib', '.DS_Store'}

sys.path.insert(0, str(HERE.parent / 'shared'))
from bundle import bundle_engine  # noqa: E402


def wheel_for(tag):
    dest = CACHE / tag
    found = sorted(dest.glob('mini_racer-*.whl')) if dest.exists() else []
    if not found:
        dest.mkdir(parents=True, exist_ok=True)
        subprocess.run([sys.executable, '-m', 'pip', 'download', '--quiet', '--no-deps',
                        '--only-binary=:all:', '--platform', PLATFORMS[tag],
                        '--python-version', '3.12', MINI_RACER, '-d', str(dest)], check=True)
        found = sorted(dest.glob('mini_racer-*.whl'))
    if not found:
        sys.exit('no mini-racer wheel for %s' % tag)
    return found[-1]


def unpack_mini_racer(tag, lib_root):
    """py_mini_racer (with its V8 library and ICU data) -> lib_root/<tag>/py_mini_racer."""
    target = lib_root / tag
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True)
    with zipfile.ZipFile(wheel_for(tag)) as whl:
        for name in whl.namelist():
            parts = pathlib.PurePosixPath(name).parts
            if 'py_mini_racer' not in parts:
                continue
            rel = pathlib.Path(*parts[parts.index('py_mini_racer'):])
            dest = target / rel
            if name.endswith('/'):
                continue
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(whl.read(name))
    if not (target / 'py_mini_racer' / '__init__.py').exists():
        sys.exit('py_mini_racer not found in the %s wheel' % tag)
    return target


def zip_addin(tag):
    OUT.mkdir(parents=True, exist_ok=True)
    zpath = OUT / ('SupportFins-%s.zip' % tag)
    with tempfile.TemporaryDirectory() as tmp:
        lib = unpack_mini_racer(tag, pathlib.Path(tmp))
        with zipfile.ZipFile(zpath, 'w', zipfile.ZIP_DEFLATED) as z:
            for f in sorted(ADDIN.rglob('*')):
                rel = f.relative_to(ADDIN)
                if f.is_dir() or SKIP.intersection(rel.parts):
                    continue
                z.write(f, pathlib.Path('SupportFins') / rel)
            for f in sorted(lib.rglob('*')):
                if f.is_file():
                    z.write(f, pathlib.Path('SupportFins', 'lib', tag) / f.relative_to(lib))
    return zpath


def zip_slim():
    """The add-in without mini-racer: engine_host fetches the right wheel on first run."""
    OUT.mkdir(parents=True, exist_ok=True)
    zpath = OUT / 'SupportFins.zip'
    with zipfile.ZipFile(zpath, 'w', zipfile.ZIP_DEFLATED) as z:
        for f in sorted(ADDIN.rglob('*')):
            rel = f.relative_to(ADDIN)
            if f.is_dir() or SKIP.intersection(rel.parts):
                continue
            z.write(f, pathlib.Path('SupportFins') / rel)
    return zpath


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--no-vendor', action='store_true', help='bundle the engine only')
    ap.add_argument('--platform', action='append', choices=sorted(PLATFORMS),
                    help='zip this platform (repeatable; default: %s)' % ', '.join(RELEASED))
    ap.add_argument('--slim', action='store_true',
                    help='also zip SupportFins.zip without the runtime (fetched on first run)')
    ap.add_argument('--here', choices=sorted(PLATFORMS),
                    help='also unpack mini-racer into SupportFins/lib/<tag> for a linked install')
    args = ap.parse_args()

    js = bundle_engine(ADDIN / 'engine' / 'fins_engine.js')
    print('engine bundle: SupportFins/engine/fins_engine.js (%.0f KB)' % (len(js) / 1024))
    if args.here:
        unpack_mini_racer(args.here, ADDIN / 'lib')
        print('vendored mini-racer into SupportFins/lib/%s' % args.here)
    if args.slim:
        z = zip_slim()
        print('built %s (%.0f KB)' % (z.relative_to(HERE.parent.parent), z.stat().st_size / 1024))
    if args.no_vendor:
        return
    for tag in args.platform or RELEASED:
        z = zip_addin(tag)
        print('built %s (%.1f MB)' % (z.relative_to(HERE.parent.parent), z.stat().st_size / 1e6))


if __name__ == '__main__':
    main()
