/**
 * BRACES -- buttresses for a short wall that stands tall on the plate (local issue 036).
 *
 * The fill pass serves a figure's hands, hems and elbows with walls 3 mm long and
 * 25-50 mm tall: up to 17x as tall as they are long. Along the line nothing reaches
 * past the wall's own 3 mm, and a part-attached wall that runs down to the plate has
 * no flange at all (Isaac's hands: 33 mm on a 0.4 x 1 mm footprint). PR #200 capped
 * the ratio -- lengthening or refusing the wall -- and left the hands bare; Matthew
 * 2026-10-07: keep the wall where the red is and make it stand.
 *
 * So a wall over BRACE.aspect x its length gets up to four ribs at the plate: one off
 * each end along its line, one off each face at its middle. A rib is a triangle in its
 * own vertical plane, the wall's thickness, rising BRACE.rise of the wall's height at
 * the stem and running out to the plate `PROP.footRatio x height` away -- the same
 * rule the foot already follows across a plate wall. Under it a flange strip, the
 * foot's height and footMin either side, grips the plate. Ribs stop 1 mm under the tip
 * taper, so the contact, the gap and the tines are untouched. New print numbers: rise
 * and minReach (docs/FIN-SPEC.md, Braces).
 *
 * A rib is built only from a station whose floor is the plate (v1: no ribs landing on
 * the part -- they would mark it), only where the part stays sideClear off it, and
 * only if `clear(tris)` (the caller's check against supports already built) passes.
 * Each rib is judged alone: a wall tucked against a thigh still gets its open sides.
 */
import { boxExtrude } from '../solids.js';
import { PROP } from './config.js';
import { surfaceZsAt } from './surface.js';

export const BRACE = {
  aspect: PROP.maxShortAspect, // braced when height > this x length (Auto's own short-wall limit)
  rise: 0.5,                   // rib height at the stem, as a share of the wall's height there
  onPlate: 0.5,                // mm: a station whose floor is this close to the bed stands on the plate
  minReach: 1.5,               // mm: a rib shorter than this is not tried (blocked ribs retry at half reach)
  step: 0.25,                  // mm: part clearance sampled this finely under a rib
};

/** Does part surface come within sideClear of the box u0..u1 x -w..w x z0..z1(u)
 *  (rib frame: u out from the stem, v across it)? */
function ribHitsPart(tris, o, d, u0, u1, w, z0, z1) {
  const nu = Math.ceil((u1 - u0) / BRACE.step), nv = Math.ceil(2 * w / BRACE.step);
  for (let i = 0; i <= nu; i++) {
    const u = u0 + (u1 - u0) * i / nu;
    for (let k = 0; k <= nv; k++) {
      const v = -w + 2 * w * k / nv;
      const x = o[0] + d[0] * u + d[1] * v, y = o[1] + d[1] * u - d[0] * v;
      for (const z of surfaceZsAt(tris, x, y)) if (z >= z0 - 0.01 && z <= z1(u) + PROP.sideClear) return true;
    }
  }
  return false;
}

/** One rib from station point `o` (on the plate, at the stem's centre) in unit plan
 *  direction `d`: `stem` is the rib's height there, `reach` how far out it lands.
 *  Its triangles, or null when the part is in the way. */
function rib(tris, o, d, zBed, stem, reach) {
  const u0 = -PROP.th / 2;                          // starts inside the stem: overlapping solids
  const fw = PROP.footMin;                          // flange half-width
  const z1 = (u) => zBed + stem * Math.max(0, 1 - Math.max(0, u) / reach);
  // out to sideClear past the tip: a part resting on the plate just beyond where a rib
  // lands would otherwise meet its flange end-on (review: 0.05 mm). From the stem's
  // centre, not behind it: u < 0 is inside the wall's own body, and part beside that is
  // the wall's clearance, not the rib's -- checking it refused every rib on Isaac's
  // right-hand wall (it stands 0.6 mm off the boot at the plate)
  const lo = 0, hi = reach + PROP.sideClear;
  if (ribHitsPart(tris, o, d, lo, hi, PROP.th / 2 + PROP.sideClear, zBed, z1)) return null;
  if (ribHitsPart(tris, o, d, lo, hi, fw + PROP.sideClear, zBed, () => zBed + PROP.baseH)) return null;
  const out = [];
  // the rib: (u, z) triangle, extruded across. Frame (u, z, v) right-handed: v = u x z.
  boxExtrude([[u0, zBed], [reach, zBed], [u0, zBed + stem]], -PROP.th / 2, PROP.th / 2,
    (a, b, c) => [o[0] + d[0] * a + d[1] * c, o[1] + d[1] * a - d[0] * c, b], out);
  // its flange: (u, v') rectangle, extruded up. Frame (u, v', z): v' = z x u.
  boxExtrude([[u0, -fw], [reach, -fw], [reach, fw], [u0, fw]], zBed, zBed + PROP.baseH,
    (a, b, c) => [o[0] + d[0] * a - d[1] * b, o[1] + d[1] * a + d[0] * b, c], out);
  return out;
}

/**
 * Brace the wall whose contact line is `top` (stations [x, y, z], z the part above)
 * and whose bottom at station i is `floorZ(i)`. Appends the ribs' triangles to `out`
 * and returns how many were built (0 when the wall is stocky enough or nothing fits).
 */
export function braceWall(top, floorZ, tris, zBed, out, clear = () => true) {
  const n = top.length;
  if (n < 2) return 0;
  const a = top[0], b = top[n - 1];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 1e-6) return 0;
  let height = 0;
  for (let i = 0; i < n; i++) height = Math.max(height, top[i][2] - PROP.gap - floorZ(i));
  if (height <= BRACE.aspect * len) return 0;
  const dx = (b[0] - a[0]) / len, dy = (b[1] - a[1]) / len;
  const reach0 = PROP.footRatio * height;
  const mid = n >> 1;
  const ribs = [[0, [-dx, -dy]], [n - 1, [dx, dy]], [mid, [dy, -dx]], [mid, [-dy, dx]]];
  let built = 0;
  for (const [i, d] of ribs) {
    if (floorZ(i) > zBed + BRACE.onPlate) continue;
    // under the tip taper: the contact and its breakaway stay exactly as they were
    const stem = Math.min(BRACE.rise * (top[i][2] - PROP.gap - zBed), top[i][2] - PROP.gap - PROP.tipH - 1 - zBed);
    if (stem < PROP.baseH + 1) continue;
    for (let reach = reach0; reach >= BRACE.minReach; reach /= 2) {
      const r = rib(tris, [top[i][0], top[i][1]], d, zBed, stem, reach);
      if (r && clear(r)) { out.push(...r); built++; break; }
    }
  }
  return built;
}
