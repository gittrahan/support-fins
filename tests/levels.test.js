// Layer boundaries (web/prop/levels.js): a host that knows its slicer's layers passes
// them as `levels`, and every tine fills exactly one of those layers.
//   - the helpers: the tine's layer is the one under the nearest boundary, a sway
//     tine's starts on the nearest boundary, the crest cuts on a boundary, and past the
//     last boundary the top layer's height repeats; a bad list is refused by name;
//   - a 0.3 mm first layer under 0.2 mm layers: on the plate-origin grid every tine
//     straddles a real boundary (two thin beads); with levels each fills one layer;
//   - an adaptive stack: each tine fills one layer, whatever its height;
//   - a sway brace's tines and the bed pad's first layer take the boundaries too;
//   - buildFins sets them for its own build only: the next build without them is
//     the same as one that never saw them, also after a build that threw.
// Without levels nothing moves: golden.test.js pins that.

import { tiltedBlockTopo, block, buildTopology, analyze, prop, loadModel, rotX, assert, assertClose, bbox, tineBoxes } from './_util.js';

const WEB = new URL('../web/', import.meta.url).href;
const { buildFins, applyTunables } = await import(`${WEB}fins.js`);
const { withLevels, levelsOn, tineBand, levelCell, levelCut, firstLayerHeight } = await import(`${WEB}prop/levels.js`);
const { crestCut } = await import(`${WEB}prop/crest.js`);
const sway = await import(`${WEB}sway.js`);

const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const { emitTines, PROP } = prop;

/** Boundaries from 0: a first layer, then `rest` heights repeated up to `top` mm. */
function stack(first, rest, top = 60) {
  const z = [0, first];
  for (let k = 0; z.at(-1) < top; k++) z.push(Math.round((z.at(-1) + rest[k % rest.length]) * 1e6) / 1e6);
  return z;
}
const FIRST_03 = stack(0.3, [0.2]);                                         // 0, 0.3, 0.5, 0.7, ...
const ADAPTIVE = stack(0.2, [0.08, 0.12, 0.16, 0.2, 0.24, 0.28, 0.2, 0.12]); // uneven heights

/** The layer [levels[i], levels[i + 1]] a tine box fills, or -1 when it fills none exactly. */
function layerOf(t, levels) {
  const i = levels.findIndex((z) => Math.abs(z - t.lo[2]) < 1e-9);
  return i >= 0 && i + 1 < levels.length && Math.abs(levels[i + 1] - t.hi[2]) < 1e-9 ? i : -1;
}

/** Tines along an Auto wall's contact line on a block tilted `tilt` deg (the
 *  thick-layer test's set-up, tines.test.js), with these levels or the grid. */
function wallTines(tilt, levels, layerHeight = 0.2) {
  const topo = tiltedBlockTopo(-20, 20, -15, 15, 0, 30, tilt), res = analyze(topo, 45, I);
  const line = buildFins(topo, res, I, { mode: 'auto', bedPad: false, tines: false }).fins[0].line;
  const out = [];
  const n = withLevels(levels, () => emitTines(line, null, topo, I, res.offset, out, PROP.tineStep, PROP.baseH + 0.2, layerHeight));
  const { tines } = tineBoxes(out);
  assert(tines.length === n, `${tines.length} tine boxes for ${n} tines`);
  return { tines, line };
}

Deno.test('levels: the helpers read a stack, and repeat the top layer past its end', () => {
  const L = [0, 0.3, 0.5, 0.7, 0.9];
  withLevels(L, () => {
    assert(levelsOn());
    assertClose(firstLayerHeight(), 0.3, 1e-12);
    // nearest boundary on top, the one before at the bottom (the grid's Math.round)
    let b = tineBand(0.62);
    assert(b.top === 0.7 && b.bot === 0.5 && Math.abs(b.below - 0.2) < 1e-12, JSON.stringify(b));
    b = tineBand(0.6);                                // a tie goes up, as Math.round does
    assert(b.top === 0.7 && b.bot === 0.5, JSON.stringify(b));
    b = tineBand(0.1);                                // never under the first layer
    assert(b.top === 0.3 && b.bot === 0 && b.below === 0.3, JSON.stringify(b));
    b = tineBand(1.25);                               // past the end: 0.2 layers go on
    assertClose(b.top, 1.3, 1e-12); assertClose(b.bot, 1.1, 1e-12);
    // a sway tine starts on the nearest boundary
    const c = levelCell(0.62);
    assert(c.bot === 0.7 && c.top === 0.9, JSON.stringify(c));
    // a wall top at 0.95 prints up to the layer [0.7, 0.9] (the next one's middle,
    // 1.0, is above it): a one-layer crest starts at 0.7, a two-layer one at 0.5
    assert(levelCut(0.95, 1) === 0.7 && levelCut(0.95, 2) === 0.5);
    assert(crestCut(0.95, 1.2, 0, 'flat').cut === levelCut(0.95, PROP.ifaceLayers), 'the crest cuts on a boundary');
  });
  assert(!levelsOn(), 'levels stay set after withLevels');
});

Deno.test('levels: a bad list is refused by name, and the build before is put back', () => {
  for (const [bad, why] of [[[0.1, 0.3], 'start at 0'], [[0, 0.3, 0.3], 'rise'], [[0, 0.3, 0.2], 'rise'],
                            [[0], 'at least two'], [[0, NaN], 'rise'], ['0, 0.2', 'at least two']]) {
    let msg = '';
    try { withLevels(bad, () => {}); } catch (e) { msg = e.message; }
    assert(msg.includes(why), `${JSON.stringify(bad)}: "${msg}"`);
  }
  withLevels([0, 0.3, 0.5], () => {
    try { withLevels([0, 0.2, 0.4], () => { throw new Error('boom'); }); } catch { /* the build failed */ }
    assert(levelsOn() && firstLayerHeight() === 0.3, 'a failed inner build did not put the outer levels back');
  });
  assert(!levelsOn());
});

