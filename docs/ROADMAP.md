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
- **Auto mode** — detect overhang regions, find a vertical face beside each, place a
  finned wall + horizontal tines. Covers ~65% of regions; says so out loud for the rest.
- **Draw mode** — click a spot on the part to place a fin, drag to move, delete, and
  re-aim which face it stands against. This is how the other 35% gets served.
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
| **M2** | Orientation: rotate gizmo, snap-to-face, live readout. | Rotating a part visibly changes the overhang count. |
| **M3** | Fin placement + STL export, end-to-end. *Gap-only geometry — internal milestone, never shipped.* | Exported STL opens in a slicer with the fin present. |
| **M4** | **Tines.** Fin stands beside the part on a vertical face, horizontal tines fused in. | A printed test part comes off the plate and the fin snaps clean. |
| **M5** | Draw mode — place / move / delete fins by hand. | A part auto-mode refuses can be finned manually. |
| **M6** | Strength overlay: load arrow, pull-vs-lever toggle, ranked suggestions. | Toggling pull↔lever changes the recommended orientation. |
| **M7** | Chamfer + bed pad permissions, limitations panel, sample model, Ko-fi, domain. | A stranger can use it without being told anything. |

**M3 never ships.** A fin with no tines only constrains the part in one direction —
Slant3D demos a cube falling away from exactly that support mid-print. M3 exists to prove
the pipeline, M4 makes it correct.

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

## Decisions still open

- **Name + domain.** Product is Support Fins; the domain isn't bought.
- **The "faster" claim is unverified** — fins are ~1.2 mm walls vs. supports' material and
  travel, but tipping a part on edge raises Z height and can eat the gain. Measure with a
  real slicer before it goes in a script. If it loses, drop it.
- **Auto-orientation solver** stays out of v1 by design.

## Explicitly deferred

3MF / OBJ input · overhangs that sit over the part rather than the plate · mobile layout
(desktop-recommended notice instead) · any analytics · accounts, cloud, sharing.
