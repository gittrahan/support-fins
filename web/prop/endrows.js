/**
 * Flush end rows (local issue 062): the candidate layout for a patch's FREE edges.
 *
 * The mid-strip layout (vExt / n apart, half that from each edge) leaves a lip of up
 * to half a pitch past the last row; on a FREE edge (air past it, see freeEdge) that
 * lip is a cantilever, and on the slenderness coupon a 4 mm one curled on every
 * ledge. So the outermost row MOVES OUT to a free edge, flush (PROP.edgeInset), and
 * the rows spread evenly between the two ends, the spread never wider than the old
 * pitch -- with two or more rows, one more row than before (the ends moved out, the
 * span grew). #143 added a row beside each end instead and kept the old ones, which
 * doubled every free edge (lowledge 3 -> 5 walls); Matthew 2026-10-01: same count,
 * the end ones flush; 2026-10-23: never a wider gap than the pitch, so +1 row.
 *
 * This only LAYS the candidate. Whether it is worth its wall is the judge's call per
 * region (buildProps races it against the mid-strip rows, prop/judge.js; a tie keeps flush);
 * it replaced a slope cutoff (PROP.edgeFlatDeg, 45 deg) that guessed from the underside's
 * angle. The one cutoff left is Sway's (PROP.edgeFlatDegSway, see patchTracks): a
 * brace is the user's own ask and the judge doesn't see it.
 */
import { insidePart } from '../inside.js';
import { PROP } from './config.js';
import { surfaceZAt } from './surface.js';

/**
 * `rows` (the mid-strip layout across v = vLo..vHi, `n` of them, `vExt` apart in all)
 * with the outermost row moved out flush to each free end, or null when neither end
 * is free (or an old row already sits at it): the rows stay as they were.
 */
export function endRows(rows, vLo, vHi, probe) {
  const vExt = vHi - vLo, e = PROP.edgeInset, n = rows.length;
  const near = 2 * e;                        // an old row this close already sits at the end
  if (vExt <= 2 * near) return null;
  const lo = rows[0] - vLo > near && freeEdge(probe, vLo, -1);
  const hi = vHi - rows[n - 1] > near && freeEdge(probe, vHi, +1);
  if (!lo && !hi) return null;
  const a = lo ? vLo + e : rows[0], b = hi ? vHi - e : rows[n - 1];
  // one row can't stand at an end without leaving the rest bare: it keeps its
  // place mid-strip and the free ends get their own (as #143)
  // Spread wider than the old pitch, and the gaps get another row instead:
  // moving the ends out must not open the middle. It used to allow up to
  // 2 x maxUnsupportedSpan (a point mid-gap still in a wall's reach), which
  // left a 40 mm deck's three walls 19.4 mm apart at a 12 mm pitch, and a
  // turned ledge's (local issue 038) two rows 20 mm apart.
  const cap = vExt / n;
  const m = Math.max(n, Math.ceil((b - a) / cap - 1e-9) + 1);
  return n === 1 ? [...(lo ? [a] : []), rows[0], ...(hi ? [b] : [])]
    : Array.from({ length: m }, (_, w) => a + ((b - a) * w) / (m - 1));
}

/**
 * Does the patch end in AIR along its edge at v = `vEdge` (`dir` -1 for the low
 * side, +1 for the high)? Probed at five points along the edge: the underside
 * just inside the edge gives the height, and a point 0.8 mm past the edge from
 * 2 mm below to 2 mm above that height is tested for part. Part there -- a spine
 * the ledge hangs off, the same overhang carrying on into the next sub-patch, or
 * an upright the underside meets -- makes the edge attached. Free only when most
 * probes that found an underside found air, and nothing stands in the column the
 * flush row would fill (either face, down to the bed).
 */
function freeEdge(probe, vEdge, dir) {
  const { support, patchTris, ux, uy, vx, vy, uLo, uHi } = probe;
  let air = 0, part = 0;
  for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    const u = uLo + (uHi - uLo) * t;
    const at = (v) => [ux * u + vx * v, uy * u + vy * v];
    const [ix, iy] = at(vEdge - dir * 0.3);
    const z = surfaceZAt(patchTris, ix, iy);
    if (z === null) continue;
    // an edge down at the bed rests on it: no lip to curl, and a flush wall there
    // is lower than any wall worth building (a cube at X20's low edge)
    if (z < PROP.minHeightSquat) { part++; continue; }
    const [ox, oy] = at(vEdge + dir * 0.8);
    const solid = [-2, -1, -0.3, 0.3, 1, 2].some((dz) => insidePart(support.topo, support.rot, support.offset, ox, oy, z + dz));
    if (solid) { part++; continue; }
    // the flush row's whole column must be clear too: just outside its outer
    // face, from the underside down to the bed (lbracket Y20: the side under the
    // edge leans out, and a flush wall stood in it lower down)
    // (both faces: a deck overhanging its leg by less than a wall stands the
    // flush row against the leg -- bridge, sparse: blocked and buried)
    for (const side of [+1, -1]) {
      const [cx, cy] = at(vEdge - dir * PROP.edgeInset + side * dir * (PROP.th / 2 + PROP.sideClear));
      for (let zz = z - 0.5; zz > 0.3; zz -= 1) {
        if (insidePart(support.topo, support.rot, support.offset, cx, cy, zz)) return false;
      }
    }
    air++;
  }
  return air >= 2 && air > part;
}
