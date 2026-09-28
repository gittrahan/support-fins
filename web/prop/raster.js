/**
 * Raster placement: walls across a region's WHOLE footprint, the way a slicer's
 * grid support stands, raced against the patch/tube placement region by region.
 *
 * Why. A wall's top already follows whatever surface is above it (contourTop,
 * settleTop), so a wall does not need a straight or flat overhang -- only a
 * straight track in PLAN. What held curved parts back was placement: a curved
 * region got ONE wall under its lowest line (tubeLine), and anything else was
 * split into 15-degree patches (splitRegion) with every patch under 12 mm2
 * dropped. The dome ceiling example got 2 walls and 34% of its area held with no
 * skips at all -- nothing refused, the placer simply never tried a second wall.
 * Laying parallel tracks at the row pitch across the whole region, the way a
 * grid support does, took it to 75% (bowl 24 -> 75, torus X30 4 -> 54, the real
 * bear upright 0 -> 57; spike in prototype/raster/, local issue 008).
 *
 * Why a race and not a replacement. Raster alone LOSES on real tubes: a pipe on
 * its side wants one wall under its lowest line, and parallel tracks across it
 * land on its flanks (hook 98 -> 36%, vase_flare X30 93 -> 59%). So buildProps
 * builds the normal pass, then a raster pass over only the regions the normal
 * pass left partly bare (`rasterWanted`), and `raceRegions` keeps, per region,
 * whichever holds more overhang area -- by a margin, so a region the normal pass
 * already holds does not swap one clean wall for several stepped pieces for a
 * sliver more area (the real gree figure's arm, measured in the spike).
 *
 * Split out of prop.js, which only wires the two passes together.
 */
import { floorLine } from './attached.js';
import { PROP } from './config.js';
import { seat } from './surface.js';
import { footFor } from './sweep.js';
import { patchTracks } from './tracks.js';

// A raster region replaces the normal one only if it holds this much more
// overhang area: RACE_REL of the normal pass's held area, and at least
// RACE_ABS mm2. Equal-ish coverage keeps the normal pass's fewer, longer walls.
export const RACE_REL = 0.10;
export const RACE_ABS = 5.0;
// A region the normal pass already holds this much of (own faces) is not
// rebuilt as raster -- there is nothing left to win.
export const RASTER_SKIP_HELD = 0.95;
// A swap may not raise a region's lowest grip by more than this (mm): the
// lowest tine is what holds the part while it is still short and least stable,
// and prototype/sweep/compare.js blocks on it rising 0.1 mm.
export const GRIP_RISE = 0.1;

/**
 * The raster tracks for one region: parallel straight tracks at `rowSpan`
 * across its whole footprint (patchTracks on the region, not on a patch), each
 * cut where the region has no face above it and where the floor under it
 * changes between plate and part, so every piece goes down exactly one of the
 * plate path or the part-attached path. The raster pass then keeps every
 * usable run of a track, not just the longest (see rasterRest).
 */
export function rasterTracks(regionPts, regionTris, partTris, step, rowSpan, support) {
  const lines = [];
  for (const t of patchTracks(regionPts, regionTris, step, support, rowSpan)) {
    // floorLine's plate/part split, the same test buildPartAttached counts with
    const floor = floorLine(t, partTris);
    let cur = [], cls = null;
    for (let k = 0; k < t.length; k++) {
      const onPart = floor[k][2] > PROP.gap + 0.5;
      if (cls !== null && onPart !== cls) {
        if (cur.length >= PROP.minStations) lines.push(cur);
        cur = [];
      }
      cls = onPart;
      cur.push(t[k]);
    }
    if (cur.length >= PROP.minStations) lines.push(cur);
  }
  return lines;
}

/**
 * A raster track crosses the part and other obstacles, so its longest usable
 * run is rarely all of it: the pieces either side of `run` get their own try.
 * Returns them (each at least minStations long), marked `rest` so a piece that
 * turns out unusable is not counted as a second skip for the same track, and
 * with `from`, the index its first station had in `line` -- the caller claims
 * those stations off `line`'s squat pass, since the piece runs its own.
 */
export function rasterRest(line, run) {
  const rest = [];
  for (const [a, b] of [[0, run[0]], [run[1], line.length]]) {
    if (b - a < PROP.minStations) continue;
    const piece = line.slice(a, b);
    piece.rest = true;
    piece.from = a;
    rest.push(piece);
  }
  return rest;
}

/**
 * Overhang faces seated once: [cx, cy, cz, area, region] per face.
 */
