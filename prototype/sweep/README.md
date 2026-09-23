# Regression sweep — the pre-merge gate

Unit tests pin cases we already know about. This looks at **all** of them: it
builds supports for every model × pose × coverage (31 models × 9 poses × 3 =
837 cases) with the base engine and the branch, and reports every case where
the branch supports **less**.

```sh
prototype/sweep/vs-base.sh                 # vs origin/main, incl. check_stl.py
prototype/sweep/vs-base.sh <sha>           # vs any commit
NOCHECK=1 prototype/sweep/vs-base.sh       # skip the check_stl pass (sweep alone: ~1 min)
CHECK_TIMEOUT=300 prototype/sweep/vs-base.sh   # per-case check_stl limit (default 45s)
KEEP=/some/dir prototype/sweep/vs-base.sh  # keep base/head JSON for digging
```

Exit 1 on any blocking regression. **Rule: don't merge with an unexplained
blocking line.** A deliberate trade (e.g. fewer walls on purpose) still shows up
and gets explained in the PR.

**Blocking** (compare.js): new crash · an overhang region goes unserved · wall
length lost (>5mm and >5%) · tines lost (>3 and >5%) · lowest tine rises >0.1mm
(base grip). Then **check_diff.py** runs `prototype/check_stl.py` on every
changed case of both builds and blocks on a case that was clean and now fails
(fused wall, open mesh, tine that misses, off-spec standoff), now builds
nothing, or loses >2 points of overhang coverage.

**Info only:** wall count, squat walls, gains, plastic.

Why it exists: on 2026-09-22 a fix that looked perfect on the 35° cube was
found (by an ad-hoc version of this) to cost tines on most parts and drop
walls on others — nothing the one-part check or the unit tests could see.

Files: `sweep.js` (run one engine, optionally export STLs) · `compare.js`
(diff two runs) · `check_diff.py` (check_stl on both exports) · `vs-base.sh`
(all of it against a git ref, in a throwaway worktree).

`check_stl.py` checks every solid, so its cost scales with tine count (40mm
cube ~1s; bigplate at dense ~200s). check_diff runs cases in parallel, one
process each, with a per-case limit; a case that overruns is listed as **NOT
checked** — never counted as a pass.
