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

## Small holes and automatic placement

Auto and Full coverage leave a recognised tiny-hole ceiling unsupported, using
the existing `fins/coverage.js` HOLE classification (nominally a bore around 6 mm
or smaller). A wall can fit inside such an opening but be impossible to reach
and remove. The exclusion is shared by the normal, raster, downhill, wedge,
short-wall and fill passes; curved tracing cannot grow back onto excluded faces.
The full model remains available for collision checks. After automatic generation,
the ceiling is highlighted amber, separately labelled from area-based slivers.
Highlight small overhangs hides both amber categories when disabled; exempt
ceilings do not turn red. Before generation, with supports off, and in Draw,
the original overhang analysis supplies the colours. Larger bores still get
supports, and Draw remains an explicit choice.

Containment probes for this classification use the full seated model and count
coincident triangle hits as one surface. Opposite-facing hits at a tangent cancel.
This keeps a probe on a tessellation seam from treating bore air as solid or
inventing a floor; it does not change the general collision predicates.

Full coverage also reserves the space between each excluded ceiling triangle
and the model's upward-facing floor in its existing collision grid. These
keep-clear volumes are computed once with the classification and never emitted
as supports or credited as held area. This prevents removal of the trapped wall
from opening a new route through the cavity for supports aimed elsewhere.

The readout reports recognised small-hole ceilings left for bridging separately
from overhangs where placement failed. If every retained region is exempt and
there is no other placement or seating failure, the Fins row says "none needed"
rather than "none possible". Plugin stats expose `smallHoleRegions`
(zero when none). Check the slicer preview and print settings: exclusion does not
guarantee a successful bridge. This is the existing heuristic, not an exact
diameter or extraction-path test. It measures the selected overhang band, so its
recognition also depends on the overhang threshold and mesh geometry.

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

### Resin: vertical pins — `web/prop/pins.js` (GitHub #309)

All of the above is FDM. A resin print is peeled off the vat floor every layer, so a
support has to be **attached** to the part — a resin slicer's contact tip sinks into the
model ("penetration" in Lychee, "contact depth" in Chitubox) — and a wall standing `gap`
under a flat span holds nothing. **Tines → Direction → Vertical (resin)** replaces the comb
with pins:

| | value | why |
|---|---|---|
| pin width `pinW` | 0.4 mm square | a resin contact tip's 0.3–0.6, inside the 0.6 wall tip |
| pin tip `pinTipW` | 0.25 mm square | narrows from `pinW` across the gap, so it snaps at the part's surface |
| pin depth `pinDepth` | 0.1 mm (field 0.05–1) | how far into the part (resin presets: 0–0.2); halved down to ¼ where the part is thinner, else no pin |
| spacing | the Tine grip slider's step | 2 mm dense … 5 mm light, ≥ 3 per wall |
| bottom | `tineOverlap` (0.3) inside the wall top | so they union |
| foot gap | 0 (welded) | a wall on the part would otherwise start as a floating island |

The wall's own `gap` stays: the pin is the neck across it. All four top corners are
checked inside the part. **Not tested on a resin printer.**

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
- **Tines kiss the part's surface** (2026-10-02). A tine is placed only where its
  `tineReach` (0.5, at a 0.2 layer) reach lands in the part, but it's built only up to the surface: its
  end follows the part, measured at each side edge at the tine's bottom and top
  (`kissEnds`), so on a slope the end leans with the underside and nothing of the tine
  sits inside the part (+0.01 mm, so the two overlap rather than sit flush). Top and
  bottom stay flat and one layer apart, so it's still one bead. A slicer unions part
  and supports in one object, so the buried stretch never printed: bite coupon, main
  vs kiss, sectioned at every mid-layer: 0 mm2 lost, 0.02 mm2 gained (spots where the
  0.5 box stopped short of the face). What welds is the part's next layer printing
  onto the tine (local issue 027).
  The end is the FIRST solid along the line (2026-10-14): the search probed at 2× the
  reach and bisected back, so a part thinner than that left both probes in air past it
  (the full reach, run through), and a second piece beyond a thin near one pulled the end
  out through the near one. A 0.1 mm walk up to the old answer catches both; where it
  finds nothing the end is unchanged to the bit. Across the sweep's 324 auto builds, 107
  tine corners moved; each had run through 0.02-0.75 mm of solid, and came in a median
  0.42 mm (up to 1.75 on a cone at 0.6 layers). No count, wall or coverage changed.
  Cone, needle and tube at X40 had them at 0.2 layers.
