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
- an overhang a tooth cannot reach into gets **no tine** (no gripping air).

**`supports.test.js`** -- `buildFins` on the stress models, tilted so they place fins:
- the fin **wall never fuses into the STL** (it clears the part by the breakaway
  gap; only tines bite in);
- fin feet **fuse into the bed pad** and reach the plate -- a wall lifted off its
  pad is unsupported;
- added geometry is **watertight**;
- a tilted part gets a **tined, gripping** fin.

See `docs/FIN-SPEC.md` for the spec these encode. `prototype/stress/run.js` is the
broader sweep (all models × poses) for eyeballing; this suite is the pass/fail gate.
