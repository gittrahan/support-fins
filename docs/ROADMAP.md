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
- **Serve dev with caching off** (`dev-server.py`). `python3 -m http.server` sends no
  `Cache-Control`, so browsers heuristically cache ES modules; editing a module and
  reloading then silently runs the old code and looks exactly like a logic bug.

## M4 status (2026-07-25)

**Geometry: done and verified.** `prototype/verify_fins.js` over the three dev models at
0/25/40°, checked with trimesh:

- every added solid is watertight and a positive volume (walls, bases, tines, pad);
- the wall holds its **0.2 mm standoff** — measured min gap 0.194 mm — and no wall vertex
  is inside the part;
- **tines fuse**: exactly half of each tine's vertices sit inside the part, which is what
  a nub spanning from inside the part to inside the wall should look like;
- fins come out on **opposite bearings** (0° / 180°) unprompted, which is the spec's "two
  fins, opposite sides" falling out of the scoring rather than being hard-coded;
- the bed pad appears exactly when bed contact is ≈ 0, and only then.

**Site selection: too conservative, and that is the open problem.** The wall runs from the
plate to the top of its patch, so `freeSpan()` blocks any u where part geometry sits
outboard of the wall's inner face at any height below the patch. On the hub — whose usable
faces start 15 mm up over a wider base — that blocks everything, and Stabilize finds zero
sites at every tilt. The clipping is *correct*; the model of obstruction is what is wrong.

The reason it is wrong is worth stating precisely: the test asks "is there part surface
outboard of the wall?", when the question is "is the wall's slab inside the part?" Those
differ whenever the part is thicker than the wall stands off. Answering the real question
needs an occupancy test (parity raycast), which is the first thing in this project that
genuinely wants **three-mesh-bvh** — the library the roadmap listed and every milestone so
far has managed to avoid.

Three candidate fixes, in the order they should be tried:
1. **Occupancy, not proximity.** Raycast-parity test of the wall's slab against the part.
   Most correct, brings in the BVH dependency.
2. **Let the wall start above the plate**, standing on a base column at the patch's foot,
   so geometry below the patch stops mattering.
3. **Let the wall step outward** to clear an obstruction, at the cost of the tines on that
   stretch getting longer than one bead.

## Decisions still open

- **Name + domain.** Product is Support Fins; the domain isn't bought.
- **The "faster" claim is unverified** — fins are ~1.2 mm walls vs. supports' material and
  travel, but tipping a part on edge raises Z height and can eat the gain. Measure with a
  real slicer before it goes in a script. If it loses, drop it.
- **Auto-orientation solver** stays out of v1 by design.

## Explicitly deferred

3MF / OBJ input · overhangs that sit over the part rather than the plate · mobile layout
(desktop-recommended notice instead) · any analytics · accounts, cloud, sharing.
