/**
 * Does a built wall body run inside the part? Station checks look at the stations
 * alone, but where an underside steps (top 6.8 -> 31.8 over one 1 mm gap) the body's
 * slanted edge runs between them, through the part: 1.7 mm deep on a tilted front panel.
 *
 * Crossing the part's skin isn't enough to count. Most walls that cross it do so by a
 * sliver (a knuckle at X30: 553 of the 558 lines an any-contact test caught were under
 * CUT_DEPTH), and treating those as cuts cost 11% more bare overhang for nothing
 * measured. CUT_DEPTH is one layer at the usual 0.2 mm and half a 0.4 line: under it the
 * slicer's own line width swallows the overlap. Shallower contact is left to prints.
 */
import { insidePart, nearestPart, solidClearance } from '../inside.js';

export const CUT_DEPTH = 0.2;
const SAMPLE = 0.4;       // mm between sample points on a wall face, well under a station

/**
 * The first point of `built` (print-space triangle soup, three vertices each) at least
 * CUT_DEPTH inside the part, as [x, y, z], or null. Exact pierce test first, so a body
 * that never crosses the skin costs one solidClearance and no sampling.
 */
export function bodyCut(topo, rot, offset, built) {
  const hit = solidClearance(topo, rot, offset, built, 0.25, true);
  if (!hit || hit.d > 1e-6) return null;
  const deep = (x, y, z) => insidePart(topo, rot, offset, x, y, z)
    && !nearestPart(topo, rot, offset, x, y, z, CUT_DEPTH);
  for (let i = 0; i + 2 < built.length; i += 3) {
    // from the corner between the shortest edge and the longest, so a sliver of a
    // triangle gets samples for its size, not the square of its length
    const c = [built[i], built[i + 1], built[i + 2]];
    const e = [dist(c[0], c[1]), dist(c[1], c[2]), dist(c[2], c[0])];
    const s = e.indexOf(Math.min(...e));
    const l = e[(s + 1) % 3] >= e[(s + 2) % 3] ? (s + 1) % 3 : (s + 2) % 3;
    const at = l === (s + 1) % 3 ? (s + 1) % 3 : s;   // the corner both edges share
    const A = c[at], B = c[(at + 1) % 3], C = c[(at + 2) % 3];
    const nB = Math.max(1, Math.ceil(dist(A, B) / SAMPLE)), nC = Math.max(1, Math.ceil(dist(A, C) / SAMPLE));
    for (let u = 0; u <= nB; u++) {
      for (let v = 0; v <= nC; v++) {
        const a = u / nB, b = v / nC;
        if (a + b > 1) break;
        const g = 1 - a - b;
        const x = g * A[0] + a * B[0] + b * C[0], y = g * A[1] + a * B[1] + b * C[1],
              z = g * A[2] + a * B[2] + b * C[2];
        if (deep(x, y, z)) return [x, y, z];
      }
    }
  }
  return null;
}

const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
