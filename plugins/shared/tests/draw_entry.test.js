// drawWall (draw_entry.js): Draw mode for the plugins. Pins that it is the
// website's drawn wall (web/draw.js drawnWall, called the way web/ui/walls.js
// calls it), that it doesn't move with where the part sits on the plate, and that
// its material clearances are applied every call and don't leak between calls.
//
//   deno test --allow-read plugins/shared/tests/
import { drawWall } from '../engine/draw_entry.js';
import { computeFins } from '../engine/fins_entry.js';
import { WEB, tiltedBlockTopo, prop, isClosed, assert } from '../../../tests/_util.js';
import { analyze, buildTopology, IDENTITY3 } from '../../../web/overhangs.js';
import { applyTunables } from '../../../web/fins.js';
import { MATERIAL } from '../../../web/materials.js';

const { drawnWall } = await import(`${WEB}draw.js`);

// tests/draw.test.js's part: a 40x60x12 block tilted 45 deg about X, and a level
// 16 mm line along X under its underside, a few mm off the plate.
function tiltedBlock() {
  const topo = tiltedBlockTopo(-20, 20, -30, 30, -6, 6, 45);
  let best = null;
  for (let y = -25; y <= 25; y += 0.5) {
    const zs = prop.surfaceZsAt(topo.pos, 0, y);
    if (zs.length < 2) continue;
    const under = Math.min(...zs), top = Math.max(...zs);
    if (under < 4 || top - under < 1) continue;
    if (!best || under > best.under) best = { y, under };
  }
  assert(best, 'test setup: found no overhang Y on the tilted block');
  return { pos: Float64Array.from(topo.pos), a: [-8, best.y, best.under], b: [8, best.y, best.under] };
}
const moved = (pos, d) => pos.map((v, i) => v + d[i % 3]);
const add = (p, d) => p.map((v, i) => v + d[i]);
const PLATE = [137.25, 88.5, 3.0];

// The site's call (web/ui/walls.js rebuildDrawn): the part in the print frame
// (analyze's offset applied), the clicks in that frame, the material's tunables set.
function siteWall(pos, a, b, material = 'pla', layerHeight = 0.2) {
  const topo = buildTopology({ getAttribute: () => ({ array: pos }) });
  const res = analyze(topo, 45, IDENTITY3);
  const o = [res.offset.x, res.offset.y, res.offset.z];
  const m = MATERIAL[material];
  applyTunables({ padH: m.padH, padGrab: m.padGrab, propGap: m.propGap });
  return drawnWall(add(a, o), add(b, o), moved(pos, o), 0,
    { tines: true, tineDensity: 0, layerHeight, topo, rot: IDENTITY3, offset: res.offset });
}
// a site wall's triangles mapped back out of the print frame
function siteBack(r, pos) {
  const res = analyze(buildTopology({ getAttribute: () => ({ array: pos }) }), 45, IDENTITY3);
  const o = [res.offset.x, res.offset.y, res.offset.z];
  return r.tris.flatMap((p) => [p[0] - o[0], p[1] - o[1], p[2] - o[2]]);
}
const worst = (x, y) => x.reduce((m, v, i) => Math.max(m, Math.abs(v - y[i])), 0);
const back = (r) => {
  const o = [r.offset.x, r.offset.y, r.offset.z];
  return r.triangles.map((v, i) => v - o[i % 3]);
};

Deno.test('drawWall builds the website\'s drawn wall, where the site puts it', () => {
  // off-centre, so the site's seat offset isn't zero and a frame slip would show
  const OFF = [5.5, -7.25, 0];
  const block = tiltedBlock();
  const pos = moved(block.pos, OFF), a = add(block.a, OFF), b = add(block.b, OFF);
  const site = siteWall(pos, a, b);
  const r = drawWall(pos, a, b, {});
  assert(site.ok && r.ok, `site ${site.reason ?? 'ok'}, plugin ${r.reason ?? 'ok'}`);
  assert(r.stats.tines === site.tines, `tines ${r.stats.tines} vs site ${site.tines}`);
  assert(r.triangles.length === site.tris.length * 3, `${r.triangles.length / 9} vs site ${site.tris.length / 3} triangles`);
  const d = worst(back(r), siteBack(site, pos));
  assert(d < 1e-4, `the wall sits ${d} mm from the site's`);
  assert(r.stats.tines > 0, 'the drawn wall should grip with tines (Tines is on by default)');
  assert(isClosed(r.triangles), 'drawn wall is not closed');
});

