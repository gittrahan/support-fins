# Fin geometry spec

Every number here is stated on camera by Slant3D in *How to Design Better Support Fins
for 3D Printing* (youtube.com/watch?v=vnn4XeKQobs). These are not our guesses. Where we
deviate, this file says so and why.

## The shape

A support fin is **a gap and a grab**, and both halves matter:

- The **fin body** is a thin wall standing off the part face by a clearance — it props
  the part up, exactly like a slicer support.
- The **tines** are tiny horizontal bridges that *fuse into the part*. They're what make
  it a **combined** support.

A fin with no tines only holds the part in one direction. The part falls *away* from it
sideways — Slant3D demos a real cube that did exactly that, mid-print. **Tines are the
entire point, not a refinement.**

## Dimensions

| feature | value | rationale |
|---|---|---|
| fin body standoff | **0.2 mm** from the part face | "spaced exactly 0.2mm away the same way support would be" |
| tine height (vertical) | **one layer line** (0.3 mm at Slant3D's layer height; **0.2 mm here**, matching the print's layer height) | a single bead is enough; smaller ⇒ smaller divot. Must equal the *slicer's* layer height or it slices into 1.5 layers and stops being one continuous bead |
| tine width | **0.4–0.8 mm** | 0.4 = one nozzle pass, 0.8 = out-and-back. Prefer the smallest that prints. |
| tine count | **7–8 near the base**, spreading out with height | the part is least stable early. ~5 is usually enough. |
| tine spacing (upper) | every few layers | "just to make sure everything is fully reinforced" |
| base | wide **ellipse**, **1 mm** thick disc | bed adhesion without leaving a veneer to scrape off |
| part bottom edge | **~2 mm chamfer** | a tilted part otherwise starts on a single line and peels off the bed |
| fin top | **rounded**, never pointed | a sharp tip is a retraction point that causes defects |
| placement | on an **edge or corner** | hides the tine pockmarks; never the middle of a visible face |
| long parts | **two fins**, opposite sides | a single fin lets the part twist and fall |

## Why the tines must be horizontal

A horizontal tine prints as **one continuous layer line**: the nozzle travels along the
fin, crosses into the tine, into the part, and back out — **no retraction**. It is a
single strong bead.

A perpendicular (vertical) tine is its own little tower, grown one dot per layer. The
nozzle deposits a tiny amount each pass, so the tines are frail, may not print at all,
may never contact the part, and add a retraction each. Slant3D: *"This is the worst way
of doing it."*

There's a removal benefit too: because horizontal tines lie in the plane of the layer
lines, you **bend** them to fatigue and snap clean, instead of tearing them and leaving
welts.

## Claims we can make (his, on camera)

- Uses less material than tree supports.
- Removes "in a fraction of a second"; at 0.5 mm the marks "have basically no presence at all."
- **Slicer-, machine-, and material-independent** — it's in the STL, so it prints right
  wherever it's sent. This is the property no slicer can provide, because a slicer's
  output is gcode for one machine.
- Diagonal layer lines ⇒ stronger part.
- All edges look good — no distinct top/bottom surface finish.

## Where we deviate

- **`breakaway_wall()` in the prototype is gap-only, no tines — and tines cannot be added
  to it.** The prototype sweeps its wall *under* the contact line, topping out 0.2 mm
  below the part, so the only gap it leaves is vertical, and a tine across a vertical gap
  is the failure mode above. A wall can pass under the contact line *or* rise above it,
  never both: at the contact height the part touches the wall's plane, so it would have to
  pinch to zero thickness there.

  So the fin has to stand **beside** the part, off a near-vertical face, and let the
  **tines carry the load** — which is what "combined" means, and why placement is "on an
  edge or corner." Measured across the 11-model test set (`prototype/probe_tines*.py`):
  66% of contact-line stations take a tine ≤ 1.5 mm, and 13/20 overhang regions have a
  vertical face tall enough to stand a fin against. **That ~65% ceiling is why manual fin
  placement is a core feature, not a fallback.**
- **Scale-aware profile.** The prototype's foot/chamfer/tip are fixed, which degenerates
  into a 14 mm splayed sheet when the overhang sits low. Foot width must scale with wall
  height.