function overhangFaces(topo, result, rot) {
  const { pos } = topo, off = result.offset, v = [0, 0, 0], faces = [];
  result.regions.forEach((g, ri) => {
    for (const f of g.faces) {
      let cx = 0, cy = 0, cz = 0;
      for (let i = 0; i < 3; i++) {
        seat(pos, f * 9 + i * 3, rot, off, v);
        cx += v[0] / 3; cy += v[1] / 3; cz += v[2] / 3;
      }
      faces.push([cx, cy, cz, topo.area[f], ri]);
    }
  });
  return faces;
}

/**
 * Overhang area held by wall TOPS `tops`: a top point within half the
 * maxUnsupportedSpan in plan and 0-1.5 mm below the face (prototype/examples/
 * probe.js's rule). Tops, not every support vertex as rival.js counts: a wall's
 * base flange sits within 3 mm of any low face around it, and on the torus at
 * X45 that credited a low ledge to a wall 9 mm away that never reaches it.
 * `faces` is the set judged (a region's own, or every face near it).
 */
function heldBy(faces, tops) {
  const reach = PROP.maxUnsupportedSpan / 2;
  let held = 0;
  for (const [cx, cy, cz, a] of faces) {
    for (const p of tops) {
      const dz = cz - p[2];
      if (dz >= -0.05 && dz <= 1.5 && Math.hypot(p[0] - cx, p[1] - cy) <= reach) {
        held += a;
        break;
      }
    }
  }
  return held;
}

// every wall's top line (surface minus gap), the points heldBy measures from
const wallTops = (qs) => qs.flatMap((q) => q.line ?? []);

// Half-width of a wall's footprint on whatever it stands on: a squat wall's
// brim, a part-attached wall's own thickness, a plate wall's flange.
const halfFoot = (q) => (q.squat ? PROP.squatBrimW
  : q.partAttached ? PROP.th / 2 : footFor(q.height ?? 0));

// The lowest point a set of walls grips from: each wall's lowest tine vertex
// (`grip`, recorded by buildProps as it emits them). Infinity = no tines.
const gripZ = (qs) => Math.min(Infinity, ...qs.map((q) => q.grip ?? Infinity));

// Closest approach of two walls' centrelines in PLAN.
function planGap(l1, l2) {
  const seg = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
    const t = L > 1e-12 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0;
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  };
  let d = Infinity;
  for (const [P, Q] of [[l1, l2], [l2, l1]]) {
    for (const p of P) {
      if (Q.length === 1) d = Math.min(d, Math.hypot(p[0] - Q[0][0], p[1] - Q[0][1]));
      for (let i = 0; i + 1 < Q.length; i++) d = Math.min(d, seg(p, Q[i], Q[i + 1]));
    }
  }
  return d;
}

const byRegion = (props) => {
  const m = new Map();
  for (const q of props) {
    if (!m.has(q.region)) m.set(q.region, []);
    m.get(q.region).push(q);
  }
  return m;
};

/**
 * buildProps's second half: given the normal pass, run the raster pass over the
 * regions it left partly bare (`rasterPass(regions)` is buildProps's own pass
 * builder) and race them. Returns `normal` itself when nothing swaps, so a part
 * the raster pass cannot improve builds byte-identical to the normal pass.
 *
 * opts.rasterVeto (auto mode: fins/wedges.js wedgeVeto) drops raster walls that
 * would take a wedge's face before the race sees them.
 *
 * The tests' tine capture (globalThis.__TINECAP, see tines.js) must end up
 * holding the KEPT walls' tines only: each pass captures into its own array,
 * every wall records its slice (`caps`), and the kept slices go back.
 */
export function withRaster(topo, result, rot, opts, normal, rasterPass) {
  const faces = overhangFaces(topo, result, rot);
  const want = rasterWanted(faces, result, normal);
  if (!want.size) return normal;
  const cap = globalThis.__TINECAP;
  const capNormal = cap ? cap.slice() : null;
  if (cap) globalThis.__TINECAP = [];
  const raster = rasterPass(want);
  const capRaster = globalThis.__TINECAP;
  globalThis.__TINECAP = cap;
  if (opts.rasterVeto) raster.props = raster.props.filter((q) => !opts.rasterVeto(q, normal.props));
  const raced = raceRegions(faces, result, normal, raster);
  if (!raced.rasterRegions) return normal;
  if (cap) {
    cap.length = 0;
    for (const q of raced.props) if (q.caps) cap.push(...(q.raster ? capRaster : capNormal).slice(...q.caps));
  }
  return raced;
}

/**
 * The regions worth a raster pass: those the normal pass `a` holds less than
 * RASTER_SKIP_HELD of (own faces, by its own walls and every other wall).
 */
