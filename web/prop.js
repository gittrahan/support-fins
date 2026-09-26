/**
 * PROP mode -- a breakaway wall that stands UNDER an overhang.
 *
 * This is a different support from the fin in fins.js, not a variant of it, and
 * the difference is what it leans on:
 *
 *   Stabilize  a wall BESIDE the part, gripping a face with horizontal tines.
 *              Needs a face to grip, so it cannot serve a cone or a sphere.
 *   Prop       a wall UNDER the overhang, rising from the plate and stopping
 *              `gap` short. The part bridges that last layer, so the wall never
 *              fuses and it snaps off. Needs only an underside contact line,
 *              which every shape has.
 *
 * A prop has no tines, deliberately. Tine-less supports were rejected early in
 * this project on Slant3D's demo of a cube falling away from one -- but that is
 * a part balanced on an EDGE with the support as its only restraint. A part
 * sitting down on the plate with an overhang above it has no such failure mode:
 * gravity holds it onto the prop. `tools/support/breakaway.py` in the video repo
 * works exactly this way, has no tines anywhere in it, and produced good fins on
 * real printed shelter hubs -- the parts Stabilize could not touch.
 *
 * The geometry is M3's, which was validated (34/36 regions served, every wall
 * watertight) and then retired for the wrong reason. What is new here is the
 * judgement around it: a prop is only emitted where the wall can actually reach
 * the plate through open air.
 */
import { insidePart, solidClearance } from './inside.js';
import { MIN_REGION_AREA } from './overhangs.js';
import { ribbon } from './solids.js';
import { bodyMask, insertFloorStations, longestRun, stationCertified, stationIsClear, tallBody, tallSpan, withLowTails } from './prop/clearance.js';
import { PROP } from './prop/config.js';
import { contourTop, lowerSag, settleTop, straightness } from './prop/contact.js';
import { seat, surfaceZsAt } from './prop/surface.js';
import { sweep, sweepBetween } from './prop/sweep.js';
import { emitTines, tineStepFor } from './prop/tines.js';
import { patchTracks, splitRegion, tubeLine } from './prop/tracks.js';

// Moved into web/prop/ (one module per concern); re-exported here so every
// importer of prop.js is unchanged.
export { PROP } from './prop/config.js';
export { splitRegion, tubeLine, patchTracks } from './prop/tracks.js';
export { straightness, contactLine, lowerSag, contourTop, settleTop } from './prop/contact.js';
export { footFor, profileHalf, sweep, sweepBetween } from './prop/sweep.js';
export { surfaceZAt, surfaceZsAt } from './prop/surface.js';
export { tineStepFor, emitTines } from './prop/tines.js';

/**
 * The floor contour a PART-ATTACHED support stands on: for each station of
 * `topLine`, the HIGHEST part surface strictly below the overhang, or 0 (the
 * plate) where nothing intervenes.
 *
 * This is the exact mirror of `contourTop`. contourTop looks UP across the tip
 * and takes the LOWEST hit, so the tip stops `gap` under the overhang; floorLine
 * looks DOWN across the tip and takes the HIGHEST hit below the overhang, so the
 * support lands on the part instead of driving to z=0. Taking the highest hit
 * across the tip's width (not just the centre) means the bottom rests ON the
 * floor and never digs into it -- the same reasoning contourTop uses to keep the
 * top out of the part.
 *
 * `margin` keeps the overhang's OWN face from being read as its floor: only
 * surfaces at least `margin` below the contact line count. Stations with no
 * intervening surface fall through to 0, so a wall that is part over-part and
 * part over-bed degrades station-by-station to the plate with nothing special-
 * cased -- the current all-to-plate behaviour is just the everywhere-0 case.
 */
export function floorLine(topLine, tris, margin = 1.0) {
  const half = PROP.tip / 2;
  const bot = [];
  for (let i = 0; i < topLine.length; i++) {
    const a = topLine[Math.max(0, i - 1)];
    const b = topLine[Math.min(topLine.length - 1, i + 1)];
    let rx = b[0] - a[0], ry = b[1] - a[1];
    const rn = Math.hypot(rx, ry) || 1;
    const sx = ry / rn, sy = -rx / rn;      // across the wall
    const ceil = topLine[i][2] - margin;
    let z = 0;                               // plate fallback
    for (const o of [-half, 0, half]) {
      for (const zz of surfaceZsAt(tris, topLine[i][0] + sx * o, topLine[i][1] + sy * o)) {
        if (zz < ceil && zz > z) z = zz;     // highest surface below the overhang
      }
    }
    bot.push([topLine[i][0], topLine[i][1], z]);
  }
  return bot;
}

