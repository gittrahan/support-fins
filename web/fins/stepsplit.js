/**
 * One candidate line -> its walls, parted where a body would run inside the part.
 * drawnWall refuses such a line, saying where (prop/bodycut.js). Full coverage may place
 * as many walls as it likes, so it builds the stretch either side of the cut instead of
 * losing the whole line; Draw, one line one wall, shows the refusal.
 */
import { DRAW_MIN_LEN } from '../draw.js';
import { heldDrawnWall } from './heldtines.js';

// A cut sits between two stations, so each piece stops this many stations short of the
// nearest one. Short of a piece's own cut, a piece cut again parts again, this many times.
const CLEAR_STATIONS = 2;
const MAX_PARTS = 3;

/** The two [from, to] stations a cut parts `r.top` at, or null if a side has no stations. */
export function cutEnds(r) {
  const top = r.top;
  let k = 0, best = Infinity;
  for (let i = 0; i < top.length; i++) {
    const d = Math.hypot(top[i][0] - r.cutAt[0], top[i][1] - r.cutAt[1]);
    if (d < best) { best = d; k = i; }
  }
  return { before: top[k - CLEAR_STATIONS] ?? null, after: top[k + CLEAR_STATIONS] ?? null };
}

const longEnough = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1]) >= DRAW_MIN_LEN;

/**
 * Build a -> b: `walls`, the built results, one unless a cut parted the line; `refused`,
 * the first refusal when none built; `tries`, the drawnWall calls spent; `parted`, the
 * cuts that split a line.
 */
export function wallsAcrossCuts(a, b, tris, opts, build = heldDrawnWall, parts = MAX_PARTS) {
  const r = build(a, b, tris, 0, opts);
  if (r.ok) return { walls: [r], refused: null, tries: 1, parted: 0 };
  if (!r.cutAt || parts <= 0) return { walls: [], refused: r, tries: 1, parted: 0 };
  const { before, after } = cutEnds(r);
  const out = { walls: [], refused: r, tries: 1, parted: 1 };
  const side = (p, q) => {
    if (!p || !q || !longEnough(p, q)) return;
    const s = wallsAcrossCuts(p, q, tris, opts, build, parts - 1);
    out.walls.push(...s.walls);
    out.tries += s.tries;
    out.parted += s.parted;
  };
  side(a, before);
  side(after, b);
  if (out.walls.length) out.refused = null;
  return out;
}
