# Engine note: fin geometry moves under float noise

Found while pinning the Orca path against the website. Not an Orca bug and not
blocking. It's written down here with a repro so you can decide what to do with it.

## What happens

On `lbracket`, shifting every vertex coordinate by **1e-13 mm** (far below
anything a printer, an STL writer or a user could produce on purpose) changes the
fin mesh. The overhang analysis and the number of fins (`braceCount`) don't
change. The difference is in the tine comb along the top of each fin.

```
deno run --allow-read plugins/shared/tests/sensitivity_repro.js
```

Re-run against current `main` (after the `plugins/` move):

| pose | baseline | +/-1e-13 mm | same part moved to x=137, y=88 then re-centred |
|---|---|---|---|
| Y20 | 18 tines, 1884 tris | 18 tines, 1864 tris | 18 tines, 1864 tris |
| Y35 | 17 tines, 1652 tris | 17 tines, 1632 tris | 17 tines, 1692 tris |
| Y50 | 20 tines, 2068 tris | 20 tines, 2048 tris | 20 tines, 2088 tris |

When I first reported this, the tine **count** flipped too (for example Y35 went from
17 to 16 tines at 1e-13 mm). On current `main` the count holds steady and only the
triangle count moves, so the recent tine work seems to have fixed most of it.
Some station keep/drop decisions still flip, though.

## Why it matters

- Two users with the "same" part can get slightly different tine combs, and the
  website can give a different comb for "rotate in-app" vs "import an STL that
  was saved already rotated".
- Tests can't pin output vertex-for-vertex, only at the fin level.

## Likely cause (unconfirmed)

A ray-parity or on-edge test hitting exactly-degenerate cases on axis-aligned
geometry (e.g. `insidePart` / `stationIsClear` rays grazing an edge or vertex), so
a 1e-13 nudge flips a keep/drop decision for a station. `lbracket` is all
axis-aligned faces, which makes grazing hits common.

## Possible fixes

1. Snap input vertices to a fixed grid (e.g. 1e-6 mm) after posing, before analysis.
   That makes results repeatable but moves the problem to grid boundaries.
2. Make the keep/drop decisions robust: jitter the ray direction by a fixed
   irrational angle, or use a tolerance band and resolve ties deterministically.

The Orca plugin does option 1 in `plugins/shared/engine/fins_entry.js`: it re-centres the posed part
in float64 and snaps it to a 1 nm grid before calling the engine. With the snap,
a part's fins are identical wherever it sits on the plate
(`plugins/shared/tests/entry.test.js`, "moving a part around the plate never changes its fins").
