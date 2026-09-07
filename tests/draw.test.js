// Draw mode places a hand-drawn breakaway WALL under the line the user draws, and
// (Matthew's ask) that wall grips the part with the same tine comb the auto fins
// use when Tines is on. These pin: a drawn wall builds, it carries tines with the
// toggle on and none with it off, the geometry stays watertight, and the tines --
// and only the tines -- bite into the part.

import { WEB, tiltedBlockTopo, prop, isClosed, insideCount, assert } from './_util.js';

const { drawnWall } = await import(`${WEB}draw.js`);
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const OFF = { x: 0, y: 0, z: 0 };

// A 40x60x12 block tilted 45 deg about X (baked into the verts, min z = 0), so its
// underside is a broad downward overhang whose face still has enough horizontal
// normal to grip. The tilt is about X, so at a fixed Y the underside height is
// constant in X -- draw the wall along X for a clean, level contact line.
function tiltedBlock() {
  const topo = tiltedBlockTopo(-20, 20, -30, 30, -6, 6, 45);
  // Find a Y where the vertical ray passes through the solid (top + underside) with
  // the underside standing a good few mm off the plate -- a real overhang to prop.
  let best = null;
  for (let y = -25; y <= 25; y += 0.5) {
    const zs = prop.surfaceZsAt(topo.pos, 0, y);
    if (zs.length < 2) continue;
    const under = Math.min(...zs), top = Math.max(...zs);
    if (under < 4 || top - under < 1) continue;       // too near the plate / too thin
    if (!best || under > best.under) best = { y, under, top };
  }
  assert(best, 'test setup: found no overhang Y on the tilted block');
  return { topo, y: best.y, z: best.under };
}

function draw(tines) {
  const { topo, y, z } = tiltedBlock();
  const a = [-8, y, z], b = [8, y, z];              // 16mm along X, level underside
  const r = drawnWall(a, b, topo.pos, 0,
    { tines, topo, rot: IDENTITY, offset: OFF, tineDensity: 1 });
  return { topo, r };
}

Deno.test('draw: a wall builds under the drawn line on a tilted overhang', () => {
  const { r } = draw(false);
  assert(r.ok, `drawn wall failed: ${r.reason}`);
  assert(r.tris.length > 0, 'drawn wall produced no geometry');
});

Deno.test('draw: Tines ON grips the part, OFF is a plain breakaway wall', () => {
  const on = draw(true).r;
  const off = draw(false).r;
  assert(on.ok && off.ok, 'drawn wall failed to build');
  assert(on.tines > 0, `Tines on emitted no tines (${on.tines})`);
  assert(!off.tines, `Tines off still emitted tines (${off.tines})`);
});

Deno.test('draw: a tined wall is watertight', () => {
  const { r } = draw(true);
  assert(isClosed(r.tris), 'tined drawn-wall geometry is not closed');
});

Deno.test('draw: only the tines bite into the part, never the wall', () => {
  const { topo, r: on } = draw(true);
  const off = draw(false).r;
  const inWith = insideCount(topo, IDENTITY, OFF, on.tris);
  const inWithout = insideCount(topo, IDENTITY, OFF, off.tris);
  // The bare wall stands off by the breakaway gap -- nothing of it inside the part.
  assert(inWithout === 0, `the plain wall pokes into the part (${inWithout} verts inside)`);
  // Turning tines on is the ONLY thing that adds interior bite.
  assert(inWith > inWithout, 'Tines on added no bite into the part');
});