// How far below the clicked/probed overhang a settle pass may still pull the top
// down when looking for a part-attached support. Comfortably covers an overhang's
// own slope over a wall's length, and stays well under the smallest floor-to-
// overhang gap worth supporting -- so the top settles on the overhang, never its
// floor. Shared with draw.js so the two paths measure a part-attached wall alike.
export const PART_BAND = 3.0;

const BORE = {
  radius: 10,      // mm; a cavity narrower than ~2x this reads as a bore/slot
  dirs: 8,         // compass rays cast outward from the support column
  walledMin: 6,    // ...this many hitting part within `radius` = enclosed
  step: 0.5,       // mm along each ray
};

/**
 * Is the support column at station `k` enclosed by part walls -- i.e. standing
 * inside a bore or narrow slot? A support there SCARS an internal surface you
 * cannot clean (worse than a little sag), so [[project_support_fin_quality_first]]
 * says refuse it: a hole is an ORIENTATION problem, not a support one.
 *
 * Cast `dirs` horizontal rays out from the column's centreline at mid-height and
 * count how many strike part material within `radius`. An open ledge-over-base
 * has air on at least some sides (few walled); a blind bore is walled all round.
 */
function enclosedFloor(top, floor, k, topo, rot, offset) {
  const p = top[k];
  const zMid = (floor[k][2] + (top[k][2] - PROP.gap)) / 2;
  // A column whose own centreline is inside the part is buried, not standable.
  if (insidePart(topo, rot, offset, p[0], p[1], zMid)) return true;
  let walled = 0;
  for (let d = 0; d < BORE.dirs; d++) {
    const ang = (d / BORE.dirs) * 2 * Math.PI;
    const dx = Math.cos(ang), dy = Math.sin(ang);
    for (let r = BORE.step; r <= BORE.radius; r += BORE.step) {
      if (insidePart(topo, rot, offset, p[0] + dx * r, p[1] + dy * r, zMid)) {
        walled++;
        break;
      }
    }
  }
  return walled >= BORE.walledMin;
}

/**
 * Can a PART-ATTACHED wall at station `k` stand between its floor and the overhang
 * without piercing a side wall? Mirror of stationIsClear, but bounded to the
 * (floor, top) span the wall actually occupies -- it probes STRICTLY between the
 * ends, since the bottom is meant to weld to the floor and the top to break away
 * under the overhang, and probing those would read the intended contacts as welds.
 */
function clearBetween(top, floor, k, topo, rot, offset) {
  const p = top[k];
  const a = top[Math.max(0, k - 1)];
  const b = top[Math.min(top.length - 1, k + 1)];
  const rx = b[0] - a[0], ry = b[1] - a[1];
  const rn = Math.hypot(rx, ry);
  if (rn < 1e-9) return true;
  const sx = ry / rn, sy = -rx / rn;
  const zTop = p[2] - PROP.gap, zBot = floor[k][2];
  const nP = Math.max(3, Math.ceil((zTop - zBot) / 1.5));
  for (let i = 1; i < nP; i++) {                 // strictly interior heights
    const z = zBot + ((zTop - zBot) * i) / nP;
    for (const m of [0.12, 0.24, PROP.sideClear]) {
      const w = PROP.th / 2 + m;
      if (insidePart(topo, rot, offset, p[0] + sx * w, p[1] + sy * w, z)) return false;
      if (insidePart(topo, rot, offset, p[0] - sx * w, p[1] - sy * w, z)) return false;
    }
  }
  return true;
}

/**
 * Try to stand a PART-ATTACHED wall under `line` (the overhang contact polyline,
 * seated). Returns one of three verdicts:
 *   { ok: true, prop }   -- a part-attached wall was built into `out`.
 *   { floored: true }    -- there IS a floor here (an over-the-part overhang) but
 *                           no safe wall fits (a bore, or side walls in the way);
 *                           the caller must NOT then stilt to the plate through
 *                           the part -- it counts this and moves on.
 *   { }                  -- no floor beneath the overhang; an ordinary bed
 *                           overhang. The caller falls through to the plate path
 *                           UNCHANGED, so the flagship parts don't change.
 *
 * This is the auto-placer's version of what draw.js does by hand: settle a BANDED
 * top so the overhang isn't dragged onto its own floor, read the floor with
 * floorLine, and bridge the two with sweepBetween. It only claims a line when a
 * real floor sits under MOST of it, refuses bores (enclosedFloor), and refuses to
 * pierce side walls (clearBetween).
 */
