// The site's First layer field (web/index.html #first-layer, ui/finbuild.js pageLevels):
// a 0.2 mm first layer under 0.12 mm layers (an A1 "0.12 Fine" profile) moves every
// layer boundary 0.08 off the plate-origin grid. A tine has to fill the layer right
// under the part's first layer over it -- one lower leaves an empty layer between
// them, one higher prints it in the part's own layer. The grid gets that wrong for a
// quarter or so of the tines; the levels from firstLayerLevels get every one right.

import { tiltedBlockTopo, analyze, prop, assert, tineBoxes } from './_util.js';

const WEB = new URL('../web/', import.meta.url).href;
const { buildFins } = await import(`${WEB}fins.js`);
const { withLevels, firstLayerLevels, levelsOn } = await import(`${WEB}prop/levels.js`);
const { drawnWall } = await import(`${WEB}draw.js`);
const { emitTines, PROP } = prop;
const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Boundaries of the real print: first, then `h` layers, up to 60 mm. */
const real = (first, h) => { const z = [0, first]; while (z.at(-1) < 60) z.push(Math.round((z.at(-1) + h) * 1e6) / 1e6); return z; };

/** Each tine of the wall under a block tilted `tilt` deg: how many layers sit between
 *  the layer it prints in (the one whose mid-height it holds, as a slicer cuts) and the
 *  part's first layer over its underside. 0 is right. */
function gaps(tilt, h, levels, L) {
  const topo = tiltedBlockTopo(-20, 20, -15, 15, 0, 30, tilt), res = analyze(topo, 45, I);
  const line = buildFins(topo, res, I, { mode: 'auto', bedPad: false, tines: false }).fins[0].line;
  const out = [];
  globalThis.__TINECAP = [];
  try {
    withLevels(levels, () => emitTines(line, null, topo, I, res.offset, out, PROP.tineStep, PROP.baseH + 0.2, h));
    const { tines } = tineBoxes(out), cap = globalThis.__TINECAP;
    assert(tines.length === cap.length && tines.length > 5, `${tines.length} boxes, ${cap.length} tines`);
    const layerOfMid = (z) => { let i = 0; while (i + 1 < L.length && (L[i] + L[i + 1]) / 2 < z) i++; return i; };
    return tines.map((t, k) => {
      const under = cap[k].z + (t.hi[2] - t.lo[2]) / 2;        // zMid is the underside less half the tine
      const printed = [];
      for (let i = 0; i + 1 < L.length; i++) {
        const mid = (L[i] + L[i + 1]) / 2;
        if (mid > t.lo[2] + 1e-9 && mid <= t.hi[2] + 1e-9) printed.push(i);
      }
      assert(printed.length === 1, `a tine prints in ${printed.length} layers`);
      return layerOfMid(under) - printed[0] - 1;
    });
  } finally {
    globalThis.__TINECAP = undefined;
  }
}

Deno.test('first layer: the field matching the layer height sends no levels', () => {
  assert(firstLayerLevels(0.2, 0.2) === null && firstLayerLevels(0.12, 0.12) === null);
  assert(firstLayerLevels(0.2, NaN) === null && firstLayerLevels(NaN, 0.2) === null);
  assert(JSON.stringify(firstLayerLevels(0.12, 0.2)) === JSON.stringify([0, 0.2, 0.32]));
});

Deno.test('first layer: 0.2 under 0.12 layers puts every tine under the part, where the grid misses', () => {
  const L = real(0.2, 0.12);
  let gridMiss = 0;
  for (const tilt of [35, 40, 45, 50]) {
    const g = gaps(tilt, 0.12, null, L), f = gaps(tilt, 0.12, firstLayerLevels(0.12, 0.2), L);
    gridMiss += g.filter((d) => d !== 0).length;
    assert(f.every((d) => d === 0), `tilt ${tilt}: layers between tine and part ${JSON.stringify(f)}`);
  }
  assert(gridMiss > 0, 'the grid put every tine right too: this test no longer shows the offset');
});

Deno.test('first layer: a drawn wall takes the levels for its own build and puts them back', () => {
  // draw.test.js's set-up: a block tilted 45 deg about X, the wall drawn along X
  const topo = tiltedBlockTopo(-20, 20, -30, 30, -6, 6, 45), OFF = { x: 0, y: 0, z: 0 };
  let at = null;
  for (let y = -25; y <= 25; y += 0.5) {
    const zs = prop.surfaceZsAt(topo.pos, 0, y);
    if (zs.length < 2) continue;
    const under = Math.min(...zs);
    if (under >= 4 && Math.max(...zs) - under >= 1 && (!at || under > at.z)) at = { y, z: under };
  }
  const wall = (levels) => drawnWall([-8, at.y, at.z], [8, at.y, at.z], topo.pos, 0,
    { tines: true, topo, rot: I, offset: OFF, tineDensity: 1, layerHeight: 0.12, ...(levels === undefined ? {} : { levels }) });
  const grid = wall(undefined), lev = wall(firstLayerLevels(0.12, 0.2));
  assert(grid.ok && lev.ok, `drawn wall failed: ${grid.reason ?? lev.reason}`);
  assert(!levelsOn(), 'levels stayed set after a drawn wall');
  assert(JSON.stringify(grid.tris) !== JSON.stringify(lev.tris), 'the levels moved nothing on a drawn wall');
  assert(JSON.stringify(wall(null).tris) === JSON.stringify(grid.tris), 'levels null is not the grid');
});

Deno.test('first layer: a clicked brace takes the levels for its own build and puts them back', async () => {
  // anchor_short.test.js's column: a 10 x 10 x 40 block, an anchor up its -x side
  const { block, buildTopology } = await import('./_util.js');
  const sway = await import(`${WEB}sway.js`);
  const pos = block(0, 10, 0, 10, 0, 40);
  const topo = buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
  const res = analyze(topo, 45, I);
  let side = -1;
  for (let f = 0; f < topo.nFaces && side < 0; f++) if (topo.nrm[f * 3] < -0.9) side = f;
  const at = (levels) => sway.swayAtFace(topo, res, I, side, [res.offset.x, 5 + res.offset.y, 20],
    { tines: true, layerHeight: 0.12, gap: 0.2, reach: 1, anchor: true, ...(levels === undefined ? {} : { levels }) });
  const grid = at(undefined), lev = at(firstLayerLevels(0.12, 0.2));
  assert(grid.ok && lev.ok, `brace failed: ${grid.reason ?? lev.reason}`);
  assert(!levelsOn(), 'levels stayed set after a brace');
  assert(JSON.stringify(grid.tris) !== JSON.stringify(lev.tris), 'the levels moved nothing on a brace');
  assert(JSON.stringify(at(null).tris) === JSON.stringify(grid.tris), 'levels null is not the grid');
});
