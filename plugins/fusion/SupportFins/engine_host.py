"""Runs the printfins.com fin engine inside Fusion.

The fins come from the website's own engine (web/*.js, unmodified), bundled by
plugins/shared/bundle.py and run in an embedded V8 (mini-racer), exactly as the
Orca plugin does. There is no Python port of the fin geometry to drift from the
site: a fix on the site reaches Fusion the next time the add-in is built.

Pure Python, no adsk imports, so the tests run it without Fusion.

    engine/fins_engine.js   the bundle (plugins/fusion/build.py writes it)
    lib/<platform>/         mini-racer, because Fusion's Python has no pip: vendored
                            by build.py in the full builds, or fetched once from
                            PyPI (SHA-256 pinned, see RUNTIME) by the small build.
                            A mini-racer already on sys.path (a dev machine, CI)
                            is used first.
"""

import atexit
import base64
import json
import os
import platform
import sys
import threading
from array import array

HERE = os.path.dirname(os.path.abspath(__file__))
BUNDLE = os.path.join(HERE, 'engine', 'fins_engine.js')
LIB = os.path.join(HERE, 'lib')

# What the website starts with (plugins/shared/engine/fins_entry.js ENGINE_DEFAULTS).
DEFAULTS = {
    'mode': 'auto',
    'bedPad': True,
    'tines': True,
    'tineDensity': 0.0,
    'coverage': 0.5,
    'layerHeight': 0.2,
}

# One engine run should take well under a few seconds. Past this, give up rather
# than leave Fusion frozen on the main thread.
TIMEOUT_S = 60.0


class EngineError(Exception):
    """The engine couldn't start or run, worded for the readout."""


def platform_tag():
    """The lib/ subfolder that holds this machine's mini-racer build."""
    machine = platform.machine().lower()
    if sys.platform == 'win32':
        return 'win_amd64'
    if sys.platform == 'darwin':
        return 'macosx_arm64' if machine in ('arm64', 'aarch64') else 'macosx_x86_64'
    return 'linux_x86_64'


# mini-racer, fetched on first use when this copy of the add-in doesn't carry it
# (the small download). Pinned to the exact wheels on PyPI by SHA-256, so nothing
# but these files is ever unpacked into the add-in. Same version the Orca plugin
# and build.py use; change all three together.
MINI_RACER = '0.14.1'
_PYPI = 'https://files.pythonhosted.org/packages/'
RUNTIME = {
    'win_amd64': (_PYPI + '78/60/e0708ea8533e928f10f985be35af4c02dd2b61f4a7501dc88e8c927d85e5/'
                  'mini_racer-0.14.1-py3-none-win_amd64.whl',
                  '4abd58c62c9955988dbc0cbf5a798914334fe570d2b192f8890bec20135ab6d1'),
    'macosx_arm64': (_PYPI + '09/bf/ecaad0c208b9d8bd8f2141f7fa5e520b66915945a2ed56c520524df75fcb/'
                     'mini_racer-0.14.1-py3-none-macosx_11_0_arm64.whl',
                     '56cc6965a1665a50d8d613bc43aa83b4cec6b1f09acc69dc4c2845dacb201463'),
    'macosx_x86_64': (_PYPI + '27/2c/5857ee4e1714db8956aa878dc90255557458c124f93163704e7de948be03/'
                      'mini_racer-0.14.1-py3-none-macosx_10_9_x86_64.whl',
                      'a401ecdf5f73d4714b76dc3a4c9b5780059cf4c59a5b64cff7497dc6c219d5a0'),
    'linux_x86_64': (_PYPI + 'c2/3c/c5bd479784826bbbc69f713aae2bcfd5ef353ba4e5e0e661666938474535/'
                     'mini_racer-0.14.1-py3-none-manylinux_2_27_x86_64.whl',
                     'cdf3a088e1363f16a695288f882abf76b3705b8e1df21418208b87ed010037a4'),
}

_fetch_lock = threading.Lock()


def runtime_present(tag=None):
    return os.path.isfile(os.path.join(LIB, tag or platform_tag(), 'py_mini_racer', '__init__.py'))


def fetch_runtime(tag=None, timeout=120):
    """Download this platform's mini-racer wheel, check its SHA-256, and unpack
    py_mini_racer into lib/<tag>. A no-op when it is already there. Safe to call
    from a background thread (it touches no Fusion API)."""
    import hashlib
    import shutil
    import tempfile
    import urllib.request
    import zipfile
    tag = tag or platform_tag()
    with _fetch_lock:
        if runtime_present(tag):
            return
        if tag not in RUNTIME:
            raise EngineError('There is no fin engine runtime for this platform (%s).' % tag)
        url, want = RUNTIME[tag]
        work = tempfile.mkdtemp(prefix='supportfins_')
        try:
            wheel = os.path.join(work, 'runtime.whl')
            try:
                with urllib.request.urlopen(url, timeout=timeout) as r, open(wheel, 'wb') as out:
                    shutil.copyfileobj(r, out)
            except Exception as e:
                raise EngineError('Couldn’t download the fin engine runtime (about 15 MB, once) '
                                  'from PyPI: %s. Check the connection, or install the full '
                                  'build of the add-in, which carries it.' % e)
            h = hashlib.sha256()
            with open(wheel, 'rb') as fh:
                for block in iter(lambda: fh.read(1 << 20), b''):
                    h.update(block)
            if h.hexdigest() != want:
                raise EngineError('The downloaded fin engine runtime failed its checksum, so it '
                                  'was not used. Try again later, or install the full build.')
            staged = os.path.join(work, 'lib')
            with zipfile.ZipFile(wheel) as z:
                for name in z.namelist():
                    parts = name.split('/')
                    if 'py_mini_racer' not in parts or name.endswith('/'):
                        continue
                    rel = parts[parts.index('py_mini_racer'):]
                    if '..' in rel:
                        continue
                    dest = os.path.join(staged, *rel)
                    os.makedirs(os.path.dirname(dest), exist_ok=True)
                    with z.open(name) as src, open(dest, 'wb') as out:
                        shutil.copyfileobj(src, out)
            target = os.path.join(LIB, tag)
            os.makedirs(target, exist_ok=True)
            final = os.path.join(target, 'py_mini_racer')
            if os.path.isdir(final):
                shutil.rmtree(final)
            shutil.move(os.path.join(staged, 'py_mini_racer'), final)
        finally:
            shutil.rmtree(work, ignore_errors=True)