function buildPartAttached(line, partTris, topo, rot, offset, out) {
  const top = line.map((p) => [p[0], p[1], p[2]]);
  contourTop(top, partTris, PART_BAND);
  lowerSag(top, partTris, PART_BAND);
  settleTop(top, partTris, 0.25, PART_BAND);
  const floor = floorLine(top, partTris);

  // A real floor under a majority of stations, or this is a bed overhang -- let
  // the plate path have it. floorLine returns ~0 with clear air to the plate, so
  // this declines on every ordinary overhang and the flagship parts don't change.
  let real = 0;
  for (const f of floor) if (f[2] > PROP.gap + 0.5) real++;
  if (real < Math.max(PROP.minStations, Math.ceil(floor.length * 0.5))) return {};

  const ok = top.map((p, k) => {
    if (floor[k][2] <= PROP.gap + 0.5) return false;               // no real floor
    if ((p[2] - PROP.gap) - floor[k][2] < PROP.minHeight) return false;
    if (enclosedFloor(top, floor, k, topo, rot, offset)) return false;
    return clearBetween(top, floor, k, topo, rot, offset);
  });
  const run = longestRun(ok);
  if (!run || run[1] - run[0] < PROP.minStations) return { floored: true };

  const subTop = top.slice(run[0], run[1]);
  const subFloor = floor.slice(run[0], run[1]);
  const span = Math.hypot(subTop[subTop.length - 1][0] - subTop[0][0],
                          subTop[subTop.length - 1][1] - subTop[0][1]);
  if (span < PROP.minSpan) return { floored: true };

  const before = out.length;
  if (!sweepBetween(subTop, subFloor, out)) { out.length = before; return { floored: true }; }

  let height = 0, vol = 0;
  for (let i = 0; i < subTop.length; i++) {
    height = Math.max(height, (subTop[i][2] - PROP.gap) - subFloor[i][2]);
  }
  for (let i = before; i < out.length; i += 3) {
    const a = out[i], b = out[i + 1], c = out[i + 2];
    vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2])
          + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return {
    ok: true,
    prop: {
      span, height, stations: subTop.length, volume: Math.abs(vol),
      partAttached: true,
      line: subTop.map((p) => [p[0], p[1], p[2] - PROP.gap]),
    },
  };
}

/**
 * Sweep a SQUAT breakaway wall: a thin wall necking to the breakaway tip, on a
 * flat brim. The full T-flange (`sweep`) can't fit here -- baseH 1.0 alone is most
 * of the wall -- but a squat wall still has to hold to the plate, so it gets a
 * thin WIDE brim instead: two layers tall (snaps off, leaves no part mark since it
 * sits on the plate), wide enough to grip. Two overlapping solids the slicer
 * unions, exactly like `sweep`'s wall + flange.
 */
export function sweepSquat(line, zBed, out) {
  const wall = [], brim = [];
  const brimTop = zBed + PROP.squatBrimH;
  for (let i = 0; i < line.length; i++) {
    const p = line[i];
    const a = line[Math.max(0, i - 1)];
    const b = line[Math.min(line.length - 1, i + 1)];
    let rx = b[0] - a[0], ry = b[1] - a[1];
    const rn = Math.hypot(rx, ry);
    if (rn < 1e-9) return false;
    rx /= rn; ry /= rn;
    const sx = ry, sy = -rx;                 // horizontal, across the wall

    const top = p[2] - PROP.gap;
    const h = top - zBed;
    if (h < PROP.minHeightSquat) return false;
    // neck to the tip over whatever height is left above the brim
    const ztip = Math.max(top - PROP.tipH, brimTop + 0.05);
    const P = (o, z) => [p[0] + sx * o, p[1] + sy * o, z];

    // the stem: bed to breakaway tip, th-wide then necking to the contact tip
    wall.push([
      P(+PROP.th / 2, zBed), P(+PROP.th / 2, ztip), P(+PROP.tip / 2, top),
      P(-PROP.tip / 2, top), P(-PROP.th / 2, ztip), P(-PROP.th / 2, zBed),
    ]);
    // the brim: a thin flat slab overlapping the wall's base, for plate grip
    brim.push([
      P(+PROP.squatBrimW, zBed), P(+PROP.squatBrimW, brimTop),
      P(-PROP.squatBrimW, brimTop), P(-PROP.squatBrimW, zBed),
    ]);
  }
  ribbon(wall, out);
  ribbon(brim, out);
  return true;
}

/**
 * Build brimmed squat breakaway walls on the sub-minHeight bed stations of a
 * contoured overhang line -- the near-bed overhangs a full T-wall can't reach.
 *
 * A flanged wall needs ~minHeight of headroom to exist at all, so `sweep` and its
 * trim discard every station lower than that; on an organic part whose underside
 * ramps down to the plate, that abandons the whole low band and it prints into
 * air. Here the low band is built directly: the stations with minHeightSquat <=
 * height < minHeight (DISJOINT from the tall run the caller builds, so the two
 * never compete) are walked into maximal runs, and each is swept via `sweepSquat`
 * -- a thin wall on a thin WIDE brim. The full T-foot can't fit under a 1mm wall
 * (footMin 1.6 would splay into a sheet), but the wall still has to HOLD to the
 * plate, so the brim gives it the adhesion area a bare 0.6mm-wide tip never could.
 * Same weld guard as the plate path: a squat wall that would fuse is dropped,
 * never shipped ("no prop" is fixable, a fused prop is a ruined print).
 *
 * Operates on a private deep copy of the line so `settleTop` never mutates the
 * points the caller's tall path still reads. Appends triangles to `out` and
 * returns the placed prop descriptors (marked `squat: true`).
 *
 * `claimed` (optional, per station) marks stations a tall wall already covers
 * with its low TAIL (withLowTails); those are skipped so the two never stack.
 * Only stations the built wall really spans are claimed -- a low band next to a
 * BLOCKED tall station still gets its squat wall.
 */
