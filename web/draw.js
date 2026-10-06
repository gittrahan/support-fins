/**
 * DRAW MODE -- the user hands the tool one contact line and it sweeps ONE
 * breakaway wall along it.
 *
 * This is exactly how tools/support/breakaway.py works in the video repo: a
 * human places one wall per feature, so the wall's contact line is GIVEN, never
 * guessed. That is the whole reason breakaway.py's output was always cleaner than
 * the auto-placer's -- the sweep was never the fragile part, GUESSING a contact
 * line for a 2D overhang region was. On a square face the auto-placer fit a PCA
 * axis to a near-isotropic footprint and the eigenvector snapped to ~45deg, so
 * the walls ran diagonally across the face and self-intersected. A line the user
 * draws is straight in XY by construction; there is nothing left to snap.
 *
 * Geometry only. The interaction (picking the two endpoints, live preview, undo)
 * lives in ui/walls.js; this module turns two surface points plus the part's triangles
 * into a watertight wall, reusing prop/sweep.js's proven `sweep` and its three
 * line-settling passes verbatim.
 */
import { PROP, PART_BAND, footFor, surfaceZsAt as gridZsAt, surfaceHitsAt as gridHitsAt, sweep, sweepBetween, sweepSquat, floorLine, moldLine, contourTop, lowerSag, settleTop, emitTines, tineStepFor } from './prop.js';

/**
 * A hand-drawn wall may be much shorter than an auto wall (PROP.minSpan, 7 mm): the user
 * is pointing at one small overhang -- a cleat, a fingertip, a chin -- that no auto
 * wall reaches. 2 mm still gives the three stations a sweep needs (local issue 011).
 */
export const DRAW_MIN_LEN = 2;

/**
 * Every surface height directly above (x, y), as a list.
 *
 * `surfaceZAt` in prop/surface.js returns only the LOWEST, which is what an auto-placer
 * wants (the underside a wall props to). A hand-drawn wall instead wants the
 * surface the user actually clicked, so this keeps them all and the caller picks
 * the one nearest the line the user drew -- otherwise a wall under a shallow
 * overhang would jump down to whatever plate-resting geometry shares its (x, y).
 */
function surfaceZsAt(tris, x, y) {
  return surfaceHits(tris, x, y).map((h) => h[0]);
}

/** ...and with each, its normal's z (unit): [z, nz]. The full-wall checks (local issue
 * 033) ask about surfaces, not parity: a mesh built from bodies touching face to face
 * (bridge.stl's deck on its piers) carries coincident inner faces, and an inside/outside
 * count through them reads air as solid. */
function surfaceHits(tris, x, y) {
  const hits = [];
  for (let i = 0; i < tris.length; i += 9) {
    const ax = tris[i], ay = tris[i + 1], az = tris[i + 2];
    const bx = tris[i + 3], by = tris[i + 4], bz = tris[i + 5];
    const cx = tris[i + 6], cy = tris[i + 7], cz = tris[i + 8];
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(den) < 1e-12) continue;
    const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / den;
    const l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / den;
    const l3 = 1 - l1 - l2;
    if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    hits.push([l1 * az + l2 * bz + l3 * cz, nz / (Math.hypot(nx, ny, nz) || 1)]);
  }
  return hits;
}

/**
 * Is (x, y, z) inside the part? Odd number of surfaces below it in that column. The
 * squat fallback has no clearance probe of its own (Auto's stationIsClear needs the
 * topology), and at 0.6 mm of headroom a line on an UPWARD face reads that face as its
 * floor -- so it checks the solid directly.
 */
function solidAt(tris, x, y, z) {
  // a column through a shared edge hits both triangles: one surface, counted once
  const zs = surfaceZsAt(tris, x, y).filter((zz) => zz < z).sort((p, q) => p - q);
  let n = 0;
  for (let i = 0; i < zs.length; i++) if (i === 0 || zs[i] - zs[i - 1] > 1e-5) n++;
  return n % 2 === 1;
}

/** Each station sits under a DOWN-facing surface: air just below it and part within
 * half a mm above (the settle passes leave a top a little under the underside). */
function underAnOverhang(line, tris) {
  return line.every((p) => !solidAt(tris, p[0], p[1], p[2] - 0.02)
    && [0.02, 0.1, 0.25, 0.5].some((d) => solidAt(tris, p[0], p[1], p[2] + d)));
}

/** Does an interior station lie ON the part -- the surface it touches facing up? A line
 * drawn on an upward face does; one under an overhang touches a face looking down. Not
 * the end stations: Auto and the user put those on the overhang's edge. */
