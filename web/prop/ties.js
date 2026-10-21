/**
 * TIES -- a zigzag of struts between two neighbouring walls (local issue 036).
 *
 * The fill pass serves a figure with a forest of thin walls, each standing on its
 * own (Matthew 2026-10-08: "all the fins become a mess"). Ribs (brace.js) widen each
 * wall's footing; a tie makes two walls one frame. From the plate at wall A a strut
 * climbs to wall B, the next climbs back to A, and so on: a Warren truss in the
 * vertical plane through both walls. Every strut rises TIE.slope (60deg) -- steeper
 * than the 45deg a printer holds without support -- and each starts on the plate or
 * on the strut before it, so nothing in a tie bridges or hangs.
 *
 * Struts stop under the lower wall's tip taper (1 mm under it, as ribs do) and at
 * TIE.rise of its height, so the contact, the gap and the tines are untouched. Each
 * end runs TIE.into past its wall's centreline (overlapping solids, never flush; met
 * at a slant a corner can show through the far face, so the part clearance is checked
 * out to the ends). A tie is built only
 * where the part stays sideClear off every strut, from both walls' plate stations
 * (v1: no ties landing on the part), and only if `clear(tris)` (the caller's check
 * against the other supports) passes.
 */
import { boxExtrude } from '../solids.js';
import { PROP } from './config.js';
import { surfaceZsAt } from './surface.js';

export const TIE = {
  // rise per run: 60deg, well past the 45deg a printer holds, for the weaker ones
  // (#359: 55deg was cutting it fine on a fast bed slinger)
  slope: Math.tan((60 * Math.PI) / 180),
  // mm: a strut's thickness square to its run, at a 0.4 nozzle (nozzle.js grows it).
  // WAS 1.2 deep measured straight up -- ~0.7 square to a 55deg strut, under two 0.4
  // lines, so a 0.6 nozzle's slicer could drop it and a 35 mm strut flexed (#359)
  perp: 1.4,
  thick: 1.4 * Math.hypot(1, Math.tan((60 * Math.PI) / 180)),   // the same, straight up (2.8)
  slopeMax: Math.tan((75 * Math.PI) / 180),      // a tie steepens to reach the wall's top,
                                                 // no further: past this it barely braces
  minSpan: 2.0,   // mm: closer than this the two walls' feet already meet
  maxSpan: 12.0,  // mm: farther than this a strut is a wall of its own
  minHeight: 8,   // mm: a wall shorter than this stands without help
  rise: 0.7,      // ties stop at this share of the lower wall's height
  perWall: 2,     // ties a wall takes part in, nearest neighbours first
  step: 0.25,     // mm: part clearance sampled this finely along a strut
  into: 0.35,     // mm: a strut's end runs this far past each wall's centreline -- inside
                  // the wall (th/2 = 0.5) square on, never ending flush on its far face
};

/** Does the part come within sideClear of the strut from (u0, z0) to (u1, z1) (bottom
 *  edge; TIE.thick deep), or sit around it? Frame: u from `o` along `d`, v across. */
function strutHitsPart(tris, o, d, u0, z0, u1, z1, thick = TIE.thick) {
  const w = PROP.th / 2 + PROP.sideClear, c = PROP.sideClear;
  const nu = Math.max(1, Math.ceil(Math.abs(u1 - u0) / TIE.step)), nv = Math.ceil(2 * w / TIE.step);
  for (let i = 0; i <= nu; i++) {
    const u = u0 + (u1 - u0) * i / nu, zb = z0 + (z1 - z0) * i / nu, zt = zb + thick;
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
 * `maxSpan` is the farthest apart the walls may be (fins/ties.js ties Auto's wider
 * comb). `checkPart` false skips the part clearance -- the costly part -- for a
 * caller that rules the tie out more cheaply first, then builds it again checked.
 */
export function tieWalls(a, b, zMax, tris, zBed, out, maxSpan = TIE.maxSpan, checkPart = true) {
  const dx = b[0] - a[0], dy = b[1] - a[1], span = Math.hypot(dx, dy);
  if (span < TIE.minSpan || span > maxSpan) return 0;
  const d = [dx / span, dy / span], o = [a[0], a[1]];
  const e = TIE.into;
  // as many struts as fit at TIE.slope: the last strut's top, at its far end (TIE.into
  // past the wall), stays under zMax
  const n = Math.floor((zMax - zBed - TIE.thick - e * TIE.slope) / (span * TIE.slope));
  if (n < 1) return 0;
  // ...then steepen them to reach zMax, or a wide pair's one or two struts leave the
  // top half of the walls free (#359: 60deg across a 15 mm comb climbs 26 mm). Never
  // flatter than TIE.slope, and TIE.perp thick square to the run at any slope.
  let slope = TIE.slope, thick = TIE.thick;
  for (let k = 0; k < 8; k++) {
    slope = Math.min(TIE.slopeMax, Math.max(TIE.slope, (zMax - zBed - thick) / (n * span + e)));
    thick = TIE.perp * Math.hypot(1, slope);
  }
  // the last pass's thicker strut must still fit: settle the slope on it (only ever
  // flatter, so thinner straight up, and never under TIE.slope -- n fit there)
  slope = Math.max(TIE.slope, Math.min(slope, (zMax - zBed - thick) / (n * span + e)));
  thick = TIE.perp * Math.hypot(1, slope);
  const climb = span * slope;                     // one strut's rise
  const struts = [];
  for (let s = 0; s < n; s++) {
    // even struts A -> B, odd B -> A; each starts where the last one ended
    const [u0, u1] = s % 2 ? [span, 0] : [0, span];
    const z0 = zBed + s * climb, z1 = z0 + climb;
    // out to its ends: past each wall's centreline, where a slanted corner can show
    const g = s % 2 ? -1 : 1, rise = e * slope;
    if (checkPart && strutHitsPart(tris, o, d, u0 - g * e, Math.max(zBed, z0 - rise), u1 + g * e, z1 + rise, thick)) return 0;
    struts.push([u0, z0, u1, z1]);
  }
  const h = PROP.th / 2;
  for (const [u0, z0, u1, z1] of struts) {
    // TIE.into past each wall's centreline (overlapping solids), along the strut's slope
    const s = Math.sign(u1 - u0), e0 = u0 - s * e, e1 = u1 + s * e;
    const zAt = (u) => z0 + (z1 - z0) * (u - u0) / (u1 - u0);
    const lo = Math.max(zBed, zAt(e0));
    // (u, z) parallelogram, extruded across: frame (u, z, v) right-handed, v = u x z
    const poly = s > 0
      ? [[e0, lo], [e1, zAt(e1)], [e1, zAt(e1) + thick], [e0, lo + thick]]
      : [[e1, zAt(e1)], [e0, lo], [e0, lo + thick], [e1, zAt(e1) + thick]];
    boxExtrude(poly, -h, h, (p, q, r) => [o[0] + d[0] * p + d[1] * r, o[1] + d[1] * p - d[0] * r, q], out);
  }
  return struts.length;
}
