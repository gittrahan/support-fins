/**
 * TALL-WALL RIBS (local issue 046; a user: "you're definitely going to want some sort
 * of bracing for fins taller than 10cm or they wobble too much, maybe just a
 * perpendicular fin"). A wall is a 1 mm sheet whose foot stops at footMax, tied to the
 * part only by its tines at the top: tall, it sways across its thin side every layer.
 *
 * Runs LAST, after every wall, wedge, fill wall and sway brace is on the plate (ribs
 * built as walls went in took plate the next walls needed -- the fill pass's lesson).
 * Each wall standing on the plate over BRACE.tallH gets face ribs along it
 * (prop/brace.js, `kinds.tall`): only at stations whose floor is the plate, each kept
 * sideClear off the part and off every other support (its own wall and tines aside),
 * so no rib fuses two pieces. A wall the fill pass already braced is left as it is.
 * `opts.tallRibs: false` (the Brace tall walls box unticked) skips it.
 */
import { BRACE, braceWall, PROP } from '../prop.js';
import { surfaceZsAt } from '../prop/surface.js';
import { seatedPartTris } from './seating.js';

const CELL = 2.0;   // mm: the clash grid's plan cell
const SPLIT = 1.0;  // mm: triangles are split to this across in plan before they're compared

/** fn(x0, y0, x1, y1, zLo, zHi) for pieces of triangle (p, q, r) about SPLIT across in
 *  plan: a diagonal wall's triangle would box a whole quadrant, and a rib's would
 *  count its tall stem out at its low tip. Split at the longest edge in plan. */
function pieces(p, q, r, fn, depth = 0) {
  const x0 = Math.min(p[0], q[0], r[0]), x1 = Math.max(p[0], q[0], r[0]);
  const y0 = Math.min(p[1], q[1], r[1]), y1 = Math.max(p[1], q[1], r[1]);
  if (depth >= 16 || Math.max(x1 - x0, y1 - y0) <= SPLIT) {
    fn(x0, y0, x1, y1, Math.min(p[2], q[2], r[2]), Math.max(p[2], q[2], r[2]));
    return;
  }
  const d = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
  const pq = d(p, q), qr = d(q, r), rp = d(r, p);
  if (qr >= pq && qr >= rp) [p, q, r] = [q, r, p];
  else if (rp >= pq && rp >= qr) [p, q, r] = [r, p, q];
  const m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];
  pieces(p, m, r, fn, depth + 1);
  pieces(m, q, r, fn, depth + 1);
}

/**
 * Where supports stand, in plan: ~1 mm pieces of each support triangle, each with its
 * plan box and its LOWEST point. A rib rises from the plate, and so does every wall,
 * wedge and pad it could meet, so "a piece lower than the rib's top there, within
 * sideClear of it in plan" is a clash; tines high on a wall are not. Coarser than
 * fill.js's 3D boxGrid in height only, on the safe side (a rib is refused under a
 * leaning wedge it might have cleared); that grid cost 4 s on bigplate Y35.
 */
export function planGrid() {
  const cells = new Map();
  const key = (i, j) => (i + 32768) * 65536 + (j + 32768);
  const cellsOf = (x0, y0, x1, y1, fn) => {
    for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) {
      for (let j = Math.floor(y0 / CELL); j <= Math.floor(y1 / CELL); j++) fn(key(i, j));
    }
  };
  return {
    add(vs, tag = null, keep = () => true) {
      for (let n = 0; n + 2 < vs.length; n += 3) {
        if (!keep(vs[n], vs[n + 1], vs[n + 2])) continue;
        pieces(vs[n], vs[n + 1], vs[n + 2], (x0, y0, x1, y1, z) => {
          const o = [x0, y0, x1, y1, z, tag];
          cellsOf(x0, y0, x1, y1, (k) => { let c = cells.get(k); if (!c) cells.set(k, (c = [])); c.push(o); });
        });
      }
    },
    /** Does another support (not `own`) stand within sideClear of the rib `vs`? */
    hits(vs, own = undefined) {
      const pad = PROP.sideClear;
      let hit = false;
      for (let n = 0; n + 2 < vs.length && !hit; n += 3) {
        pieces(vs[n], vs[n + 1], vs[n + 2], (x0, y0, x1, y1, _zLo, zHi) => {
          if (hit) return;
          x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
          cellsOf(x0, y0, x1, y1, (k) => {
            if (hit) return;
            for (const o of cells.get(k) ?? []) {
              if (o[5] !== own && o[4] <= zHi + pad && o[0] <= x1 && x0 <= o[2] && o[1] <= y1 && y0 <= o[3]) { hit = true; return; }
            }
          });
        });
      }
      return hit;
    },
  };
}

/** The highest part surface under station p (a wall's centreline point, z the wall's
 *  top), or zBed: where that station's wall stands. */
function floorAt(tris, p, zBed) {
  let f = zBed;
  for (const z of surfaceZsAt(tris, p[0], p[1])) if (z < p[2] - 0.5 && z > f) f = z;
  return f;
}

/**
 * Add the ribs to `built` (buildFins' result, seated frame, bed at z 0) in place:
 * triangles appended, each braced fin's triRanges grown, `built.tallRibs` the count.
 */
export function braceTallWalls(topo, result, rot, built) {
  const fins = built.fins ?? [];
  const tall = fins.filter((f) => f.kind === 'prop' && !f.braces && (f.height ?? 0) > BRACE.tallH
    && Array.isArray(f.line) && f.line.length >= 2);
  built.tallRibs = 0;
  if (!tall.length) return built;
  const tris = seatedPartTris(topo, rot, result.offset);
  // Only what a rib could meet goes in: under the tallest rib (a tall wall's tines,
  // and everything above, never can)
  const zTop = BRACE.rise * Math.max(...tall.map((f) => f.height)) + PROP.sideClear;
  const low = (p, q, r) => Math.min(p[2], q[2], r[2]) <= zTop;
  const grid = planGrid();
  fins.forEach((f, k) => { for (const [a, b] of f.triRanges ?? []) grid.add(built.triangles.slice(a, b), k, low); });
  if (built.padTriangles?.length) grid.add(built.padTriangles, null, low);
  const triangles = [...built.triangles];
  for (const f of tall) {
    const k = fins.indexOf(f);
    // braceWall takes the part's surface: Auto's lines sit the gap under it, the fill
    // pass's (drawnWall's `top`) are the surface itself
    const top = f.fill ? f.line : f.line.map((p) => [p[0], p[1], p[2] + PROP.gap]);
    const floors = f.line.map((p) => floorAt(tris, p, 0));
    const out = [];
    const n = braceWall(top, (i) => floors[i], tris, 0, out, (t) => {
      if (grid.hits(t, k)) return false;
      grid.add(t, k);              // the next wall's ribs keep clear of these
      return true;
    }, { tall: true });
    if (!n) continue;
    const at = triangles.length;
    for (const v of out) triangles.push(v);
    f.triRanges = [...(f.triRanges ?? []), [at, triangles.length]];
    f.ribs = n;
    built.tallRibs += n;
  }
  built.triangles = triangles;
  return built;
}
