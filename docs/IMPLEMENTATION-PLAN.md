# Implementation plan — M5c, M6b, M7b

> **STATUS 2026-07-29: M5c and M6b are DONE and committed** (M6b landed as
> `splitRegion`/`patchTracks` in `prop.js`; M5c flipped the default and the
> selector labels; the §6 measurement ran and both claims verified — numbers
> in `docs/ROADMAP.md` "M6b + M5c status"). §§3–4 below are kept for the
> reasoning and the invariants; the next open milestone is **M7b** (§5),
> then M8/M9.

Self-contained handoff. `docs/ROADMAP.md` is the canonical *why*; this file is
the *how*, written so it can be executed without re-deriving anything. Every
number below was measured on this machine on 2026-07-28, not estimated.

**Repo:** `~/projects/support-fins` (MIT, remote `gittrahan/support-fins`).

---

## 0. How to run everything

No build step, no `node`. Deno for headless checks, Python for judging.

```bash
cd ~/projects/support-fins/prototype

# generate: one case = one model at one tilt in one mode
deno run --allow-read --allow-write verify_fins.js \
    ../web/dev-models/voron_drive_frame.stl 40 /tmp/out/drive-40.stl prop

# judge: reads <case>.stl, <case>-part.stl, <case>-fins.stl, <case>-pad.stl
python3 check_stl.py /tmp/out/*.stl
```

`verify_fins.js` args: `<model.stl> <tiltDeg> <outPath.stl> <mode>` where mode is
`prop` or `stabilize`. It imports the **shipping** modules (`overhangs.js`,
`planes.js`, `fins.js`, `prop.js` have no three.js import), so it validates real
code, not a reimplementation.

**The standard matrix** is 4 models × tilts 0/25/40/60:
`voron_drive_frame`, `voron_filter_housing`, `hub_corner`, `hub_post_foot` in
`web/dev-models/`. Always run the whole matrix; single cases mislead.

Browser: `python3 dev-server.py` then open the printed URL. Do **not** use
`python3 -m http.server` — it sends no `Cache-Control`, so edited ES modules are
silently served stale and it looks exactly like a logic bug.

`deno check web/app.js` reports 4 `TS2307` errors for `three` and
`three/addons/...`. That is the browser import map, which Deno does not read.
**Expected, not a regression.** The five geometry modules
(`prop.js`, `fins.js`, `overhangs.js`, `planes.js`, `inside.js`) check clean.

---

## 1. Baseline as of 2026-07-28 (M5a + M5b landed)

| mode | clean | built but failed | built nothing | overhang coverage |
|---|---|---|---|---|
| Stabilize (fin) | 8/12 | 0 | 4 | **4%** |
| Prop (wall) | 8/16 | 0–1 | 6–7 | **13%** |

Breakaway gaps measure **0.15–0.22 mm** against a 0.2 spec. Every wall is
vertical and seated at z = 0.

`check_stl.py` uses `trimesh.sample.sample_surface`, which is **random**, so the
clean count moves by ±1 between runs on marginal cases. Do not chase a one-case
change; re-run before believing it.

**Of the 7 Prop empties, 4 are correct refusals**, and must stay refusals:

- `hub_post_foot` at 0/25/40 — the part has **0.0 mm² of bed contact at every
  tilt from 0° to 165°**; it balances on the tip of its own tapered foot.
  Nothing you add can hold it. `seatingOf()` in `fins.js` classifies this as
  `point` and the UI says so. Not a bug.
- `voron_drive_frame` at 0° — its only overhangs are two 25 mm² regions sitting
  0.5 mm off the plate with a 5.1 mm span. Correctly not worth a wall.

So the real miss count is ~3, and they are the target of M6b.

**UPDATE 2026-07-29, after M6b:** 10/16 clean, 61% coverage, and the six
remaining empties are ALL correct refusals — the four above plus
`hub_post_foot`@60 (the point gate now refuses it too; the "wall" it used to
get was a 104 mm scaffold on a part that cannot stand) and `hub_corner`@0
(its ledge overhangs the part's own base tab — 10 of 18 faces raycast into
the part before the plate — and its other regions are socket rings over the
boss; the bed-only limitation, verified, not a miss). A narrow-foot retry was
tried for `hub_corner`@0 and reverted: it rescued nothing anywhere.

---

## 2. Invariants — re-breaking these is the main risk

Each cost a measured regression. Do not "simplify" any of them.

1. **`settleTop()` lowers only, never raises.** `surfaceZAt()` sees only the
   *current region's* triangles, so a measured clearance larger than `gap`
   usually means the nearest geometry belongs to another part of the mesh that
   this pass cannot see. Raising on that evidence welded walls to what it could
   not measure: the matrix went **6 clean → 0**, with gaps of 0.002–0.015 mm.
