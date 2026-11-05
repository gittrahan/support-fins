#!/usr/bin/env python3
"""Run a macOS validation/build command with workspace-only writes.

No home override, global configuration, or fallback to system temporary storage.
This is deliberately macOS-specific; other platforms must supply equivalent
confinement before being used for this validation protocol.
"""
import argparse
import json
import os
from pathlib import Path
import resource
import signal
import subprocess
import sys
import time


def inside(root, path):
    path = Path(path).resolve()
    if not path.is_relative_to(root):
        raise ValueError(f'path escapes workspace: {path}')
    return path


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--workspace', type=Path, required=True)
    p.add_argument('--network', action='store_true', help='Downloads only; slicing stays offline')
    p.add_argument('--log', type=Path, required=True)
    p.add_argument('--metrics', type=Path, required=True)
    p.add_argument('--timeout', type=float, default=1800)
    p.add_argument('command', nargs=argparse.REMAINDER)
    a = p.parse_args()
    if sys.platform != 'darwin':
        p.error('macOS sandbox-exec required; no unconfined fallback')
    root = a.workspace.resolve(strict=True)
    inside(root, Path.cwd())
    log, metrics = inside(root, a.log), inside(root, a.metrics)
    cmd = a.command[1:] if a.command[:1] == ['--'] else a.command
    if not cmd:
        p.error('command required after --')
    if a.timeout <= 0:
        p.error('timeout must be positive')
    env = os.environ.copy()
    paths = {'TMPDIR':'tmp', 'TMP':'tmp', 'TEMP':'tmp', 'DENO_DIR':'cache/deno',
             'npm_config_cache':'cache/npm', 'PIP_CACHE_DIR':'cache/pip',
             'PYTHONPYCACHEPREFIX':'cache/python', 'PYTHONUSERBASE':'cache/python-user',
             'XDG_CACHE_HOME':'cache/xdg', 'XDG_CONFIG_HOME':'cache/config',
             'XDG_DATA_HOME':'cache/data', 'CLANG_MODULE_CACHE_PATH':'cache/clang',
             'CCACHE_DIR':'cache/ccache', 'EM_CACHE':'cache/emscripten'}
    for key, suffix in paths.items():
        path = inside(root, root/suffix)
        path.mkdir(parents=True, exist_ok=True)
        env[key] = str(path)
    env.update(PYTHONDONTWRITEBYTECODE='1', PYTHONNOUSERSITE='1', PIP_CONFIG_FILE='/dev/null',
               npm_config_userconfig=str(inside(root, root/'cache/npm-user.npmrc')),
               npm_config_globalconfig=str(inside(root, root/'cache/npm-global.npmrc')),
               EM_CONFIG=str(inside(root, root/'cache/emscripten-config')), xcrun_nocache='1')
    profile = '(version 1)\n(allow default)\n(deny file-write*)\n'
    profile += f'(allow file-write* (subpath {json.dumps(str(root))}) (literal "/dev/null"))\n'
    if not a.network:
        profile += '(deny network*)\n'
    profile_path = inside(root, root/('network.sb' if a.network else 'offline.sb'))
    profile_path.write_text(profile)
    log.parent.mkdir(parents=True, exist_ok=True)
    metrics.parent.mkdir(parents=True, exist_ok=True)
    start = time.monotonic()
    metrics.write_text(json.dumps({'status':'running', 'exitCode':None})+'\n')
    status, code = 'failed', None
    def interrupted(signum, frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, interrupted)
    with log.open('wb') as output:
        child = subprocess.Popen(['/usr/bin/sandbox-exec', '-f', str(profile_path), *cmd],
                                 env=env, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            code = child.wait(timeout=a.timeout)
            status = 'completed' if code == 0 else 'failed'
        except (subprocess.TimeoutExpired, KeyboardInterrupt) as e:
            status = 'timeout' if isinstance(e, subprocess.TimeoutExpired) else 'interrupted'
            try:
                os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                child.wait()
            code = child.returncode
    metrics.write_text(json.dumps({'status':status, 'exitCode':code,
        'elapsedSeconds':time.monotonic()-start,
        'peakResidentBytes':resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss}, indent=2)+'\n')
    return 0 if status == 'completed' else 1


if __name__ == '__main__':
    raise SystemExit(main())
