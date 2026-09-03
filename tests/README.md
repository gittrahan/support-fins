# Support-engine tests

Fast, offline invariant tests for the geometry the tool bakes into an STL. Pure
geometry in, triangle soup out -- so every test builds something and asserts a
property no future change may quietly break.

```sh
deno test --allow-read tests/
```

## What's pinned (and why it exists)

Each of these is a regression that actually shipped once. The tests are the
fence around it.

**`tines.test.js`** -- `emitTines` on a controlled solid block:
- teeth **point INTO the part**, flush with the wall's flanks -- never standing
  proud as sideways tabs "laying on" the surface;
- teeth are **thin horizontal bridges** (one layer line), never tall dropped towers;
- on a wall along a leaning face's **level contour**, teeth still **bite into the
  face** -- the bite heading comes from the part (nearest-face inward normal), not
  the wall's run. This one shipped broken: the bite was taken from the run tangent,
  which only lands right when the wall happens to run up the slope, so tines on a
  contour-following wall lay FLAT. The earlier "point INTO the part" test missed it
  because its block put the run tangent *into* the part by construction;
- an overhang a tooth cannot reach into gets **no tine** (no gripping air).

**`supports.test.js`** -- `buildFins` on the stress models, tilted so they place fins:
- the fin **wall never fuses into the STL** (it clears the part by the breakaway
  gap; only tines bite in);
- fin feet **fuse into the bed pad** and reach the plate -- a wall lifted off its
  pad is unsupported;
- added geometry is **watertight**;
- a tilted part gets a **tined, gripping** fin.

**`orient.test.js`** -- the orientation/strength logic behind the left rail (pure,
no DOM), so a change to a verdict or a solver can't silently drift:
- **`layerVerdict`** buckets a pose's posture -- tall = weak, flat = strong, on its
  side = mixed -- and now returns **posture only** (the always-on text note was
  dropped; this locks that so a future edit can't quietly re-add it);
- **`loadAlignment`** reads a pull as good/mixed/poor from how much of it crosses
  the layers, with the good/mixed cut pinned at 60deg off in-plane;
- **`suggestOrientations`** turns a part saved tilted (a baked-in overhang) back to
  its support-free flat pose and ranks it first, best-first and well-formed;
- **`suggestStrengthPose`** lays an axial pull into the layer plane on a *seated*
  pose (never the needle-tower), and declines to turn an already in-plane load.

See `docs/FIN-SPEC.md` for the spec these encode. `prototype/stress/run.js` is the
broader sweep (all models × poses) for eyeballing; this suite is the pass/fail gate.
