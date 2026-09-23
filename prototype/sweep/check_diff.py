"""
Run check_stl.py's per-case judge on two exported sweeps and report what got
WORSE: a case that was clean and now fails (fused wall, open mesh, tine that
misses, off-spec standoff), one that now builds nothing, or one whose overhang
coverage dropped.

    python3 prototype/sweep/check_diff.py <base export dir> <head export dir>

Exit 1 when anything got worse. Imports check_stl's own `check()` so the rules
are the checker's, not a copy.
"""
import glob, json, os, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
COV_DROP = 2.0   # percentage points of overhang area
# check_stl checks every solid, so cost scales with tine count: a 40mm cube is
# ~1s, bigplate at dense (1,500 solids) is ~200s. Each case runs in its own
# process (parallel, killable); one that overruns is REPORTED as unchecked, never
# silently passed. Override with CHECK_TIMEOUT=<s>.
TIMEOUT = float(os.environ.get('CHECK_TIMEOUT', 45))
WORKERS = os.cpu_count() or 4

# One case in a child process; prints (ok, cov, tot, last line) as JSON.
CHILD = r"""
import contextlib, io, json, sys, warnings
warnings.filterwarnings('ignore')
sys.path.insert(0, sys.argv[1])
import check_stl
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    ok, cov, tot = check_stl.check(sys.argv[2])
lines = buf.getvalue().strip().splitlines()
print(json.dumps([ok, cov, tot, lines[-1] if lines else '']))
"""


def judge_one(case):
    try:
        r = subprocess.run([sys.executable, '-c', CHILD, os.path.join(HERE, '..'), case],
                           capture_output=True, text=True, timeout=TIMEOUT)
        if r.returncode != 0:
            return case, ('crash', None, 0, (r.stderr.strip().splitlines() or ['?'])[-1])
        return case, tuple(json.loads(r.stdout.strip().splitlines()[-1]))
    except subprocess.TimeoutExpired:
        return case, ('timeout', None, 0, f'> {TIMEOUT:.0f}s')


def judge(dirs):
    cases = [p[:-4] for d in dirs for p in sorted(glob.glob(f'{d}/*.stl'))
             if not p.endswith(('-fins.stl', '-pad.stl', '-part.stl'))]
    out, t0, done = {}, time.time(), 0
    with ThreadPoolExecutor(WORKERS) as ex:
        for case, res in ex.map(judge_one, cases):
            out[case] = res
            done += 1
            if done % 25 == 0 or done == len(cases):
                print(f'  checked {done}/{len(cases)}  ({time.time() - t0:.0f}s)', flush=True)
    return out


def main(base_dir, head_dir):
    R = judge([base_dir, head_dir])
    name = lambda c: os.path.basename(c)
    B = {name(c): v for c, v in R.items() if c.startswith(base_dir)}
    H = {name(c): v for c, v in R.items() if c.startswith(head_dir)}
    worse, unchecked = [], []
    for k, (hok, hcov, htot, hline) in H.items():
        bok, bcov = B.get(k, (None, None))[:2]
        if hok in ('timeout', 'crash') or bok in ('timeout', 'crash'):
            unchecked.append((k, f'base {bok}, head {hok}' if bok in ('timeout', 'crash') else hok, hline))
            continue
        if bok is True and hok is False:
            worse.append((k, 'was clean, now FAILS', hline))
        elif bok is not None and hok is None:
            worse.append((k, 'now builds NOTHING', hline))
        elif bcov is not None and hcov is not None and hcov < bcov - COV_DROP:
            worse.append((k, f'coverage {bcov:.0f}% -> {hcov:.0f}%', hline))
    clean = lambda D: sum(1 for v in D.values() if v[0] is True)
    print(f'check_stl on {len(H)} changed cases: clean {clean(B)} (base) -> {clean(H)} (head)')
    fixed = sum(1 for k in H if B.get(k, [None])[0] is False and H[k][0] is True)
    if fixed:
        print(f'  {fixed} case(s) the base FAILED now pass')
    for k, why, line in worse:
        print(f'  ✗ {k:44} {why}\n      {line}')
    if unchecked:
        print(f'  ? {len(unchecked)} case(s) NOT checked (timeout/crash) -- not a pass:')
        for k, why, _ in unchecked:
            print(f'      {k:44} {why}')
    print('No check_stl regressions.' if not worse else f'{len(worse)} check_stl regression(s).')
    return 1 if worse else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1], sys.argv[2]))
