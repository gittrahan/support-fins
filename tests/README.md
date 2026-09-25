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

**`pad.test.js`** -- the bed pad styles (FIN-SPEC "Bed pad styles"):
- **Sure hold** is a smooth oval that conforms under a tilted part's flank, stays
  watertight, and thins into a gap on PETG numbers;
- **Light** is the default, **one layer** thick at any layer height, and its
  SLICED first-layer gap (pad vs part sections at mid-height) is > 0.1 mm -- past
  the slicers' 0.098 mm closing -- at X30, X40 and X45, while staying within about
  a bead of the part (a brim, not a moat). At 0.1 mm it welded shut at X40;
- **Custom**'s thickness, spread and grip all reach the geometry;
- **Auto** (the default) is **Sure hold on a small foot** (cone tip, sphere,
  cylinder on its rim) and Light elsewhere -- an explicit Light or Custom is never
  swapped -- and the swapped pad meets the part even on PETG numbers;
- a **wedge foot** never runs under the part it braces (fails on the old foot,
  which crossed a cube's edge).

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

**`cutout.test.js`** -- wall cutouts (issue #34), holes through tall breakaway walls
(diamond / triangle / arch one per cell, and the staggered lattice):
- every piece is a **closed, outward-wound** solid (the slicer unions them);
- the cut wall **never reaches outside** the solid wall it replaces, and removes
  real material (mid-plane sampled, winding number so overlapping pieces count once);
- the **contact top, foot and end posts stay solid**;
- **no hole roof is flatter than 45deg** -- nothing bridges open air (checked by
  loosening `CUT.slope`: the arch then fails);
- pattern off, or a wall too short for a hole, is **byte-identical** to before;
- on a **sloped** fin (a tipped cube's underside) the lattice **climbs the slope**
  (>30% removed; the first per-cell version cut ~one hole there) and still never bridges;
- on **real parts** (stress models, Auto) no pattern leaves the support open or makes
  it **heavier** than solid -- a wall where only a speck of a hole fits stays solid;
- a **part-standing** wall cuts too, and the pick reaches an **Auto** build through
  `opts.tunables` (the Worker has its own copy of `cutout.js`).

**`threemf.test.js`** -- the 3MF container, both directions (the only tests here
that aren't fin geometry, because the file format is equally part of the product):
- our own export **round-trips** back to the same geometry, both bodies intact
  through the `<components>` assembly;
- the declared **unit** is honoured (inch/cm/m/micron -> mm) -- 3MF states its
  units, and ignoring that is the "imported at 1/25 scale" bug on the way IN;
- `<build><item>` and `<component>` **transforms compose** -- a reader that keeps
  only one imports the part offset from the plate;
- **DEFLATE** entries read, which matters because every real exporter compresses
  and our writer only ever emits STORE, so the round-trip test alone would miss it;
- **ZIP64** archives read, in both the "sizes and offset overflowed" and
  "offset only" shapes (the ZIP64 extra field holds only the fields that actually
  overflowed, in a fixed order, so a reader that assumes all three mis-parses the
  second). This one shipped broken: ZIP64 was refused outright on the assumption
  that no 3MF would use it, and a real user file did -- writers enable it for
  reasons of their own, not only past the 4GB limit. Unresolvable placeholders
  still fail loudly;
- **support/non-printable bodies** stay out of the part geometry (leftover support
  in a plate would otherwise poison the overhang analysis);
- the **production extension** reads: Bambu/Orca/MakerWorld put each object in its
  own part (`3D/Objects/object_N.model`) referenced by `<component p:path="...">`,
  and a root-only reader throws on these -- which is most real multi-object files;
- object ids are **scoped per part file**: two parts legally reuse `id="1"`, so a
  single global id->object map (three.js's `ThreeMFLoader`) silently assembles the
  wrong geometry on a clash -- the test pins that the two survive as distinct edge
  lengths (this is issue #14's second, quieter half);
- a plate's objects come back **separately and named** (from
  `Metadata/model_settings.config`) so the caller can let the user pick which to
  fin, rather than merging a plate of distinct models into one soup;
- a broken file **fails loudly**: a triangle indexing a missing vertex drops that
  face alone (dropping a partial one would shear the rest of the mesh), and a
  non-ZIP or mesh-free package throws rather than opening blank.

**`step.test.js`** -- STEP import through the real vendored OpenCascade WASM (the
same `stepObjects()` the app's worker output goes through):
- a STEP is recognised by its **content** (the `ISO-10303-21;` magic), not its name;
- a one-body file imports at the right **size and volume** and as a **closed** solid
  (a missing or inside-out face shows up as a volume error, not just a bbox one);
- curved faces are **finely faceted** (an 8 mm bore gets 60+ sides) -- these
  triangles are what gets printed, so coarse tessellation is a quality bug;
- several bodies come back as several **pickable objects**, named from the file;
- a kernel failure or garbage file **throws**, never opens a blank part;
- the imported part runs through `analyze` + `buildFins` and gets a fin.
Fixtures (`tests/fixtures/*.step`) are made with FreeCAD.

**`sway.test.js`** -- sway braces (`web/sway.js`) on a 150 mm post (plain blocks,
no stress models needed):
- a tall part gets braces, watertight, and the **rib never fuses** into the part;
- every tine is **one layer**, on the layer grid, and bites into solid;
- tines run **all the way up at even spacing**, and "grip from" keeps them off below it;
- a short part gets none **and says why**; Draw's one-click brace works on a side and
  refuses a roof; `buildFins` without the option is unchanged;
- a brace straight across a channel from another is **refused**, a staggered one is not.

See `docs/FIN-SPEC.md` for the spec these encode. `prototype/stress/run.js` is the
broader sweep (all models × poses) for eyeballing; this suite is the pass/fail gate.