def prefetch():
    """Fetch the runtime in the background at add-in start, so the first dialog
    doesn't wait on the download. Errors are left for available() to report."""
    import importlib.util
    if importlib.util.find_spec('py_mini_racer') is not None or runtime_present():
        return None
    t = threading.Thread(target=lambda: _quiet(fetch_runtime), name='SupportFinsFetch', daemon=True)
    t.start()
    return t


def _quiet(fn):
    try:
        fn()
    except Exception:
        pass


def _import_mini_racer():
    import importlib.util
    if importlib.util.find_spec('py_mini_racer') is None:   # a dev machine or CI has it
        vendored = os.path.join(LIB, platform_tag())
        if not runtime_present():
            fetch_runtime()                                   # the small download
        if vendored not in sys.path:
            sys.path.insert(0, vendored)
    from py_mini_racer import MiniRacer, init_mini_racer
    return MiniRacer, init_mini_racer


_ctx = None


def _engine():
    """One V8 context for the whole Fusion session (loading the bundle takes ms)."""
    global _ctx
    if _ctx is None:
        if not os.path.isfile(BUNDLE):
            raise EngineError('The fin engine bundle is missing (engine/fins_engine.js). '
                              'Run plugins/fusion/build.py, or install a packaged build.')
        MiniRacer, init_mini_racer = _import_mini_racer()
        flags = ['--single-threaded']
        if sys.platform == 'darwin':
            # macOS: mini-racer's JIT hits SIGTRAP, and a hardened app like Fusion may
            # refuse JIT memory anyway (the Orca plugin learned this first).
            flags.append('--jitless')
        init_mini_racer(flags=flags, ignore_duplicate_init=True)
        ctx = MiniRacer()
        with open(BUNDLE, encoding='utf-8') as fh:
            ctx.eval(fh.read())
        # mini-racer never tears V8 down on its own; without this, exit can hang.
        atexit.register(ctx.close)
        # Fusion's Stop/Run reimports this module; close the last run's context
        # (kept on sys, which outlives the reimport) instead of leaking its thread.
        old = getattr(sys, '_support_fins_v8', None)
        if old is not None:
            try:
                old.close()
            except Exception:
                pass
        sys._support_fins_v8 = ctx
        _ctx = ctx
    return _ctx


def reset():
    """Drop this module's V8 context; the next call starts a new one."""
    global _ctx
    ctx, _ctx = _ctx, None
    if ctx is not None:
        try:
            ctx.close()
        except Exception:
            pass
    if getattr(sys, '_support_fins_v8', None) is ctx:
        sys._support_fins_v8 = None


def available():
    """(True, None) if the engine can run here, else (False, why)."""
    try:
        _engine()
        return True, None
    except EngineError as e:
        return False, str(e)
    except Exception as e:  # a broken DLL, an unsupported OS...
        return False, 'The fin engine couldn’t start: %s' % e


def compute_fins(soup, options=None):
    """Run the website's fin engine on a posed part.

    soup    flat sequence of floats, 9 per triangle: the part in PRINT SPACE (mm,
            z up, the bed at z = 0), wound outward.
    options overrides for DEFAULTS (mode, bedPad, tines, tineDensity, coverage,
            layerHeight).

    Returns (fins, stats): fins is an array('d') triangle soup in the SAME frame as
    `soup` (the engine seats the part itself; its offset is undone here), and
    stats is the engine's dict (overhangRegions, finTriangles, padTriangles, tines...).
    """
    data = array('d', soup)
    if not len(data) or len(data) % 9:
        raise EngineError('The part has no triangles to fit fins to.')
    if sys.byteorder != 'little':       # the bridge reads little-endian bytes
        data.byteswap()
    opts = dict(DEFAULTS)
    opts.update({k: v for k, v in (options or {}).items() if k in DEFAULTS})
    payload = (base64.b64encode(data.tobytes()).decode('ascii'), json.dumps(opts))
    raw = None
    for attempt in (1, 2):
        try:
            raw = _engine().call('SupportFinsEngine.computeFinsB64', *payload,
                                 timeout_sec=TIMEOUT_S)
            break
        except EngineError:
            raise
        except Exception as e:
            # A context that was closed under us (another copy of this module
            # reloaded, as Fusion's Stop/Run does) fails every call: start a fresh
            # one and try once more before giving up.
            reset()
            if attempt == 2:
                raise EngineError('The fin engine failed on this part (%s: %s).'
                                  % (type(e).__name__, e or 'no message'))
    out = json.loads(raw)
    seated = array('f')
    seated.frombytes(base64.b64decode(out['triangles']))
    if sys.byteorder != 'little':
        seated.byteswap()
    off = out['offset']                 # seated = input + offset
    ox, oy, oz = off['x'], off['y'], off['z']
    fins = array('d', seated)
    for i in range(0, len(fins), 3):
        fins[i] -= ox
        fins[i + 1] -= oy
        fins[i + 2] -= oz
    return fins, out['stats']
