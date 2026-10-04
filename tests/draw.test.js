// Draw mode places a hand-drawn breakaway WALL under the line the user draws, and
// (Matthew's ask) that wall grips the part with the same tine comb the auto fins
// use when Tines is on. These pin: a drawn wall builds, it carries tines with the
// toggle on and none with it off, the geometry stays watertight, and the tines --
// and only the tines -- bite into the part.

import { WEB, tiltedBlockTopo, prop, block, buildTopology, isClosed, insideCount, assert } from './_util.js';

const { drawnWall, DRAW_MIN_LEN } = await import(`${WEB}draw.js`);
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

// ---- Draw opens up (local issue 011): short walls, squat walls on the plate and on the part.
// Each case here was refused before; a drawn wall that built before builds the same (golden
// cube-x40-draw), because the squat walls are only tried after both full-height walls fail.

const topoOf = (...blocks) => {
  const pos = new Float32Array(blocks.flatMap((b) => [...b]));
  return buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
};
const lowest = (tris) => Math.min(...tris.map((v) => v[2]));

Deno.test('draw: a short wall (3 mm) builds; under DRAW_MIN_LEN still refuses', () => {
  const { topo, y, z } = tiltedBlock();
  const r = drawnWall([-1.5, y, z], [1.5, y, z], topo.pos, 0);
  assert(r.ok, `3 mm drawn wall refused: ${r.reason}`);
  const h = DRAW_MIN_LEN * 0.6;
  const no = drawnWall([-h / 2, y, z], [h / 2, y, z], topo.pos, 0);
  assert(!no.ok && /too short/.test(no.reason), `a ${h} mm line should refuse as too short`);
});

Deno.test('draw: a squat wall on the plate under a low overhang (0.8 mm of wall)', () => {
  const topo = topoOf(block(-10, 10, -5, 5, 1.0, 4));          // underside 1 mm over the plate
  const r = drawnWall([-5, 0, 1.0], [5, 0, 1.0], topo.pos, 0);
  assert(r.ok && r.squat && !r.partAttached, `expected a squat plate wall: ${JSON.stringify({ ok: r.ok, reason: r.reason })}`);
  assert(Math.abs(lowest(r.tris)) < 1e-6, 'a plate wall should stand on z 0');
  assert(isClosed(r.tris), 'the squat wall is not closed');
  assert(insideCount(topo, IDENTITY, OFF, r.tris) === 0, 'the squat wall pokes into the part');
});

Deno.test('draw: a squat wall on the part under a shelf 1.2 mm over it', () => {
  // a hand just over a thigh: slab z 0-3, shelf z 4.2-6 above it
  const topo = topoOf(block(-15, 15, -10, 10, 0, 3), block(-12, 12, -6, 6, 4.2, 6));
  const r = drawnWall([-6, 0, 4.2], [6, 0, 4.2], topo.pos, 0);
  assert(r.ok && r.squat && r.partAttached, `expected a squat wall on the part: ${JSON.stringify({ ok: r.ok, reason: r.reason })}`);
  assert(Math.abs(lowest(r.tris) - (3 + prop.PROP.footGap)) < 1e-3, `foot should sit footGap over the slab, at ${lowest(r.tris)}`);
  assert(isClosed(r.tris), 'the squat wall is not closed');
  assert(insideCount(topo, IDENTITY, OFF, r.tris) === 0, 'the squat wall pokes into the part');
});

Deno.test('draw: under minHeightSquat of room still refuses', () => {
  const topo = topoOf(block(-10, 10, -5, 5, 0.6, 4));          // 0.6 - gap 0.2 = 0.4 mm of wall
  const r = drawnWall([-5, 0, 0.6], [5, 0, 0.6], topo.pos, 0);
  assert(!r.ok, 'a wall under minHeightSquat should not build');
});

Deno.test('draw: a line from low to tall mixes a squat stem with the full wall, and is closed', () => {
  // a ramp underside from 1.0 mm to ~9 mm over the plate along X
  const pos = new Float32Array(block(-10, 10, -5, 5, 0, 4));
  for (let i = 0; i < pos.length; i += 3) pos[i + 2] += 1.0 + (pos[i] + 10) * 0.4;   // shear: z += 1 + 0.4 (x + 10)
  const topo = buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
  const zAt = (x) => 1.0 + (x + 10) * 0.4;
  const r = drawnWall([-9, 0, zAt(-9)], [8, 0, zAt(8)], topo.pos, 0);
  assert(r.ok && r.squat, `expected a mixed squat/full wall: ${JSON.stringify({ ok: r.ok, reason: r.reason })}`);
  assert(r.height > prop.PROP.minHeight, 'the tall end should be a full-height wall');
  assert(insideCount(topo, IDENTITY, OFF, r.tris) === 0, 'the mixed wall pokes into the part');
  assert(isClosed(r.tris), 'the mixed wall is not closed (each piece is its own closed solid)');
});

Deno.test('draw: no squat wall through the part -- too little room on a low slab refuses', () => {
  // slab z 0-1, shelf from 1.6: 0.4 mm of room on the slab (under minHeightSquat), and a
  // plate wall would have to pass through the slab to reach the shelf
  const topo = topoOf(block(-15, 15, -10, 10, 0, 1), block(-12, 12, -6, 6, 1.6, 4));
  const r = drawnWall([-6, 0, 1.6], [6, 0, 1.6], topo.pos, 0);
  assert(!r.ok, `built a wall where none fits (squat ${r.squat}, partAttached ${r.partAttached})`);
});

Deno.test('draw: a squat plate wall takes tines from the brim up', () => {
  // the 45deg block's underside where it runs ~1.2 mm over the plate (a tine needs a
  // sloped face to reach into; a level underside takes none)
  const topo = tiltedBlockTopo(-20, 20, -30, 30, -6, 6, 45);
  let at = null;
  for (let y = -30; y <= 30 && !at; y += 0.1) {
    const zs = prop.surfaceZsAt(topo.pos, 0, y);
    if (zs.length >= 2 && Math.abs(Math.min(...zs) - 1.2) < 0.06) at = { y, z: Math.min(...zs) };
  }
  assert(at, 'test setup: no underside ~1.2 mm up on the tilted block');
  const r = drawnWall([-6, at.y, at.z], [6, at.y, at.z], topo.pos, 0,
    { tines: true, topo, rot: IDENTITY, offset: OFF, tineDensity: 1 });
  assert(r.ok && r.squat, `expected a squat plate wall: ${r.reason}`);
  assert(r.tines > 0, 'a squat drawn wall with Tines on emitted no tines');
});
