// TIE WALLS TOGETHER (web/fins/ties.js, GH #57): with the box ticked, neighbouring
// Auto and Full walls over TIE_WALL_H are tied into frames, last. Pinned: Auto's
// ~15 mm comb under a shelf gets tied, up to TIE_WALL_TOP under the tip; unticked
// builds exactly as without the pass; short walls stand alone; a wall takes at most
// TIE.perWall ties, the fill pass's counted.
import { assert, analyze, buildTopology, fins, prop } from './_util.js';
const { PROP, TIE } = prop;
const { TIE_WALL_H, TIE_WALL_TOP } = await import('../web/fins/ties.js');

function box(x0, x1, y0, y1, z0, z1, out) {
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  for (const [a, b, c] of [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]]) out.push(...v[a], ...v[b], ...v[c]);
}
/** A post with a 60 x 60 mm shelf out from its top, the shelf's underside `h` up. */
function shelf(h) {
  const t = [];
  box(0, 10, 0, 60, 0, h + 2, t); box(10, 70, 0, 60, h, h + 2, t);
  const pos = new Float32Array(t);
  const topo = buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
  const rot = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  return { topo, rot, res: analyze(topo, 45, rot) };
}
const build = (s, o = {}) => fins.buildFins(s.topo, s.res, s.rot, { mode: 'auto', bedPad: true, ...o });

Deno.test('wall ties: Auto walls 60 mm up are tied; unticked is the build without them', () => {
  const s = shelf(60);
  const on = build(s, { tieWalls: true }), off = build(s);
  assert(off.wallTies === undefined, 'unticked: the pass never runs');
  const walls = on.fins.filter((f) => f.kind === 'prop');
  assert(on.wallTies >= walls.length - 1, `the comb is tied end to end: ${on.wallTies} ties, ${walls.length} walls`);
  // everything before the ties is the unticked build, triangle for triangle
  for (let i = 0; i < off.triangles.length; i++) {
    const a = on.triangles[i], b = off.triangles[i];
    if (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2]) throw new Error(`vertex ${i} moved`);
  }
  const ties = on.triangles.slice(off.triangles.length);
  assert(ties.length > 0, 'the ties are in the mesh');
  const top = Math.min(...walls.map((f) => f.height));
  let zLo = Infinity, zHi = -Infinity;
  for (const v of ties) { zLo = Math.min(zLo, v[2]); zHi = Math.max(zHi, v[2]); }
  assert(zLo > -1e-6, 'ties stand on the plate');
  assert(zHi <= top - PROP.tipH - TIE_WALL_TOP + 1e-6, `ties stop under the tip: ${zHi.toFixed(2)}`);
  // and they reach well up the wall, where it sways, not just its foot
  assert(zHi > 0.6 * top, `ties climb the wall: top ${zHi.toFixed(1)} of ${top.toFixed(1)}`);
  for (const f of walls) assert((f.ties ?? 0) <= TIE.perWall, `wall ${f.id}: ${f.ties} ties`);
});

Deno.test('wall ties: walls under TIE_WALL_H stand alone', () => {
  const on = build(shelf(TIE_WALL_H - 6), { tieWalls: true });
  assert(on.wallTies === 0, `no ties on short walls: ${on.wallTies}`);
});

Deno.test('wall ties: with the ribs on, every neighbouring pair is still tied', () => {
  // a tie shares its walls with the next one along: tying 0-1 must not block 1-2
  const on = build(shelf(110), { tieWalls: true });
  const walls = on.fins.filter((f) => f.kind === 'prop');
  assert(on.tallRibs > 0, 'the walls are ribbed');
  assert(on.wallTies >= walls.length - 1, `${on.wallTies} ties on ${walls.length} walls`);
});

Deno.test('wall ties: Full coverage keeps within TIE.perWall, the fill pass\'s ties counted', () => {
  const s = shelf(60);
  const on = build(s, { mode: 'full', tieWalls: true }), off = build(s, { mode: 'full' });
  assert(on.wallTies > 0, 'Full\'s walls are tied too');
  assert(on.fill.walls === off.fill.walls, 'ties never cost a wall');
  for (const f of on.fins) assert((f.ties ?? 0) <= TIE.perWall, `wall ${f.id}: ${f.ties} ties`);
});
