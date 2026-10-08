/**
 * TIES -- a zigzag of struts between two neighbouring walls (local issue 036).
 *
 * The fill pass serves a figure with a forest of thin walls, each standing on its
 * own (Matthew 2026-10-08: "all the fins become a mess"). Ribs (brace.js) widen each
 * wall's footing; a tie makes two walls one frame. From the plate at wall A a strut
 * climbs to wall B, the next climbs back to A, and so on: a Warren truss in the
 * vertical plane through both walls. Every strut rises TIE.slope (55deg) -- steeper
 * than the 45deg a printer holds without support -- and each starts on the plate or
 * on the strut before it, so nothing in a tie bridges or hangs.
 *
 * Struts stop under the lower wall's tip taper (1 mm under it, as ribs do) and at
 * TIE.rise of its height, so the contact, the gap and the tines are untouched. Each
 * end runs th/2 into its wall (overlapping solids, never flush). A tie is built only
 * where the part stays sideClear off every strut, from both walls' plate stations
 * (v1: no ties landing on the part), and only if `clear(tris)` (the caller's check
 * against the other supports) passes.
 */
import { boxExtrude } from '../solids.js';
import { PROP } from './config.js';
import { surfaceZsAt } from './surface.js';

export const TIE = {
  slope: Math.tan((55 * Math.PI) / 180), // rise per run: 55deg, steeper than the 45deg a printer holds
  thick: 1.2,     // mm: a strut's depth, measured straight up
  minSpan: 2.0,   // mm: closer than this the two walls' feet already meet
  maxSpan: 12.0,  // mm: farther than this a strut is a wall of its own
  minHeight: 8,   // mm: a wall shorter than this stands without help
  rise: 0.7,      // ties stop at this share of the lower wall's height
  perWall: 2,     // ties a wall takes part in, nearest neighbours first
  step: 0.25,     // mm: part clearance sampled this finely along a strut
};

/** Does the part come within sideClear of the strut from (u0, z0) to (u1, z1) (bottom
 *  edge; TIE.thick deep), or sit around it? Frame: u from `o` along `d`, v across. */
function strutHitsPart(tris, o, d, u0, z0, u1, z1) {
  const w = PROP.th / 2 + PROP.sideClear, c = PROP.sideClear;
  const nu = Math.max(1, Math.ceil(Math.abs(u1 - u0) / TIE.step)), nv = Math.ceil(2 * w / TIE.step);
  for (let i = 0; i <= nu; i++) {
    const u = u0 + (u1 - u0) * i / nu, zb = z0 + (z1 - z0) * i / nu, zt = zb + TIE.thick;
    for (let k = 0; k <= nv; k++) {
      const v = -w + 2 * w * k / nv;
      const x = o[0] + d[0] * u + d[1] * v, y = o[1] + d[1] * u - d[0] * v;
      let above = 0;
      for (const z of surfaceZsAt(tris, x, y)) {
        if (z >= zb - c && z <= zt + c) return true;
        if (z > zt) above++;
      }
      if (above % 2) return true;                 // inside the part
    }
  }
  return false;
}

/**
 * The tie between plan points `a` (on wall A's line) and `b` (on wall B's), both
 * standing on the plate at zBed, under `zMax` (the lower wall's limit). Appends the
 * struts to `out` and returns how many, or 0 (out untouched) when none fits.
 */
export function tieWalls(a, b, zMax, tris, zBed, out) {
  const dx = b[0] - a[0], dy = b[1] - a[1], span = Math.hypot(dx, dy);
  if (span < TIE.minSpan || span > TIE.maxSpan) return 0;
  const d = [dx / span, dy / span], o = [a[0], a[1]];
  const climb = span * TIE.slope;                 // one strut's rise
  const n = Math.floor((zMax - zBed - TIE.thick) / climb);
  if (n < 1) return 0;
  const struts = [];
  for (let s = 0; s < n; s++) {
    // even struts A -> B, odd B -> A; each starts where the last one ended
    const [u0, u1] = s % 2 ? [span, 0] : [0, span];
    const z0 = zBed + s * climb, z1 = z0 + climb;
    if (strutHitsPart(tris, o, d, u0, z0, u1, z1)) return 0;
    struts.push([u0, z0, u1, z1]);
  }
  const h = PROP.th / 2;
  for (const [u0, z0, u1, z1] of struts) {
    // th/2 into each wall at both ends (overlapping solids), along the strut's slope
    const s = Math.sign(u1 - u0), e0 = u0 - s * h, e1 = u1 + s * h;
    const zAt = (u) => z0 + (z1 - z0) * (u - u0) / (u1 - u0);
    const lo = Math.max(zBed, zAt(e0));
    // (u, z) parallelogram, extruded across: frame (u, z, v) right-handed, v = u x z
    const poly = s > 0
      ? [[e0, lo], [e1, zAt(e1)], [e1, zAt(e1) + TIE.thick], [e0, lo + TIE.thick]]
      : [[e1, zAt(e1)], [e0, lo], [e0, lo + TIE.thick], [e1, zAt(e1) + TIE.thick]];
    boxExtrude(poly, -h, h, (p, q, r) => [o[0] + d[0] * p + d[1] * r, o[1] + d[1] * p - d[0] * r, q], out);
  }
  return struts.length;
}
