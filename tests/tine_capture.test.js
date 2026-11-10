// The tine capture (globalThis.__TINECAP) must hold exactly the tines the build kept.
// Every candidate a pass builds and drops (a race's loser, a fill wall that touches a
// support or holds no new red, the fill's losing rows-or-patches build, a last-resort
// short wall that meets a support) takes its tines back out. The tests read the capture
// for the lowest tine and the comb's spacing, and judgeDownhill compares builds on the
// lowest captured tine, so a stray tine reads as grip that is not there.
// Pinned: capture = built tines for Auto, Full (mode 'full'), each with Curved walls,
// and Draw's pad, on torus, tube and lbracket, plus one drawn wall and the last-resort
// walls. Not pinned: the sway braces, and parts that need a private model.

import { loadModel, analyze, fins, tiltedBlockTopo, prop, assert } from './_util.js';
import { sitePose } from './_scene.js';

const { drawnWall } = await import('../web/draw.js');

const MODES = [
  ['auto', { mode: 'auto' }],
  ['auto + curved walls', { mode: 'auto', curvedWalls: true }],
  ['full', { mode: 'full' }],
  ['full + curved walls', { mode: 'full', curvedWalls: true }],
  ['draw (pad only)', { mode: 'draw' }],
];
const PARTS = [['torus', 30], ['tube', 60], ['lbracket', 35]];

for (const [model, deg] of PARTS) {
  for (const [label, extra] of MODES) {
    Deno.test(`tine capture = built tines: ${model} X${deg}, ${label}`, () => {
      const topo = loadModel(model), rot = sitePose([deg, 0, 0]);
      const res = analyze(topo, 45, rot);
      globalThis.__TINECAP = [];
      let b, cap;
      try {
        b = fins.buildFins(topo, res, rot, { bedPad: true, tines: true, ...extra });
        cap = globalThis.__TINECAP;
      } finally { globalThis.__TINECAP = undefined; }
      const records = b.fins.filter((f) => f.kind !== 'sway').reduce((a, f) => a + f.tines, 0);
      assert(cap.length === b.tines, `${model} ${label}: capture ${cap.length} vs built ${b.tines}`);
      assert(records === b.tines, `${model} ${label}: records ${records} vs built ${b.tines}`);
    });
  }
}

Deno.test('tine capture = built tines: a drawn wall, and a drawn wall that is refused', () => {
  const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const topo = tiltedBlockTopo(-20, 20, -30, 30, -6, 6, 45);
  let y = null, z = 0;
  for (let t = -25; t <= 25; t += 0.5) {
    const zs = prop.surfaceZsAt(topo.pos, 0, t);
    if (zs.length < 2) continue;
    const under = Math.min(...zs);
    if (under >= 4 && under > z) { y = t; z = under; }
  }
  assert(y !== null, 'test setup: an overhang to draw under');
  const opts = { tines: true, topo, rot: IDENTITY, offset: { x: 0, y: 0, z: 0 }, tineDensity: 1 };
  for (const [a, b, ok] of [[[-8, y, z], [8, y, z], true], [[-8, y, z], [-8.1, y, z], false]]) {
    globalThis.__TINECAP = [];
    try {
      const r = drawnWall(a, b, topo.pos, 0, opts);
      assert(r.ok === ok, `drawn wall ok=${r.ok}, expected ${ok}`);
      assert(globalThis.__TINECAP.length === (r.ok ? r.tines : 0), `capture ${globalThis.__TINECAP.length} vs wall ${r.tines}`);
    } finally { globalThis.__TINECAP = undefined; }
  }
});

Deno.test('tine capture = built tines: the last-resort short walls drop the ones that meet a support', async () => {
  const { lastResortWalls } = await import('../web/fins/shortwalls.js');
  const topo = loadModel('lbracket'), rot = sitePose([35, 0, 0]);
  const res = analyze(topo, 45, rot);
  const opts = { tines: true, layerHeight: 0.2, coverage: 0.5 };
  // `existing` is every support vertex already built: none, or one box over everything
  const big = [];
  for (const [x, y, z] of [[-500, -500, -500], [500, -500, -500], [0, 500, 500]]) big.push([x, y, z]);
  const rows = [];
  for (const existing of [[], big]) {
    globalThis.__TINECAP = [];
    try {
      const r = lastResortWalls(topo, res, rot, opts, [], [], existing);
      rows.push({ cap: globalThis.__TINECAP.length, tines: r.tines, props: r.props.length });
    } finally { globalThis.__TINECAP = undefined; }
  }
  assert(rows[0].props > 0 && rows[0].tines > 0, 'test setup: short walls build with nothing in the way');
  assert(rows[0].cap === rows[0].tines, `kept: capture ${rows[0].cap} vs tines ${rows[0].tines}`);
  assert(rows[1].props === 0 && rows[1].cap === 0, `all dropped: ${rows[1].props} walls, capture ${rows[1].cap}`);
});