- **Draw mode builds smaller walls than Auto** (2026-10-03, local issue 011). A drawn
  wall needs only **2 mm** of line (`DRAW_MIN_LEN` in `draw.js`; Auto's `minSpan` is 7),
  because the user is pointing at one small overhang Auto doesn't reach -- a cleat, a
  fingertip. When neither full-height wall fits (on the part, then on the plate), it
  falls back to a **squat** wall: on the part down to `minHeightSquat` (0.6 mm) of
  wall -- in practice the part below must be **just over 1 mm** under the overhang,
  since `floorLine` skips surfaces within its 1 mm margin -- or on the plate -- only where nothing of the part is under
  the line -- with its stations under `minHeight` (1.5) as a brimmed squat stem
  (`sweepSquat`, Auto's near-bed wall, tines from `squatBrimH` up) and any taller run as
  the full flanged wall. Under 0.6 mm of room it still refuses. The fallback runs only
  after both full-height walls fail, so every line that built before builds the same.
- **A low band gets a row at its edge** (2026-10-05). Where a near-flat underside sinks
  toward the plate (a curved face lying on the bed), no wall fits under the squat floor
  (0.6 mm wall + gap), and Auto's rows land on a pitch that ignores it. So the edge of
  that band -- the first row position where a squat wall and its brim clear the part --
  gets a row when no row that can build stands within a brim width (5 mm) of it
  (`lowEdges` in `prop/tracks.js`; a row inside the band never builds, so it doesn't count). Added, never moved: moving a row onto the edge lost real walls. Bands
  under `lowBandMin` (1 mm) are sampling dips, not the plate.
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
  triangle or arch holes through the middle of *breakaway walls* and *wedges* (`CUT` in
  `cutout.js`; a cube on its edge at 45° is held by wedges alone, so leaving them solid
  made the setting do nothing there): the contact tip + a 1.2 mm rail, the foot + a 1.2 mm rail, and 2 mm end
  posts stay solid, webs between holes are 1.6 mm, and every hole roof rises at
  ≥ 1.4:1 (~55°) so nothing bridges. **Lattice** instead fills the wall's real outline (it follows a
  sloped top, e.g. a fin under a tipped cube) with 6 mm-pitch diamonds in staggered rows
  (1.2 mm struts at 1.5:1, ~56°). Diamonds at the edge are clipped to the outline; a
  roof that clip leaves flatter than 45° is cut back to exactly 45° (a gable under a
  level top), so every hole roof is ≥ 45° -- the same rule the tool's overhang check
  applies to the part. **Honeycomb** fills the same outline the same way with
  hexagons stood on a corner (6 mm pitch, 1.2 mm struts both ways: vertical between
  neighbours in a row, diagonal between rows), stretched upright until their roofs
  rise 1.4:1 (~55deg); a regular hexagon's 30deg roofs are a print question
  (`prototype/calibration/cutout/`, the honeycomb gate). Under the coupon's ledge its
  walls weigh about 10 % less than Lattice's. Walls too short for a 3 mm hole stay solid. The
  tined side fins (the Onshape port's; the web tool no longer builds them) are never
  cut -- their tines anchor across the whole blade.

- **Interface material (optional, off by default).** GitHub #21: a toolchanger can
  print the part-facing band of a support in a second material that won't bond to the
  part (PETG under PLA). `PROP.iface` (`web/prop/crest.js`) is a mode:
  - **Flat contacts** (the default when on): a wall station gets a crest only where
    the part's underside above it is within `ifaceFlatDeg` = 10° of level. There the
    crest is `PROP.ifaceLayers` = 1 layer (the Layer height field, 0.2 mm) of the wall's full 1.0 mm
    (two lines), no tip taper: the taper only exists so fused PLA snaps off, and it
    left one PETG line with nothing to bond to. 10° keeps the full-width edge 0.09 mm
    off the part, under the gap. Tines stay in the body material. That is how PETG
    interfaces are used (flat undersides come out like top surfaces) and costs a few
    layers of tool changes. A cube at 35° gets none: its first print (crest
    everywhere) couldn't lay the PETG on the PLA, climbing through every layer.
  - **Everywhere**: every wall top (on a slope it keeps the tip's taper, or its edge
    would rise into the part) and the tines, sway braces' included.
  The crest reaches 0.01 mm down into the body (they overlap); every wall kind is split
  -- prop, part-attached, squat, Draw/fill, and a wedge blade when all of its contact is
  a crest. The 3MF export writes the interface as a second part of the supports object,
  `<name> interface` (an object of its own starts in mid-air, and Orca refuses it:
  "empty first layer"); the readout says when the mode is on and no wall got one. The
  gap stays the material's: what it should be over PETG (0 / 0.1 / 0.2) is a coupon
  question. Not split: a sway rib's own inner edge (a vertical contact the full height
  of the rib), the foot of a wall standing on the part, and a wedge whose contact line
  steps straight up.

## Bed pad styles — `PAD.style` in `web/fins/pad.js`

The pad goes under a part whose bed contact is under `padMinArea` (60 mm²), which is
nearly every tilted part. **Printed, 2026-09-24:** a cube on its edge in **PETG** with
one wedge and the Light pad held for the whole print, and the pad came off clean.

| style | thickness | meets the part | why |
|---|---|---|---|
| **Auto** (default) | Light's, or Sure hold's on a small foot | as whichever it picked | the dropdown shows the pick -- "Auto (Light)" / "Auto (Sure hold)" -- so it never reads Light over a Sure hold pad |
| **Light** | **one layer** (the Layer height field) | **0.12 mm** sideways gap off the part's first-layer outline (its section at the first layer's mid-height) | a slicer brim: only the first layer grips the plate, so more layers add stiffness and weld height, never adhesion; the gap keeps pad and part as two regions, so perimeters run beside the part instead of solid infill through it |
| **Sure hold** | `padH` 0.5 mm (PETG 0.3) | tacked `grab` 0.05 mm into the underside (PETG −0.1) | the original pad; slices as one merged region with the part on its first layers -- holds hardest, hard to remove |
| **Custom** | Pad thickness | Pad gap (sideways) + Pad grip (vertical) | the Light mesh on the user's numbers; the only style that shows them |

All three spread `padMargin` (4 mm) past the contact; Custom exposes that as Pad spread.

**Small feet get Sure hold.** Light grips by first-layer squish along the part's
first-layer outline: a 40 mm cube's edge gives 80 mm of it. A part on a point or a
small round foot gives a few mm (cone or pyramid tip < 1 mm, sphere 8 mm, a cylinder
on its rim 7–12 mm), which is next to nothing to hold, and the ball-footed shelter
hubs printed on the Sure hold pad. So when that outline is under `minGripOutline`
(20 mm) Auto builds Sure hold instead, and the readout says "Sure hold (small foot)"
and why. On the stress set the split is clean: every round/point pose is ≤ 16.5 mm,
every edge pose ≥ 24 mm. The 20 mm line is a judgement call, not a measurement.
An explicit Light or Custom is never swapped; on a small foot (Custom: with a gap) it gets a warning.
The swapped pad always **meets** the part (grab ≥ 0, flush or the material's tack):
PETG's Sure hold stands a 0.1 mm gap under the part, which on a sphere put the pad
~0.7 mm off the first-layer dot -- two unconnected pieces on layer 1, holding nothing
(Matthew's PETG sphere).
**The gap must clear the slicer, not just exist.** PrusaSlicer, Orca and Bambu close any
slice gap under 2 × `slice_closing_radius` (0.049) = 0.098 mm. The first Light pad aimed
for 0.1 mm and printed well at exactly 45°, but on a cube at 40° the mesh gave 0.089 mm and
the slicer merged the cube's first bead into the pad (Matthew, 2026-09-24). So the gap is
0.12 mm, and it is held exactly: the pad's top ramps linearly with the true distance from
the part's first-layer section, crossing mid-height at the gap, which the mesh's linear
interpolation preserves. Sliced gap measures ≥ 0.12 mm along a cube's edge at 30–50°,
≥ 0.107 mm at its rounded end corners. The mesh is 0.1 mm only in the 1.2 mm blocks the
part comes near (within the gap ring and ramp of any surface below the pad's top); every
other block is flat and meshes as two triangles, or a fan through the nodes it shares with a
fine block and the rim (so the outline is the full grid's). Every slice equals the full 0.1 mm
grid's. It used to be fine across a
band of the whole oval, so one dip near the rim made a 128 mm figure's pad 2M cells. A
coarser grid is not a way out: at 0.3 mm the gap closes to 0.080 mm at a cube's corners.

A **tined** pad (0.3 mm clearance bridged by one-layer tines) was tried first and
dropped: on the first layer the slots were 0.1–0.3 mm, the perimeters around them
squished together, and it still sliced as one fused piece.

**Wedge feet** follow the same rule: the 0.6 mm flange stops where the part hangs less
than footH + gap (0.8 mm) above it. It used to reach 3 mm past the wedge's low end,
straight across a cube's edge, and fused with the part for three layers.

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

**Tines kiss the face (2026-10-03).** Like the walls' tines (#168), a brace tine now ends
on the part's face (`kissEnds`, web/kiss.js) instead of running the bite (0.3, PETG 0.15)
into it, and the material's bite is gone: one `SWAY.tineReach` 0.3 only decides where a
tine goes (the part must be there at half of it). Measured before changing it, on 16
braced cases (4 real parts, 12 stress shapes), PLA and PETG: brace and tine counts all the
same, and part + braces merged, sectioned at every mid-layer that changed, identical in
30 of 32. The two others are one brace on the lighthouse (Y90), where a blocky step puts
a notch between a tine's two side edges: PLA 0.13 mm2 less tine in it, PETG 0.14 more,
over 7 layers. The printed numbers above still stand.

| feature | value | rationale |
|---|---|---|
| orientation | vertical rib, **edge-on** to an upright face (≤ 30° lean) | a plate lying flat against the face bends the easy way exactly when the part leans into it; edge-on is its stiff direction |
| inner edge | the breakaway gap (Support gap) off the face | same standoff as every other support |
| depth | **15%** of rib height at the bed ("Brace depth"), tapering to 4 mm at the top | stiffer than the part at the bottom, where the lever arm is longest; a flat top, never a point |
| thickness | 1.2 mm + 0.004 mm per mm of height, max 2.4 mm | a 250 mm rib at 1.2 mm is more slender than the part it holds |
| tines | one layer, one bead wide, **evenly spaced** (default 6 mm, "Brace tine spacing") from "Brace grip from" to the top | the sway is at the top; the Brace's dense-low, 1.6×-spreading rows left the top of a tall part untied |
| grip floor | ≥ 3 tines and ≥ 30% of the rows must find the face | a tall rib tied on at a few points still lets the part wave about between them |
| stilt limit (**auto only**) | auto won't stand a rib more than **40 mm**, or more than **40%** of its height, below its first tine, measured from the plate or from "Brace grip from" if that is higher. A brace placed **by hand builds anyway** and the readout says how far it stands before gripping | under its lowest grip a brace holds nothing and nothing holds it: it prints as a lone wall, free to wobble beside a part at its most delicate. So auto avoids it — but the human picks the pose and can see what the software can't, and this is the same suggest-don't-decide split as the rest of the tool |
| clash | ≥ 1 mm of air from another brace (square-ended foot and body rectangles compared at matching heights) and from any prop wall or wedge (compared at the bed, where both are widest) | two supports fused into one piece no longer break away in pieces; square ends allow clear braces on opposite sides of a thin part without imaginary rounded caps extending through it |
| auto placement | up to 4 faces with bearings ≥ 60° apart, a rib per ~100 mm of face width, at the face's **tallest** columns | holds both axes; a rib at a gable's low end braces the half that wasn't moving |
| manual | Draw mode: one click on an upright side; click a placed support to select it, Delete / "Remove selected" to take it out | |

## Wall ribs (Full coverage) — `web/prop/brace.js`

Sway's optional cross ribs use the **actual Sway body thickness**, including its
height/nozzle floor, rather than the ordinary wall thickness. Their flange keeps
the ordinary foot's margin beyond that wider body. Part and support clearance
checks see the complete wider mesh; a blocked arm may shorten or be omitted, never
thin down to fit. The selected cross-height percentage and ordinary wall ribs are
unchanged. This uses more material when Sway is thicker than an ordinary wall;
the geometry checks establish clearance and export integrity, not measured print
strength. A physical coupon is still needed.

Not printed yet. The fill pass serves hands, hems and elbows with walls ~3 mm long and
25–50 mm tall (Isaac's hands: 33 mm on a 0.4 × 1 mm footprint), a suspect in plates
letting go. A cap on the ratio (closed PR #200) left the hands bare, so the wall stays
and gets ribs at the plate. Only these numbers are new; the rest are the wall's own.

| feature | value | rationale |
|---|---|---|
| when | fill walls over `maxShortAspect` (**6**) × their length, at stations whose floor is the plate | Auto's own short-wall limit; v1 lands nothing on the part (marks) |
| where | up to 4: off each end along the line, off each face at the middle | each judged alone: a wall against a thigh keeps its open sides |
| reach | `footRatio` × wall height (0.12; 4.2 mm on a 35 mm wall), halved while blocked, down to **1.5 mm** | the rule the foot already follows across the line |
| rise | **50%** of the wall's height at the stem, and ≥ 1 mm under the tip taper | the contact, gap and tines are untouched |
| thickness / flange | wall `th` (1.0); flange `baseH` (0.6) tall, `footMin` (1.6) either side | same as the wall it braces |
| clearance | `sideClear` (0.35) off the part, out past the tip; off every other support (joined flanges allowed, as fill walls) | a fused rib doesn't break away |
| order | after every fill wall is placed | ribs built as walls went in took plate the next walls needed (Isaac 12 → 10 walls) |

## Tall-wall ribs (Brace tall walls) — `web/fins/tall.js`, `web/prop/brace.js`

Not printed yet. A user: "you're definitely going to want some sort of bracing for fins
taller than 10cm or they wobble too much, maybe just a perpendicular fin." A wall is a
1 mm sheet on a foot that stops at `footMax`, tied to the part only by its tines at the
top. The rib is the Wall ribs' own triangle (below); only when and where are new. The
tall/ coupon (`prototype/calibration/tall/`) prints walls 60–120 mm bare vs ribbed to
set the numbers.

| feature | value | rationale |
|---|---|---|
| when | plate walls over `BRACE.tallH` (**100 mm**), Auto, Full and Draw; the **Brace tall walls** box, on by default | the reporter's 10 cm, until the coupon prints |
| where | a pair, one off each face, every `BRACE.faceStep` (**30 mm**) of wall length, at the middle of each share; never off the ends | a long wall is stiff along its line; across it, it is a sheet |
| reach / rise / flange | the Wall ribs': `footRatio` × height (halved while blocked, ≥ 1.5 mm), **50 %** of the height, `footMin` flange | one rib shape; R50 vs R80 is on the coupon |
| order | last: after every wall, wedge, fill wall and sway brace | ribs built as walls went in took plate the next walls needed (the fill pass's lesson) |
| clearance | `sideClear` off the part (only at stations whose floor is the plate) and off every other support below the rib's top, in plan, ~1 mm pieces | no rib fuses two pieces; a 3D box grid was exact but cost 4 s on bigplate Y35, this ~0.2 s |
| skipped | a wall the fill pass already ribbed (the slim rule) | no doubled ribs |

## Joined walls and ties (Full coverage) — `web/fins/fill.js`, `web/prop/ties.js`

Not printed yet. A figure's fill walls stood apart, each on its own ("all the fins become
a mess"), and a 45° cleat sole needs walls down its slope that cross the one along it.

| feature | value | rationale |
|---|---|---|
| joined walls | the fill's patch-by-patch pass may, as its last try, cross or meet another **fill** wall; never Auto's, never the part | one support with the wall it meets; the slope's walls were refused for touching it |
| tie shape | zigzag of struts (a Warren truss) in the plane through both walls, from the plate at wall A up to B, back to A… | each strut starts on the plate or the strut below: nothing bridges |
| strut slope | **55°** (`TIE.slope` = tan 55°) | steeper than the 45° a printer holds without support |
| strut size | wall `th` (1.0) wide, **1.2 mm** deep measured straight up; ends run th/2 into each wall | overlapping solids, never flush |
| which walls | fill walls ≥ **8 mm** tall, at stations on the plate, **2–12 mm** apart; closest pairs first, **2** ties a wall | under 2 mm the feet already meet; past 12 mm a strut is a wall of its own |
| how high | to **70%** of the lower wall's height, and ≥ 1 mm under its tip taper | the contact, gap and tines are untouched |
| clearance | `sideClear` (0.35) off the part (none inside it); off every support but its own two walls | a fused tie doesn't break away from the part |
| order | after the ribs | ties don't take plate or room from walls or ribs |

## Downhill walls (Auto and Full) — `web/prop/downhill.js`, `web/fins/downhill.js`

Not printed yet. Issue #25: walls that run down an overhang and follow it to the plate,
one at each end of its top edge and one in the middle, bending with the surface where it
curves. The wall itself is the ordinary plate wall; only placement and the race are new.

| feature | value | rationale |
|---|---|---|
| direction | the surface's steepest descent, traced in **1 mm** stations (`stationStep`) | across a downhill wall the surface is level, so its top settles clear on both flanks; walls along a 45° slope failed every clearance probe (#125's edge paths, 0 walls on the #25 part) |
| seeds | the region's top edge (sampled on a **1 mm** grid), both ends **1 mm** in, and evenly between at ≤ `maxUnsupportedSpan` (**12 mm**) | the reporter's three lines: each edge and the middle |
| stop | leaving the region, slope under **0.05**, turning back, or within **3 mm** of an earlier line | converging lines join instead of crowding |
| level region | no line when under half the region slopes | a ceiling has no downhill; rows keep it |
| race | per region against the other placements (`raceAgainst`): must hold **3%** more (raster needs 10%), weigh ≤ **1.5×**, never raise the region's lowest tine | the #25 part's bend is +9.8% |
| no flush flank | a downhill wall with any vertex (tines aside) inside the part is dropped before the race | a flank flush with a part face at the top edge read as clear (lbracket Y20, plugin path) |
| whole build | when a region swaps, the part is also built without downhill walls; the downhill build stays only if it holds ≥ the overhang (MUST + near-plate), its lowest tine rises ≤ `gripRise`, and no wedge is lost | wedges, short walls and the fill pass build around the race's result, which it can't see |
| switch | `opts.downhill`: unset = race + judge (Auto, Full); `false` = off; `buildProps` alone only with `true` | |

### Curved walls checkbox — `web/prop/curved.js`

Not printed yet. Off by default; Auto and Full only, site only (plugins later).

| feature | value | rationale |
|---|---|---|
| bend | the spread of a wall's top-line headings, each read over **3 mm** of line, unwrapped, **10%** trimmed at each end of the range; 0 under 6 mm of line | one wandering chord where the line starts off the climb isn't a bend (a quarter arc reads ~70°) |
| bending region | any of its downhill walls bends > **10°** | not print-tested; straight downhill walls read 0° on the real organic parts, real bends 10–60° (spiral ramp 56–60°, lamp shade X30 and bust 10–23°) |
| tried, ticked | downhill walls are tried under **every** region, not only those the walls above left bare (`RASTER_SKIP_HELD`) | a curve under a well-held region was never built (spiral X30, bunny X30) |
| race, ticked | a bending region **always** swaps to its downhill walls if they hold anything, at any weight; the normal walls that hold what they miss (≥ `RACE_ABS`) or grip lower stay beside them (`keepers`), and the grip rule does not veto the swap. Other regions race as unticked | the user asked for the curve (#25: "only worked once"); measured over 8 real organic parts, holding-as-much let 4 bending walls through, forcing ~12. Bare overhang stays red in the readout |
| whole build | ticked, in Auto no whole-build judge: not the downhill one, not one against the unticked build (Full: next row) | the user's choice; over 16 real cases it never changed the result anyway |
| Auto fill, ticked | the fill pass (`fins/fill.js`, rows off) runs under the regions a curve won, there only; the readout counts it apart from Full coverage's (`curvedFill`) | forced curves left overhang the straight walls held (spiral X30 911 → 803 mm², bear X0 211 → 162); with the fill every measured case holds ≥ unticked (torus X30 471 → 835). Ticked Auto takes up to ~3.5 s longer on a big part |
| known gaps, ticked | the downhill whole-build judge is skipped for non-bending regions too; the fill doesn't look at a neighbouring region a dropped straight wall also held; a forced swap may raise the lowest tine (bust Y60 17.90 → 18.16 mm, held 1557 → 3239 mm²) | review 2026-10-17: the judge rejected nothing on 9 stress models × 6 tilts + 4 real parts, and neighbour loss measured 0 on 6 parts; revisit on a print or a report |
| Full, ticked | the unticked Full build is built too; the curved one stays only if it holds ≥ **99%** as much (`CURVED.fullSlack`), its lowest tine rises ≤ `gripRise` and no wedge is lost (`judgeDownhill`'s test); the slack only when the ticked build has a bending wall (all straight: the strict test). Otherwise the straight build, and the readout says so (`curvedDropped`). Can still cost plastic for no gain (torus, held equal, +12% plastic) | the curves can break up the fill's rows (coffee bean on its side: held −2 to −5%); a strict test dropped the spiral (−0.8%) and bust X30 (−0.3%) too. Ticked Full builds up to ~2.5x as long (the curved build, plus the unticked one with its own downhill judge) |
| tracing surface, ticked | `prop/trace.js`: each region grown across adjacent down-facing faces (normal z below **−0.34**, `TRACE.grow`: the slivers and steep strips between islands) up to **6 mm** in plan from the red it grew from (`TRACE.bridge`, half `maxUnsupportedSpan`); regions whose growth meets trace as one surface and race as one (their leader's turn: every member's walls against the group's); a member counts as served only where the group's walls reach its own faces; a group's wall within a foot + 1 mm in plan of a wall an earlier group swapped in is dropped (each group traces alone: stacked surfaces met 0.15–0.43 mm apart on the bean on its side; a shared join hash instead cut the lamp shade X30's curves 20 → 15 and held below unticked) | a rippled surface near the threshold breaks its red into islands, and a line traced on one stopped at its edge: coffee bean tilted back (X-45) 0 curves → 8, held 1305 → 2674 mm² (Auto) |
| slope, ticked | read over **2 mm** (`TRACE.h`; unticked 0.5) | ridges under it don't steer the line |
| coverage, ticked | each line trimmed to the stations within **6 mm** of red (slivers count); red farther than that from every line seeds a line of its own, highest first, up to **60** lines per surface (`DOWNHILL.maxLines`) | the curves cover the overhang and the fill takes scraps: bean on its side (X90) 10 → 30 curves, Auto fill 40 → 21 walls (still at its try cap), held 6376 → 7377 mm²; Full now keeps them (7154 → 7340) |
| two races, ticked | the downhill race runs as unticked first; then a second race over the grown surfaces, where a group whose walls bend always swaps and every other group keeps what the first left | `buildProps` changes nothing where no wall bends (ticked Auto still skips the downhill judge: known gaps, above) |
| limits | a red band shallower than `minSpan` (**7 mm**) downhill gets stubs, not curves; one bending line swaps its whole group, so on a part whose red joins into one surface the forced swap reaches most of it (`keepers` and Auto's fill stand behind it; in Full the 1% judge) | bean X-30: 39 lines traced, 26 stubs, 1 curve. Ticked Auto can hold less than unticked: lamp shade X30 25382 → 24842 mm² (−2.1%, the fill at its cap; Full keeps the straight build there). Kept forced (Matthew, 2026-10-17); every other measured case holds at least as much |
| switch | `opts.curvedWalls === true`; anything else is the race above, byte for byte | |

## Naming

Slant3D says "grip fins" once. Unrelated to the *grip fin* used elsewhere in Matthew's
CAD work (a tolerance-absorbing feature for mating holes). Don't collide the terms.

## Optional full Sway depth

The browser's **Full brace depth** defaults off. Without `uncappedDepth: true`,
the bed depth stays `max(minDepth, min(maxDepth, reach * H))`, where `maxDepth`
remains 60 mm. Opt-in uses `max(minDepth, reach * H)` instead; `reach` retains
its 5–50% bounds and `H` is the actual collision-limited brace height. The depth
is recomputed whenever a model collision lowers the rib. Top depth, thickness,
foot padding, tine geometry and minimum grip are unchanged.

Auto worker requests and hand-placed Sway both carry the option. Existing
part, foot, brace-to-brace and brace-to-wall checks still apply to the expanded
footprint. A selected depth is not a promise that every position can accept it.
The user must check build-volume fit and sliced geometry. Larger bases consume
more space and material and have not been physically validated for metre-high
prints. Undo/redo and saved 3MF sessions retain the setting; plugin dialogs keep
their established capped defaults. This feature needs neither nozzle profiles
nor the Draw worker/CPU changes.

## Nozzle size — `web/nozzle.js`

Every width above is for a **0.4 mm nozzle**. The site's Nozzle field (0.2 / 0.25 /
0.4 / 0.6 / 0.8, and 1.0-2.0 for large-format printers after #210; default 0.4) scales them by `k = nozzle / 0.4`:

| width | 0.4 | rule | 0.6 | 0.8 | 0.2 |
|---|---|---|---|---|---|
| tine (`PROP.tineW`, `SWAY.tineW`) | 0.5 | × k | 0.75 | 1.0 | 0.25 |
| contact tip (`PROP.tip`) | 0.6 | × k | 0.9 | 1.2 | 0.3 |
| wall (`PROP.th`) | 1.0 | × max(1, k) | 1.5 | 2.0 | 1.0 |
| wedge (`PERP.th`) | 1.2 | × max(1, k) | 1.8 | 2.4 | 1.2 |
| brace rib (`SWAY.thMin`–`thMax`, and `thPerMm`) | 1.2–2.4 | × max(1, k) | 1.8–3.6 | 2.4–4.8 | 1.2–2.4 |

One-line features (tines, tip) follow the nozzle both ways. The structural widths
only grow: a finer nozzle doesn't make a free-standing wall stiffer. Heights (tine
height, gaps, pad) follow the layer height, not the nozzle. 0.4 is the tuned
geometry, unchanged. The other sizes are this scaling rule, not printed coupons.
**Large nozzles** (1.0–2.0) follow the same rule: a 2.0 nozzle builds a 5 mm wall and
a 3 mm tip. Layer height stays capped at 0.6: the gap, the flanges and the pad are fixed
heights tuned for thin layers, and a 0.2 mm gap disappears into a 1 mm layer.
**Walls stop at `TH_MAX` 6 mm** (walls and wedges), half the 12 mm row spacing
(`maxUnsupportedSpan`): a 2.5 nozzle's two-line wall, or 2.0 at four lines (10 mm, feet
12 mm wide on a 12 mm pitch), fused a row into one block (6.7 kg of supports on a plate
that takes 252 g at 0.4). The page offers only the Wall lines that fit the nozzle.
**The tine reach grows past a wider tip** (`PROP.tineReachTip`, nozzle.js): the reach is
measured from the wall's centre, and a tip wider than 0.4's 0.6 swallowed the 0.5 reach --
on a curved underside the tines all but vanished (sphere at 45°: 30 at 0.4, 6 at 2.0).
The extra half-tip, `max(0, (tip − 0.6) / 2)`, is added to the reach: 0.15 at 0.6, 0.3 at
0.8, 1.2 at 2.0 (sphere: 26). 0.4 and finer add nothing.
**A free edge's outermost row steps in by the same amount** (`PROP.edgeInset`, 0.6 +
that extra half-tip): at a fixed 0.6 a 2.0 nozzle's 3 mm tip and 2.5 mm tines hung 1.2 mm
past the part's edge -- tabs out of the wall's side (cube at X30). The tip's face stays
0.3 mm inside the edge at every nozzle; the wider wall body below it may reach past.
The plugins build at 0.4 for now. The comb's scan step follows the tine
width, so a 0.2 comb can land a tine or two fewer. The nozzle is a printer setting:
remembered across visits, left alone by a loaded session.

**Tine reach follows the layer height** (2026-10-14): `tineReach × max(1, layer / 0.2)`, at
most 3× (0.6's).
The reach probe sits at the tine's mid-height, half a layer under the underside, so
under a shallow underside it only finds solid when `reach · tan θ > layer / 2`. At a
fixed 0.5 that cut off ~17° at 0.3 mm layers, ~22° at 0.4 and ~31° at 0.6, and every
wall under a flatter underside built with no tines (the M4 front upright: 223 tines at
0.2, 117 at 0.4, 53 at 0.6; buster upright: none at 0.4). Keeping the 0.2 layer's
reach-to-layer ratio brings thick layers back to the 0.2 count (228 / 220; buster 15 /
10). 0.2 and thinner are unchanged. The ends still kiss the surface; a thick layer's
tine top, snapped to the layer line, can sit up to half a layer above the underside,
above the mid-layer a slicer samples.
A wedge's tines follow the layer too: they were always 0.2 tall with the 0.2 reach, a
third of a 0.6 layer, which the slicer drops or merges (portal X45 at 0.6: 41 tines, all
0.2 tall; now 42, 0.6 tall).

### Wall lines

The Walls section's **Wall lines** (2 / 4 / 6 / 8, default 2) thickens the structure
for a tall part or a big printer, after Per Hjort's nozzle profiles (#210). With
`m = lines / 2`:

| width | rule | 0.4, 4 lines | 0.4, 8 lines |
|---|---|---|---|
| wall (`PROP.th`) | × max(1, k) × m | 2.0 | 4.0 |
| wedge (`PERP.th`) | × max(1, k) × m | 2.4 | 4.8 |
| brace rib (`SWAY.thMin`, `thMax`) | at least the wall | 2.0–2.4 | 4.0 |
| feet (`footMin`, `footMax`, `squatBrimW`) | + the wall's extra half-width | 2.1, 3.5, 3.0 | 3.1, 4.5, 4.0 |
| neck into the tip (`PROP.tipH`) | max(1.5, neck run × tan 55°) | 1.5 | 2.43 |
| tip, tines | unchanged: one line | 0.6, 0.5 | 0.6, 0.5 |

The feet are half-widths from the wall's centre, so they move out with its face.
The neck rule only lifts a taper that would lean flatter than 55° (`PROP.neckDeg`). A wall
lower than that taper narrows its body instead (`stemHalf` in `web/prop/sweep.js`, local
issue 044), so its shoulder never leans flatter either; a step under half a line (`tip / 3`)
prints at any angle and is left alone. 2 lines is the tuned wall, unchanged. A thicker wall fits fewer places: on a tight part some
overhangs lose their wall, and the readout reports them. It is a setting of the part
(undoable, saved with a session), not the printer. The plugins build 2 lines.

## Optional rounded bed feet

`tunables.roundFeet: true` rounds ordinary, squat and wedge feet; Auto Sway
inherits it, and direct Sway callers may pass `roundFeet: true`. Browser default
is off. Omitted/false/null tunables restore legacy feet on reused engine instances,
without resetting material clearances. Undo/redo and saved 3MF sessions retain the
browser setting. Feet standing on the part itself are unchanged. Vertical/resin pin
mode ignores the setting, preserving its windowed/undercut feet and overlap fixes.

Eight-step corner arcs are inscribed in the existing clearance envelope. Normal
and squat flanges round only their outside ends. Internal segment caps are inset
up to 0.005 mm and connecting solids overlap up to 0.01 mm below the lower roof;
the joints do not expand the checked contour. Wedge and Sway feet use the same
inscribed polygon rounding. Contact crests and tines retain their geometry and
interface tags; the added foot triangles remain owned by their support record.

Rounding reduces first-layer corner area. Geometry checks are not print validation
of adhesion or metre-high stability. Compare the first layers in the slicer and
print-test before adopting it for tall parts. Legacy geometry goldens stay unchanged.
