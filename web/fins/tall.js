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
import { boxGrid } from './fill.js';
import { seatedPartTris } from './seating.js';

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
  const grid = boxGrid();
  fins.forEach((f, k) => { for (const [a, b] of f.triRanges ?? []) grid.add(built.triangles.slice(a, b), k); });
  if (built.padTriangles?.length) grid.add(built.padTriangles);
  const triangles = [...built.triangles];
  for (const f of tall) {
    const k = fins.indexOf(f);
    const top = f.line.map((p) => [p[0], p[1], p[2] + PROP.gap]);   // braceWall takes the part's surface
    const floors = f.line.map((p) => floorAt(tris, p, 0));
    const out = [];
    const n = braceWall(top, (i) => floors[i], tris, 0, out, (t) => {
      if (grid.hits(t, PROP.sideClear, false, (tag) => tag === k)) return false;
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
