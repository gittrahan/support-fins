# Roadmap

The loop the tool exists to serve:

> **load an STL → rotate it into a stronger orientation → see what that broke →
> add fins that fix it → export an STL that prints support-free anywhere.**

Everything below is judged against that sentence. If a feature doesn't move a user
through it, it waits.

---

## Constraints that shape every decision

| constraint | consequence |
|---|---|
| Fully client-side, nothing uploaded | no server, no account, no queue. Also the privacy pitch and a video beat. |
| Static host (Cloudflare Pages) | the whole app is files in `web/`. Deploy = push. |
| **No build step** | `node` is not installed on this machine and we don't need it. Vendor `three.js` as an ES module, `<script type="module">`, develop with `python3 -m http.server`. Revisit only if we outgrow it. |
| No boolean kernel | proven in the spike: fins are separate closed solids appended to the mesh, unioned by the slicer. No WASM CAD, no `manifold3d` in the browser. |
| Auto-placement must carry the product | **Owner's call, 2026-07-26: auto first, Draw after.** The old "auto tops out at ~65%, so manual is core" was measured against a support that needed a flat face to grip. A bed-attached vertical wall needs only a reachable underside, so the ceiling has to be re-measured before it is treated as a limit. Deriving the contact curve and its span — the two things `breakaway.py` took as arguments — is now the product, not a step toward Draw. |

## Libraries (all MIT, all vendored)

- **three.js** — scene, `STLLoader`, `STLExporter`, `OrbitControls`, `TransformControls`.
  Not a packaged "STL viewer widget": we need scene access to shade overhangs and
  preview fins.
- **three-mesh-bvh** — fast raycasting. Fin placement is raycast-bound (the probes fire
  thousands of rays per part); the naive raycaster will not keep up on a 70k-face STL.

That is the entire dependency list. If a third library shows up, question it.

---

## Feature set

### Load
- Drag-and-drop / file picker, binary + ASCII STL.
- Stats bar: filename, triangle count, bbox in mm, watertight yes/no.
- **Sample model button** — try it with no file. Gates nothing, but it's the difference
  between a bounce and a first export, and it's what the video demos.

### View
- Build plate with grid, part resting on it, orbit / pan / zoom.
- Printer volume box with presets (default P1: 250×220×270; P2 256³; P3 300×300×330).
- **Overhang shading** — faces steeper than the threshold painted red, live. This is the
  diagnosis view and it's ~10 lines. It is also the single most screenshot-able thing
  in the app.

### Orient
- User rotates. Primary, always. Arbitrary rotate + snap increments + "lay this face
  on the plate" by clicking a face.
- Live readout while rotating: overhang count, how many are finnable, part height,
  bed contact area.
- **2–3 ranked auto-suggestions with their tradeoffs — suggested, never applied.**
  The spike proved why: the strength-optimal pose for one hub was 155 mm tall balanced
  on a 100 mm needle. Geometrically valid, terrible print.

### Strength (optional overlay)
- Place a load arrow on the part + answer one toggle: **does it pull apart, or does it
  lever?**
- Score updates with orientation.
- This toggle is not a nicety — pull-mode and bend-mode picked *different* best
  orientations on 4 of 4 parts tested. It's also the video's best educational beat.

### Supports

> **PLAN REVISION, 2026-07-26.** Everything in this section was rewritten after the
> owner looked at real output. The short version: the project took its primary
> geometry from Slant3D's fin, which solves **toppling**, and treated
> `breakaway.py`'s wall, which solves **overhangs**, as a secondary experimental
> mode. That is backwards for every part in the test set. See
> "Why the plan changed" below for the measurements.

**There is ONE support primitive: a vertical breakaway wall.** It rises from the
plate and stops `gap` below the part, so the part bridges that last layer and the
wall snaps off. Everything else is a parameter of it or an optional addition.

| property | rule | why |
|---|---|---|
| **orientation** | **always perpendicular to the plate.** Never leans. | A support carries load to the plate in compression. A 1.2mm wall leaning 40° is itself an unsupported overhang and buckles sideways. `breakaway.py` builds strictly vertical walls — its `profile()` varies the horizontal offset and the height independently — and the lean was added by this port, only so a flat wall could stay parallel to the flat face it grips. |
| **top edge** | **contoured** to the surface above it, sampled densely, including the tip's own WIDTH | The wall follows the part; the part does not have to be flat. This is what removes the need to lean. The tip is a `tip`-wide flat, so on a sloped underside its up-slope corner is what sets the real gap — evaluate the surface at **both tip corners**, not the centreline. |
| **length** | as long as the contact curve it serves, trimmed to where it is clear | No cap. `maxLen: 25` with the comment *"a fin is a short brace at a corner"* is the single line most responsible for useless output. |
| **footprint** | flared foot + chamfer shoulder, scaled to wall height | Unchanged; already right. |
| **attachment** | bed only | One clean thing to remove, not two welds to cut. |

**Tines are an OPTIONAL anti-tip addition, not part of the support.** Slant3D's
fin solves a specific problem — a part balanced on an edge that would rotate and
fall — and the tines are what resist that torque. They do not hold up an overhang,
and they are why the primary mode was small, low, and cornered. They stay
available (`docs/FIN-SPEC.md` still governs their geometry) as a **Brace** option
for the toppling case. They are no longer the default and no longer required.

**The placement question is not "which region deserves a support".** It is
**"is any part of this overhang further than `maxUnsupportedSpan` from a support?"**
That is a measurable physical criterion, it is how a slicer thinks, and it
replaces the per-region judgment that produced both failure modes on record —
13 walls on a part that wanted 2, and one 4.5mm brace on a part with 3,403 mm² of
overhang 75mm in the air.