function onThePart(line, tris) {
  return line.some((p, i) => {
    if (i === 0 || i === line.length - 1) return false;
    let best = null;
    for (const h of surfaceHits(tris, p[0], p[1])) {
      if (Math.abs(h[0] - p[2]) < 0.5 && (!best || Math.abs(h[0] - p[2]) < Math.abs(best[0] - p[2]))) best = h;
    }
    return best !== null && best[1] > 0;
  });
}

/** Does part surface cross z0..z1(i) anywhere under the wall, w(i) either side of its
 * centre line? A body resting on the plate beside a plate wall's flange puts its bottom
 * face in the flange's band; one standing in its stem, a side face. Sampled every
 * BAND_STEP along and across -- at the stations alone, a pin 0.5 mm thick slipped
 * between them -- through prop.js's gridded surfaceZsAt (a mini has ~1M faces). */
const BAND_STEP = 0.25;
function bandHitsPart(line, tris, w, z0, z1) {
  for (let i = 0; i + 1 < line.length; i++) {
    const p = line[i], q = line[i + 1];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (len < 1e-9) continue;
    const rx = (q[0] - p[0]) / len, ry = (q[1] - p[1]) / len;
    const wi = Math.max(w(i), w(i + 1)), top = Math.max(z1(i), z1(i + 1));
    const na = Math.ceil(len / BAND_STEP), nc = Math.ceil(2 * wi / BAND_STEP);
    for (let s = 0; s <= na; s++) for (let k = 0; k <= nc; k++) {
      const t = len * s / na, o = -wi + 2 * wi * k / nc;
      for (const z of gridZsAt(tris, p[0] + rx * t + ry * o, p[1] + ry * t - rx * o)) {
        if (z >= z0 && z <= top) return true;
      }
    }
  }
  return false;
}

/** Points across a wall at each station, `w` either side of its centre line, at height z(i). */
function acrossClear(line, tris, w, z) {
  for (let i = 0; i < line.length; i++) {
    const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)];
    let rx = b[0] - a[0], ry = b[1] - a[1];
    const rn = Math.hypot(rx, ry);
    if (rn < 1e-9) return false;
    rx /= rn; ry /= rn;
    for (const o of [-w, -w / 2, 0, w / 2, w]) {
      if (solidAt(tris, line[i][0] + ry * o, line[i][1] - rx * o, z(i))) return false;
    }
  }
  return true;
}

/**
 * The contact polyline for a wall drawn from `a` to `b` (both surface points in
 * PRINT space, [x, y, z]). Straight in XY by construction. Each station's height
 * is the part surface nearest the line the user drew -- not the global lowest,
 * which would jump to another feature -- and then the three prop/contact.js passes pull
 * the top to a clean `gap` below the part exactly as the auto-placer does. `under`
 * limits the pick to down-facing surfaces (the fill pass; see below).
 */
export function drawnLine(a, b, tris, step = PROP.stationStep, band = Infinity, under = false) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;
  const n = Math.max(PROP.minStations - 1, Math.ceil(len / step));
  const line = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const x = a[0] + dx * t, y = a[1] + dy * t;
    const hint = a[2] + (b[2] - a[2]) * t;   // the height the drawn line implies here
    let z = hint, best = Infinity;
    // `under`: only surfaces facing DOWN. A column through a leaning figure meets its
    // back (the underside, red) and its front; on a curved back the straight-line
    // hint lands nearer the front, so a long wall the fill pass laid down a spine
    // read "faces up" at every station. A hand-drawn line keeps the nearest of all.
    // (Through prop's grid: the fill pass runs this per candidate line, and a linear
    // scan per station was minutes on a 1M-face mini.)
    const zs = under ? gridHitsAt(tris, x, y).filter((h) => h[1] < 0).map((h) => h[0]) : surfaceZsAt(tris, x, y);
    for (const zz of zs) {
      const d = Math.abs(zz - hint);
      if (d < best) { best = d; z = zz; }
    }
    line.push([x, y, z]);
  }
  // `band` bounds every settle pass to surfaces within `band` of the clicked
  // overhang, so an over-the-part overhang isn't dragged down onto its own floor
  // (the collapse that made part-attached supports impossible). Infinity keeps
  // the bed-attached behaviour exactly.
  contourTop(line, tris, band);
  lowerSag(line, tris, band);
  settleTop(line, tris, 0.25, band);
  return line;
}

/**
 * Build one drawn breakaway wall. Returns `{ ok: true, tris, length, height, top }`
 * (`top`: the wall's contact line, the surface-z stations its top follows).
 * `opts.under`: follow only down-facing surfaces (drawnLine) -- the fill pass's walls.
 * or `{ ok: false, reason }` with a message the UI can show -- a hand-drawn wall
 * that can't be built should say WHY (too short, at the plate) rather than
 * silently doing nothing, the failure mode M5's scoreboard was built on.
 */
