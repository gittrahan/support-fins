// The tests' tine capture (globalThis.__TINECAP) must hold exactly the tines the build
// kept: every candidate wall a pass builds and drops (a race's loser, a fill wall that
// touches a support or holds no new red) takes its tines back out. Several tests read
// the capture for the lowest tine or the comb's spacing, so a stray tine reads as grip
// that is not there. One table over every mode, on parts with and without bends.

import { loadModel, analyze, fins, tiltedBlockTopo, prop, assert } from './_util.js';
import { sitePose } from './_scene.js';

const { drawnWall } = await import('../web/draw.js');

const MODES = [
  ['auto', { mode: 'auto' }],
  ['auto + curved walls', { mode: 'auto', curvedWalls: true }],
  ['full', { mode: 'auto', coverage: 1 }],
  ['full + curved walls', { mode: 'auto', coverage: 1, curvedWalls: true }],
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
