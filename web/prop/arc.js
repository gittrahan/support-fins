/**
 * Arc walls: ONE wall along a level overhang that curves in PLAN -- a slot cut
 * through a tube's wall, whose ceiling is a strip the wall's thickness wide bent
 * round the tube's axis (a candy dispenser's dispensing slot, a window in a pipe).
 *
 * Nothing else follows that strip. Its faces all point straight down, so it has no
 * slope for downhill.js to run down and tubeLine reads it as a plane; the patch
 * path then lays straight tracks, and a straight wall can only cut across a strip
 * that bends: on a 1.6 mm wall it found no line at all (Ø30 tube, 22 mm slot:
 * 0 walls; Full coverage's chords held 58% of the ceiling directly). This traces
 * the strip's centre line instead: a circle fitted to its points gives a centre,
 * stations are stepped round it, and each sits midway across the strip there
 * (its edges probed along the radius) -- so the line follows the strip even where its radius drifts.
 *
 * Only a strip: narrow (ARC.maxWidth across everywhere), level (its whole rise
 * within PROP.contourSlopeMin -- the slope below which there is nothing to read --
 * of maxWidth; a slope is downhill.js's), open (a
 * complete ring is circular.js's), and bending more than CURVED.minBend (a straight
 * strip is the patch path's, unchanged). Returns tracks in tubeLine's shape --
 * [x, y, z] stations ~`step` apart, z the region's surface -- or null.
 */
import { PROP } from './config.js';
import { CURVED, lineBend } from './curved.js';
import { surfaceZAt } from './surface.js';

export const ARC = {
  maxWidth: 6,    // mm across the strip: one wall then has every edge within 3 mm (half
                  // maxUnsupportedSpan's 6 mm held rule); wider bands get rows
  minGap: 30,     // deg: the strip must leave at least this much of the circle open --
                  // circular.js takes complete loops at gaps up to 30
  minLen: 2,      // mm of line: Draw's DRAW_MIN_LEN, a short slot is still a slot
  probe: 0.05,    // mm between probes across the strip for its edges (a quarter of `gap`)
};

const TAU = 2 * Math.PI;

/** Least-squares circle through the points' plan positions (Kasa), or null. */
function fitCircle(pts) {
  const o = pts[0];
  let mx = 0, my = 0;
  for (const p of pts) { mx += p[0] - o[0]; my += p[1] - o[1]; }
  mx /= pts.length; my /= pts.length;
  let xx = 0, xy = 0, yy = 0, xr = 0, yr = 0;
  for (const p of pts) {
    const x = p[0] - o[0] - mx, y = p[1] - o[1] - my, r2 = x * x + y * y;
    xx += x * x; xy += x * y; yy += y * y; xr += x * r2; yr += y * r2;
  }
  const det = xx * yy - xy * xy;
  if (det <= 1e-9) return null;               // collinear: a straight strip
  return [o[0] + mx + (yy * xr - xy * yr) / (2 * det), o[1] + my + (xx * yr - xy * xr) / (2 * det)];
}

/**
 * The centre line of a level strip that curves in plan, as one track, or null
 * when the region isn't one (see the header).
 */
export function arcLine(regionPts, regionTris, step = PROP.stationStep) {
  if (regionPts.length < 6) return null;
  // Level ACROSS the strip too, not only along the line: on a sloping chamfer the
  // fitted arc can run along a contour and read level (ssdMounts-Chamfer X60, a
  // 75 x 8 mm strip falling 4.8 mm across, took an arc and lost 96 -> 11%).
  let zLo = Infinity, zHi = -Infinity;
  for (const p of regionPts) { zLo = Math.min(zLo, p[2]); zHi = Math.max(zHi, p[2]); }
  if (zHi - zLo > PROP.contourSlopeMin * ARC.maxWidth) return null;
  const c = fitCircle(regionPts);
  if (!c) return null;
  // Polar coordinates round the centre, the angle measured from the strip's
  // middle so the strip never straddles the -pi/pi seam.
  let sx = 0, sy = 0;
  for (const p of regionPts) { const a = Math.atan2(p[1] - c[1], p[0] - c[0]); sx += Math.cos(a); sy += Math.sin(a); }
  const mid = Math.atan2(sy, sx);
  const polar = regionPts.map((p) => {
    let a = Math.atan2(p[1] - c[1], p[0] - c[0]) - mid;
    a -= TAU * Math.round(a / TAU);
    return [a, Math.hypot(p[0] - c[0], p[1] - c[1])];
  });
  let a0 = Infinity, a1 = -Infinity, rSum = 0;
  for (const [a, r] of polar) { a0 = Math.min(a0, a); a1 = Math.max(a1, a); rSum += r; }
  if ((TAU - (a1 - a0)) * 180 / Math.PI < ARC.minGap) return null;   // a ring
  const rMean = rSum / polar.length;
  // One station every `step` along the mean radius. At each, the strip's edges are
  // found by probing the region's surface out along the radius (ARC.probe apart):
  // the vertices alone are too sparse -- a long facet spans several stations, and a
  // station seeing only one edge's vertices sat 0.5 mm off the middle of a 1.6 mm strip.
  const n = Math.max(2, Math.ceil(((a1 - a0) * rMean) / step));
  const reach = ARC.maxWidth + ARC.probe;
  const line = [];
  for (let i = 0; i <= n; i++) {
    const a = mid + a0 + (i / n) * (a1 - a0), ca = Math.cos(a), sa = Math.sin(a);
    let lo = Infinity, hi = -Infinity;
    for (let r = rMean - reach; r <= rMean + reach; r += ARC.probe) {
      if (surfaceZAt(regionTris, c[0] + r * ca, c[1] + r * sa) !== null) { lo = Math.min(lo, r); hi = Math.max(hi, r); }
    }
    if (lo > hi) continue;                                  // off the strip: an end's corner
    if (hi - lo > ARC.maxWidth) return null;                // a band, not a strip
    const r = (lo + hi) / 2, x = c[0] + r * ca, y = c[1] + r * sa;
    const z = surfaceZAt(regionTris, x, y);
    if (z !== null) line.push([x, y, z]);
  }
  if (line.length < PROP.minStations) return null;
  let run = 0;
  for (let i = 1; i < line.length; i++) run += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
  if (run < ARC.minLen) return null;
  if (lineBend(line) <= CURVED.minBend) return null;
  return [line];
}