#### Why the plan changed (2026-07-26)

Four findings, all from the shipped code and its own records.

**1. The output is an order of magnitude too small.** `voron_drive_frame` at 40°
is 53 × 92 × 78 mm, with **3,403 mm² of overhang running from the plate up to
74.7 mm**, over an 89 mm-long underside. The tool builds **one fin, 16.5 mm tall ×
4.5 mm long, on a 7.4 mm stilt** — chosen from an available face measuring 60 mm
tall × 70 mm long. The owner's sketch of what it should look like is a wall
spanning that underside, which is exactly `breakaway_wall` and nothing like a fin.

**2. The smallness is a stated premise, not a bug.** `FIN.maxLen = 25`, commented
*"a fin is a short brace at a corner, not a full-length wall"*. It traces to M3,
where naive placement gave 13 walls 12–103 mm tall and the roadmap judged they
*"would waste more plastic than the slicer supports they replace"* — **a claim
that was never measured**, about a 1.2 mm wall, which is the thinnest support
there is and the product's central claim. The correction to "too many, too big"
should have been *fewer*, not *smaller*.

**3. Leaning is common and structurally wrong.** Of the 16 fins the tool builds
across the test matrix, **7 lean 25–40°**. `voron_filter_housing` at 40° is a
35.8 mm wall leaning **40°**; at 60° it is a **147.5 mm** wall leaning 30° on a
12.6 mm stilt. The roadmap defended this as *"a thin wall leaning up to 45° is a
self-supporting overhang"* — true of printing a wall in isolation, false of a
support, which has to transfer load down rather than merely exist.

**4. It was already written down, filed under the wrong heading.** M4's own status
section, above, records: *"Stabilize does not serve overhangs and says so. The hub
at 40 degrees leaves 8 regions unsupported, and PrusaSlicer independently flags
'Collapsing overhang, Long bridging extrusions, Floating object part, Low bed
adhesion' on that export … a 46 mm fin on a 123 mm part balanced on an edge is
unlikely to be enough in practice."* A slicer said the primary mode does not hold
the part up, in writing, and it was logged as an **honest limitation** rather than
read as *the primary mode is the wrong support*. Being candid about a shortfall is
not the same as noticing that it invalidates the design.

