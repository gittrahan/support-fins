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
- **Tines kiss the part's surface** (2026-10-02). A tine is placed only where its
  `tineReach` (0.5) reach lands in the part, but it's built only up to the surface: its
  end follows the part, measured at each side edge at the tine's bottom and top
  (`kissEnds`), so on a slope the end leans with the underside and nothing of the tine
  sits inside the part (+0.01 mm, so the two overlap rather than sit flush). Top and
  bottom stay flat and one layer apart, so it's still one bead. A slicer unions part
  and supports in one object, so the buried stretch never printed: bite coupon, main
  vs kiss, sectioned at every mid-layer: 0 mm2 lost, 0.02 mm2 gained (spots where the
  0.5 box stopped short of the face). What welds is the part's next layer printing
  onto the tine (local issue 027).
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
  applies to the part. Walls too short for a 3 mm hole stay solid. The
  tined side fins (the Onshape port's; the web tool no longer builds them) are never
  cut -- their tines anchor across the whole blade.

- **Interface material (optional, off by default).** GitHub #21: a toolchanger can
  print the part-facing band of every support in a second material that won't bond to
  the part (PETG under PLA). With `PROP.iface` on (`web/prop/crest.js`), each wall --
  prop, part-attached, squat, Draw/fill, wedge blade -- is split `PROP.ifaceH` = 0.6 mm
  (three 0.2 mm layers, inside the 1.5 mm tip taper) below its top: the body below, the
  crest above, the crest reaching 0.01 mm down into the body so the two overlap. The
  tines and their wall steps are interface too. The 3MF export writes the interface as a
  third object, `<name> interface`, in register with the part and supports. The gap
  stays the material's: whether PETG lets it close is a coupon question. Sway braces are
  not split yet (their contact is a vertical edge the full height of the rib).

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
≥ 0.107 mm at its rounded end corners. The mesh is 0.1 mm only across the band where the
part comes within the pad's height (1.2 mm elsewhere).

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
| clash | ≥ 1 mm of air from another brace (compared at matching heights) and from any prop wall or wedge (compared at the bed, where both are widest) | two supports fused into one piece no longer break away in pieces |
| auto placement | up to 4 faces with bearings ≥ 60° apart, a rib per ~100 mm of face width, at the face's **tallest** columns | holds both axes; a rib at a gable's low end braces the half that wasn't moving |
| manual | Draw mode: one click on an upright side; click a placed support to select it, Delete / "Remove selected" to take it out | |

## Wall ribs (Full coverage) — `web/prop/brace.js`

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

## Naming

Slant3D says "grip fins" once. Unrelated to the *grip fin* used elsewhere in Matthew's
CAD work (a tolerance-absorbing feature for mating holes). Don't collide the terms.