function rasterWanted(faces, result, a) {
  const tops = wallTops(a.props);
  const want = new Set();
  for (let ri = 0; ri < result.regions.length; ri++) {
    const own = faces.filter((f) => f[4] === ri);
    let area = 0;
    for (const f of own) area += f[3];
    if (area > 0 && heldBy(own, tops) < RASTER_SKIP_HELD * area) want.add(ri);
  }
  return want;
}

/**
 * Every overhang face within reach of region `ri` (its bbox grown by two spans):
 * a wall under one region holds its neighbours too, so the race judges them all.
 */
function nearRegion(faces, ri) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const f of faces) {
    if (f[4] !== ri) continue;
    x0 = Math.min(x0, f[0]); x1 = Math.max(x1, f[0]);
    y0 = Math.min(y0, f[1]); y1 = Math.max(y1, f[1]);
  }
  const reach = 2 * PROP.maxUnsupportedSpan;
  return faces.filter((f) => f[0] >= x0 - reach && f[0] <= x1 + reach
                          && f[1] >= y0 - reach && f[1] <= y1 + reach);
}

/**
 * The normal-pass walls `qa` a region swapped to raster (`qb`) still keeps, or
 * null when the swap must not happen.
 *
 * Kept: any normal wall that stands clear of every kept wall (feet + 1 mm apart
 * in plan, so no two fuse) and either holds area they miss or grips lower than
 * they do. Torus X45: the raster rows missed a low ledge the normal pass's squat
 * wall held (69 mm2); bore_bracket X45: they dropped the wall whose tines gripped
 * 1.2 mm off the bed for one gripping from 22.9 mm. The swap must trade neither.
 * If the region's lowest grip still rises past GRIP_RISE, no swap.
 */
function keepers(qa, qb, near) {
  const kept = [...qb], extra = [];
  const bare = near.filter((f) => !heldBy([f], wallTops(kept)));
  const clear = (q) => kept.every((r) => planGap(q.line ?? [], r.line ?? []) >= halfFoot(q) + halfFoot(r) + 1);
  // lowest-gripping first, so a low wall claims its spot before a neighbour
  const order = [...qa].sort((x, y) => gripZ([x]) - gripZ([y]));
  for (const q of order) {
    if (!q.line?.length || !clear(q)) continue;
    const addsArea = heldBy(bare, q.line) >= RACE_ABS;
    const addsGrip = gripZ([q]) < gripZ(kept) - GRIP_RISE;
    if (!addsArea && !addsGrip) continue;
    extra.push(q);
    kept.push(q);
    for (let i = bare.length - 1; i >= 0; i--) if (heldBy([bare[i]], q.line)) bare.splice(i, 1);
  }
  return gripZ(kept) > gripZ(qa) + GRIP_RISE ? null : extra;
}

/**
 * Per region, keep the normal pass `a` or the raster pass `b` (plus the normal
 * walls `keepers` saves): the raster pass must hold RACE_REL / RACE_ABS more of
 * the faces near the region. Returns buildProps's shape, with `rasterRegions` =
 * how many regions swapped.
 *
 * `skipped` stays the normal pass's: a region the raster pass rescued may still
 * be counted as skipped there. Over-reporting a skip is the safe direction --
 * the readout never claims a region was served that wasn't.
 */
function raceRegions(faces, result, a, b) {
  const A = byRegion(a.props), B = byRegion(b.props);
  const out = [], props = [], served = new Set();
  let tines = 0, volume = 0, swapped = 0, sagRisk = a.sagRisk;
  const take = (build, q) => {
    const triRanges = [];
    for (const [s, e] of q.triRanges) {
      const r0 = out.length;
      for (let i = s; i < e; i++) out.push(build.triangles[i]);
      triRanges.push([r0, out.length]);
    }
    props.push({ ...q, id: props.length, triRanges, raster: build === b });
    served.add(q.region);
    tines += q.tines ?? 0;
    volume += q.volume ?? 0;
  };
  for (let ri = 0; ri < result.regions.length; ri++) {
    const qa = A.get(ri) ?? [], qb = B.get(ri) ?? [];
    let extra = null;
    if (qb.length) {
      const near = nearRegion(faces, ri);
      const ha = qa.length ? heldBy(near, wallTops(qa)) : 0;
      const hb = heldBy(near, wallTops(qb));
      if (hb > ha + Math.max(RACE_ABS, RACE_REL * ha)) extra = keepers(qa, qb, near);
    }
    if (!extra) { for (const q of qa) take(a, q); continue; }
    swapped++;
    sagRisk ||= b.sagRisk;
    for (const q of qb) take(b, q);
    for (const q of extra) take(a, q);
  }
  return { triangles: out, props, skipped: a.skipped, served: served.size,
           servedRegions: [...served], tines, sagRisk, volume, rasterRegions: swapped };
}
