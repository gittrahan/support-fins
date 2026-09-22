# Fusion add-in for support fins: handoff

A starting brief for a new project: an **Autodesk Fusion add-in that inserts sway braces**
(and later, overhang support fins) into a design, so the supports live in the model
instead of being added in the slicer. Written 2026-09-22 at the end of the session that
built sway braces for the Support Fins website. Everything a fresh session needs is here
or linked from here.

---

## 1. Goal and scope

**Phase 1 — sway braces (this project's first deliverable).**
A command, *Insert Sway Brace*, where the user picks the print bed and then clicks upright
faces of a body; the add-in builds a tapered buttress rib against each face, tied to it
with one-layer tines. An *Auto* option braces the tallest sides without clicking.

**Phase 2 — overhang fins (later).** Reuse the website's existing JavaScript engine
(`web/prop.js`, `web/fins.js`, ~3,600 lines) inside a Fusion HTML palette, have it return
contact lines / placements, and build solids from those in Python. Don't port that engine
to Python.

**Out of scope:** slicer plugins (the repo's PrusaSlicer/Orca plugins are exploratory and
not working), and anything that changes the user's own geometry.

## 2. Where the design already lives

- Repo: <https://github.com/MitchMilam/support-fins> (Mitch's fork; the original is
  Matthew's project). Local clone: `C:\Users\mitch\source\repos\support-fins`.
- Branch **`sway-braces`**, pushed, **no PR yet** (waiting on a physical print):
  - `6cb3e85` sway: add optional sway braces for tall parts
  - `66ca477` readme: describe sway braces for tall parts
- Files to port:
  - `web/sway.js` — the whole brace algorithm, ~500 lines, pure geometry, no DOM. **This is
    the reference implementation.** Where this document and the code disagree, the code wins.
  - `docs/FIN-SPEC.md`, section "Sway braces (tall parts)" — the numbers and the reasoning.
  - `tests/sway.test.js` — 10 tests; port them as the Python test suite (section 6).
- Background worth reading: `docs/FIN-SPEC.md` top to bottom (why tines are horizontal and
  one layer tall, the 0.2 mm gap, what was tried and rejected), and the README section
  "Sway braces for tall parts".

## 3. The brace spec

### What a sway brace is

A tall, slender part drifts, sags or wobbles as it prints: the nozzle drags the top and each
layer shrinks as it cools. A sway brace is:

1. **Rib** — a vertical plate standing **edge-on** (perpendicular) to an upright face, its
   stiff direction. Inner edge sits at the **gap** off the face; it is **deep at the bed and
   tapers** to a flat top. A plate lying flat against the face (the old "Brace" fin) bends the
   easy way exactly when the part leans into it — don't build that.
2. **Foot** — a thin flange on the bed under the rib.
3. **Tines** — horizontal bridges from the rib's inner edge into the part, **exactly one
   layer tall**, **evenly spaced all the way up**. They are the only thing that touches the part.

### Numbers (mm unless noted; from `SWAY` in `web/sway.js`)

| name | value | meaning |
|---|---|---|
| `maxLeanDeg` | 30° | faces leaning more than this from vertical are not "upright" |
| `minFaceH` | 30 | auto: face must be at least this tall… |
| `minTopFrac` | 0.4 | …and reach at least 40% of the part's height |
| `minPartH` | 30 | auto: shorter parts get no braces (say so) |
| `thMin` / `thPerMm` / `thMax` | 1.2 / 0.004 / 2.4 | rib thickness = min(2.4, 1.2 + 0.004·H) |
| `reach` | 0.15 | **default** depth at the bed = 15% of rib height (user setting "Brace depth") |
| `topDepth` | 4 | depth at the top (flat edge, never a point) |
| `minDepth` / `maxDepth` | 8 / 60 | clamp on the bed depth |
| `topClear` | 1.0 | rib stops this far below the top of the face column |
| `minRibH` | 20 | shorter ribs are refused |
| `footH` / `footHalf` / `footPad` | 0.6 / 3 / 3 | foot thickness; flange past each side; past the outer end |
| `gap` | 0.2 | inner edge standoff (PLA; PETG uses 0.3) |
| `bite` | 0.3 | how far a tine sinks into the part (PLA; PETG uses 0.15) |
| `tineW` | 0.5 | tine width across the rib (one nozzle bead) |
| `tineOverlap` | 0.3 | tine sinks this far back into the rib so they merge |
| `tineSpanMax` | 1.5 | skip a tine that would cross more open air than this |
| `tineSpacing` | 6 | **default** vertical spacing (user setting) |
| `minTines` / `minGripShare` | 3 / 0.3 | refuse a rib with < 3 tines or tines on < 30% of its rows |
| `pitch` / `maxPerFace` | 100 / 4 | auto: one rib per ~100 mm of face width, max 4 per face |
| `endInset` | 10 | auto: keep candidate columns this far from a face's ends |
| `maxFaces` / `minBearingSep` | 4 / 60° | auto: up to 4 faces whose normals differ by ≥ 60° |
| `nudges` | 0, ±3, ±6, ±10 | auto: try shifting a column by these if it can't build or clashes |
| `clearance` | 1.0 | minimum air between two braces |
| `levelStep` | 10 | clash check compares braces every 10 mm of height |

User settings (with the website's defaults): **Brace grip from** 0 mm (height tines start),
**Brace tine spacing** 6, **Brace depth** 15%, plus the shared **Layer height** 0.2 and
**Support gap** 0.2. Tines on/off follows the global Tines toggle.

### Algorithm for one rib (`buildSwayRib`)

Frame: `n` = the face normal's horizontal part (unit), `u` = horizontal along the face,
z = up from the bed. `s` = horizontal distance out of the face along `n`.

1. **Face column.** At the clicked/chosen `u`, find the z-range `[fz0, fz1]` where the face
   exists (the website samples every 1 mm). Rib height `H = fz1 − topClear`; refuse if
   `H < minRibH`.
2. **Inner edge.** Seat it on the outermost point of the face within the rib's slab
   (`u ± (th/2 + tineW)`), plus `gap`. On a planar Fusion face this is just the face plane
   + gap. For a leaning face the inner edge follows the plane, so it slants.
3. **Outline** in (s, z): inner edge from z = 0 to H; outer edge = inner + depth(z), with
   depth going linearly from `D0 = clamp(reach·H, 8, 60)` at z = 0 to 4 at z = H.
4. **Obstruction.** If any part geometry crosses the rib's volume, set `H = (lowest hit z) − 1`
   and recompute (up to 6 times). Still hit → refuse ("the part sticks out over that spot").
5. **Foot.** Rectangle from the inner edge at z = 0 to `D0 + footPad` out, `th/2 + footHalf`
   each side, `footH` tall. If the part is in its way → refuse ("the part's base spreads out
   under this face").
6. **Tines** (if on): for z from `max(fz0 + 0.5, gripFrom, footH + 0.5)` to `min(fz1, H) − 0.5`,
   step `tineSpacing`:
   - **Snap to the layer grid:** `bottom = round(z / layerH) · layerH`, `top = bottom + layerH`.
     Stop if `top > H`.
   - At mid-layer, find where the face actually is; skip if the gap to cross exceeds
     `tineSpanMax`, or if a point `bite/2` inside the face isn't inside the part.
   - Box from `bite` inside the face to `tineOverlap` inside the rib, `tineW` wide, one layer tall.
   - Afterwards require `tines ≥ max(minTines, floor(minGripShare · rows))`, else refuse.
7. Record for the clash check: the foot segment (inner→outer at z = 0) with its half-width,
   and the rib's inner→outer segment every `levelStep` up to H.

Every refusal returns a short human reason. **Never fail silently.**

### Auto placement (`buildSwayBraces`)

1. Candidate faces: upright (≤ 30° lean), ≥ 30 mm tall, top ≥ 40% of part height.
   Score = height × width, best first.
2. Pick greedily up to 4 faces whose bearings are ≥ 60° apart (so opposite *and* adjacent
   sides can both be chosen).
3. Per face: `n = clamp(round(width / 100), 1, 4)` ribs. Sample columns across the face
   (insetting 10 mm from the ends, about every 5 mm, max 24 samples) and choose the **tallest**
   columns, at least `max(50, width/(n+1))` apart, ties going to the ends. (Evenly spaced
   columns put the fence cap's braces 160 mm up a 249 mm gable; tallest-first reaches 234.)
4. Build each with the nudges; skip any that fails or clashes, and count the skips for the readout.

### Clash check (`swayClashes`)

Two braces clash if their **foot segments** are closer than `halfW1 + halfW2 + 1`, or if at
any shared height (every 10 mm up to the shorter one's top) their **rib segments** are closer
than `(th1 + th2)/2 + 1`. Braces on facing walls of a narrow channel reach toward each other
and would merge into a bar that doesn't break away — that's what this catches. Manual
placement tries shifts of 0, ±2, ±4 mm; if it still clashes, refuse with "it would run into
another brace — click a spot staggered from it".

### Rules not to break (from `docs/FIN-SPEC.md`)

- Supports never lean; they carry load straight down to the bed.
- Tines are horizontal and exactly one slicer layer tall (so they print as one bead and snap
  off cleanly). Layer height must match the slicer's.
- The rib never touches the part; only tines do.
- Don't modify the user's geometry (the project decided against the 2 mm bottom chamfer for
  this reason).
- Supports near edges/corners hide tine marks better than mid-face.

## 4. Fusion decisions and gotchas

- **Python add-in** (Fusion's standard). Keep the brace maths in a **pure-Python module with
  no `adsk` imports**, so it can be unit-tested with plain Python/pytest outside Fusion. The
  `adsk` layer only picks faces, reads geometry and creates bodies.
- **Units: the Fusion API works in centimetres internally.** Convert at the boundary; keep
  the maths module in millimetres to match the spec.
- **Print orientation:** Fusion's up axis isn't always Z. Have the user pick the bed (a planar
  face of the part or a construction plane) and derive the up direction from it. Don't assume.
- **Face picking:** a `SelectionCommandInput` filtered to planar faces. Faces are exact, so no
  mesh-patch detection is needed for phase 1 (curved faces can come later).
- **Build fast:** create all rib/foot/tine solids with `TemporaryBRepManager` and add them in
  one go (inside a `BaseFeature` edit in parametric designs; directly in direct-modeling
  designs). ~100 tines as individual timeline features would be very slow.
  Tines and feet are boxes (`createBox` with an `OrientedBoundingBox3D`). The tapered rib isn't
  a box — e.g. a box trimmed by a boolean difference with a rotated box, or build it from a
  planar-wire face; **verify against the current API**.
- **Obstruction and containment:** easier than on the website — intersect the candidate rib
  with the part body (a boolean on temporary copies) to find the lowest hit; use
  `pointContainment` for the "is the tine's tip inside the part" check.
- **Keep supports separate:** put them in a "Supports" component so the user's bodies are
  untouched and the supports can be hidden or deleted. Tines *overlap* the part by `bite`; on
  the website the slicer merges the overlap. **Confirm the slicer does the same** with separate
  bodies from a Fusion STL/3MF export (see open items).
- Settings to remember between sessions: Fusion attributes or a small JSON file next to the
  add-in.

## 5. Reference model and expected results

**Model:** `Fence Cap-45 Degree Vertical-Rev 3.stl` (in the support-fins repo's `Samples/`
folder locally; `*.stl` is gitignored, so it isn't on GitHub). 171.4 × 98.4 × 249.2 mm,
1,792 triangles, volume ~178,826 mm³ (~222 g PLA). It's a thin-walled channel: two tall
pentagon-shaped side walls (~3.2 mm thick, ~92 mm apart inside) joined by a 45° sloped roof
and an angled arm. Printed standing up, as loaded (no rotation).

**Website results to match (PLA, 0.2 mm layers, gap 0.2, defaults):**

| case | result |
|---|---|
| Auto | **4 braces, 102 tines, ~20 g** (1 column skipped) |
| Mitch's hand-placed set (printing now) | **3 braces** in a row on the inside face of one side wall, following the gable: heights **169, 194, 219 mm**; bed depths 25, 29, 33 mm; 28 + 33 + 37 = **98 tines**; **25 g** |
| Under the roof, inside the channel | braces capped at **103 mm** by the roof above |
| Braces directly across the 92 mm channel | allowed (≈35 + 24 mm deep leaves plenty of air) |
| A brace 1.5 mm beside another on the same wall | refused (clash) |

The exported file for the print is `Downloads\Fence Cap-45 Degree Vertical-Rev 3-sway.stl`
(3,040 triangles: the part plus the 3 braces).

## 6. Tests to port (`tests/sway.test.js`)

On a 40 × 30 × 150 mm block (and a two-wall channel):
1. A tall post gets ≥ 2 braces, and the result is watertight.
2. With tines off, **no rib vertex is inside the part**. (Website note: exactly at z = 0 the
   point-in-part test gave false positives on the bed plane; the test lifts points by 0.001 mm.)
3. Every tine is one layer tall, on the layer grid, and bites into the part.
4. Tines reach > 90% of the height, with even gaps of the requested spacing (± one layer).
5. "Grip from" 80 mm → no tine below 80.
6. A 20 mm block gets no braces and a reason.
7. Manual: works on a side face, refuses the top face, returns a watertight brace over 100 mm tall.
8. Braces are off by default.
9. Channel (two 80 × 10 × 150 walls, 40 mm apart): a brace directly across from another is
   refused; one staggered 20 mm along is allowed.
10. Auto on the channel places ≥ 2 braces without clashes.

## 7. Open items

- **Physical print pending** (started the night of 2026-09-21, 8–9 h). Record: does the top
  still move or show layer lines; how easily do braces snap off; what marks do tines leave;
  does any brace wobble or lift. **Defaults (depth, thickness, spacing) may change** — port
  after, or keep them as named constants that are easy to update.
- Whether separate tine bodies merge with the part in Mitch's slicer.
- Distribution: install by hand in the add-ins folder first; the Autodesk App Store later
  (it has a review process).
- support-fins PR for Matthew: open once the print confirms. (Issue already left for him.)
- Known website bug, unrelated to Fusion but worth knowing: material (PLA/PETG) and gap settings
  don't reach the website's background build worker in Auto mode. `sway.js` works around it
  by taking gap/bite as options.

## 8. Machine notes (Mitch's Windows PC)

- Python: `C:\Python312\python.exe`. The bare `python3` command opens the Microsoft Store.
  `numpy`/`trimesh` are not installed.
- Node is installed; **Deno is not** (the website's tests are Deno tests; they were run under
  Node with a small shim).
- Git Bash and PowerShell are both available.
- An **Autodesk Fusion connection (MCP)** is available in Claude sessions — useful for a quick
  prototype (pick a face on the fence cap, build one brace) before writing the full add-in.
- Website dev server: `C:\Python312\python.exe dev-server.py` in the support-fins repo →
  http://localhost:8731. Downloads from the in-app browser pane arrive as unnamed `.tmp` files;
  use a normal browser for exports.

## 9. Suggested first steps

1. Wait for the print result; update the defaults in section 3 if needed.
2. Prototype through the Fusion connection: fence cap, pick the bed and one inner wall, build
   one brace as temporary bodies, and check it against the 169/194/219 mm reference.
3. Scaffold the add-in: pure-Python `sway` module + tests (section 6), then the command
   dialog, then Auto.
4. Export STL/3MF from Fusion and slice to confirm the tines merge.