export function drawnWall(a, b, tris, zBed = 0, opts = {}) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < DRAW_MIN_LEN) {
    return { ok: false, reason: `wall too short — ${len.toFixed(1)}mm, needs ${DRAW_MIN_LEN}mm` };
  }
  const out = [];
  // A drawn wall grips the part with the same tine comb the auto fins use, when
  // Tines is on. emitTines needs the part in topology form (for bite direction), so
  // it only runs when the caller passes topo/rot/offset -- the live preview omits
  // them and stays a plain wall for speed. `topLine` is the wall's surface-z contact
  // line (emitTines subtracts the gap itself).
  // (`minTop`: a squat plate wall's base is its thin brim, so its tines start from
  // squatBrimH, as Auto's squat walls do -- the flange default would skip every one)
  const withTines = (line, minTop = undefined) => opts.tines && opts.topo
    ? emitTines(line, tris, opts.topo, opts.rot, opts.offset, out,
                tineStepFor(opts.tineDensity), minTop, opts.layerHeight ?? PROP.tineH)
    : 0;
  // PART-ATTACHED first: if solid part sits below the overhang, the support
  // stands on THAT, not the plate. Probe with a BANDED top contour so the
  // overhang isn't settled down onto the very floor we're looking for; floorLine
  // then returns the nearest surface below each station (0 where the path to the
  // plate is open). A real floor anywhere along the line routes the whole wall
  // through sweepBetween, whose bottom is the per-station floor -- bed stations
  // degrade to z=0 on their own. This is what stops the "marched past the part
  // straight to the plate" bug: on the over-the-part case sweep-to-plate SUCCEEDS
  // and silently builds the tall stilt, so the fix must PREFER the floor.
  const topPA = drawnLine(a, b, tris, PROP.stationStep, PART_BAND, !!opts.under);
  // ...unless the line lies ON the part: drawn on an UPWARD face (the UI lets you
  // click one), it read the part's own underside as its floor and stood the wall
  // inside the part, floor to top (local issue 033: a sphere's top, 296-384
  // vertices in). That line falls through to the plate wall below.
  if (topPA && topPA.length >= PROP.minStations && !onThePart(topPA, tris)) {
    const floor = floorLine(topPA, tris);
    let floorMax = 0;
    for (const p of floor) if (p[2] > floorMax) floorMax = p[2];
    const mold = floorMax > PROP.gap + 0.5 ? moldLine(topPA, tris) : null;
    if (mold && sweepBetween(mold.top, mold.floor, out)) {
      let height = 0;
      for (let i = 0; i < topPA.length; i++) {
        height = Math.max(height, (topPA[i][2] - PROP.gap) - floor[i][2]);
      }
      const tines = withTines(topPA);
      return { ok: true, tris: out, length: len, height, partAttached: true, tines, top: topPA };
    }
  }

  const line = drawnLine(a, b, tris, PROP.stationStep, Infinity, !!opts.under);
  if (!line || line.length < PROP.minStations) {
    return { ok: false, reason: 'no surface found along that line' };
  }
  // The flange and the stem must clear the part beside the line (Auto's clearance
  // pass measures the same profile): drawn beside a body resting on the plate, the
  // flange reached 0.4-1.1 mm into it (local issue 033). Checked before sweep writes.
  const top = (i) => line[i][2] - PROP.gap - zBed;
  if (line.every((p, i) => top(i) >= PROP.minHeight)
      && (bandHitsPart(line, tris, (i) => footFor(top(i)), zBed - 0.01, () => zBed + PROP.baseH + PROP.gap)
       || bandHitsPart(line, tris, () => PROP.th / 2, zBed - 0.01, (i) => zBed + top(i) / 2))) {
    return { ok: false, reason: 'too close to the part — the wall’s foot would cut '
      + 'into it; draw the line a little further out' };
  }
  // Reaching here means no real floor was found below the overhang, so this is a
  // plate-attached wall. `sweep` returns false when any station is shorter than
  // PROP.minHeight, and two situations produce that:
  //   - the drawn line genuinely sits near the plate (drawn by a resting edge);
  //   - the user pointed at a real overhang HIGH above the bed, but other part
  //     geometry sits directly under it, so contourTop/settleTop pull the wall
  //     top down to that lower surface and it collapses.
  // The over-the-part case (the L-bracket boss over its base) is now handled by
  // the part-attached branch above, which stands on that lower surface instead of
  // collapsing -- so a failure here that still LOOKS over-the-part means the floor
  // was out of reach (too thin a gap to seat a wall), not that we ignore it.
  // The clicked endpoints' heights are exactly "what the user pointed at", so a
  // high clickTop with a failed sweep is the unreachable case, not a low line.
  if (!sweep(line, zBed, out)) {
    // Neither full-height wall fits. Before refusing, the two SQUAT walls a user
    // drawing by hand can still want (local issue 011) -- tried only now, so every
    // drawn wall that built before builds exactly the same:
    //   - on the part, with as little as minHeightSquat headroom (a hand just over a thigh);
    //   - on the plate, its low stations a brimmed squat stem, the tall ones the full wall.
    const squat = squatWall(topPA, line, tris, zBed);
    if (squat) {
      out.push(...squat.tris);
      const tines = withTines(squat.top, squat.partAttached ? undefined : PROP.squatBrimH);
      return { ok: true, tris: out, length: len, height: squat.height, partAttached: squat.partAttached, squat: true, tines, top: squat.top };
    }
    const clickTop = Math.min(a[2], b[2]) - zBed;
    if (clickTop >= PROP.minHeight + PROP.gap) {
      return { ok: false, reason: 'this overhang sits above another part of the '
        + 'model, so a wall standing on the plate can’t reach it — rotate so it '
        + 'faces the plate' };
    }
    return { ok: false, reason: 'nothing to hold up there — the line sits at the plate' };
  }
  let height = 0;
  for (const p of line) height = Math.max(height, p[2] - PROP.gap - zBed);
  const tines = withTines(line);
  return { ok: true, tris: out, length: len, height, tines, top: line };
}

