// Sway's lowestHit (web/swayhit.js) goes through an XY triangle grid (web/triindex.js)
// instead of scanning every triangle. The grid may only skip triangles that cannot
// touch the rib's box, so the answer must be bit-identical to the full scan:
//   - (the same, with the rib's z bounds, where each candidate is first checked against the rib's (s, u, z) box)
//   - on boxes of every orientation, size and height over several models, the indexed
//     lowest z equals lowestHitBrute's (including Infinity for "nothing crosses");
// tests/sway*.test.js cover sway.js's own calls through it.

import { loadModel, blockTopo, tiltedBlockTopo, assert } from './_util.js';

const WEB = new URL('../web/', import.meta.url).href;
const { lowestHit, lowestHitBrute } = await import(`${WEB}swayhit.js`);

// Small deterministic PRNG, so a failure reproduces.
function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

/** A rib-shaped query: slab across the face, outline in (s, z) as sway.js builds it. */
function randomQuery(rand, lo, hi) {
  const ang = rand() * Math.PI * 2;
  const nh = { x: Math.cos(ang), y: Math.sin(ang) };
  const uDir = { x: -nh.y, y: nh.x };
  const cx = lo[0] + rand() * (hi[0] - lo[0]), cy = lo[1] + rand() * (hi[1] - lo[1]);
  const uc = cx * uDir.x + cy * uDir.y, s0 = cx * nh.x + cy * nh.y;
  const th = 1 + rand() * 4, depth = 3 + rand() * 25, slope = (rand() - 0.5) * 0.4;
  const z0 = rand() * (hi[2] - lo[2]) * 0.5, z1 = z0 + 2 + rand() * (hi[2] - lo[2]);
  const sIn = (z) => s0 + slope * z, sOut = (z) => s0 + slope * z + depth;
  const outline = [
    (q) => q[2] - z0, (q) => z1 - q[2],
    (q) => q[0] - (sIn(q[2]) - 0.05), (q) => (sOut(q[2]) + 0.1) - q[0],
  ];
  const sLo = Math.min(sIn(z0), sIn(z1)) - 0.05, sHi = Math.max(sOut(z0), sOut(z1)) + 0.1;
  return { fr: { nh, uDir }, uLo: uc - th / 2 - 0.3, uHi: uc + th / 2 + 0.3, outline, sLo, sHi, zLo: z0, zHi: z1 };
}

function bounds(tris) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i += 3) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], tris[i + k]); hi[k] = Math.max(hi[k], tris[i + k]);
  }
  return { lo, hi };
}

const scenes = {
  sphere: loadModel('sphere'), torus: loadModel('torus'), lbracket: loadModel('lbracket'),
  staircase: loadModel('staircase'), tshape: loadModel('tshape'), lowledge: loadModel('lowledge'),
  post: blockTopo(-20, 20, -15, 15, 0, 150), tilted: tiltedBlockTopo(-20, 20, -15, 15, 0, 100, 25),
};

for (const [name, topo] of Object.entries(scenes)) {
  Deno.test(`lowestHit through the grid equals the full scan: ${name}`, () => {
    const tris = Float64Array.from(topo.pos.subarray(0, topo.nFaces * 9));
    const { lo, hi } = bounds(tris);
    // Boxes mostly over the part, some beside it, so both hits and misses are checked.
    const pad = [(hi[0] - lo[0]) * 0.2, (hi[1] - lo[1]) * 0.2, 0];
    const rand = rng(name.length * 7919 + 1);
    let hits = 0, misses = 0;
    for (let n = 0; n < 400; n++) {
      const q = randomQuery(rand, lo.map((v, k) => v - pad[k]), hi.map((v, k) => v + pad[k]));
      const want = lowestHitBrute(tris, q.fr, q.uLo, q.uHi, q.outline);
      const got = lowestHit(tris, q.fr, q.uLo, q.uHi, q.outline, q.sLo, q.sHi);
      assert(Object.is(got, want), `${name} query ${n}: grid ${got} vs scan ${want}`);
      // with the z bounds sway.js passes: the per-triangle box test must not drop a crossing
      const gotZ = lowestHit(tris, q.fr, q.uLo, q.uHi, q.outline, q.sLo, q.sHi, q.zLo, q.zHi);
      assert(Object.is(gotZ, want), `${name} query ${n}: grid+box ${gotZ} vs scan ${want}`);
      if (want === Infinity) misses++; else hits++;
    }
    assert(hits > 20 && misses > 20, `${name}: queries should include both hits (${hits}) and misses (${misses})`);
  });
}
