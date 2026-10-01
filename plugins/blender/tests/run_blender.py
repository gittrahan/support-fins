# SPDX-License-Identifier: GPL-3.0-or-later
"""Download a checksum-verified official Linux Blender and run the packaged smoke test.

  python plugins/blender/tests/run_blender.py --version 4.2.23 --package build/support_fins-linux-x64.zip

CI's blender-smoke job (.github/workflows/plugins.yml). Blender's user folders point
into the temp dir, so the run never touches a real install. From RemusTL's PR #145.
"""
import argparse
import os
import hashlib
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--version', choices=('4.2.23', '5.2.2'), required=True)
    parser.add_argument('--package', type=Path, required=True)
    args = parser.parse_args()
    base = f"https://download.blender.org/release/Blender{args.version.rsplit('.', 1)[0]}/"
    name = f'blender-{args.version}-linux-x64.tar.xz'
    def fetch(url):
        return urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent':'SupportFins-tests'}), timeout=120)
    with tempfile.TemporaryDirectory(prefix='blender-ci-') as directory:
        directory = Path(directory)
        archive = directory / name
        with fetch(base + name) as response, archive.open('wb') as output:
            shutil.copyfileobj(response, output)
        with fetch(base + f'blender-{args.version}.sha256') as response:
            checks = response.read().decode()
        expected = next(line.split()[0] for line in checks.splitlines() if line.split()[-1].lstrip('*') == name)
        with archive.open('rb') as source:
            actual = hashlib.file_digest(source, 'sha256').hexdigest()
        if actual != expected:
            raise RuntimeError('Official Blender checksum mismatch')
        with tarfile.open(archive) as source:
            source.extractall(directory, filter='data')
        blender = directory / name.removesuffix('.tar.xz') / 'blender'
        env = dict(os.environ, **{f'BLENDER_USER_{k}': str(directory / 'user' / k.lower())
                                  for k in ('CONFIG', 'SCRIPTS', 'DATAFILES', 'EXTENSIONS')})
        subprocess.run([str(blender), '--background', '--factory-startup', '--python-exit-code', '1',
                        '--python', str(Path(__file__).with_name('blender_smoke.py')),
                        '--', '--package', str(args.package.resolve())], check=True, timeout=600, env=env)

if __name__ == '__main__':
    main()