- **The 2 mm bottom chamfer modifies the user's part**, not just adds a fin. That's a
  bigger permission ask — surface it explicitly in the UI, don't do it silently.
  **DECISION (2026-09-02): do NOT build it. The breakaway bed pad solves the same
  bed-adhesion problem without touching the user's geometry** (quality-first). Don't
  re-litigate unless a real print shows the pad alone can't hold a tilted-onto-an-edge
  part. (Everything else Slant3D shows in vnn4XeKQobs — rounded top, ellipse pad,
  corner placement, 0.3×0.5 horizontal tines, two-fins-opposite, one-STL — is already
  implemented; this chamfer is the only spec feature we intentionally skip.)

- **Wall cutouts (optional, off by default).** Issue #34 asked for holes through the
  fins to save filament; Slant3D's fins are solid. The Cutouts setting cuts diamond,
  triangle or arch holes through the middle of *breakaway walls* only (`CUT` in
  `cutout.js`): the contact tip + a 1.2 mm rail, the foot + a 1.2 mm rail, and 2 mm end
  posts stay solid, webs between holes are 1.6 mm, and every hole roof rises at
  ≥ 1.4:1 (~55°) so nothing bridges. **Lattice** instead fills the wall's real outline (it follows a
  sloped top, e.g. a fin under a tipped cube) with 6 mm-pitch diamonds in staggered rows
  (1.2 mm struts at 1.5:1, ~56°). Diamonds at the edge are clipped to the outline; a
  roof that clip leaves flatter than 45° is cut back to exactly 45° (a gable under a
  level top), so every hole roof is ≥ 45° -- the same rule the tool's overhang check
  applies to the part. Walls too short for a 3 mm hole stay solid. The
  tined side fins in `fins.js` are never cut -- their tines anchor across the whole
  blade.

## Sway braces (tall parts) — `web/sway.js`

Not from the video; an extension for tall, slender parts that drift, sag or wobble
as they grow. Nothing overhangs, but the nozzle's drag and each layer shrinking as
it cools push the top around, and every movement leaves a visible layer line. Off by
default ("Sway braces (tall parts)" in the options panel).

**Printed, 2026-09-22.** Two prints of the 249 mm fence-post cap in **ASA**, braces
hand-placed in Draw (three on one, five on the other). Both came out clean: the braces
**snapped off by hand**, the tines left **small bumps**, and the drift the braces exist
to stop was gone. So the numbers below are the printed ones — change them only for the
same kind of reason the rest of this file demands: something measured, not a hunch.

Both prints used the **PLA profile with every setting left at its default** — gap 0.2,
bite 0.3, tine spacing 6 mm, depth 15%, layer height 0.2 — so the PLA clearances
release cleanly in ASA too. ASA has no profile of its own yet; two prints isn't enough
to write one, but it is enough to say the PLA numbers are a safe starting point for it.

| feature | value | rationale |
|---|---|---|
| orientation | vertical rib, **edge-on** to an upright face (≤ 30° lean) | a plate lying flat against the face bends the easy way exactly when the part leans into it; edge-on is its stiff direction |
| inner edge | the breakaway gap (Support gap) off the face | same standoff as every other support |
| depth | **15%** of rib height at the bed ("Brace depth"), tapering to 4 mm at the top | stiffer than the part at the bottom, where the lever arm is longest; a flat top, never a point |
| thickness | 1.2 mm + 0.004 mm per mm of height, max 2.4 mm | a 250 mm rib at 1.2 mm is more slender than the part it holds |
| tines | one layer, one bead wide, **evenly spaced** (default 6 mm, "Brace tine spacing") from "Brace grip from" to the top | the sway is at the top; the Brace's dense-low, 1.6×-spreading rows left the top of a tall part untied |
| grip floor | ≥ 3 tines and ≥ 30% of the rows must find the face | a tall rib tied on at a few points still lets the part wave about between them |
| stilt limit (**auto only**) | auto won't stand a rib more than **40 mm**, or more than **40%** of its height, below its first tine, measured from the plate or from "Brace grip from" if that is higher. A brace placed **by hand builds anyway** and the readout says how far it stands before gripping | under its lowest grip a brace holds nothing and nothing holds it: it prints as a lone wall, free to wobble beside a part at its most delicate. So auto avoids it — but the human picks the pose and can see what the software can't, and this is the same suggest-don't-decide split as the rest of the tool |
| clash | ≥ 1 mm of air from another brace (compared at matching heights) and from any prop wall or wedge (compared at the bed, where both are widest) | two supports fused into one piece no longer break away in pieces |
| auto placement | up to 4 faces with bearings ≥ 60° apart, a rib per ~100 mm of face width, at the face's **tallest** columns | holds both axes; a rib at a gable's low end braces the half that wasn't moving |
| manual | Draw mode: one click on an upright side; click a placed support to select it, Delete / "Remove selected" to take it out | |