**And the underlying cause of the failures found the day before:** the port
automated the one thing the human was doing. `breakaway_wall(bm, contact, t0, t1, …)`
takes **the curve and the span as arguments** — *"pick t0 so contact(t0) has
already cleared any solid the wall must NOT weld to"*. Deriving those two things
from connected overhang regions is where the bowl-vs-ledge failure, the merged
regions, the missing trim and the burial discards all live. The geometry was never
the weak part. **Auto-placement stays first (owner's call), so deriving `contact`
and `t0/t1` reliably IS the work — it is not a step on the way to something else.**

#### Measured 2026-07-28 — the revision is right, and the blockers are four small ones

The 2026-07-26 revision above was written from the shipped code's own records.
It has now been re-run and instrumented (`prototype/probe_wall.js`,
`prototype/probe_straightness.js`), and the picture is **better than the plan
assumed**: Prop's geometry is not what is failing. Four specific gates are
throwing away walls that are otherwise correct, and each one discards a whole
region over a local problem.

**0. The default mode is still `stabilize`.** `buildFins` reads
`opts.mode ?? 'stabilize'`, so every leaning fin on record is what a user
actually sees; the vertical wall is behind an experimental selector. Re-run of
the full matrix: **7 of the 12 fins built lean 25–40°** (`hub_corner`@0 39°,
`filter_housing`@25 25° / @40 40° / @60 30°, `drive_frame`@60 30°,
`hub_corner`@60 28°, `hub_post_foot`@60 27°). Flipping the default is the single
change that most directly answers "the fin is not perpendicular to the bed."

**1. `sweep()` is all-or-nothing, and that alone loses the flagship part.**
`if (h < PROP.minHeight) return false` aborts the entire wall if *any* station is
short. On `voron_drive_frame` at 25° and 40° the contact line is otherwise
perfect — tortuosity 1.29/1.44, span 92–100 mm, **zero blocked stations** — but
its first one or two stations sit where the underside meets the plate (h = −0.2
mm), so the whole thing is discarded as `degenerate`. This is `breakaway.py`'s
`t0/t1` trim, never automated. Keeping the longest contiguous usable run instead:

| case | before | after trim |
|---|---|---|
| `drive_frame` @25 | nothing (`degenerate`) | **44.1 mm tall × 96.1 mm span** over 3,276 mm² |
| `drive_frame` @40 | nothing (`degenerate`) | **66.6 mm tall × 78.4 mm span** over 3,240 mm² |

That is the owner's sketch, rendered and looked at: a vertical wall from the
plate, top edge contoured to the tilted underside, running nearly the length of
the part. Compare the fin it replaces — 16.5 × 4.5 mm on a 7.4 mm stilt.

**2. Every `buried` rejection is the tip-corner bug, and it is fatal rather than
cosmetic.** The 2026-07-26 entry filed "sub-spec gaps" as a precision problem to
fix later. It is not: the buried vertices sit at the wall's **top**, not its foot
(`filter_housing`@0: 10 verts at z = 40.68 on a wall topping at 40.7; foot-height
verts implicated: **0 of 5, 0 of 10, 0 of 23, 0 of 29**). The top is a `tip`-wide
flat set at the *centreline*, so its up-slope corner rises by `half_tip × slope`.
Any underside steeper than `atan(gap / half_tip)` = **33.7°** drives that corner
inside the part, `insidePart` sees it, and the entire wall is thrown away. Most
overhang surfaces are steeper than 33.7°. Evaluating the surface at both tip
corners and taking the lowest removes the whole `buried` bucket on
`drive_frame`@25/40 and `hub_corner`@40.

**3. `tortuosity` measures the sampling, not the shape — so it is not a
precondition, it is a coin flip.** Same region, same geometry,
`voron_drive_frame`@40 R0, varying only the station count:

| stations | 8 | 14 | 24 | 48 | 96 |
|---|---|---|---|---|---|
| `tortuosity` | 1.14 | 1.44 | 1.59 | **2.08** | **3.16** |
| RMS deviation / chord | 0.081 | 0.069 | 0.062 | 0.065 | 0.065 |

Arc length grows without bound as you sample a curve more finely; the chord does
not. The `maxTortuosity: 2.0` gate therefore flips on a good region purely
because someone densified the sampling. **Replace it with RMS deviation from the
fitted axis over chord**, which is scale- and density-independent. It separates
the same cases the gate was built for: `drive_frame`'s servable region sits at
0.065, `hub_post_foot`'s bowl at 0.15–0.21.

**4. `samples: 14` is scale-blind, exactly as `foot: 7.0` was.** Fourteen
stations across a 96 mm span is one every 7 mm, and a curved underside moves
more than the 0.2 mm gap within that. Station spacing must be a **length**.
**Order matters here and it was tested:** densifying to one station per 2 mm
*before* fixing #3 regressed `drive_frame` from one good wall back to zero, by
pushing tortuosity past the gate. #3 lands first.

**What the four fixes together do not fix — and that is M6b.** With all of them,
walls appear in 9 of 16 cases, but coverage of the overhang area is only 9–46%
on the parts that matter (`drive_frame`@40: one wall, 46%). The reason is
structural: **a connected overhang "region" is a topological artifact, not a
support unit.** Union-find over adjacent overhang faces merges the entire tilted
underside of `drive_frame` into one 3,240 mm² region whose contact line is 6.4 mm
RMS off any straight axis. One wall per region can never cover it. M6b's job is
to stop asking "one wall per region" and start asking "walls spaced at
`maxUnsupportedSpan` under a height field."

- Per-fin params with spec defaults (`docs/FIN-SPEC.md`): standoff 0.2, tine 0.3 tall ×
  0.4–0.8 wide, 7–8 tines low spreading with height, 1 mm elliptical base, rounded top.
- **Layer height + nozzle width inputs.** Easy to miss and load-bearing: tine height *is*
  one layer, tine width *is* one or two nozzle passes. The spec numbers are derived from
  these, not constants.

### Part modifications (ask first, always)
- **2 mm bottom chamfer** on the bed-contact edge — a tilted part otherwise starts on a
  single line and peels off.
- **Bed pad** — required, not optional, for tilted parts: nearly every tilted candidate
  has bed contact ≈ 0.
- Both change *the user's part*, not just add a fin. Explicit checkbox, never silent.

### Export
- Binary STL, fins + pad baked in.
- Small report: what was added, the intended print orientation, "no supports needed".
- **Honest-limitations panel** — overhangs sitting over the part rather than the plate,
  features under the wall-height floor, regions with no vertical face, **bowl-shaped
  overhangs with no line to sweep, and parts that touch the plate at a single point**
  (nothing the tool adds can hold one — the answer is to rotate). Naming these
  builds more trust than hiding them, and it's a chapter in the video.

### Footer
- Ko-fi button, GitHub link, MIT, and a "runs entirely in your browser — nothing is
  uploaded" badge.
- **Placement: after a successful export, not above the fold.** Ask at the moment the
  thing has already delivered value.

---

## Milestones

Each one ends at something you can open in a browser and judge.

| # | ships | done when |
|---|---|---|
| ~~**M0**~~ ✅ | `index.html` + vendored three.js. Drag-drop an STL, orbit it, build plate + printer box. | ~~A Voron STL loads and spins at 60fps.~~ **Done** — 35,520-tri Voron frame at 60fps, no console errors. |
| ~~**M1**~~ ✅ | Overhang shading + stats readout. No fins yet. | ~~Red faces match what the Python probe reports on the same file.~~ **Done** — exact match on two models (4,782 faces / 264.6 mm² / 563 raw / 2 regions), threshold slider live at 2–8 ms. |
| ~~**M2**~~ ✅ | Orientation: rotate gizmo, snap-to-face, live readout. | ~~Rotating a part visibly changes the overhang count.~~ **Done** — standing a Voron plate on edge moves it from 265 mm² of overhang / 3110 mm² bed contact to 1310 / 73, re-analysed in 1–6 ms. |
| ~~**M3**~~ ✅ | Fin placement + STL export, end-to-end. *Gap-only geometry — internal milestone, never shipped.* | ~~Exported STL opens in a slicer with the fin present.~~ **Done** — 13 fins on a tilted Voron frame, exported as 14 closed solids (1 part + 13 fins), all watertight, seated at z=0. Validated with trimesh, **not yet opened in a real slicer.** |
| ~~**M4**~~ ⚠️ | **Tines + Stabilize mode.** Fin stands beside the part on a vertical face, horizontal tines fused in, regions clustered per face. Bed pad included. | **Built and verified, then DEMOTED by the plan revision.** The geometry is correct (8/8 built cases clean, sliced, 227 of ~228 fin layers in the toolpaths) but it is the wrong primary support: it braces against toppling, it does not hold up an overhang. Survives as the optional **Brace**. Never test-printed. |
| ~~**M5**~~ ⚠️ | **Prop mode** — a breakaway wall under each overhang. | **Landed experimental at 3/16 and superseded.** Its geometry is the right primitive; its *derivation* of the contact curve is what failed. Rebuilt as M5b. |

### Revised, from here

> **Executing any of these? Read `docs/IMPLEMENTATION-PLAN.md` first.** It is the
> self-contained how-to for M5c / M6b / M7b: exact commands, the baseline
> numbers, the ten invariants that each cost a measured regression, and which
> "built nothing" cases are correct refusals rather than misses.

| # | ships | done when |
|---|---|---|
| ~~**M5a**~~ ✅ | **The checker grows a coverage metric, before any geometry changes.** % of overhang area whose centroid lies within `maxUnsupportedSpan` (XY) of some wall's centreline, reported per case alongside clean/failed/empty. Prototyped in `prototype/probe_wall.js`; lift it into `check_stl.py` so it judges shipped output. | The current matrix is re-scored and the coverage column is in the table. A 4.5 mm brace under 3,403 mm² reads as ~0%, which is the number that was missing. |
| ~~**M5b**~~ ✅ | **The wall primitive, done properly** — the four measured fixes, *in this order*: (1) **straightness gate** — replace `tortuosity` with RMS-deviation/chord, threshold from data (~0.10, between 0.065 and 0.15); (2) **tip-corner contouring** — evaluate the underside across the tip's own width and take the lowest, so `gap` is a floor; (3) **trim, don't discard** — keep the longest contiguous run of usable stations instead of aborting the sweep, the `t0/t1` trim `breakaway.py` asked a human for; (4) **station spacing as a length**, not `samples: 14`. Vertical always, no length cap, foot scales with height. | `voron_drive_frame` at 40° gets a wall spanning its raised underside that matches the owner's sketch (**prototyped: 66.6 mm × 78.4 mm, rendered**), measures 0.20 mm at its closest approach with the gap as a floor — `check_stl.py`'s ±0.05 band, currently failing at 0.003–0.343 — and slices. **This milestone is a picture next to a sketch.** |
| ~~**M5c**~~ ✅ | **Flip the default from `stabilize` to the wall,** and demote the fin to the `brace` option the revision describes. Empty-state copy names the wall's own skip reasons. | **Done 2026-07-29.** `buildFins` defaults to `prop`, the selector lists Prop first and calls the fin **Brace — stop it toppling**, "experimental" is gone. A user who loads a part and exports gets a vertical wall. |
| ~~**M6b**~~ ✅ | **Coverage, not one-wall-per-region.** The connected overhang region is a topological artifact — `drive_frame`'s whole underside is one 3,240 mm² region, 6.4 mm RMS off any axis, and one wall covers 46% of it. Replace region→wall with underside height field → a **set** of walls spaced at `maxUnsupportedSpan`. | **Done 2026-07-28/29** — `splitRegion` + `patchTracks` (rows of parallel walls). Matrix coverage **13% → 61%**, `drive_frame`@40 **86%**, `filter_housing`@60 **94%**, 10/16 clean, **zero** failed walls, and all 6 empties are measured correct refusals (see M6b status below). |
| **M7b** | Judgment + honesty: `maxUnsupportedSpan` as the user-facing dial, plastic cost readout, limitations panel, point-balanced gate (landed), Brace as an option. | A part that needs 2 walls gets 2, a part that needs 9 gets 9, and the panel names what it could not reach. |
| **M8** | Draw mode + strength overlay: load arrow, pull-vs-lever toggle, ranked suggestions. | A part auto refuses can be supported by hand; toggling pull↔lever changes the recommended orientation. |
| **M9** | 2 mm chamfer + permission checkboxes, sample model, Ko-fi, domain. | A stranger can use it without being told anything. |

## M6b + M5c status (2026-07-29) — landed, and the empties are all honest

**The matrix's six empty cases are now all correct refusals, each verified
against the geometry rather than assumed:**

- `hub_post_foot` at **all four tilts** — 0.0 mm² of bed contact from 0° to
  165°; the point-seating gate refuses before building and the UI says to
  rotate. (The plan expected @60 to build a wall; that wall was a 104 mm
  scaffold on a part that cannot stand, and refusing it is the better answer.)
- `voron_drive_frame` @0 — two trivial regions 0.5 mm off the plate.
- `hub_corner` @0 — **investigated 2026-07-29, and it is the bed-only
  limitation, not a miss.** Raycast straight down from its ledge's overhang
  faces: 10 of 18 hit the part's own base tab (z 0.7–2.3) before the plate, so
  a wall would have to stand ON the part; the clear remainder is a
  sub-`minSpan` stub. Its other two regions are socket rings directly over the
  boss below (blocked at every station). The `stationIsClear` probe ladder
  never looks below z≈1.4, so the low tab is invisible to it — but
  `stationCertified` catches it at the foot chamfer, which is why the skip
  says `blocked` and nothing welds.
- **A narrow-foot retry was tried and REVERTED — don't re-derive it.** The
  hypothesis was that only the flared foot collided at `hub_corner`@0 (probes
  failed at o=±3.3, z=1.25, the flare band). Threading a `footCap` through
  `stationIsClear`/`stationCertified`/`sweep` and retrying failed walls at
  `footMin` changed **nothing anywhere in the matrix** — the tab sits under
  the wall's whole footprint, not just under its flare. Complexity that
  rescues zero cases does not ship.

**M5c landed the same day:** `buildFins` defaults to `prop`, `app.js` starts
on `prop`, the selector reads "Prop — hold up each overhang" / "Brace — stop
it toppling" with "experimental" dropped. Stabilize re-verified after the
flip: 11/12 clean, 0 failed, coverage 5% — no regression, and the 5%-vs-61%
gap is the flip's justification, measured.

**The unverified claim is now verified — both halves (2026-07-29).** Same
export, same orientation, PrusaSlicer 2.9.6 defaults; walls baked in vs. bare
part with the slicer's own supports (buildplate-only, matching our bed-only
rule):