Deno.test('drawWall: the same wall anywhere on the plate', () => {
  const { pos, a, b } = tiltedBlock();
  const here = drawWall(pos, a, b, {});
  const there = drawWall(moved(pos, PLATE), add(a, PLATE), add(b, PLATE), {});
  assert(here.ok && there.ok, 'drawn wall failed');
  // Seated frames are identical (seat.js), so the walls are bit-identical there...
  assert(here.triangles.length === there.triangles.length && here.triangles.every((v, i) => v === there.triangles[i]),
    'seated triangles differ with plate position');
  // ...and land under the part wherever it sits.
  const h = back(here), t = back(there);
  let worst = 0;
  for (let i = 0; i < h.length; i++) worst = Math.max(worst, Math.abs(t[i] - PLATE[i % 3] - h[i]));
  assert(worst < 1e-4, `mapped-back walls differ by ${worst} mm`);
});

Deno.test('drawWall: PETG is the site\'s PETG wall, and does not leak into the next PLA one', () => {
  const { pos, a, b } = tiltedBlock();
  const pla = drawWall(pos, a, b, {});
  const petg = drawWall(pos, a, b, { material: 'petg' });
  const site = siteWall(pos, a, b, 'petg');
  assert(petg.ok && site.ok, 'PETG wall failed');
  assert(petg.triangles.length === site.tris.length * 3 && petg.stats.tines === site.tines, 'PETG wall differs from the site\'s');
  assert(!(petg.triangles.length === pla.triangles.length && petg.triangles.every((v, i) => v === pla.triangles[i])),
    'PETG wall is identical to PLA: the material never reached it');
  const again = drawWall(pos, a, b, {});
  assert(again.triangles.length === pla.triangles.length && again.triangles.every((v, i) => v === pla.triangles[i]),
    'a PLA wall after a PETG one differs: clearances leaked');
});

Deno.test('drawWall: the layer height reaches the wall (one-layer tines)', () => {
  const { pos, a, b } = tiltedBlock();
  for (const lh of [0.1, 0.3]) {
    const r = drawWall(pos, a, b, { layerHeight: lh });
    const site = siteWall(pos, a, b, 'pla', lh);
    const d = worst(back(r), siteBack(site, pos));
    assert(d < 1e-4, `layer ${lh}: the wall sits ${d} mm from the site's`);
  }
  const thin = back(drawWall(pos, a, b, { layerHeight: 0.1 }));
  const thick = back(drawWall(pos, a, b, { layerHeight: 0.3 }));
  assert(thin.length !== thick.length || worst(thin, thick) > 0.05, 'layer height 0.1 and 0.3 give the same wall');
});

Deno.test('drawWall says why it can\'t build, in the site\'s words', () => {
  const { pos, a } = tiltedBlock();
  const r = drawWall(pos, a, add(a, [1, 0, 0]), {});   // 1 mm, under DRAW_MIN_LEN
  assert(!r.ok && /too short/.test(r.reason), `expected "too short", got ${JSON.stringify(r)}`);
});

Deno.test('drawWall refuses bad endpoints and bad options', () => {
  const { pos, a, b } = tiltedBlock();
  for (const bad of [[1, 2], [1, 2, NaN], 'x', null]) {
    let threw = false;
    try { drawWall(pos, a, bad, {}); } catch { threw = true; }
    assert(threw, `accepted b = ${JSON.stringify(bad)}`);
  }
  let threw = false;
  try { drawWall(pos, a, b, { material: 'abs' }); } catch { threw = true; }
  assert(threw, 'accepted an unknown material');
});

Deno.test('drawWall leaves the next computeFins unchanged', () => {
  const { pos, a, b } = tiltedBlock();
  const before = computeFins(pos, {});
  drawWall(pos, a, b, { material: 'petg', cutout: 'lattice' });
  const after = computeFins(pos, {});
  assert(after.triangles.length === before.triangles.length && after.triangles.every((v, i) => v === before.triangles[i]),
    'computeFins after a drawWall differs from before it');
});
