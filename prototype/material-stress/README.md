# Support material stress matrix

Run serially from the repository root:

```sh
deno run -A prototype/material-stress/run.js --out tmp/material-stress
```

Use a fresh output directory per run. The manifest records the source revision,
Deno/V8 versions, source SHA-256 hashes and every case. `results.jsonl` records
resolved settings, generation/partition time, output roles, numerical residuals
and worker/inline parity. A failure or 180-second timeout exits nonzero after the
remaining cases; it never becomes a passing negative test.

The matrix covers every stock STL in `prototype/stress/models`, flat/X30/X60Y30,
Auto/Full, Tines only and separately assigned tines with Flat/Everywhere
interfaces. The T-shaped model also uses diamond cutouts. Plate pads and tall
wall ribs remain enabled. Full/X30 torus is an explicit normal case. Optional
real models use the same list as `prototype/sweep/full-set.js`; missing files are
listed individually. A linked checkout can supply `--optional-root /path/to/repo`.
Private optional models and generated reports must stay untracked.

To minimize a failure, select its exact case:

```sh
deno run -A prototype/material-stress/run.js --out tmp/material-one \
  --only torus/x30/full/all-separate
```

Each case uses a disposable worker, checks the partition's valid closed solids,
union preservation and non-overlap, then compares the real export worker with
inline output, including role ownership. Four representative cases run in normal
Deno CI; deliberately invalid open/T-junction controls belong to the focused
material tests. Numerical tolerances remain those of the partitioner.

This is software validation. It does not establish adhesion or grip between
materials, or replace slicer import/preview and physical tests.