| case | walls baked in | slicer supports | plastic | time |
|---|---|---|---|---|
| `drive_frame` @40 | 26.1 cm³ · 2h58m | 48.5 cm³ · 4h17m | **−46%** | **−31%** |
| `filter_housing` @25 | 76.8 cm³ · 6h38m | 125.8 cm³ · 10h03m | **−39%** | **−34%** |
| `hub_corner` @25 | 87.9 cm³ · 6h36m | 108.9 cm³ · 7h37m | **−19%** | **−13%** |

**State the caveat whenever the number is used:** slicer supports cover 100%
of overhangs; the walls covered 86% / 71% / 74% on these cases. Some of the
saving is coverage the walls do not attempt (short spans under
`maxUnsupportedSpan` that bridge fine, plus refusals). That is the design —
support only what needs support — but the honest sentence is "less plastic
partly because it supports less, on purpose."

## M5a + M5b status (2026-07-28) — landed

**M5a is in `check_stl.py`.** `coverage()` reports the percentage of overhang
AREA within `MAX_UNSUPPORTED_SPAN` (12 mm) of a support, per case and summed
across the matrix. A point counts as served only when a support has geometry
near it in XY *and* at roughly its own height — without the height test a
flared foot "serves" every overhang it happens to stand near in plan view.
The first thing it measured is the number this project most needed:

| mode | clean | overhang coverage |
|---|---|---|
| Stabilize (the fin) | 8/12 | **4%** |
| Prop (the wall) | 8/16 | **13%** |

The fin was never a support. It is now measured saying so, rather than argued
about.

`check_props` also stopped conflating two different clearances. The breakaway
gap (wall top to the part above it, must be 0.2) and the flank clearance (wall
sides to anything beside them, must merely never fuse) were one number, which
failed walls whose flanks were correctly standing well clear. They are told
apart by where the nearest part surface is relative to the sample, not by the
wall's parameterisation.

**M5b is in `prop.js`**, all four fixes plus two that the measurements forced:

| | change | why |
|---|---|---|
| 1 | `straightness()` replaces `tortuosity()` | the old gate measured the sampling |
| 2 | `contourTop()` | the tip's up-slope corner was buried past 33.7° of slope |
| 3 | `longestRun()` + trim | one short station discarded a 92 mm wall |
| 4 | `stationStep` (mm) replaces `samples` (count) | scale-blind, like `foot: 7.0` was |
| 5 | `stationIsClear` probes the full height, outboard | both remaining welds were on the flank, above the last probe |
| 6 | `settleTop()` | closes the loop: measure the built edge, lower it onto spec |

**#6 is the one worth not re-deriving.** The generator confirms with sampled
points and the checker measures exact surface-to-surface distance, so no amount
of denser probing makes them agree — that chase is what produced the "0.11–0.19
where 0.2 was intended" family the roadmap carried for two milestones. Measure
the finished top edge, then move it. Two things about it were learned the hard
way: it must **lower only** (raising on region-only evidence welded the wall to
geometry it could not see — the matrix went 6 clean to 0, gaps of 0.002 mm), and
it must be **per station** (one global shift let a single low triangle drop the
whole wall 0.48 mm below the part, too far to land on).

Result: breakaway gaps now measure **0.15–0.22 mm** against a 0.2 spec, every
wall is vertical and seated at z = 0, and the flagship `voron_drive_frame` gets
the wall from the owner's sketch. Rendered and looked at. Stabilize is unchanged
at 8/12, so nothing regressed.

**Still open, and honestly:** coverage is 13%. Six of sixteen cases build
nothing, and the reason is now almost entirely the straightness gate rejecting
regions that are genuinely curved. That is M6b's job — split the region, do not
loosen the gate. `stationStep` is set to 1.0 rather than 2.0 for the same
reason: at 2.0 the matrix scores 8 clean / **2 walls that would weld** / 18%
coverage, at 1.0 it is 8-9 clean / **zero** bad walls / 13%. Coverage is a
milestone away; a fused support is a ruined print.

**The checker has to grow a coverage metric before M5b, not after** — it is M5a
above, and it is prototyped and measured, not merely specified. Nothing in
`check_stl.py` ever asked whether a support *holds anything up* — it asks only
whether the solid is clean, outside the part, and correctly spaced. A 4.5 mm brace
under 3,403 mm² of overhang passes every one of those. The new gate is
**"% of overhang area within `maxUnsupportedSpan` of a support"**, and it would
have caught this on day one. This is the same lesson as yesterday's "empty counted
as clean", one level up: *the scoreboard has to measure the thing you actually want.*

**The bed pad stays early.** Nearly every tilted part has bed contact ≈ 0 — it rests
on an edge — so without a pad there is no test print to judge. The 2 mm bottom
chamfer stays late: it modifies *the user's own geometry* rather than adding a solid
beside it, so it cannot ship before the permission UI that asks about it.

**"M3 never ships" was wrong, twice over.** It was retired on the grounds that a
tine-less wall "only constrains the part in one direction", citing Slant3D's cube
falling away from exactly that support. But that demo is a part balanced on an
EDGE with the support as its only restraint; a wall propping an overhang from
beneath, on a part that is otherwise sitting down, has gravity holding the part
onto it. `breakaway.py` has no tines anywhere and produced good supports on real
printed shelter hubs. The tine-less bed-attached wall is now the **primary**
primitive, and M3's geometry — modulo the inside-out winding nobody caught — was
closer to right than what replaced it.

