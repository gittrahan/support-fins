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
 * lives in app.js; this module turns two surface points plus the part's triangles
 * into a watertight wall, reusing prop.js's proven `sweep` and its three
 * line-settling passes verbatim.
 */
import { PROP, sweep, sweepBetween, floorLine, contourTop, lowerSag, settleTop } from './prop.js';

// How far below the clicked overhang a settle pass may still pull the top down
// when probing for a part-attached support. Comfortably covers an overhang's own
// slope over a wall's length, and stays well under the smallest floor-to-overhang
// gap worth supporting -- so the top settles on the overhang, never its floor.
const PART_BAND = 3.0;

/**
 * Every surface height directly above (x, y), as a list.
 *
 * `surfaceZAt` in prop.js returns only the LOWEST, which is what an auto-placer
 * wants (the underside a wall props to). A hand-drawn wall instead wants the
 * surface the user actually clicked, so this keeps them all and the caller picks
 * the one nearest the line the user drew -- otherwise a wall under a shallow
 * overhang would jump down to whatever plate-resting geometry shares its (x, y).
 */
function surfaceZsAt(tris, x, y) {
  const zs = [];
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
    zs.push(l1 * az + l2 * bz + l3 * cz);
  }
  return zs;
}

/**
 * The contact polyline for a wall drawn from `a` to `b` (both surface points in
 * PRINT space, [x, y, z]). Straight in XY by construction. Each station's height
 * is the part surface nearest the line the user drew -- not the global lowest,
 * which would jump to another feature -- and then the three prop.js passes pull
 * the top to a clean `gap` below the part exactly as the auto-placer does.
 */
export function drawnLine(a, b, tris, step = PROP.stationStep, band = Infinity) {
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
    for (const zz of surfaceZsAt(tris, x, y)) {
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
 * Build one drawn breakaway wall. Returns `{ ok: true, tris, length, height }`
 * or `{ ok: false, reason }` with a message the UI can show -- a hand-drawn wall
 * that can't be built should say WHY (too short, at the plate) rather than
 * silently doing nothing, the failure mode M5's scoreboard was built on.
 */
export function drawnWall(a, b, tris, zBed = 0) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < PROP.minSpan) {
    return { ok: false, reason: `wall too short — ${len.toFixed(0)}mm, needs ${PROP.minSpan}mm` };
  }
  const out = [];
  // PART-ATTACHED first: if solid part sits below the overhang, the support
  // stands on THAT, not the plate. Probe with a BANDED top contour so the
  // overhang isn't settled down onto the very floor we're looking for; floorLine
  // then returns the nearest surface below each station (0 where the path to the
  // plate is open). A real floor anywhere along the line routes the whole wall
  // through sweepBetween, whose bottom is the per-station floor -- bed stations
  // degrade to z=0 on their own. This is what stops the "marched past the part
  // straight to the plate" bug: on the over-the-part case sweep-to-plate SUCCEEDS
  // and silently builds the tall stilt, so the fix must PREFER the floor.
  const topPA = drawnLine(a, b, tris, PROP.stationStep, PART_BAND);
  if (topPA && topPA.length >= PROP.minStations) {
    const floor = floorLine(topPA, tris);
    let floorMax = 0;
    for (const p of floor) if (p[2] > floorMax) floorMax = p[2];
    if (floorMax > PROP.gap + 0.5 && sweepBetween(topPA, floor, out)) {
      let height = 0;
      for (let i = 0; i < topPA.length; i++) {
        height = Math.max(height, (topPA[i][2] - PROP.gap) - floor[i][2]);
      }
      return { ok: true, tris: out, length: len, height, partAttached: true };
    }
  }

  const line = drawnLine(a, b, tris);
  if (!line || line.length < PROP.minStations) {
    return { ok: false, reason: 'no surface found along that line' };
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
  return { ok: true, tris: out, length: len, height };
}
