/**
 * Short walls, the LAST RESORT (issue #121). A ring-and-strut lattice is all
 * 4-6 mm strut undersides, every one under PROP.minSpan, so the walls dropped them
 * as stubs and half the red printed into air. Once the walls and wedges are in,
 * the regions still bare get one more placement pass with the short-wall floor
 * (prop/clearance.js minSpanFor `short`): a wall down to minSpanShort, kept only
 * while it is at most maxShortAspect times as tall as it is long.
 *
 * Why last and not in the normal pass: a short wall that "serves" a face stands a
 * wedge or a raster row down, and those hold it better (a tube lost 14 wedge tines
 * that way, tests/tails.test.js). Here it only lands where nothing else did, so a
 * part the engine already served is untouched.
 *
 * A wall that comes within sideClear of a wall or wedge already built is dropped
 * (bounding boxes, conservative), and so is one that comes within sideClear of a
 * short wall kept before it.
 */
import { buildShortWalls, PROP } from '../prop.js';
import { bareAfterWedges } from './wedges.js';

/** [minX, minY, minZ, maxX, maxY, maxZ] over tris[from..to), one vertex per entry. */
function boxOf(tris, from, to) {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = from; i < to; i++) {
    const v = tris[i];
    for (let k = 0; k < 3; k++) { if (v[k] < b[k]) b[k] = v[k]; if (v[k] > b[k + 3]) b[k + 3] = v[k]; }
  }
  return b;
}
const overlaps = (a, b, pad) =>
  a[0] - pad <= b[3] && b[0] <= a[3] + pad && a[1] - pad <= b[4] && b[1] <= a[4] + pad &&
  a[2] - pad <= b[5] && b[2] <= a[5] + pad;

/**
 * Short walls for the regions `servedRegions` and `wedgeTris` left bare. `existing`
 * is every support triangle already built (vertex list). Returns the kept walls:
 * triangles, props with triRanges into those triangles, the regions they serve and
 * their tines.
 */
export function lastResortWalls(topo, result, rot, opts, servedRegions, wedgeTris, existing) {
  const bare = bareAfterWedges(topo, rot, result, servedRegions, wedgeTris);
  const none = { triangles: [], props: [], served: [], tines: 0 };
  if (!bare.length) return none;
  const built = buildShortWalls(topo, result, rot, opts, new Set(bare));
  if (!built.props.length) return none;

  const others = [];
  for (let i = 0; i < existing.length; i += 3) others.push(boxOf(existing, i, i + 3));
  const triangles = [], props = [], served = new Set();
  let tines = 0;
  for (const p of built.props) {
    const ranges = p.triRanges ?? [];
    const box = ranges.reduce((b, [a, z]) => {
      const r = boxOf(built.triangles, a, z);
      return [0, 1, 2].map((k) => Math.min(b[k], r[k])).concat([3, 4, 5].map((k) => Math.max(b[k], r[k])));
    }, [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
    if (others.some((o) => overlaps(box, o, PROP.sideClear))) continue;
    const triRanges = ranges.map(([a, z]) => {
      const at = triangles.length;
      for (let i = a; i < z; i++) triangles.push(built.triangles[i]);
      return [at, triangles.length];
    });
    others.push(box);                               // and the next short wall keeps off this one
    props.push({ ...p, triRanges, short: true });
    served.add(p.region);
    tines += p.tines ?? 0;
  }
  return { triangles, props, served: [...served], tines };
}