export function buildSquatBed(line, regionTris, topo, rot, offset, out, claimed = null) {
  const zBed = 0;
  const placed = [];
  const heightOf = (p) => (p[2] - PROP.gap) - zBed;
  const usable = line.map((p, k) => {
    const h = heightOf(p);
    return h >= PROP.minHeightSquat && h < PROP.minHeight && !(claimed && claimed[k])
        && stationIsClear(line, k, topo, rot, offset);
  });

  let k = 0;
  while (k < usable.length) {
    if (!usable[k]) { k++; continue; }
    let j = k;
    while (j < usable.length && usable[j]) j++;
    const raw = line.slice(k, j).map((p) => [p[0], p[1], p[2]]);  // deep copy
    k = j;
    if (raw.length < PROP.minStations) continue;
    const spanRaw = Math.hypot(raw[raw.length - 1][0] - raw[0][0],
                               raw[raw.length - 1][1] - raw[0][1]);
    if (spanRaw < PROP.minSpanSquat) continue;

    // Put the closest approach on spec, then re-trim: settling can lift a station
    // into the tall band or drop one below the squat floor, exactly as it can for
    // a full wall. Keep only what is still squat-height and measurably clear.
    settleTop(raw, regionTris);
    const avail = raw.map((p, i) => {
      const h = heightOf(p);
      return h >= PROP.minHeightSquat && h < PROP.minHeight
          && stationCertified(raw, i, topo, rot, offset);
    });
    const run = longestRun(avail);
    if (!run || run[1] - run[0] < PROP.minStations) continue;
    const settled = raw.slice(run[0], run[1]);
    const span = Math.hypot(settled[settled.length - 1][0] - settled[0][0],
                            settled[settled.length - 1][1] - settled[0][1]);
    if (span < PROP.minSpanSquat) continue;

    const before = out.length;
    if (!sweepSquat(settled, zBed, out)) {
      out.length = before;
      continue;
    }

    // Same acceptance as the plate path: an approach from above is the breakaway
    // interface (must clear the gap), anything else is a flank weld.
    const hit = solidClearance(topo, rot, offset, out.slice(before), 0.25);
    if (hit && (hit.cosUp > 0.7 ? hit.d < PROP.gap - 0.065 : hit.d < 0.205)) {
      out.length = before;
      continue;
    }

    const top = Math.max(...settled.map((p) => p[2])) - PROP.gap;
    let vol = 0;
    for (let i = before; i < out.length; i += 3) {
      const a = out[i], b = out[i + 1], c = out[i + 2];
      vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2])
            + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    }
    placed.push({
      span, height: top - zBed, stations: settled.length, volume: Math.abs(vol),
      squat: true,
      line: settled.map((p) => [p[0], p[1], p[2] - PROP.gap]),
      // Triangle range of THIS wall in the caller's `out`. The caller emits the
      // tines separately (after every squat wall), so a fin's full geometry is
      // [this wall range] + [its tines range] -- two non-contiguous segments,
      // tracked as `triRanges` at the push site.
      triRange: [before, out.length],
    });
  }
  return placed;
}

/**
 * What buildProps returns when it builds nothing -- kept here so the callers
 * that refuse to build (a part seated on a point) return the same shape.
 */
export function noProps() {
  return {
    triangles: [], props: [], served: 0, volume: 0,
    skipped: { noLine: 0, wanders: 0, stub: 0, blocked: 0,
               degenerate: 0, buried: 0, weld: 0, sliver: 0, bore: 0 },
  };
}

// mm row pitch at the sparsest coverage (0). This is DELIBERATELY wider than
// maxUnsupportedSpan: the mid-slider (0.5) is the structural anti-sag cap, and
// dragging left of it trades sag safety for fewer supports -- the tool warns when
// a part actually lands a row wider than the cap (buildProps.sagRisk). Matthew
// asked for this: a small part was floored at 3 fins by the hard cap.
export const COVER_SPARSE_SPAN = 30.0;