**And the "13 fins" finding was misread.** On a Voron frame stood on edge, naive
placement puts a wall under all 13 servable regions, 12–103 mm tall on a 116 mm
part, and the roadmap called them *"full-height scaffold walls that would waste
more plastic than the slicer supports they replace."* **That comparison was never
run.** A 1.2 mm wall is the thinnest support that exists — it is the product's
central claim — and the correct response to "13 is too many" is *fewer walls*,
not *smaller walls*. Reading it as the latter is what produced `maxLen: 25` and a
4.5 mm brace under 3,403 mm² of overhang.

So placement is **not a mode and not a judgment call about intent.** It is a
coverage criterion: *no point of an overhang may be further than
`maxUnsupportedSpan` from a support.* The count then falls out of the geometry —
a part that needs 2 gets 2, a part that needs 9 gets 9 — and the dial is exposed
to the user rather than guessed at. **Before `maxUnsupportedSpan` is defaulted,
measure the plastic both ways** (walls vs. the slicer's own supports) so the
claim the project rests on is finally a number.

---

## Settled while building

- **The overhang threshold must be strict, with an epsilon.** 45° is the canonical
  designed-in chamfer angle, so real parts carry thousands of faces landing *exactly* on
  the boundary, and a face at exactly the threshold is self-supporting. The Python probe's
  truncated `0.7071` constant was 7.6e-6 looser than `cos(45°)` and silently pulled every
  45° chamfer in — on one Voron part, 45 extra faces but **318 mm², a 2.1× overstatement**
  of overhang area. Both sides now use `cos(threshold) + 1e-4` and `nz` in float64.
  This is the same failure as the spike's "6 fins on a part that needs zero," one layer
  down: **judgment starts at the threshold comparison.**
- **Browser and Python must agree numerically, and it's checked.** `web/overhangs.js`
  mirrors `prototype/spike_overhangs.py` constant-for-constant; `window.__sf` exposes the
  topology and analyzer so the two can be diffed on the same file.
- **Lighting is a legibility requirement, not decoration.** Overhangs are on the underside,
  so the user looks *up* at the part most of the time. A conventional key-from-above rig
  leaves exactly the faces this tool exists to show sitting in the dark.
- **Rotation is cheap because welding is rotation-invariant.** Turning a part cannot change
  which triangles touch, so a rotation re-runs only the linear classify pass (1–6 ms) and
  never the weld (28–119 ms). That is what lets the readout update live during a drag.
- **Orientation is applied as a transform, never baked into the geometry.** The mesh stays
  in its original frame and the analysis takes a rotation matrix, so nothing accumulates
  float error across a hundred rotations and the original file is always recoverable.
- ~~**The fin leans with the part.**~~ **REVERSED 2026-07-26 — walls are always
  vertical.** The original reasoning was that requiring a *vertical face* to stand
  against is self-defeating, since tilting a part is exactly what stops its faces
  being vertical (at 30°, the first version found ONE site on a 35,520-face Voron
  frame). That problem is real; leaning was the wrong answer to it. A thin wall
  leaning 45° is a self-supporting overhang *as a printed object*, but a support
  has to carry load to the plate, and a 1.2 mm wall at 40° buckles sideways rather
  than taking it in compression — measured: 7 of 16 fins lean 25–40°, one of them a
  147 mm wall on a 12.6 mm stilt. **The right answer to a non-vertical face is a
  vertical wall with a contoured top edge**, which is what `breakaway.py` does and
  what removes the need for the face to be flat *or* vertical.
- **Planar segmentation must grow from a seed plane, never merge pairwise.** Union-find
  over adjacent faces whose normals agree within 12° *creeps*: a cylindrical boss's faces
  each differ from the next by a few degrees, so the whole cylinder merges into one "flat"
  patch and swallows any real wall it touches. Region-growing against the seed's own plane
  cannot creep — the hundredth face is judged by the same plane as the first.
- **Verification runs headless, in `deno`.** `overhangs.js`, `planes.js` and `fins.js`
  import no three.js, so `prototype/verify_fins.js` runs the *shipping* modules over real
  STLs and hands the output to trimesh. This is not a build step and does not change the
  no-node constraint — it is a dev-only check. It immediately caught an area-weighting bug
  that put every plane at d/3, which no amount of looking at the screen would have found.
- **A flat wall does not need a flat PART, and assuming it did was the single
  biggest limit on coverage.** Requiring a patch to be flat symmetrically meant a
  fin could grip exactly one facet of a round surface — on hub_post_foot at 70°
  the best grip available anywhere on the part was 0.86mm, so nothing could be
  placed at any angle a human would choose. The budget is asymmetric now: the
  surface may not bulge TOWARD the fin at all (the plane is a supporting plane,
  touching the window's outermost point, so every deviation is negative by
  construction), but it may recede up to 1.2mm, and each tine measures its own
  gap and reaches further. The limit on receding is the limit on a tine: 1.5mm of
  unsupported span, which `prototype/probe_tines2.py` established years before it
  was needed here. One flat wall now spans many facets of a cone.
- **Cheap search, exact confirmation — applied three times now.** The pattern
  that keeps working: search with something fast and approximate, then verify the
  finished geometry exactly and discard what fails. The wall gets a containment
  test (`inside.js`), the finished fin gets a clearance test against the volume it
  actually occupies (the plane moves after the search, so the search cannot be
  trusted about it), and every tine is confirmed to bite before it is emitted.
  Each of those three caught a real defect that all the cheaper checks passed.
- **Fins are rebuilt when a drag ENDS, not during it.** The confirmation passes
  cost ~100ms on a 43k-face part: fine once, unusable at 60fps. Overhang shading
  still updates live at 1-6ms, so the thing the user is steering by never stalls,
  and the fins grey out while they are stale rather than showing a stale answer
  as if it were current.
- **Serve dev with caching off** (`dev-server.py`). `python3 -m http.server` sends no
  `Cache-Control`, so browsers heuristically cache ES modules; editing a module and
  reloading then silently runs the old code and looks exactly like a logic bug.

## M4 status (2026-07-26)

**Geometry and site selection: done, verified, and sliced.** `prototype/verify_fins.js`
generates, `prototype/check_stl.py` judges, and both run over the three dev models at
0/25/40 degrees. **9/9 cases clean**, where clean means all five of:

- every added solid watertight and a positive volume;
- no wall or base vertex inside the part;
- every tine fused into the part;
- every tine attached to its own wall;
- standoff measured 0.200-0.233 mm against a 0.2 mm spec.

**It has now been through a real slicer**, which had never happened before. PrusaSlicer
reports the hub export `manifold = yes`, 85 parts, seated at z = 0, and slices it without
error. `prototype/check_gcode.py` confirms the fin is really in the toolpaths: **227 of
~228 expected layers, z 0.20 to 45.40 — 100% of the fin's height** — plus 1,183 moves in
the base disc. A fin too thin to slice would have vanished here and passed every
mesh-level check in the repo.

### What the fixes were

Three faults were stacked, each hiding the one behind it:

1. **The patch frame was wrong for any leaning face.** `planes.js` built its "up the face"
   vector from `u`'s components instead of `n`'s; the result is not even in the patch
   plane. Correct whenever `nz = 0`, so upright fins looked perfect while a 40-degree face
   put its tines **13.6 mm from their own wall**. That is what "tines touch their wall"
   now gates, and it is why that check exists.
2. **The wall was as tall as the patch's bounding box.** On a tilted part the patch is a
   diagonal band in (u, z), so the wall shot past the face into neighbouring geometry at
   most u values — 92 of 100 bins blocked on the hub. Height now follows the patch
   locally, and the window is capped at `maxLen`.
3. **`FLAT_TOL` was larger than the standoff.** At 0.5 mm a patch could bow further than
   the fin stands off: wall 1.7 mm inside the part on one side, 45 of 78 tines fused to
   air on the other. It is now bounded by the standoff and the tine bite.

### Settled here, worth not re-deriving

- **The obstruction test is a BAND, not a half-space.** "Any surface outboard of the
  wall's inner face" blocks on the far side of every hollow — on a hub, all 52 bins, with
  the obstruction 14-58 mm away in open air. Bounding it at the wall's outer face asks the
  real question. It is exact rather than a heuristic: a wall box engulfed in solid with no
  surface crossing it would require the part to be solid to the plate there, and nothing
  extends below z = 0, so the part would have a face at z ~ 0 inside the box.
- **Broad search, exact confirmation.** The band test stays the search primitive because
  it is cheap enough for thousands of windows; `inside.js` then ray-parity tests the
  finished fin and discards it if it is inside the part. The grid is built once per file
  in the mesh's ORIGINAL frame — rotation cannot invalidate it, the same reason the weld
  is cached — so it costs nothing per drag frame.
- **Sites offer several ranked windows.** One buried window used to throw the whole face
  away; `filter_housing` at 25 degrees recovers a clean fin from its second choice.
- **Fin separation must be POSITIONAL, not just angular.** The two faces of a thin rib are
  a perfect 180 degrees apart and sailed through the old check, giving the hub two
  "opposite" fins **1.6 mm from each other** — one fin's bracing at two fins' cost. The
  spec says opposite sides because torsion needs a lever arm, so `minSiteGap` enforces one.
- **A BVH was never needed.** The roadmap expected occupancy-by-BVH to be the fix. The
  band test removed the need for it in the search, and the confirmation pass is cheap
  enough with a uniform grid. `three-mesh-bvh` remains unvendored.

### Honest limitations, unchanged or newly measured

- **`hub_corner` still finds no site at 0 and 25 degrees**, only at 40. Stabilize covers
  what it covers; this is the ~65% ceiling that makes Draw mode (M5) core, not a fallback.
  *(Superseded 2026-07-26: that ceiling was measured against a support needing a flat
  face to grip. A bed-attached vertical wall has different reach, and the number must
  be re-measured rather than carried forward. Draw is now M8.)*
- **Every case now produces exactly ONE fin.** Once positional separation was enforced, no
  dev model offered a genuine second site within the constraints. "Two fins, opposite
  sides" is still the spec; the parts are not currently giving us two.
- **Stabilize does not serve overhangs and says so.** The hub at 40 degrees leaves 8
  regions unsupported, and PrusaSlicer independently flags "Collapsing overhang, Long
  bridging extrusions, Floating object part, Low bed adhesion" on that export. That is the
  honest state of a part braced but not supported — and a 46 mm fin on a 123 mm part
  balanced on an edge is unlikely to be enough in practice.
- **Still not test-printed.** Slicing cleanly is not the same as coming off the plate.

## M5 status (2026-07-26, REVISED) — Prop covers far less than was recorded

Shipped behind the mode selector, labelled experimental, and not the default.

**The previous entry here was wrong, and the tooling is why.** It claimed
"hub_post_foot gets a wall at 0 and 40 degrees" and "12/16 cases clean". Measured
again over 4 models × 4 tilts:

| | cases |
|---|---|
| produced a clean support | **3 / 16** |
| built something that failed | 2 |
| **built nothing at all** | **11** |

hub_post_foot gets **zero props at 0, 20, 25, 30, 40 and 50 degrees**; only at 60.
For comparison, Stabilize over 4 models × 3 tilts is 8 clean / 0 failed / 4 empty.

### Two measurement faults manufactured that number

- **`check_stl.py` counted empty output as clean.** `if m is None: return True` —
  a case where the tool built nothing scored exactly like a case where it built a
  good support. 11 of the 16 "passes" were nothing at all. Empty is now its own
  bucket: it is a coverage failure, just not a correctness one.
- **Prop's skip reasons were thrown away before anything could read them.**
  `buildFins` squashed `skipped` onto the stabilize-shaped `rejected` object,
  which keeps only `blocked`. So `verify_fins.js` printed `blocked: 0` for
  hub_post_foot at 0 degrees when the real reason was `buried: 1`, and the UI's
  empty state read the same lossy object. Whatever explains a failure has to
  survive the trip to the UI. Prop's own counters are now passed through intact.

### Root cause on the hub post: it is a bowl, and Prop sweeps a line

hub_post_foot's overhang is the underside of the **ball hub** — a bowl, not a
ledge. The XY covariance of its lowest points is nearly isotropic (1.0 would be a
perfect circle):

| tilt | 0° | 25° | 40° | 60° |
|---|---|---|---|---|
| anisotropy | 1.08 | 1.03 | 1.31 | 36.1 |
| props built | 0 | 0 | 0 | 1 |

`contactLine` takes the principal axis of that point set — which is noise — and
buckets along it, so the "contact line" alternates between the two sides of the
ring, wandering **2.4× its own chord and up to 16mm off it**. The swept wall then
saws through the part and is correctly binned by `insidePart`. The one tilt that
works is the one tilt where a line actually exists.

`breakaway.py` states the precondition in its own docstring — *"the contact line
is assumed ~straight (a linear overhang)"* — and the port inherited the sweep
without it. `PROP.maxTortuosity` now enforces it and reports `notALine`.

### The 13mm wall was never real

The previous entry blamed "its path falls outside that region's own triangles, so
`surfaceZAt` finds nothing above it". That is not what happened. **`hub_corner.stl`
is a two-body mesh** (1158 faces + a separate 28-face solid), and `check_stl.py`
took `sorted(bodies)[0]` — the largest — as "the part". A prop correctly stopping
0.2mm under the *smaller* body was measured against the larger one and reported a
13.4mm gap. `verify_fins.js` now writes a `-part.stl` sidecar so the checker never
has to guess which solid is the part; that prop measures 0.2mm.

### The sub-spec gaps have an exact cause

The "0.11–0.19mm where 0.2 was intended" family was filed as unexplained
imprecision. It is geometric: **the wall's top is a 0.6mm-wide flat, and the gap
is set at its centreline.** On a sloped underside the up-slope corner rises by
`half_tip × slope` into the gap. On hub_corner at 25°, serving a ledge of slope
0.466: `0.2 − 0.3×0.466 ≈ 0.06`, and the two top corners measure **0.056 and
0.306** against a 0.2 spec — the pair straddling the intended gap is the
signature. voron_drive_frame at 60° fails the same way and worse, its nearest top
vertex sitting **0.009mm** off the part, which is a weld. Fix is to drop `top` by
`half_tip × local slope` (or measure the gap perpendicular to the surface) — not
yet done, and it is the reason Prop stays experimental.

### A part balanced on a point cannot be supported at all

The finding that actually explains the hub post. **hub_post_foot has 0.0 mm² of
bed contact at every tilt from 0 to 165 degrees** — it stands on the tip of its
own tapered foot — and 574 mm² only when flipped 180°. Every overhang on it
therefore sits 70–100mm in the air, so even a geometrically valid prop is a
1.2mm-thick wall 70–104mm tall: the same "12–103mm scaffold" failure M3 already
identified, reappearing in M5.

Both modes used to answer with a local reason ("no flat face", "part in the way")
that sent the user off tuning something that was never the problem. `seatingOf`
now classifies the part as sitting on a **face, an edge, or a point**, and the
point case outranks every mode-specific message. An edge must not trip it — that
is the flagship Stabilize case — so the discriminator is the footprint's extent,
not its area.

**The lesson that generalises.** M3 was called "validated — 14 closed solids, all
watertight". Every one of those solids was wound INSIDE OUT: euler 2, no boundary
edges, consistent winding, and negative volume. The check asked `is_watertight`
and never asked `is_volume`. A slicer would have read the lot as holes. Retiring
M3 for the wrong reason hid that for three milestones. **M5 repeated the shape of
that mistake**: a pass rate that counted absence of output as success, and a
diagnostic channel that could not express its own failure mode. When a milestone
reports better than it looks on screen, suspect the scoreboard.

**Next on this, in order:**
1. Drop the wall top by `half_tip × local slope` so the breakaway gap is a floor.
2. Trim the contact line to its longest clear run instead of discarding the whole
   prop — `breakaway.py` takes `t0,t1` and tells the caller to *"pick t0 so
   contact(t0) has already cleared any solid the wall must NOT weld to"*; a human
   does that trim by hand and the port never automated it. Prototyped: it yields
   an unburied wall on hub_post_foot at 0/25/40 where there are currently none.
   Pair it with a height/plastic cap or it will just emit those scaffolds.
3. A point-prop (tapered column) for bowl overhangs, which is what a ball hub's
   underside actually wants. That is a third support type, not a Prop setting.

## Decisions still open

- **Name + domain.** Product is Support Fins; the domain isn't bought.
- ~~**The "faster" claim is unverified**~~ **Verified 2026-07-29** — see the
  M6b + M5c status table: 19–46% less plastic AND 13–34% faster than
  PrusaSlicer's own buildplate-only supports at the same orientation, with the
  coverage caveat stated there. The tipping-raises-Z concern is a *different*
  comparison (tilted-with-walls vs. flat-with-supports) and still unmeasured;
  don't conflate them in a script.
- **Auto-orientation solver** stays out of v1 by design.

## Explicitly deferred

3MF / OBJ input · overhangs that sit over the part rather than the plate · mobile layout
(desktop-recommended notice instead) · any analytics · accounts, cloud, sharing.
