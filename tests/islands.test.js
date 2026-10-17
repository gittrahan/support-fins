// Island starts (web/islands.js, local issue 041 / GitHub #18 #257): a feature whose
// first layer starts in midair while no face around its low point is red.

import { block, buildTopology, analyze, rotX, assert, assertClose, loadModel } from './_util.js';

const { findIslands } = await import('../web/islands.js');
const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

// A cube balanced on a corner: the (1,1,1) diagonal turned onto +Z, so its three
// lower faces lean at 54.7deg -- steeper than 45, none red -- and meet at one low point.
function cornerCube(cx, cy, cz, side) {
  const raw = block(-side / 2, side / 2, -side / 2, side / 2, -side / 2, side / 2);
  const d = [1, 1, 1].map((v) => v / Math.sqrt(3));
  // Rodrigues: turn d onto z about k = d x z
  const k = [d[1], -d[0], 0], s = Math.hypot(...k), c = d[2];
  const [kx, ky] = [k[0] / s, k[1] / s];
  const out = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i += 3) {
    const p = [raw[i], raw[i + 1], raw[i + 2]];
    const kp = [ky * p[2], -kx * p[2], kx * p[1] - ky * p[0]];         // k x p
    const kd = kx * p[0] + ky * p[1];                                   // k . p
    for (let j = 0; j < 3; j++) out[i + j] = p[j] * c + kp[j] * s + [kx, ky, 0][j] * kd * (1 - c);
    out[i] += cx; out[i + 1] += cy; out[i + 2] += cz;
  }
  return out;
}
const topoOf = (...parts) => {
  const n = parts.reduce((t, p) => t + p.length, 0), pos = new Float32Array(n);
  let o = 0;
  for (const p of parts) { pos.set(p, o); o += p.length; }
  return buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
};
const islandsOf = (topo, rot = I3) => findIslands(topo, analyze(topo, 45, rot), rot);

// a pillar on the plate with a corner-down cube stuck to its side, its low corner
// 13.07 mm up and 5 mm clear of the pillar in plan
const pillar = block(0, 10, 0, 10, 0, 30);
const LOW = 20 - 8 * Math.sqrt(3) / 2;

Deno.test('islands: a corner-down cube hanging off a pillar starts in midair, no face red', () => {
  const topo = topoOf(pillar, cornerCube(15, 5, 20, 8));
  const res = analyze(topo, 45, I3);
  const isl = findIslands(topo, res, I3);
  assert(isl.length === 1, `one island, got ${isl.length}`);
  // (seated: analyze centres the part on the plate)
  assertClose(isl[0].x, 15 + res.offset.x, 0.01, 'at the corner in x');
  assertClose(isl[0].y, 5 + res.offset.y, 0.01, 'at the corner in y');
  assertClose(isl[0].z, LOW, 0.01, 'at the corner height');
  assert(isl[0].area >= 0.03, `a real cross-section one layer up (${isl[0].area.toFixed(3)} mm2)`);
});

Deno.test('islands: a start resting within a layer of material below is no island', () => {
  // a slab off the pillar whose top is 0.1 mm under the corner
  assert(islandsOf(topoOf(pillar, cornerCube(15, 5, 20, 8), block(10, 25, 0, 10, 0, LOW - 0.1))).length === 0,
    'the corner prints on the slab under it');
  // ... ending 0.5 mm short of it in plan, past the 0.3 mm grace: it hangs again
  assert(islandsOf(topoOf(pillar, cornerCube(15, 5, 20, 8), block(10, 14.5, 0, 10, 0, LOW - 0.1))).length === 1,
    'a slab out of reach holds nothing');
});

Deno.test('islands: red low points are left to the overhang, plate starts to the plate', () => {
  // a square arm's low corners are corners of its flat (red) underside
  assert(islandsOf(topoOf(pillar, block(10, 18, 0, 8, 16, 24))).length === 0, 'a flat-bottomed arm is red, not an island');
  assert(islandsOf(topoOf(cornerCube(0, 0, 8 * Math.sqrt(3) / 2, 8))).length === 0, 'a cube on its corner stands on the plate');
});

Deno.test('islands: the stress models have none bar lowledge at Y45 (a 45-45 knife edge)', () => {
  for (const name of ['cube', 'sphere', 'torus', 'lbracket', 'staircase', 'portal', 'tshape', 'cone']) {
    const topo = loadModel(name);
    for (const d of [0, 45, -45]) assert(islandsOf(topo, rotX(d)).length === 0, `${name} X${d}`);
  }
  const ry = (d) => { const c = Math.cos(d * Math.PI / 180), s = Math.sin(d * Math.PI / 180); return [c, 0, -s, 0, 1, 0, s, 0, c]; };
  const edge = islandsOf(loadModel('lowledge'), ry(45));
  assert(edge.length === 1, `lowledge Y45: one island, got ${edge.length}`);
  const ys = edge[0].points.map((p) => p[1]);
  assert(Math.max(...ys) - Math.min(...ys) > 39, 'the whole 40 mm edge is the target, not its middle');
});
