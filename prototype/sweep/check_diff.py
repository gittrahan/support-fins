"""
Run check_stl.py's per-case judge on two exported sweeps and report what got
WORSE: a case that was clean and now fails (fused wall, open mesh, tine that
misses, off-spec standoff), one that now builds nothing, or one whose overhang
coverage dropped.

    python3 prototype/sweep/check_diff.py <base export dir> <head export dir>

Exit 1 when anything got worse. Imports check_stl's own `check()` so the rules
are the checker's, not a copy.
"""
import contextlib, glob, io, os, sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import check_stl  # noqa: E402

COV_DROP = 2.0   # percentage points of overhang area


def judge(d):
    out = {}
    for p in sorted(glob.glob(f'{d}/*.stl')):
        if p.endswith(('-fins.stl', '-pad.stl', '-part.stl')):
            continue
        case = p[:-4]
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            try:
                ok, cov, tot = check_stl.check(case)
            except Exception as e:  # a checker crash is a finding, not a skip
                ok, cov, tot = False, None, 0
                print(f'checker crashed: {e}')
        out[os.path.basename(case)] = (ok, cov, tot, buf.getvalue().strip().splitlines()[-1] if buf.getvalue().strip() else '')
    return out


def main(base_dir, head_dir):
    B, H = judge(base_dir), judge(head_dir)
    worse = []
    for k, (hok, hcov, htot, hline) in H.items():
        if k not in B:
            continue
        bok, bcov, _, _ = B[k]
        if bok and hok is False:
            worse.append((k, 'was clean, now FAILS', hline))
        elif bok is not None and hok is None:
            worse.append((k, 'now builds NOTHING', hline))
        elif bcov is not None and hcov is not None and hcov < bcov - COV_DROP:
            worse.append((k, f'coverage {bcov:.0f}% -> {hcov:.0f}%', hline))
    clean = lambda D: sum(1 for v in D.values() if v[0])
    print(f'check_stl on {len(H)} changed cases: clean {clean(B)} (base) -> {clean(H)} (head)')
    fixed = sum(1 for k in H if k in B and B[k][0] is False and H[k][0])
    if fixed:
        print(f'  {fixed} case(s) the base FAILED now pass')
    for k, why, line in worse:
        print(f'  ✗ {k:44} {why}\n      {line}')
    print('No check_stl regressions.' if not worse else f'{len(worse)} check_stl regression(s).')
    return 1 if worse else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1], sys.argv[2]))
