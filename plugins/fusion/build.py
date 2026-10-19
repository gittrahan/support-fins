#!/usr/bin/env python3
"""Bundle the printfins.com engine into the Fusion add-in, and package it.

  python3 plugins/fusion/build.py          # -> SupportFins/palette/fins_engine.js
  python3 plugins/fusion/build.py --zip    # + build/SupportFins.zip (Windows and macOS)

The add-in runs the website's engine (web/*.js, untouched, bundled with the
shared bridge by plugins/shared/bundle.py, as Orca does) in a hidden Fusion
palette, so this bundle is all it needs: nothing native, one set of files for
Windows and macOS. Copy or link SupportFins/ into Fusion's AddIns folder and Run,
or unzip build/SupportFins.zip there.

Needs esbuild (see plugins/shared/bundle.py).
"""
import argparse
import pathlib
import sys
import zipfile

HERE = pathlib.Path(__file__).resolve().parent
ADDIN = HERE / 'SupportFins'
BUNDLE = ADDIN / 'palette' / 'fins_engine.js'
OUT = HERE / 'build'
# per machine or per developer: never shipped
SKIP = {'__pycache__', 'settings.json', '.env', '.vscode', '.DS_Store', 'lib', 'engine'}

sys.path.insert(0, str(HERE.parent / 'shared'))
from bundle import bundle_engine  # noqa: E402
from version import engine_plugin_version, stamp  # noqa: E402


def zip_addin(version):
    """build/SupportFins.zip: the SupportFins folder, bundle included, its manifest
    stamped with `version` (the dialog's footer reads it)."""
    OUT.mkdir(parents=True, exist_ok=True)
    zpath = OUT / 'SupportFins.zip'
    with zipfile.ZipFile(zpath, 'w', zipfile.ZIP_DEFLATED) as z:
        for f in sorted(ADDIN.rglob('*')):
            rel = f.relative_to(ADDIN)
            if f.is_dir() or SKIP.intersection(rel.parts) or f.suffix == '.pyc':
                continue
            arc = pathlib.PurePosixPath('SupportFins', *rel.parts)
            if f.name == 'SupportFins.manifest':
                z.writestr(str(arc), stamp(f.read_text(encoding='utf-8'), '"version": "0.7.0"',
                                           f'"version": "{version}"', f.name))
            else:
                z.write(f, arc)
    return zpath


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--zip', action='store_true', help='also write build/SupportFins.zip')
    args = ap.parse_args()
    js = bundle_engine(BUNDLE)
    print('engine bundle: SupportFins/palette/fins_engine.js (%.0f KB)' % (len(js) / 1024))
    if args.zip:
        v = engine_plugin_version(HERE)
        z = zip_addin(v)
        print('built %s %s (%.0f KB)' % (z.relative_to(HERE.parent.parent), v, z.stat().st_size / 1024))


if __name__ == '__main__':
    main()
