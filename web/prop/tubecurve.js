/** Lowest-line candidate for a small tube that bends gently in plan (#50).
 * A single straight axis can lie to one side of the tube and call its convex
 * underside concave. Intersect the actual faces with vertical cross-sections,
 * then apply the existing convex/two-sided tests about the resulting local line.
 * Ambiguous minima, holes and sharp turns decline; no bridging across a gap.
 */
import { PROP } from './config.js';
import { straightness } from './contact.js';

const EPS = 1e-8;

// One connected lowest interval in a cross-section, or null. Using its midpoint
// makes a flat minimum independent of which triangle edge happened to come first.
function lowest(sections, cx, cy, ux, uy, u) {
  const segments = [];
  let z = Infinity;
  for (const { v, lo, hi } of sections) {
    if (u < lo - EPS || u > hi + EPS) continue;
    const d = v.map(p => p[0] - u), hits = [];
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3;
      if (Math.abs(d[i]) < EPS) hits.push(v[i]);
      if (d[i] * d[j] < 0) {
        const t = d[i] / (d[i] - d[j]);
        hits.push(v[i].map((a, k) => a + t * (v[j][k] - a)));
      }
    }
    if (!hits.length) continue;
    for (const p of hits) z = Math.min(z, p[2]);
    segments.push(hits);
  }
  if (!segments.length) return null;
  const intervals = [];
  for (const hits of segments) {
    const low = hits.filter(p => p[2] <= z + EPS).map(p => p[1]);
    if (low.length) intervals.push([Math.min(...low), Math.max(...low)]);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  const lo = intervals[0][0]; let hi = intervals[0][1];
  for (const a of intervals.slice(1)) {
    if (a[0] > hi + EPS) return null;
    hi = Math.max(hi, a[1]);
  }
  const v = (lo + hi) / 2;
  return [cx + ux * u - uy * v, cy + uy * u + ux * v, z];
}

function convexAlong(rn, tris, line) {
  let away = 0, toward = 0, left = 0, right = 0;
  for (let k = 0; k < rn.length; k++) {
    const f = 9 * k, x = (tris[f] + tris[f + 3] + tris[f + 6]) / 3,
      y = (tris[f + 1] + tris[f + 4] + tris[f + 7]) / 3;
    let best = null;
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i], dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy;
      if (len2 < EPS * EPS) continue;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / len2));
      const px = x - a[0] - t * dx, py = y - a[1] - t * dy, d2 = px * px + py * py;
      if (!best || d2 < best.d2) {
        const n = Math.sqrt(len2);
        best = { d2, d: (-px * dy + py * dx) / n, wx: -dy / n, wy: dx / n };
      }
    }
    if (!best || Math.abs(best.d) < 0.05) continue; // same on-line exclusion as convexAbout
    const [normal, area] = rn[k];
    const s = (normal[0] * best.wx + normal[1] * best.wy) * Math.sign(best.d);
    if (s > 0) away += area; else toward += area;
    if (best.d > 0) left += area; else right += area;
  }
  return away > PROP.tubeConvexFrac * (away + toward)
    && Math.min(left, right) > PROP.tubeTwoSidedFrac * (left + right);
}

export function curvedTubeLine(rn, tris, cx, cy, ux, uy, lo, hi, step) {
  const n = Math.max(2, Math.min(400, Math.ceil((hi - lo) / step))), line = [];
  const stride = (hi - lo) / n;
  if (stride <= EPS) return null;
  // Transform each face once; most faces miss any given section entirely.
  const sections = [];
  for (let f = 0; f < tris.length; f += 9) {
    const v = [0, 3, 6].map(i => {
      const x = tris[f + i] - cx, y = tris[f + i + 1] - cy;
      return [x * ux + y * uy, -x * uy + y * ux, tris[f + i + 2]];
    });
    sections.push({ v, lo: Math.min(...v.map(p => p[0])), hi: Math.max(...v.map(p => p[0])) });
  }
  for (let k = 0; k <= n; k++) {
    const p = lowest(sections, cx, cy, ux, uy, lo + stride * k);
    if (!p) return null;
    const prev = line.at(-1);
    // A sudden lateral jump is a different branch, not a tube to connect.
    if (prev && Math.hypot(p[0] - prev[0], p[1] - prev[1]) > 2 * stride) return null;
    line.push(p);
  }
  if (line.length < PROP.minStations || straightness(line) > PROP.maxWander || !convexAlong(rn, tris, line)) return null;
  return [line];
}
