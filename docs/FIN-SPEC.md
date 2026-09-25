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

## Bed pad styles — `PAD.style` in `web/fins.js`

The pad goes under a part whose bed contact is under `padMinArea` (60 mm²), which is
nearly every tilted part. **Printed, 2026-09-24:** a cube on its edge in **PETG** with
one wedge and the Light pad held for the whole print, and the pad came off clean.

| style | thickness | meets the part | why |
|---|---|---|---|
| **Light** (default) | **one layer** (the Layer height field) | **0.12 mm** sideways gap off the part's first-layer outline (its section at the first layer's mid-height) | a slicer brim: only the first layer grips the plate, so more layers add stiffness and weld height, never adhesion; the gap keeps pad and part as two regions, so perimeters run beside the part instead of solid infill through it |
| **Sure hold** | `padH` 0.5 mm (PETG 0.3) | tacked `grab` 0.05 mm into the underside (PETG −0.1) | the original pad; slices as one merged region with the part on its first layers -- holds hardest, hard to remove |
| **Custom** | Pad thickness | Pad gap (sideways) + Pad grip (vertical) | the Light mesh on the user's numbers; the only style that shows them |

All three spread `padMargin` (4 mm) past the contact; Custom exposes that as Pad spread.
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

## Naming

Slant3D says "grip fins" once. Unrelated to the *grip fin* used elsewhere in Matthew's
CAD work (a tolerance-absorbing feature for mating holes). Don't collide the terms.