/**
 * The squat fallback for a drawn line no full-height wall fits: `{ tris, top, height,
 * partAttached }` or null. Part first (sweepBetween down to minHeightSquat of headroom --
 * in practice just over 1 mm of room, since floorLine skips surfaces within its 1 mm margin),
 * then the plate: stations from minHeightSquat to minHeight get a brimmed squat stem
 * (sweepSquat, what Auto builds near the bed), taller runs keep the flanged wall.
 * A station under minHeightSquat still refuses the whole line.
 */
function squatWall(topPA, line, tris, zBed) {
  if (topPA && topPA.length >= PROP.minStations && underAnOverhang(topPA, tris)) {
    const floor = floorLine(topPA, tris);
    // the wall's middle, between its floor and its top, is air (on an upward slope
    // the "floor" is the slope itself and this is solid)
    const midClear = acrossClear(topPA, tris, PROP.th / 2,
      (i) => (topPA[i][2] - PROP.gap + floor[i][2] + PROP.footGap) / 2);
    if (midClear && floor.some((p) => p[2] > PROP.gap + 0.5)) {
      const mold = moldLine(topPA, tris);
      const t = [];
      if (mold && sweepBetween(mold.top, mold.floor, t, PROP.minHeightSquat)) {
        let height = 0;
        for (let i = 0; i < topPA.length; i++) height = Math.max(height, topPA[i][2] - PROP.gap - floor[i][2]);
        return { tris: t, top: topPA, height, partAttached: true };
      }
    }
  }
  const h = line.map((p) => p[2] - PROP.gap - zBed);
  if (h.some((v) => v < PROP.minHeightSquat)) return null;
  // a plate wall stands only where the way down is clear: part under a station (too
  // close for the squat wall on it above) would put this one straight through it
  if (floorLine(line, tris).some((p) => p[2] > PROP.gap + 0.5)) return null;
  // ...and only under a real overhang, with room for the whole brim (squatBrimW either
  // side, wider than the stem floorLine looked under) and the stem beside the line
  if (!underAnOverhang(line, tris)) return null;
  // (probed at the brim's TOP plus the gap: under an underside that dips beside the
  // line, mid-height passed while the brim's top corner sat in the part -- torus)
  if (!acrossClear(line, tris, PROP.squatBrimW, () => zBed + PROP.squatBrimH + PROP.gap)) return null;
  if (!acrossClear(line, tris, PROP.th / 2, (i) => zBed + (line[i][2] - PROP.gap - zBed) / 2)) return null;
  // runs of tall (full wall) and low (squat) stations; a tall run under two stations
  // can't sweep, so it goes squat with its neighbours
  const tall = h.map((v) => v >= PROP.minHeight);
  for (let i = 0; i < tall.length; i++) {
    if (tall[i] && !tall[i - 1] && !tall[i + 1]) tall[i] = false;
  }
  const t = [];
  let i = 0;
  while (i < line.length) {
    let j = i;
    while (j + 1 < line.length && tall[j + 1] === tall[i]) j++;
    if (tall[i]) {
      if (!sweep(line.slice(i, j + 1), zBed, t)) return null;
    } else {
      // a squat run reaches TWO stations into each tall neighbour: the tall sweep ends at
      // its own first/last station, so one would only meet it face to face -- the pieces
      // must overlap, never sit flush (Fusion's weld). sweepSquat takes any h >= 0.6.
      const seg = line.slice(Math.max(0, i - 2), Math.min(line.length, j + 3));
      if (seg.length < 2 || !sweepSquat(seg, zBed, t)) return null;
    }
    i = j + 1;
  }
  return { tris: t, top: line, height: Math.max(...h), partAttached: false };
}
