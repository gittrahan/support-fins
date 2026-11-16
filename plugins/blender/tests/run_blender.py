# SPDX-License-Identifier: GPL-3.0-or-later
"""Download a checksum-verified official Linux Blender and run the packaged smoke test.

  python plugins/blender/tests/run_blender.py --version 4.2.23 --package build/support_fins-linux-x64.zip

CI's blender-smoke job (.github/workflows/plugins.yml). Blender's user folders point
into the temp dir, so the run never touches a real install. From RemusTL's PR #145.
"""
import argparse
import os
import hashlib
import http.client
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import time
import urllib.request


# The official checksums from download.blender.org/release/Blender<x.y>/blender-<version>.sha256.
# Pinned here so a mirror's copy can be trusted and no checksum file has to be fetched.
SHA256 = {
    '4.2.23': 'bea0eb3146be13eae6225409a117b215184f41b7f79e799f97cb3abb8f6dc404',
    '5.2.2': '84098912789dc450e95697c4184fb8a90acbe5111c2ba4aede3fecb57806a168',
}
MIRRORS = (
    'https://download.blender.org/release/',
    'https://mirrors.ocf.berkeley.edu/blender/release/',
    'https://mirror.clarkson.edu/blender/release/',
    'https://ftp.halifax.rwth-aachen.de/blender/release/',
)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--version', choices=sorted(SHA256), required=True)
    parser.add_argument('--package', type=Path, required=True)
    # A folder kept between CI runs (actions/cache): the archive is downloaded once, so most
    # runs never touch a download server.
    parser.add_argument('--cache', type=Path)
    args = parser.parse_args()
    folder = f"Blender{args.version.rsplit('.', 1)[0]}/"
    name = f'blender-{args.version}-linux-x64.tar.xz'
    expected = SHA256[args.version]
    def digest(path):
        with path.open('rb') as source:
            return hashlib.file_digest(source, 'sha256').hexdigest()
    def download(target):
        # download.blender.org answers some GitHub runners with HTTP 403 for minutes at a
        # time, so each official mirror is tried in turn, twice round with a pause.
        for attempt in range(2):
            for base in MIRRORS:
                url = base + folder + name
                try:
                    request = urllib.request.Request(url, headers={'User-Agent': 'SupportFins-tests'})
                    with urllib.request.urlopen(request, timeout=120) as response, target.open('wb') as output:
                        shutil.copyfileobj(response, output)
                except (OSError, http.client.HTTPException) as error:  # URLError is an OSError
                    print(f'{url}: {error}', flush=True)
                    continue
                if digest(target) == expected:
                    print(f'Downloaded {url}', flush=True)
                    return
                print(f'{url}: checksum mismatch', flush=True)
            if attempt == 0:
                time.sleep(60)
        raise RuntimeError(f'Could not download {name} with the official checksum')
    with tempfile.TemporaryDirectory(prefix='blender-ci-') as directory:
        directory = Path(directory)
        store = args.cache or directory
        store.mkdir(parents=True, exist_ok=True)
        archive = store / name
        if archive.exists() and digest(archive) == expected:
            print(f'Using cached {archive}', flush=True)
        else:
            download(archive)
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