/**
 * Wide-face row pitch for a coverage setting. 0.5 is the neutral default and maps
 * to the structural cap (maxUnsupportedSpan) -- the old sparse behaviour, so a part
 * built at the slider's default is byte-identical to before. Left of centre loosens
 * past the cap toward COVER_SPARSE_SPAN (fewer supports, may sag); right of centre
 * tightens to half the cap (denser). Monotonic, so tests/coverage.test.js holds.
 */
export function coverRowSpan(coverage) {
  const c = Math.max(0, Math.min(1, coverage));
  const cap = PROP.maxUnsupportedSpan;
  return c <= 0.5
    ? cap + ((0.5 - c) / 0.5) * (COVER_SPARSE_SPAN - cap)   // 30 .. 12
    : cap - ((c - 0.5) / 0.5) * (cap / 2);                  // 12 .. 6
}

/**
 * Build a breakaway prop under every overhang region that can take one.
 *
 * @returns {{triangles, props, skipped, served, sagRisk}}
 */
export function buildProps(topo, result, rot, opts = {}) {
  const { pos } = topo;
  const step = opts.step ?? PROP.stationStep;
  // Wide-face coverage (0 sparse .. 1 dense) sets the row spacing via coverRowSpan:
  // 0.5 is the anti-sag cap (the default), left of it loosens past the cap (fewer
  // supports, flagged as sagRisk when a row actually lands wider than the cap),
  // right of it tightens. Pinned by tests/coverage.test.js.
  const coverage = Math.max(0, Math.min(1, opts.coverage ?? 0.5));
  const rowSpan = coverRowSpan(coverage);
  // sagRisk warns ONLY when the user dragged coverage below centre, asking for row
  // pitch wider than the anti-sag cap. It is NOT enough that the placed spacing
  // exceeds the cap: rounding vExt/rowSpan down routinely lands a hair over the cap
  // even at the neutral default (a 53mm face / 12mm cap -> 4 rows at 13.25mm), and
  // warning there is just noise. So gate on the REQUESTED pitch, not the rounded
  // result.
  const wantSparse = rowSpan > PROP.maxUnsupportedSpan + 0.5;
  let sagRisk = false;   // the user chose sub-cap spacing AND a real row landed wide
  const zBed = 0;
  const off = result.offset;
  const withTines = opts.tines === true;
  let tineTotal = 0;

  const out = [];
  const props = [];
  // Per-fin identity, assigned in build order. The id is only used to map a
  // raycast hit back to its fin WITHIN one build (the UI tracks removals across
  // rebuilds by a spatial signature, not this id). Sequential keeps it stable
  // within a generation.
  let nextId = 0;
  const skipped = { noLine: 0, wanders: 0, stub: 0, blocked: 0,
                    degenerate: 0, buried: 0, weld: 0, sliver: 0, bore: 0 };
  const v = [0, 0, 0];

  // The whole part, seated once, for the part-attached floor probe: the floor a
  // support lands on is usually a DIFFERENT region than the overhang, so it must
  // raycast the full mesh. Cheap next to the per-region work below.
  const partTris = new Float64Array(pos.length);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity,
      minZ = Infinity, maxZ = -Infinity;
  for (let f = 0; f < topo.nFaces; f++) {
    for (let i = 0; i < 3; i++) {
      seat(pos, f * 9 + i * 3, rot, off, v);
      partTris[f * 9 + i * 3] = v[0];
      partTris[f * 9 + i * 3 + 1] = v[1];
      partTris[f * 9 + i * 3 + 2] = v[2];
      if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
      if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
      if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
    }
  }

  // DENSE grip comb, uniform along every grippable wall. A tip-over-risk scale
  // (commit c0fcf8e) once let "stable" parts fall back to a sparse 9mm comb -- which
  // starved shallow parts down to a few nubs that read as "laying on the face"
  // instead of a gripping comb (regression Matthew caught). The cube-detach that
  // scale was reacting to was actually the bed pad's fault (fixed separately in the
  // pad commits), not the tines'. So the comb is uniformly dense again (Slant3D's
  // "7-8 low down, spreading with height"); density DEFAULTS to PROP.tineStep and
  // tests/tines_realparts.test.js pins that real parts get a full comb. The user's
  // "Tine grip" slider (opts.tineDensity) can loosen it toward tineStepSparse for a
  // surface-critical face, never silently -- see tineStepFor / tests/tine_density.test.js.
  const tineStepEff = tineStepFor(opts.tineDensity);
  // A tine MUST be exactly one slicer layer tall or it stops printing as one clean
  // continuous bead and tears on removal (welts) instead of bending off. So it
  // tracks the user's real layer height (default 0.2mm) -- see the UI's Layer height.
  const tineHeight = opts.layerHeight ?? PROP.tineH;

  // The support unit is the locally-straight sub-patch, not the connected
  // region -- see splitRegion. Fragments too small to be worth a wall are
  // counted, not silently dropped: absence of output recorded as success is
  // exactly how M5's scoreboard lied.
  const patches = [];
  for (let ri = 0; ri < result.regions.length; ri++) {
    const rFaces = result.regions[ri].faces;
    // Seat the WHOLE region's triangles once, shared by all its sub-patches.
    // The polyline each wall follows comes from its own sub-patch, but the
    // surface its top must CLEAR is the whole region's: a wall near a patch
    // boundary can run under a sibling patch's faces, and measuring against
    // patch-only triangles welded it to geometry it could not see -- gap
    // 0.003 mm and flank 0.011 mm on hub_corner, measured the first time this
    // split shipped with per-patch triangles.
    const regionTris = new Float64Array(rFaces.length * 9);
    const regionPts = [];
    let regionArea = 0;
    for (let k = 0; k < rFaces.length; k++) {
      regionArea += topo.area[rFaces[k]];
      let gx = 0, gy = 0, gz = 0;
      for (let i = 0; i < 3; i++) {
        seat(pos, rFaces[k] * 9 + i * 3, rot, off, v);
        regionTris[k * 9 + i * 3] = v[0];
        regionTris[k * 9 + i * 3 + 1] = v[1];
        regionTris[k * 9 + i * 3 + 2] = v[2];
        regionPts.push([v[0], v[1], v[2]]);
        gx += v[0]; gy += v[1]; gz += v[2];
      }
      regionPts.push([gx / 3, gy / 3, gz / 3]);
    }

    // Curved region whose lowest line is straight = a tube: ONE wall under
    // that line, the way breakaway.py props the shelter hubs. Only when the
    // region is flat, or its lowest points form a ring, does it go to
    // splitRegion for rows of tracks. See tubeLine.
    const tube = tubeLine(topo, rFaces, rot, regionPts, regionTris, step);
    if (tube && tube.length) {
      patches.push({ faces: rFaces, area: regionArea, region: ri,
                     tris: regionTris, lines: tube });
      continue;
    }

    for (const p of splitRegion(topo, rFaces, rot)) {
      if (p.area < MIN_REGION_AREA) { skipped.sliver++; continue; }
      p.region = ri;
      p.tris = regionTris;
      patches.push(p);
    }
  }
  const servedRegions = new Set();

  for (const patch of patches) {
    const regionTris = patch.tris;
    let lines;
    if (patch.lines) {
      // A tube's lowest-line track(s), fitted and resampled by tubeLine.
      lines = patch.lines;
    } else {
      // The patch's own geometry: vertices plus face centroids for the frame
      // fit, and its triangles for asking "does the patch cover this station".
      const pts = [];
      const patchTris = new Float64Array(patch.faces.length * 9);
      for (let k = 0; k < patch.faces.length; k++) {
        const f = patch.faces[k];
        let gx = 0, gy = 0, gz = 0;
        for (let i = 0; i < 3; i++) {
          seat(pos, f * 9 + i * 3, rot, off, v);
          pts.push([v[0], v[1], v[2]]);
          patchTris[k * 9 + i * 3] = v[0];
          patchTris[k * 9 + i * 3 + 1] = v[1];
          patchTris[k * 9 + i * 3 + 2] = v[2];
          gx += v[0]; gy += v[1]; gz += v[2];
        }
        pts.push([gx / 3, gy / 3, gz / 3]);
      }
      lines = patchTracks(pts, patchTris, step, { topo, rot, offset: off }, rowSpan);
      // The user chose sub-cap spacing (wantSparse) AND this face actually landed a
      // multi-row gap wider than the cap. Flag it so the UI can warn (never blocks;
      // Matthew's call). Single-row faces (spacing 0) can't sag, so they don't warn.
      if (wantSparse && lines.length && lines.spacing > PROP.maxUnsupportedSpan) sagRisk = true;
    }
    if (!lines.length) { skipped.noLine++; continue; }

    for (const line of lines) {
      // PART-ATTACHED first: if solid part sits below this overhang, a support
      // must stand on THAT floor, not stilt to the plate through the part (the
      // bug Matthew hit on a real hub). buildPartAttached declines on an ordinary
      // bed overhang (floorLine ~0), so the plate path below is reached unchanged
      // for the flagship parts. When there IS a floor but no safe wall fits (a
      // bore, or side walls in the way) it says `floored` -- counted and skipped,
      // never stilted through the part or scarred into a bore. Works on a COPY so
      // the plate path's own `line` is untouched.
      const tri0 = out.length;
      const pa = buildPartAttached(line, partTris, topo, rot, off, out);
      if (pa.ok) {
        servedRegions.add(patch.region);
        // pa.prop.line already carries the wall top (surface minus gap); add the
        // gap back so emitTines reads it as the surface, like the plate path does.
        if (withTines) {
          const topLine = pa.prop.line.map((p) => [p[0], p[1], p[2] + PROP.gap]);
          tineTotal += emitTines(topLine, partTris, topo, rot, off, out, tineStepEff, undefined, tineHeight);
        }
        // buildPartAttached pushed the wall starting at tri0; emitTines above pushed
        // its tines right after, so wall + tines are contiguous -> one segment.
        props.push({ ...pa.prop, area: patch.area,
                     trimmed: line.length - pa.prop.stations,
                     id: nextId++, kind: 'prop',
                     triRanges: [[tri0, out.length]] });
        continue;
      }
      if (pa.floored) { skipped.bore++; continue; }

      // Finish the top against the WHOLE region, not just this patch: a track
      // near a patch boundary can run under a sibling patch's faces, and
      // clearance measured against patch-only triangles welded walls to
      // geometry they could not see (gap 0.003mm, flank 0.011mm, hub_corner).
      contourTop(line, regionTris);
      lowerSag(line, regionTris);
      // pin the wall's low end to the squat floor, not the nearest 1mm station
      if (insertFloorStations(line).length) contourTop(line, regionTris);

      // SQUAT BED PASS: hold the near-bed stations too low for the flanged wall
      // below (which discards everything under minHeight as stub/blocked). It runs
      // AFTER the tall wall (runSquat, on every exit path) so it can skip exactly
      // the stations that wall's low tail covered (`claimed`) and nothing more.
      // squatLine is a deep copy taken now, before the tall path's settleTop
      // mutates the shared points, so the squat pass sees the contoured line.
      const squatLine = line.map((p) => [p[0], p[1], p[2]]);
      const claimed = line.map(() => false);
      const runSquat = () => {
        for (const sq of buildSquatBed(squatLine, regionTris, topo, rot, off, out, claimed)) {
          // a squat wall's base is the thin brim, not the tall flange, so tines
          // attach from squatBrimH up (the default minTop would skip every one).
          const t0 = out.length;
          if (withTines) tineTotal += emitTines(
            sq.line.map((p) => [p[0], p[1], p[2] + PROP.gap]),
            regionTris, topo, rot, off, out, tineStepEff, PROP.squatBrimH, tineHeight);
          servedRegions.add(patch.region);
          // buildSquatBed pushed this wall (sq.triRange) BEFORE every squat wall's
          // tines, so a fin's wall and its tines are NON-contiguous in `out` --
          // track both segments so removing the fin takes wall AND tines together.
          const segs = [sq.triRange];
          if (out.length > t0) segs.push([t0, out.length]);
          props.push({ ...sq, area: patch.area, id: nextId++, kind: 'prop', triRanges: segs });
        }
      };

      // A track is straight in XY by construction, so this gate is a tripwire
      // rather than the bowl-refusal it was for bucketed polylines -- bowls are
      // now refused by their holes (see patchTracks). Keep it: anything that
      // trips it means the frame fit itself went wrong.
      if (straightness(line) > PROP.maxWander) { skipped.wanders++; runSquat(); continue; }

      // Trim to the longest run that can actually carry a wall, rather than
      // discarding the track over a local problem. See `longestRun`.
      const clear = line.map((p, k) =>
        p[2] - PROP.gap >= PROP.minHeightSquat && stationIsClear(line, k, topo, rot, off));
      const usable = withLowTails(
        line.map((p, k) => clear[k] && p[2] - PROP.gap >= PROP.minHeight), clear);
      const run = longestRun(usable);
      if (!run || run[1] - run[0] < PROP.minStations) { skipped.blocked++; runSquat(); continue; }
      const sub = line.slice(run[0], run[1]);

      const body = bodyMask(sub);               // before settleTop -- see bodyMask
      if (tallSpan(sub, body) < PROP.minSpan) { skipped.stub++; runSquat(); continue; }

      // Last, on the trimmed run only: put the closest approach exactly on spec.
      // It runs here rather than earlier because trimming changes which part of
      // the edge is closest, so settling before the trim settles the wrong
      // thing.
      settleTop(sub, regionTris);

      // Settling can push a station that was only just tall enough below the
      // floor, and `sweep` would then throw away the whole wall -- the same
      // all-or-nothing failure the trim exists to prevent, reintroduced one step
      // later. Re-trim against the settled line: on height, and on the measured
      // clearance to everything settleTop could not see (stationCertified).
      // Tall stations carry the wall; low ones may only extend it as its tail.
      const lowA = sub.map((p, k) =>
        p[2] - PROP.gap >= PROP.minHeightSquat && stationCertified(sub, k, topo, rot, off));
      const tallA = sub.map((p, k) => lowA[k] && p[2] - PROP.gap >= PROP.minHeight);

      // Sweep, then MEASURE the finished solid -- exact triangle-to-triangle
      // clearance against the whole part (solidClearance), because the last
      // welds this pipeline shipped sat between stations, where no per-station
      // probe would ever look. A contact is a local problem like every other:
      // trim the station that owns it and try again, up to a few rounds,
      // rather than discarding a 90mm wall over one rib. A wall that cannot be
      // cut clear is dropped -- "no prop" is a fixable disappointment, a fused
      // prop is a ruined print.
      let placed = false, reason = null;
      for (let tries = 0; tries < 4 && !placed; tries++) {
        const run2 = longestRun(withLowTails(tallA, lowA));
        if (!run2 || run2[1] - run2[0] < PROP.minStations) { reason = 'blocked'; break; }
        const settled = sub.slice(run2[0], run2[1]);
        const span2 = Math.hypot(settled[settled.length - 1][0] - settled[0][0],
                                 settled[settled.length - 1][1] - settled[0][1]);
        const settledBody = body.slice(run2[0], run2[1]);
        if (tallSpan(settled, settledBody) < PROP.minSpan) { reason = 'stub'; break; }

        const before = out.length;
        if (!sweep(settled, zBed, out, PROP.minHeightSquat)) {
          out.length = before;
          reason = 'degenerate';
          break;
        }

        // 0.25 reach: the tightest threshold below is 0.205, and every extra
        // tenth of reach widens the broad phase for nothing
        const hit = solidClearance(topo, rot, off, out.slice(before), 0.25);
        // Same acceptance as stationCertified: an approach from above is the
        // breakaway interface, anything else is a flank. Interpenetration
        // measures 0 and fails the flank test, which is what retires the old
        // vertex-containment `buried` check -- crossing surfaces have
        // distance 0 long before any vertex is inside.
        if (hit && (hit.cosUp > 0.7 ? hit.d < PROP.gap - 0.065 : hit.d < 0.205)) {
          out.length = before;
          let kBest = 0, dBest = Infinity;
          for (let k = 0; k < settled.length; k++) {
            const dx = settled[k][0] - hit.x, dy = settled[k][1] - hit.y;
            if (dx * dx + dy * dy < dBest) { dBest = dx * dx + dy * dy; kBest = k; }
          }
          const at = run2[0] + kBest;
          for (const k of [Math.max(0, at - 1), at, Math.min(lowA.length - 1, at + 1)]) {
            lowA[k] = false;
            tallA[k] = false;
          }
          reason = 'weld';
          continue;
        }

        // The TALLEST point, not the lowest: this is what the wall costs to
        // print and how far it has to stand up on its own. `line` is
        // deliberately not used here -- the wall only exists over `sub`.
        const top = Math.max(...settled.map((p) => p[2])) - PROP.gap;
        // signed volume of the emitted solid (divergence theorem over its
        // triangles): the plastic this wall costs, which is the number the
        // "less material than slicer supports" claim has to be measured against
        let vol = 0;
        for (let i = before; i < out.length; i += 3) {
          const a = out[i], b = out[i + 1], c = out[i + 2];
          vol += (a[0] * (b[1] * c[2] - b[2] * c[1])
                + a[1] * (b[2] * c[0] - b[0] * c[2])
                + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
        }
        servedRegions.add(patch.region);
        // The grip comb: nubs along this wall's settled top that bite into the
        // part. `settled` carries the surface z; emitTines subtracts the gap.
        if (withTines) tineTotal += emitTines(settled, regionTris, topo, rot, off, out, tineStepEff, undefined, tineHeight,
                                              tallBody(settledBody));
        props.push({
          span: span2, height: top - zBed, area: patch.area,
          stations: settled.length, trimmed: line.length - settled.length,
          volume: Math.abs(vol),
          // the centreline, so a coverage check can ask what this wall reaches
          line: settled.map((p) => [p[0], p[1], p[2] - PROP.gap]),
          id: nextId++, kind: 'prop',
          // `before` (captured at the start of THIS try, line ~2129) marks where
          // this wall's triangles begin in `out`; failed weld retries roll back to
          // it, so on the successful try it points at this wall. emitTines just
          // pushed its tines right after, so wall + tines are one contiguous segment.
          triRanges: [[before, out.length]],
        });
        for (let k = run[0] + run2[0]; k < run[0] + run2[1]; k++) claimed[k] = true;
        placed = true;
      }
      if (!placed && reason) skipped[reason]++;
      runSquat();
    }
  }

  // `served` counts REGIONS with at least one wall, because a region can now
  // yield several -- subtracting a prop count from a region count would say a
  // part with one region and three walls had "-2 unserved".
  return { triangles: out, props, skipped, served: servedRegions.size,
           servedRegions: [...servedRegions],
           tines: tineTotal, sagRisk,
           volume: props.reduce((s, q) => s + q.volume, 0) };
}
