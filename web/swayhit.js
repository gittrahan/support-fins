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
 * box in the plane is that range by [uLo, uHi] across.
 */
export function lowestHit(tris, fr, uLo, uHi, outline, sLo, sHi) {
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
  let best = Infinity;
  eachCandidate(triIndex(tris), xa - pad, xb + pad, ya - pad, yb + pad, (t) => {
    const z = triLow(tris, t * 9, fr, uLo, uHi, outline);
    if (z < best) best = z;
  });
  return best;
}