## Keel — `keelLines` in `web/prop.js`

Issue #25, request 1, with the reporter's picture: a tipped cylinder held by **one
triangular fin from the plate to its top, standing on its lowest line**. The strip of
overhang under a tilted cylinder is too shallowly curved for `tubeLine`, so it went to
rows spread evenly across its width, which straddled the lowest line (where the
overhang is greatest) and left it bare: 4–6 walls where one belongs.

The line runs the way the strip **rises**: along its area-weighted normal's horizontal
part (the two flanks' sideways lean cancels). The strip's outline axis is only the
fallback for a strip lying level; the end caps skew it (~0.8° on the test cylinder),
enough for a side wall 10 mm out to cross a facet crease and lose half its length.

A region gets a keel when all of these hold; otherwise it keeps its tube wall or rows:

| rule | value | the case |
|---|---|---|
| a trough | the surface, with its slope along the strip removed, is lowest at one lateral offset and climbs **≥ 0.3 mm** on **both** sides (`keelRise`) | a tilted flat face's lowest line is an edge, with the face all on one side. 1.5 mm missed a cylinder at 46–49°, whose strip climbs ~0.6 mm |
| a line, not a point | down the strip the lowest point stays within **3 mm** of that line (`keelDrift`) and rises along it within **1 mm** of straight (`keelStraight`) | a bowl (sphere X25) is lowest at a point: 94% → 46% |
| not a pocket | region ≥ **300 mm²** (`tubeMinArea`, the tube route's own bar) | a keel in bore_bracket's bore displaced the wedges that gripped it from 1.2 mm |
| reach | walls outward every span only while a side is more than a span **+ 1.5 mm** from the last (`keelReachSlack`: the strip's edges sit at the 45° threshold), never past 2 mm inside its edge | |
| holds the strip | its walls reach **≥ 99.5%** of the strip's points by the sweep's coverage rule (`keelCover`), else one more wall each side, up to twice | long tubes and needles lost 3–4% to a lone keel |
| grips low | its lowest station within **1.5 mm** of the strip's lowest point (`keelDepth`) | a needle gripped 5 mm higher |
| vs a tube | when `tubeLine` also takes the region, the keel wins only if it adds side walls | a cylinder at 78–85° got the tube's lone wall plus 2–3 wedge stilts beside it; a one-wall keel on tube X60 gripped 0.2 mm higher than the tube's |
| builds | if any keel wall is refused further down, the region is rolled back to its tube wall or rows | |

On the 40 × 60 mm test cylinder: tipped 46–55°, **one fin** (4–6 walls on main at 50–55°);
60–85°, the fin plus **one full-length wall each side** (4–6 walls and stilts on main);
nothing unserved. Exactly 45.0° has no overhang (side and cap both sit on the threshold),
so it keeps main's wedges.

**Measured** (sweep vs main, 837 cases, NOCHECK): coverage 80.3% → 80.7%, nothing
unserved, no case loses coverage. **Two trades**: cylinder X30Y60 at default coverage
goes from 8 scattered walls (99.5%, 51 tines) to the keel and two side walls (98.9%, 30
tines); tube X60 at full coverage gets 5 full-length walls for 6 staggered ones, its
lowest tine 0.95 → 1.15 mm (tine phase; the keel's wall reaches lower, 0.62 vs 0.71 mm).

## Naming

Slant3D says "grip fins" once. Unrelated to the *grip fin* used elsewhere in Matthew's
CAD work (a tolerance-absorbing feature for mating holes). Don't collide the terms.