2. **`settleTop()` corrects per station, not globally.** One global shift let a
   single low triangle drop the whole wall **0.48 mm** below the part — too far
   for the part to land on, which the checker correctly reports as a gap that is
   too *large*.
3. **Straightness is RMS-deviation/chord, never arc-length/chord.** Arc length
   grows without bound as you sample a curve more finely. Same region,
   `voron_drive_frame` @40, varying only station count:
   arc/chord `1.14 → 1.44 → 1.59 → 2.08 → 3.16` (crosses a 2.0 gate on sampling
   density alone) while RMS/chord holds at `0.081 → 0.069 → 0.062 → 0.065 →
   0.065`. Evidence lives in `prototype/probe_straightness.js`; keep it runnable.
4. **Trim, never discard.** A local problem must shorten the run
   (`longestRun()`), not throw away the region. The old
   `if (h < PROP.minHeight) return false` inside `sweep()` lost a 92 mm wall
   because its first station sat where the underside meets the plate.
5. **`sideClear` (0.35) must exceed `gap` (0.2).** The top is *meant* to come
   within 0.2 mm and be bridged; the flanks are meant never to touch. Set to
   0.15 first, which put the closest approach on the flank instead of the top on
   4 of 6 walls.
6. **The breakaway gap and the flank clearance are different measurements.**
   `check_props()` separates them by where the nearest part surface sits
   relative to the sample (above ⇒ breakaway, sideways ⇒ flank). Merging them
   fails walls whose flanks are correctly standing well clear.
7. **Do not chase generator-vs-checker disagreement with denser probes.** The
   generator confirms with sampled points; the checker measures exact
   surface-to-surface distance. They never converge. That chase is what produced
   the "0.11–0.19 mm where 0.2 was intended" family the project carried for two
   milestones. Measure the finished edge and move it (`settleTop`).
8. **`hub_corner.stl` is a two-body mesh.** Always measure against the
   `-part.stl` sidecar `verify_fins.js` writes. Taking the largest body once
   produced a phantom "13 mm short wall" that was recorded as a real defect.
9. **No boolean kernel, no build step, no new dependencies.** Added solids
   overlap and are unioned by the slicer. Only `three.js` is vendored;
   `three-mesh-bvh` is listed in the roadmap but has never been needed.
10. **Rotation must stay a transform, never baked into geometry.** The weld and
    the `inside.js` grid are built once per file in the mesh's ORIGINAL frame,
    which is what keeps a gizmo drag at 1–6 ms.

---

## 3. M5c — flip the default to the wall

**Smallest milestone, and the one the original complaint is about.** A user who
loads a part today gets `stabilize`, whose fin stands *beside* the part and
leans with the face it grips: 7 of 12 fins in the matrix lean 25–40°, worst a
147 mm wall leaning 30° on a 12.6 mm stilt.

**This is a product decision the owner has not yet made.** Flipping trades a
support that covers 4% but always builds something, for one that covers 13% but
builds nothing on ~3 servable parts. **Confirm with the owner before landing.**
If M6b lands first, the trade gets much easier and this becomes obvious.

Changes:

1. `web/fins.js`, `buildFins()` — `const mode = opts.mode ?? 'stabilize'` becomes
   `?? 'prop'`.
