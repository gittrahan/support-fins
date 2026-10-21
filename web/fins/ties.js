/**
 * TIE WALLS TOGETHER (GH #57, local issue 060). Two users: fins climbing several cm
 * through open air with nothing to anchor to, and on a fast bed slinger "after the
 * fins extend upwards a few inches ... they start to flop all over the place" --
 * "sway bars at say a 45 degree angle stitching the fins together".
 *
 * That is prop/ties.js's tie: a zigzag of 55deg struts between two neighbouring
 * walls, a Warren truss that makes the pair one frame, stiff across the thin side a
 * lone wall flops along. The Full coverage fill pass already ties its own walls;
 * this ties every wall Auto or Full placed that stands on the plate over TIE_WALL_H,
 * each to its nearest neighbours (TIE.perWall, counting the fill pass's ties).
 *
 * Runs LAST, after the tall-wall ribs: a tie never takes plate a wall or rib needed,
 * so coverage can't change. A tie keeps sideClear off the part and off every other
 * support but its own two walls (tall.js's planGrid), and only plate stations take
 * one (v1, as in the fill pass). `opts.tieWalls` (the Tie walls together box) turns
 * it on; off by default until it's been printed.
 */
import { PROP, TIE, tieWalls } from '../prop.js';
import { surfaceZsAt } from '../prop/surface.js';
import { seatedPartTris } from './seating.js';
import { planGrid } from './tall.js';

/** mm: a wall shorter than this stands without a tie (the fill pass's own walls tie
 *  from TIE.minHeight; these are the walls the reports saw flop, several cm up). */
export const TIE_WALL_H = 30;

/** mm: the farthest apart two walls are tied. Auto's comb stands ~15 mm apart, past
 *  the fill pass's TIE.maxSpan; a 55deg strut across 20 mm still needs no support. */
export const TIE_WALL_SPAN = 20;

/** mm: ties stop this far under a wall's tip taper. The fill pass stops them at
 *  TIE.rise (70 %) of the wall; a 15 mm comb's 55deg struts climb 21 mm each, so on a
 *  60 mm wall that left one strut and the top 40 mm -- where the reports saw the
 *  flop -- free. The contact and its tines are in the top few mm. */
export const TIE_WALL_TOP = 5;

const ON_PLATE = 0.05;   // mm: a station whose floor is this close to the bed stands on it

/**
 * Tie the walls of `built` (buildFins' result, seated frame, bed at z 0) in place:
 * triangles appended to wall A's triRanges, `f.ties` counted on both walls, and
 * `built.wallTies` the number of ties added.
 */
export function tieAllWalls(topo, result, rot, built) {
  const fins = built.fins ?? [];
  built.wallTies = 0;
  const walls = fins.map((f, k) => ({ f, k })).filter(({ f }) => f.kind === 'prop'
    && (f.height ?? 0) > TIE_WALL_H && Array.isArray(f.line) && f.line.length >= 2);
  if (walls.length < 2) return built;
  const tris = seatedPartTris(topo, rot, result.offset);
  // Plate stations as [x, y, zMax], zMax where a tie must stop: TIE_WALL_TOP under
  // the tip taper. Auto's lines are the wall top (the gap under the part); the fill
  // pass's are the part's surface.
  const plate = new Map();
  for (const { f, k } of walls) {
    const st = [];
    for (const p of f.line) {
      const top = f.fill ? p[2] - PROP.gap : p[2];
      let floor = 0;
      for (const z of surfaceZsAt(tris, p[0], p[1])) if (z < top - 0.5 && z > floor) floor = z;
      if (floor > ON_PLATE) continue;
      st.push([p[0], p[1], top - PROP.tipH - TIE_WALL_TOP]);
    }
    if (st.length) plate.set(k, st);
  }
  const pairs = [];
  const ks = [...plate.keys()];
  for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
    const k = ks[i], m = ks[j];
    if (fins[k].fill && fins[m].fill) continue;   // the fill pass tied its own
    let best = null;
    for (const a of plate.get(k)) for (const b of plate.get(m)) {
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (d >= TIE.minSpan && d <= TIE_WALL_SPAN && (!best || d < best.d)) best = { d, a, b, k, m };
    }
    if (best) pairs.push(best);
  }
  if (!pairs.length) return built;
  pairs.sort((p, q) => p.d - q.d);
  // Only what a strut could meet goes in the clash grid: under the highest tie
  const zTop = Math.max(...pairs.map((p) => Math.min(p.a[2], p.b[2]))) + PROP.sideClear;
  const low = (p, q, r) => Math.min(p[2], q[2], r[2]) <= zTop;
  const grid = planGrid();
  fins.forEach((f, k) => { for (const [a, b] of f.triRanges ?? []) grid.add(built.triangles.slice(a, b), k, low); });
  if (built.padTriangles?.length) grid.add(built.padTriangles, null, low);
  const count = new Map(fins.map((f, k) => [k, f.ties ?? 0]));
  const triangles = [...built.triangles];
  for (const { a, b, k, m } of pairs) {
    if (count.get(k) >= TIE.perWall || count.get(m) >= TIE.perWall) continue;
    const out = [];
    if (!tieWalls(a, b, Math.min(a[2], b[2]), tris, 0, out, TIE_WALL_SPAN)) continue;
    const own = new Set([k, m]);
    if (grid.hits(out, own)) continue;
    grid.add(out, own);
    const at = triangles.length;
    for (const v of out) triangles.push(v);
    fins[k].triRanges = [...(fins[k].triRanges ?? []), [at, triangles.length]];
    for (const n of [k, m]) { fins[n].ties = (fins[n].ties ?? 0) + 1; count.set(n, count.get(n) + 1); }
    built.wallTies++;
  }
  built.triangles = triangles;
  return built;
}
