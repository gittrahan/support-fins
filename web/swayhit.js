/**
 * Sway's "does anything on the part cross the volume this rib would occupy?" test.
 *
 * lowestHit answers it through the XY grid in triindex.js: only the triangles near
 * the rib are looked at, so the click costs the same on a million-face part as on a
 * small one. lowestHitBrute is the original full scan, kept as the reference the
 * tests hold the indexed version to; both run the same per-triangle test, so they
 * can only differ in which triangles they skip, and the grid skips only triangles
 * that cannot touch the box.
 */
import { triIndex, eachCandidate } from './triindex.js';

/** Sutherland-Hodgman: keep the part of `poly` where `f(v) >= 0`. */
export function clip(poly, f) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const fa = f(a), fb = f(b);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) {
      const t = fa / (fa - fb);
      out.push(a.map((v, k) => v + (b[k] - v) * t));
    }
  }
  return out;
}

const EPS = 1e-6;
const V = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];

/**
 * The lowest z at which triangle `i` crosses the rib volume, or Infinity. The
 * triangle goes into the rib's frame (s out of the face, u across it, z), is clipped
 * to the rib's slab across the face, then against its (s, z) outline.
 */
function triLow(tris, i, fr, uLo, uHi, outline) {
  const v = V;
  let umin = Infinity, umax = -Infinity;
  for (let k = 0; k < 3; k++) {
    const x = tris[i + k * 3], y = tris[i + k * 3 + 1], z = tris[i + k * 3 + 2];
    v[k][0] = x * fr.nh.x + y * fr.nh.y;
    v[k][1] = x * fr.uDir.x + y * fr.uDir.y;
    v[k][2] = z;
    if (v[k][1] < umin) umin = v[k][1];
    if (v[k][1] > umax) umax = v[k][1];
  }
  if (umax < uLo || umin > uHi) return Infinity;
  // A triangle wholly outside one outline edge clips to nothing; say so before allocating.
  // (The edges are linear, so the margin only has to beat the rounding of the clips below --
  // except sway.js's outer edge, which kinks at z = 0 where depthAt clamps; it only matters
  // for part below the seated bed, ~0.025 mm at most.)
  for (const f of outline) if (f(v[0]) < -EPS && f(v[1]) < -EPS && f(v[2]) < -EPS) return Infinity;
  let poly = v.map((q) => q.slice());
  poly = clip(poly, (q) => q[1] - uLo);
  poly = clip(poly, (q) => uHi - q[1]);
  for (const f of outline) {
    if (poly.length < 2) break;
    poly = clip(poly, f);
  }
  let best = Infinity;
  if (poly.length < 2) return best;
  for (const q of poly) if (q[2] < best) best = q[2];
  return best;
}

/** The full scan: every triangle. The reference for lowestHit. */
export function lowestHitBrute(tris, fr, uLo, uHi, outline) {
  let best = Infinity;
  for (let i = 0; i < tris.length; i += 9) best = Math.min(best, triLow(tris, i, fr, uLo, uHi, outline));
  return best;
}

/**
 * Same answer as lowestHitBrute, from the triangles near the box only. `sLo`..`sHi`
 * must bound the outline's s (distance out of the face) over the whole volume; the
 * box in the plane is that range by [uLo, uHi] across. `zLo`..`zHi`, when given, must
 * bound the outline's z the same way.
 *
 * The grid hands over every triangle whose XY box meets the axis-aligned box around
 * the rib's footprint, which for a rib turned off-axis is much bigger than the rib.
 * Each candidate is first checked against the rib's own (s, u, z) box, cheaply and
 * without allocating; one that misses it cannot be clipped to anything, so skipping
 * it is exact (the bounds are padded by EPS so rounding never drops a touching one).
 */
export function lowestHit(tris, fr, uLo, uHi, outline, sLo, sHi, zLo = -Infinity, zHi = Infinity) {
  // s = x*nh.x + y*nh.y and u = x*uDir.x + y*uDir.y; invert that 2x2 to put the box's corners in x, y.
  const a = fr.nh.x, b = fr.nh.y, c = fr.uDir.x, d = fr.uDir.y;
  const det = a * d - b * c;
  if (!Number.isFinite(sLo + sHi) || Math.abs(det) < 1e-9) return lowestHitBrute(tris, fr, uLo, uHi, outline);
  let xa = Infinity, xb = -Infinity, ya = Infinity, yb = -Infinity;
  for (const s of [sLo, sHi]) {
    for (const u of [uLo, uHi]) {
      const x = (d * s - b * u) / det, y = (a * u - c * s) / det;
      if (x < xa) xa = x; if (x > xb) xb = x;
      if (y < ya) ya = y; if (y > yb) yb = y;
    }
  }
  const pad = 1e-6;   // rounding in the inverse; a wider net only costs a few more candidates
  const sa = sLo - EPS, sb = sHi + EPS, ua = uLo - EPS, ub = uHi + EPS, za = zLo - EPS, zb = zHi + EPS;
  const nx = fr.nh.x, ny = fr.nh.y, ux = fr.uDir.x, uy = fr.uDir.y;
  let best = Infinity;
  eachCandidate(triIndex(tris), xa - pad, xb + pad, ya - pad, yb + pad, (t) => {
    const i = t * 9;
    const x0 = tris[i], y0 = tris[i + 1], x1 = tris[i + 3], y1 = tris[i + 4], x2 = tris[i + 6], y2 = tris[i + 7];
    const s0 = x0 * nx + y0 * ny, s1 = x1 * nx + y1 * ny, s2 = x2 * nx + y2 * ny;
    if ((s0 < sa && s1 < sa && s2 < sa) || (s0 > sb && s1 > sb && s2 > sb)) return;
    const u0 = x0 * ux + y0 * uy, u1 = x1 * ux + y1 * uy, u2 = x2 * ux + y2 * uy;
    if ((u0 < ua && u1 < ua && u2 < ua) || (u0 > ub && u1 > ub && u2 > ub)) return;
    const z0 = tris[i + 2], z1 = tris[i + 5], z2 = tris[i + 8];
    if ((z0 < za && z1 < za && z2 < za) || (z0 > zb && z1 > zb && z2 > zb)) return;
    const z = triLow(tris, i, fr, uLo, uHi, outline);
    if (z < best) best = z;
  });
  return best;
}
