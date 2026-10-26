// Curved drawn walls (local issue 063): Draw's Curve tool takes the two ends and a
// point the wall runs through, and builds one wall round the circular arc through
// all three. These pin: a point in line with the ends is the straight wall to the
// byte, the curve follows its circle (past a half circle too), it is refused when
// tighter than its foot can follow, and a tined curved wall is watertight with only
// its tines in the part.

import { WEB, blockTopo, tiltedBlockTopo, prop, isClosed, insideCount, assert, assertClose } from './_util.js';

const { drawnWall } = await import(`${WEB}draw.js`);
const { arcThrough, arcStations, DRAW_MIN_RADIUS } = await import(`${WEB}drawarc.js`);
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const OFF = { x: 0, y: 0, z: 0 };
const Z = 25;
const slab = () => blockTopo(-40, 40, -40, 40, Z, Z + 5);   // a level ceiling 25 mm up

Deno.test('drawarc: a third point in line with the ends builds the straight wall exactly', () => {
  const topo = slab();
  const straight = drawnWall([-10, 0, Z], [10, 0, Z], topo.pos, 0);
  const inLine = drawnWall([-10, 0, Z], [10, 0, Z], topo.pos, 0, { through: [3, 0, Z] });
  assert(straight.ok && inLine.ok, 'straight wall failed');
  assert(JSON.stringify(straight.tris) === JSON.stringify(inLine.tris), 'in-line third point changed the wall');
});

Deno.test('drawarc: the curve runs round the circle through all three clicks', () => {
  const R = 12;
  const r = drawnWall([-R, 0, Z], [R, 0, Z], slab().pos, 0, { through: [0, R, Z] });
  assert(r.ok, `curved wall failed: ${r.reason}`);
  assertClose(r.length, Math.PI * R, 1e-6, 'length is the half circle');
  for (const p of r.top) assertClose(Math.hypot(p[0], p[1]), R, 1e-6, 'station off the circle');
  assert(r.top.every((p) => p[1] >= -1e-9), 'the wall went round the wrong side');
});

Deno.test('drawarc: a third click beyond the ends gives more than a half circle', () => {
  // ends 10 mm apart, the arc out through (0, -8): the long way round
  const c = arcThrough([-5, 0, Z], [5, 0, Z], [0, -8, Z]);
  assert(Math.abs(c.sweep) > Math.PI, `sweep ${(Math.abs(c.sweep) * 180 / Math.PI).toFixed(0)} deg`);
  const st = arcStations([-5, 0, Z], [5, 0, Z], [0, -8, Z], 1, 3);
  assert(st.some((p) => Math.abs(p[0]) < 0.6 && Math.abs(p[1] + 8) < 0.6), 'the stations miss the third click');
  assert(JSON.stringify(st[0]) === JSON.stringify([-5, 0, Z]) && JSON.stringify(st[st.length - 1]) === JSON.stringify([5, 0, Z]),
    'the ends moved');
});

Deno.test('drawarc: the clicked heights carry round the arc, a to the third click to b', () => {
  const st = arcStations([-10, 0, 10], [10, 0, 30], [0, 10, 20], 1, 3);
  const zs = st.map((p) => p[2]);
  assert(zs.every((z, i) => i === 0 || z >= zs[i - 1] - 1e-9), 'hint heights not monotonic a -> m -> b');
  const mid = st.reduce((b, p) => (Math.hypot(p[0], p[1] - 10) < Math.hypot(b[0], b[1] - 10) ? p : b));
  assertClose(mid[2], 20, 0.6, 'the third click\'s height');
});

Deno.test('drawarc: a curve tighter than the foot can follow is refused, with the radius', () => {
  const R = DRAW_MIN_RADIUS - 1;
  const r = drawnWall([-R, 0, Z], [R, 0, Z], slab().pos, 0, { through: [0, R, Z] });
  assert(!r.ok && /curve too tight — 4\.0mm radius, needs 5mm/.test(r.reason), `got ${r.ok ? 'a wall' : r.reason}`);
  const ok = drawnWall([-DRAW_MIN_RADIUS, 0, Z], [DRAW_MIN_RADIUS, 0, Z], slab().pos, 0, { through: [0, DRAW_MIN_RADIUS, Z] });
  assert(ok.ok, `a curve at the minimum radius refused: ${ok.reason}`);
});

Deno.test('drawarc: a tined curved wall is watertight and only its tines enter the part', () => {
  // draw.test.js's tilted block: its 45 deg underside has the sideways normal tines
  // grip by (a level ceiling takes none, straight or curved). Each click on the underside.
  const topo = tiltedBlockTopo(-20, 20, -30, 30, -6, 6, 45);
  const at = (x, y) => [x, y, Math.min(...prop.surfaceZsAt(topo.pos, x, y))];
  const a = at(-10, 4), b = at(10, 4), m = at(0, 10);
  const opts = { through: m, tines: true, topo, rot: IDENTITY, offset: OFF, tineDensity: 1 };
  const tined = drawnWall(a, b, topo.pos, 0, opts);
  const plain = drawnWall(a, b, topo.pos, 0, { through: m });
  assert(tined.ok && plain.ok, `curved wall failed: ${tined.reason ?? plain.reason}`);
  assert(tined.tines > 0, 'no tines on the curved wall');
  assert(isClosed(tined.tris), 'tined curved wall is not closed');
  assert(insideCount(topo, IDENTITY, OFF, plain.tris) === 0, 'the curved wall itself is inside the part');
});
