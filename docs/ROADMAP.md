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
| Auto-placement tops out around 65% of regions | manual fin placement is a **core feature**, not a fallback. |

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

### Fins

**Placement is a MODE, not a decision the tool makes for you.** How many fins a part
wants is a question about intent, and the tool cannot read intent: someone who tilted a
bracket into its strong orientation wants it to stay standing, while someone finning a
display piece wants every underside clean. Both are correct. Guessing between them is how
a tool earns *"it put junk fins all over my part."* So the grouping step is exposed. Every
mode runs the same geometry engine underneath — the only thing that changes is **which
overhang regions get bundled onto one fin.**

| mode | groups by | typical output | for |
|---|---|---|---|
| **Stabilize** | servable vertical face — every region that face reaches rides one fin | 2–3 tall fins | a part tilted into a strong orientation that just needs to stay standing. This is the technique `docs/FIN-SPEC.md` measures, and where *"long parts: two fins, opposite sides"* comes from. |
| **Coverage** | one fin per overhang region | many walls | undersides that must all come out clean, at the cost of more plastic |
| **Draw** | you | whatever you place | the ~35% of regions auto-placement can never serve |

Shipping order is **Stabilize (M4) → Draw (M5) → Coverage (M6)**. Coverage is a change to
the grouping step alone once Stabilize exists, so it is sequenced by value, not by cost —
and it is the mode most likely to be *wrong* for a given part, so it should not be what a
first-time user meets. Auto modes reach ~65% of regions and must say so out loud about
the rest.

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
  features under the wall-height floor, regions with no vertical face. Naming these
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
| **M4** | **Tines + Stabilize mode.** Fin stands beside the part on a vertical face, horizontal tines fused in, regions clustered per face. Bed pad included. | A printed test part comes off the plate and the fin snaps clean. |
| **M5** | Draw mode — place / move / delete fins by hand. | A part auto-mode refuses can be finned manually. |
| **M6** | Coverage mode + strength overlay: load arrow, pull-vs-lever toggle, ranked suggestions. | Switching Stabilize↔Coverage changes the fin count; toggling pull↔lever changes the recommended orientation. |
| **M7** | 2 mm chamfer + permission checkboxes, limitations panel, sample model, Ko-fi, domain. | A stranger can use it without being told anything. |

**The bed pad moved from M7 into M4**, because M4's done-when depends on it. Nearly every
tilted part has bed contact ≈ 0 — it rests on an edge — so without a pad there is no test
print to judge, and the milestone cannot close. The 2 mm bottom chamfer stays in M7: it
modifies *the user's own geometry* rather than adding a solid beside it, so it cannot ship
before the permission UI that asks about it.

**M3 never ships.** A fin with no tines only constrains the part in one direction —
Slant3D demos a cube falling away from exactly that support mid-print. M3 exists to prove
the pipeline, M4 makes it correct.

M3 also made the *judgment* problem concrete rather than theoretical. On a Voron frame
stood on edge, naive placement puts fins under all 13 servable overhang regions and they
come out **12–103 mm tall on a 116 mm part** — full-height scaffold walls that would waste
more plastic than the slicer supports they replace. Detection is solved; deciding which
overhangs actually deserve a fin, and where it stands, is the product.

That finding is what turned placement into a **mode** rather than an algorithm. "13 fins"
is not a bug to be tuned away — it is the honest answer to *"serve every overhang,"* a
question nobody asked. Stabilize asks a different one — *"what keeps this part standing?"* —
and answers it with 2–3 fins on the same geometry. The count follows from the intent, so
the intent has to be an input. M4 builds the correct geometry and the first mode; M5 lets
the human override both.

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
- **The fin leans with the part.** Requiring a fin to stand against a *vertical* face is
  self-defeating: tilting a part into a strong orientation is exactly what stops its faces
  being vertical. At 30° the first version found ONE site on a 35,520-face Voron frame.
  The fin is built in the patch's own frame and leans with the face it serves, which
  prints because a thin wall leaning up to 45° is a self-supporting overhang.
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
- **Every case now produces exactly ONE fin.** Once positional separation was enforced, no
  dev model offered a genuine second site within the constraints. "Two fins, opposite
  sides" is still the spec; the parts are not currently giving us two.
- **Stabilize does not serve overhangs and says so.** The hub at 40 degrees leaves 8
  regions unsupported, and PrusaSlicer independently flags "Collapsing overhang, Long
  bridging extrusions, Floating object part, Low bed adhesion" on that export. That is the
  honest state of a part braced but not supported — and a 46 mm fin on a 123 mm part
  balanced on an edge is unlikely to be enough in practice.
- **Still not test-printed.** Slicing cleanly is not the same as coming off the plate.

## Decisions still open

- **Name + domain.** Product is Support Fins; the domain isn't bought.
- **The "faster" claim is unverified** — fins are ~1.2 mm walls vs. supports' material and
  travel, but tipping a part on edge raises Z height and can eat the gain. Measure with a
  real slicer before it goes in a script. If it loses, drop it.
- **Auto-orientation solver** stays out of v1 by design.

## Explicitly deferred

3MF / OBJ input · overhangs that sit over the part rather than the plate · mobile layout
(desktop-recommended notice instead) · any analytics · accounts, cloud, sharing.