Deno.test('levels: under a 0.3 mm first layer every tine fills one layer (the grid straddles)', () => {
  for (const tilt of [35, 40]) {
    // the plate-origin grid: tines on 0.2 k, so each one crosses a boundary at 0.3 + 0.2 k
    const grid = wallTines(tilt, null).tines;
    assert(grid.length > 0, `tilt ${tilt}: no tines`);
    for (const t of grid) assert(layerOf(t, FIRST_03) < 0, `tilt ${tilt}: a grid tine fills a real layer`);
    // with the slicer's boundaries each tine is exactly one layer of the print
    const { tines, line } = wallTines(tilt, FIRST_03);
    assert(tines.length === grid.length, `tilt ${tilt}: ${tines.length} tines with levels, ${grid.length} on the grid`);
    const zs = line.map((p) => p[2]);
    for (const t of tines) {
      const i = layerOf(t, FIRST_03);
      assert(i >= 0, `tilt ${tilt}: a tine ${t.lo[2].toFixed(4)}..${t.hi[2].toFixed(4)} is not one layer`);
      assert(t.hi[2] >= Math.min(...zs) - 0.1 - 1e-9 && t.hi[2] <= Math.max(...zs) + 0.1 + 1e-9,
             `tilt ${tilt}: a tine top ${t.hi[2]} is more than half a layer off the underside`);
    }
  }
});

Deno.test('levels: on an adaptive stack each tine fills one layer, whatever its height', () => {
  const heights = new Set();
  for (const tilt of [35, 40]) {
    const { tines } = wallTines(tilt, ADAPTIVE);
    assert(tines.length > 0, `tilt ${tilt}: no tines`);
    for (const t of tines) {
      const i = layerOf(t, ADAPTIVE);
      assert(i >= 0, `tilt ${tilt}: a tine ${t.lo[2].toFixed(4)}..${t.hi[2].toFixed(4)} is not one layer`);
      heights.add(Math.round((ADAPTIVE[i + 1] - ADAPTIVE[i]) * 100));
    }
  }
  assert(heights.size >= 2, `every tine landed in a layer of one height (${[...heights]})`);
});

Deno.test('levels: a sway brace tine fills one layer too', () => {
  // BorisKozo's upside-down L (anchor_short.test.js): a column with an arm out the top
  const a = block(0, 10, 0, 10, 0, 40), b = block(10, 40, 0, 10, 35, 40);
  const pos = new Float32Array(a.length + b.length);
  pos.set(a); pos.set(b, a.length);
  const topo = buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
  const res = analyze(topo, 45, I);
  let side = -1;
  for (let f = 0; f < topo.nFaces && side < 0; f++) if (topo.nrm[f * 3] < -0.9) side = f;
  const hit = [res.offset.x, 5 + res.offset.y, 30];
  const o = { tines: true, layerHeight: 0.2, gap: 0.2, reach: 1, anchor: true };
  const build = (levels, opts) => withLevels(levels, () => sway.swayAtFace(topo, res, I, side, hit, opts));
  for (const levels of [FIRST_03, ADAPTIVE]) {
    const r = build(levels, o), bare = build(levels, { ...o, tines: false });
    assert(r.ok && bare.ok && r.tines > 0, `anchor refused: ${r.reason ?? bare.reason}`);
    // the rib and foot come first, the tines after: the tineless build is the prefix
    const tris = r.tris.slice(bare.tris.length);
    const per = tris.length / r.tines;
    for (let k = 0; k < r.tines; k++) {
      const t = bbox(tris.slice(k * per, (k + 1) * per));
      assert(layerOf(t, levels) >= 0, `a brace tine ${t.lo[2].toFixed(4)}..${t.hi[2].toFixed(4)} is not one layer`);
    }
  }
});

Deno.test('levels: the bed pad is one first layer tall', () => {
  const topo = loadModel('lbracket'), rot = rotX(40), res = analyze(topo, 45, rot);
  applyTunables({ padStyle: 'light' });
  try {
    for (const first of [0.2, 0.28, 0.35]) {
      const b = buildFins(topo, res, rot, { mode: 'auto', bedPad: true, tines: true, layerHeight: 0.2,
                                            levels: stack(first, [0.2]) });
      assert(b.padTriangles?.length > 0, 'test setup: lbracket X40 has no pad');
      assertClose(bbox(b.padTriangles).hi[2], first, 1e-9, `${first} mm first layer: pad`);
    }
  } finally {
    applyTunables({ padStyle: 'auto' });
  }
});

Deno.test('levels: one build only -- the next build without them is unchanged', () => {
  const topo = loadModel('lbracket'), rot = rotX(40), res = analyze(topo, 45, rot);
  const opts = { mode: 'full', bedPad: true, tines: true, layerHeight: 0.2 };
  const plain = () => JSON.stringify(Array.from(buildFins(topo, res, rot, opts).triangles.flat()));
  const before = plain();
  const levelled = buildFins(topo, res, rot, { ...opts, levels: FIRST_03 });
  assert(!levelsOn(), 'buildFins left its levels set');
  assert(JSON.stringify(Array.from(levelled.triangles.flat())) !== before, 'levels moved nothing');
  let threw = false;
  try { buildFins(topo, res, rot, { ...opts, levels: [0, 0.3, 0.2] }); } catch { threw = true; }
  assert(threw && !levelsOn(), 'a refused list must throw and leave nothing set');
  assert(plain() === before, 'a build after a levelled one changed');
});
