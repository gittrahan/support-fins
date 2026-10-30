/** Optional FDM line contacts below a part-supported wall. A contact must fit
 * on one upward source facet, and its whole prism must be free of other part
 * surfaces. No sampling across holes, floor snapping or source-mesh repair.
 * Small/curved facets may not admit a contact: refuse that anchored wall. */
import { ribbon } from '../solids.js';
import { surfaceCandidates } from './surface.js';
import { PROP } from './config.js';

export class AnchorContactError extends Error {}
const EPS = 1e-8;
const cross = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);

// Clip a source triangle to the contact's convex XY footprint, retaining z.
function clip(poly, footprint) {
  for (let i = 0; i < footprint.length && poly.length; i++) {
    const a = footprint[i], b = footprint[(i + 1) % footprint.length], next = [];
    for (let j = 0; j < poly.length; j++) {
      const p = poly[j], q = poly[(j + 1) % poly.length];
      const dp = cross(a, b, p), dq = cross(a, b, q);
      if (dp >= 0) next.push(p);
      if ((dp >= 0) !== (dq >= 0)) {
        const t = dp / (dp - dq);
        next.push(p.map((v, k) => v + t * (q[k] - v)));
      }
    }
    poly = next;
  }
  return poly;
}

function contact(tris, a, b, half, roof) {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
  if (len < EPS) return null;
  const sx = dy / len * half, sy = -dx / len * half;
  const fp = [[a[0] + sx, a[1] + sy], [b[0] + sx, b[1] + sy],
    [b[0] - sx, b[1] - sy], [a[0] - sx, a[1] - sy]];
  const candidates = surfaceCandidates(tris, Math.min(...fp.map(p => p[0])), Math.min(...fp.map(p => p[1])),
    Math.max(...fp.map(p => p[0])), Math.max(...fp.map(p => p[1])))
    .map(i => [0, 3, 6].map(k => Array.from(tris.slice(i + k, i + k + 3))));
  for (const [p, q, r] of candidates) {
    const nz = cross(p, q, r);
    if (nz <= EPS || !fp.every(v => cross(p, q, v) >= -EPS && cross(q, r, v) >= -EPS && cross(r, p, v) >= -EPS)) continue;
    const zAt = (v) => (cross(q, r, v) * p[2] + cross(r, p, v) * q[2] + cross(p, q, v) * r[2]) / nz;
    const bottom = fp.map(v => [...v, zAt(v)]);
    // An anchor is a short contact under this wall, never a new long pillar.
    if (bottom.some(v => v[2] <= 0 || roof - v[2] <= EPS || roof - v[2] > PROP.footGap + 0.5)) continue;
    let blocked = false;
    for (const tri of candidates) {
      const cut = clip(tri, fp);
      if (!cut.length || cut.every(v => v[2] <= zAt(v) + EPS) || cut.every(v => v[2] >= roof - EPS)) continue;
      blocked = true; break;
    }
    if (blocked) continue;
    const out = [];
    ribbon([[bottom[0], [...fp[0], roof], [...fp[3], roof], bottom[3]],
      [bottom[1], [...fp[1], roof], [...fp[2], roof], bottom[2]]], out);
    return out;
  }
  return null;
}

/** Build separate closed contacts overlapping the wall's solid bottom skin.
 * Stations are the sweep's own checked sections; keep the entire contact within
 * a straight run of sections so a bending wall cannot leave its anchor. */
export function bottomAnchors(stations, tris) {
  if (!PROP.bottomAnchors || PROP.tineDir === 'vertical' || PROP.footGap === 0) return [];
  if (!tris) throw new AnchorContactError('Line anchors need the model geometry to validate floor contact.');
  const line = PROP.tip / 1.5; // same nozzle-width convention as nozzle.js
  const spacing = Math.max(6, 10 * line), minLength = 2 * line;
  const out = []; let travelled = spacing;
  let overPart = false;
  for (let i = 1; i < stations.length; i++) {
    const a = stations[i - 1];
    let end = i, b = stations[end];
    let len = Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1]);
    travelled += len;
    if (a.bot <= PROP.footGap || b.bot <= PROP.footGap) continue;
    overPart = true;
    if (travelled < spacing || len < EPS) continue;
    // Side normals must agree with this segment: otherwise the anchor would
    // protrude through the corner of a bending wall.
    const sx = (b.p[1] - a.p[1]) / len, sy = -(b.p[0] - a.p[0]) / len;
    // Merge collinear sections: contact length must follow nozzle width rather
    // than the sweep's (sometimes very short) sampling interval.
    while (len < 4 * line && end + 1 < stations.length) {
      const q = stations[end + 1];
      if (Math.abs((q.p[0] - a.p[0]) * sx + (q.p[1] - a.p[1]) * sy) > EPS) break;
      if (q.bot <= PROP.footGap) break;
      const next = Math.hypot(q.p[0] - a.p[0], q.p[1] - a.p[1]);
      if (next <= len) break;
      b = q; len = next; end++;
    }
    const run = stations.slice(i - 1, end + 1);
    if (len < minLength || run.some(s => Math.abs(s.sx * sy - s.sy * sx) > 1e-7)) continue;
    const roof = Math.max(...run.flatMap(s => [s.botN, s.botP])) + Math.min(0.1, line / 2);
    if (run.some(s => roof >= s.ztip)) continue;
    const half = Math.min(line / 2, ...run.map(s => s.sh));
    const t = Math.min(1, 4 * line / len), inset = (1 - t) / 2;
    const at = f => a.p.map((v, k) => v + f * (b.p[k] - v));
    const added = contact(tris, at(inset), at(1 - inset), half, roof);
    if (added) { out.push(...added); travelled = 0; i = end; }
  }
  if (overPart && !out.length) {
    throw new AnchorContactError('No safe line anchors fit this floor. Turn off Line anchors or change the support placement.');
  }
  return out;
}
