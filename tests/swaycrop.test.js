// Sway's cross ribs run on a crop of the part (web/swaycrop.js) instead of the whole
// thing. The crop may only drop triangles the rib can't see, so the rib it builds, and
// the Sway brace around it, must be identical to the one built from the whole part.

import { loadModel, blockTopo, tiltedBlockTopo, assert, analyze } from './_util.js';

const WEB = new URL('../web/', import.meta.url).href;
const { cropForRib } = await import(`${WEB}swaycrop.js`);
const { swayAtFace, faceIsUpright } = await import(`${WEB}sway.js`);
const { braceCrossRib } = await import(`${WEB}prop/brace.js`);

const rot = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function rng(seed) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
}

const scenes = {
  lbracket: loadModel('lbracket'), staircase: loadModel('staircase'), tshape: loadModel('tshape'),
  post: blockTopo(-20, 20, -15, 15, 0, 150), tilted: tiltedBlockTopo(-20, 20, -15, 15, 0, 100, 25),
};

for (const [name, topo] of Object.entries(scenes)) {
  Deno.test(`cross ribs from the crop equal those from the whole part: ${name}`, () => {
    const tris = Float64Array.from(topo.pos.subarray(0, topo.nFaces * 9));
    let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
    for (let i = 0; i < tris.length; i += 3) for (let k = 0; k < 2; k++) {
      lo[k] = Math.min(lo[k], tris[i + k]); hi[k] = Math.max(hi[k], tris[i + k]);
    }
    const rand = rng(name.length * 31 + 5);
    let built = 0, blocked = 0;
    for (let n = 0; n < 60; n++) {
      const o = [lo[0] - 25 + rand() * (hi[0] - lo[0] + 50), lo[1] - 25 + rand() * (hi[1] - lo[1] + 50), 0];
      const ang = rand() * Math.PI * 2, d = [Math.cos(ang), Math.sin(ang)];
      const lean = [(rand() - 0.5) * 0.8, (rand() - 0.5) * 0.8];
      const height = 15 + rand() * 60, D0 = 4 + rand() * 12, th = 1 + rand() * 2;
      const run = (part) => {
        const out = [];
        const c = braceCrossRib(out, part, o, d, 0, height, D0, lean, () => true, 0.5, th);
        return JSON.stringify({ c, out });
      };
      const r = Math.max(1.5, D0) + 2 * 0.1 + 1 + th + 1 + 5;   // a few mm wider than the radius sway.js passes, so this tests the crop, not that radius
      const want = run(tris);
      const got = run(cropForRib(tris, o, r, lean, 0, height + 0.1));
      assert(got === want, `${name} case ${n}: crop changed the cross rib`);
      if (JSON.parse(want).c) built++; else blocked++;
    }
    assert(built > 5 && blocked > 0, `${name}: want both built (${built}) and blocked (${blocked}) ribs`);
  });
}

Deno.test('a sway click on a post still gets both cross arms from the crop', () => {
  // end to end through sway.js's crop call
  const topo = scenes.post;
  const res = analyze(topo, 45, rot);
  const f = Array.from({ length: topo.nFaces }, (_, i) => i).find((i) => faceIsUpright(topo, rot, i));
  const c = [0, 1, 2].map((k) => (topo.pos[f * 9 + k] + topo.pos[f * 9 + 3 + k] + topo.pos[f * 9 + 6 + k]) / 3);
  const r = swayAtFace(topo, res, rot, f, [c[0] + res.offset.x, c[1] + res.offset.y, c[2] + res.offset.z],
    { tines: true, layerHeight: 0.2, full: true, crossAbove: 25, crossRise: 0.5 });
  assert(r.ok && r.cross === 2, `post brace should take both cross arms (${r.ok} ${r.cross} ${r.reason ?? ''})`);
});