2. `web/app.js` — the mode selector's default option and its label. Prop is
   currently marked "experimental"; drop that, and mark Stabilize as **Brace**
   (its real job: stopping a part balanced on an edge from toppling, which is
   what Slant3D's fin is for). Do not delete Stabilize — `docs/FIN-SPEC.md`
   still governs it and it stays available.
3. Empty-state copy in `explainNoFins()` already reads Prop's own counters
   (`skipped.wanders` / `buried` / `blocked` / `stub` / `noLine` / `degenerate`).
   Verify each string still names a stage that exists.

**Done when:** loading a dev model and exporting yields a vertical wall, and the
mode selector calls the fin a Brace.

---

## 4. M6b — coverage, in two steps

The structural problem: **a connected overhang region is a topological artifact,
not a support unit.** `analyze()` in `overhangs.js` union-finds adjacent
overhang faces, which merges the entire tilted underside of
`voron_drive_frame` into one 3,240 mm² region whose contact line sits **6.4 mm
RMS off any straight axis**. One wall per region can never cover it. Two
distinct failures follow, and they need different fixes.

### M6b-1 — split regions into locally-straight sub-patches (do this first)

Attacks the ~3 real empties, all rejected by `straightness() > PROP.maxWander`.

**Do not loosen `maxWander`.** It is calibrated: servable ledges measure
0.06–0.08, `hub_post_foot`'s ball-hub bowl — the case the gate exists for —
measures 0.15–0.21. Loosening it re-admits walls that saw through the part.

**Do not split the polyline.** `contactLine()` fits ONE principal axis to the
whole region and buckets along it, so for an L-shaped or wrapped region the
polyline is already wrong before you split it. Split the **faces**, then build
one contact line per sub-patch.

Implementation:

- New function in `prop.js` (or a small `patches.js`), operating on
  `region.faces` in print space: **region-grow from a seed face against the
  seed's own plane**, admitting a face when its normal is within ~15° of the
  seed normal. Grow from the largest unassigned face until none remain.
- **Grow against the seed plane, never merge pairwise.** `planes.js` already
  documents why: union-find over "adjacent faces whose normals agree within 12°"
  *creeps* — a cylinder's faces each differ from the next by a few degrees, so
  the whole cylinder merges into one "flat" patch. Region-growing cannot creep,
  because the hundredth face is judged by the same plane as the first.
- Drop sub-patches under `MIN_REGION_AREA` (12 mm², already in `overhangs.js`).
- Run the existing pipeline unchanged per sub-patch: `contactLine` →
  `straightness` → per-station `usable` → `longestRun` → `settleTop` → `sweep`
  → `insidePart` confirmation.
- `buildProps()` currently loops `for (const region of result.regions)`. It
  becomes a loop over sub-patches. **`skipped` counters must stay per-reason and
  survive to the UI** — that lossiness is exactly how M5 was recorded as working
  on parts where it built nothing.

**Done when:** `voron_filter_housing` @0 builds a wall under its 210 mm² ledge
at z = 40.9 (currently `buried`), and the matrix has ≤4 empties — i.e. only the
4 correct refusals in §1.

### M6b-2 — parallel walls across a wide underside

Attacks coverage on parts that *do* get a wall. `voron_drive_frame` @40 gets one
correct wall covering 13–18% of a wide sloped plane; it needs several walls side
by side.

- For each sub-patch, compute its principal horizontal axis `u` and the
  perpendicular `v` (the same 2×2 covariance already in `contactLine()` and
  `buildPad()`).
- Walls run **along `u`**, placed at `v = v₀ + k · maxUnsupportedSpan` for
  integer `k` spanning the patch's `v` extent, centred so the outermost walls sit
  ~½ span inside the edges.
- Each wall's contact line = the underside sampled along `u` at that fixed `v`,
  using `surfaceZAt()`. Then the *identical* per-wall pipeline as above —
  `contourTop`, per-station `usable`, `longestRun`, `settleTop`, `sweep`,
  `insidePart`. Do not special-case it.
- **Expose `maxUnsupportedSpan` as one constant** shared by the generator and
  `check_stl.py`'s `MAX_UNSUPPORTED_SPAN` (currently 12.0 mm, duplicated). The
  checker and the generator must not be able to disagree about the dial.
- Add a plastic-cost readout per part (sum of added solid volume). It is needed
  for §6.

**Done when:** matrix coverage ≥ 60% of overhang area with **zero** walls
failing the flank or gap check, and `voron_drive_frame` @40 exceeds 80% on its
own.

---

## 5. M7b — judgment and honesty

- `maxUnsupportedSpan` becomes the **user-facing dial** (mm slider). It is the
  one number that decides how many walls a part gets, and it is a physical
  quantity a printer owner understands (how far their machine will bridge).
- Plastic-cost readout: grams/cm³ of added support, shown next to the wall count.
- Limitations panel, from data the code already produces: overhangs over the
  part rather than the plate; features under the wall-height floor; bowl-shaped
  overhangs with no line to sweep (`skipped.wanders`); parts balanced on a point
  (`seatingOf().kind === 'point'`, already landed and already outranks every
  mode-specific message).
- Brace (the fin) offered as an explicit option for the toppling case.

---

## 6. The unverified claim — measure before it goes in a script

**"Uses less plastic than slicer supports" has never been measured**, and it is
the product's central claim. A 1.2 mm wall *should* win, but tipping a part on
edge raises Z height and can eat the gain.

Procedure: take 3 matrix cases that now produce clean walls, export each twice —
once with walls and supports off, once bare with the slicer's own supports on —
and compare filament used in PrusaSlicer. **If the walls lose, drop the claim.**
The honest-limitations chapter is part of why this format works.

The same run answers the "faster" claim (print time) at no extra cost.

---

## 7. Suggested order

1. **M6b-1** — biggest correctness win, contained, no product decision needed.
2. **M6b-2** — the coverage number.
3. **§6 measurement** — cheap once walls exist, and it gates the video script.
4. **M5c** — ask the owner; trivially easy once coverage is respectable.
5. **M7b**, then M8 (Draw + strength overlay) and M9 (chamfer, sample model,
   Ko-fi, domain) per `docs/ROADMAP.md`.

Re-run the full matrix and `check_stl.py` after every step. If a milestone
reports better than it looks on screen, **suspect the scoreboard** — that has
now happened twice on this project.
