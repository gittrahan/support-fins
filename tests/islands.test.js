// Island starts (web/islands.js, local issue 041 / GitHub #18 #257): a feature whose
// first layer starts in midair while no face around its low point is red.

import { block, buildTopology, analyze, rotX, assert, assertClose, loadModel, fins, insideCount } from './_util.js';

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

Deno.test('islands: starts within 2 mm merge into one island, farther ones stay apart', () => {
  const two = (dy) => islandsOf(topoOf(pillar, cornerCube(15, 5, 20, 8), cornerCube(15, 5 + dy, 20, 8)));
  const near = two(1.5);
  assert(near.length === 1 && near[0].points.length === 2, `1.5 mm apart: one island of two starts, got ${near.length}`);
  assert(two(4).length === 2, '4 mm apart: two islands');
});

Deno.test('islands: a start under the area floor is dropped', () => {
  const topo = topoOf(pillar, cornerCube(15, 5, 20, 8));
  const res = analyze(topo, 45, I3);
  const a = findIslands(topo, res, I3)[0].area;
  assert(findIslands(topo, res, I3, { minArea: a + 0.01 }).length === 0, `a ${a.toFixed(3)} mm2 start under a higher floor`);
});

// An open steep surface, z = 2x (its faces lean out and down), on a 0.1 mm grid,
// with one vertex pushed 0.3 mm down: a low point, but its own surface runs
// lower within a layer -- the slicer prints it on the layer below.
function dimpledWall() {
  const N = 20, h = 0.1, z = (i, j) => 10 + 2 * i * h - (i === 10 && j === 10 ? 0.3 : 0);
  const P = (i, j) => [i * h, j * h, z(i, j)];
  const t = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    t.push(P(i, j), P(i, j + 1), P(i + 1, j + 1), P(i, j), P(i + 1, j + 1), P(i + 1, j));
  }
  return new Float32Array(t.flat());
}

Deno.test('islands: a dimple in a steep wall prints on the wall below it', () => {
  const topo = topoOf(dimpledWall());
  const res = analyze(topo, 45, I3);
  // (the sheet's own bottom edge, at z 10, is a start in midair too)
  const opts = { plateZ: -1, minArea: 0 };
  // seen as a candidate when the layer is thinner than its drop to the row below...
  const thin = findIslands(topo, res, I3, { ...opts, layer: 0.05, grace: 0 });
  assert(thin.length === 2, `the dimple is a downward low point (${thin.length} starts)`);
  // ... and dropped at a real layer: the wall under it is within reach
  const real = findIslands(topo, res, I3, opts);
  assert(real.length === 1 && Math.abs(real[0].z - 10 - res.offset.z) < 1e-6, 'only the bottom edge at 0.2 mm layers');
});

Deno.test('islands: a peg end too small for a fin (amber) still starts in midair', () => {
  // an arm off the pillar (its flat underside a fin-sized region) with a 2 x 2 mm
  // peg hanging under it: the peg's 4 mm2 end is an amber sliver, held by nothing
  const topo = topoOf(pillar, block(10, 30, 0, 10, 20, 24), block(20, 22, 4, 6, 16, 20.5));
  const res = analyze(topo, 45, I3);
  assert(res.regions.length === 1 && res.rawRegionCount === 2, 'the arm is a region, the peg end a sliver');
  const isl = islandsOf(topo);
  assert(isl.length === 1 && Math.abs(isl[0].z - 16 - res.offset.z) < 1e-6, `one island at the peg end, got ${isl.length}`);
});

// Full coverage holds them (fins/fill.js): the island starts are fill targets, held
// only by a wall top within FILL.islandReach under them.
const { buildFins } = fins;
const { FILL } = await import('../web/fins/fill.js');
const heldBy = (built, isl) => isl.points.some((p) => built.fins.some((f) => (f.line ?? []).some((q) =>
  Math.hypot(p[0] - q[0], p[1] - q[1]) <= FILL.islandReach && p[2] - q[2] >= -0.05 && p[2] - q[2] <= 1.5)));

Deno.test('islands: Full coverage walls a start in midair; Auto does not (Full only)', () => {
  const topo = topoOf(pillar, cornerCube(15, 5, 20, 8));
  const res = analyze(topo, 45, I3);
  const [isl] = findIslands(topo, res, I3);
  const full = buildFins(topo, res, I3, { mode: 'full', bedPad: true });
  assert(full.fill.islands === 1 && full.fill.islandsBare === 0, `Full: 1 island, none bare (${full.fill.islands}/${full.fill.islandsBare})`);
  assert(heldBy(full, isl), 'a wall top right under the corner');
  const auto = buildFins(topo, res, I3, { mode: 'auto', bedPad: true });
  assert(!heldBy(auto, isl), 'Auto has nothing under it (islands are Full only)');
});

// #257's outside corner: a quarter pyramid hanging point-down, its tip 0.5 mm in from
// under its top corner -- two sides drop near sheer to the tip, two climb away from it
// at ~48deg -- so the tip is at the part's edge and a line centred on it is half in air
function edgeCorner(x, y, z, side, rise) {
  const T = [x - 0.5, y - 0.5, z], A = [x, y, z + rise], B = [x - side, y, z + rise], C = [x - side, y - side, z + rise], D = [x, y - side, z + rise];
  const mid = [x - side / 2, y - side / 2, z + rise * 0.75], out = [];
  for (const [p, q, r] of [[T, A, B], [T, B, C], [T, C, D], [T, D, A], [A, D, C], [A, C, B]]) {
    const n = [0, 1, 2].map((k) => (q[(k + 1) % 3] - p[(k + 1) % 3]) * (r[(k + 2) % 3] - p[(k + 2) % 3])
      - (q[(k + 2) % 3] - p[(k + 2) % 3]) * (r[(k + 1) % 3] - p[(k + 1) % 3]));
    const away = n.reduce((t, v, k) => t + v * (p[k] - mid[k]), 0) > 0;
    out.push(...p, ...(away ? q : r), ...(away ? r : q));
  }
  return new Float32Array(out);
}

Deno.test('islands: Full walls an outside corner\'s tip on the part\'s edge (#257), from the side that runs up the part', () => {
  const topo = topoOf(pillar, edgeCorner(25, 5, 20, 9.5, 10));
  const res = analyze(topo, 45, I3);
  const isl = findIslands(topo, res, I3);
  assert(isl.length === 1 && Math.abs(isl[0].z - 20) < 0.01, `the tip is the one island (${isl.length})`);
  const full = buildFins(topo, res, I3, { mode: 'full', bedPad: true });
  assert(full.fill.islandsBare === 0, `Full leaves the tip bare (${full.fill.islands}/${full.fill.islandsBare})`);
  assert(heldBy(full, isl[0]), 'a wall top right under the tip');
  const auto = buildFins(topo, res, I3, { mode: 'auto', bedPad: true, tines: false });
  const n = insideCount(topo, I3, res.offset, buildFins(topo, res, I3, { mode: 'full', bedPad: true, tines: false }).triangles.slice(auto.triangles.length));
  assert(n === 0, `${n} fill vertices inside the part`);
});

Deno.test('islands: the page\'s islands (opts.islands, no vertex ids in the worker) build the same walls', () => {
  const topo = topoOf(pillar, cornerCube(15, 5, 20, 8));
  const res = analyze(topo, 45, I3);
  const isl = findIslands(topo, res, I3);
  const here = buildFins(topo, res, I3, { mode: 'full', bedPad: true });
  const { vid, ...noVid } = topo;
  const sent = buildFins(noVid, res, I3, { mode: 'full', bedPad: true, islands: isl });
  assert(vid && sent.triangles.length === here.triangles.length && sent.fill.islandsBare === 0, 'same build from the sent islands');
  const none = buildFins(noVid, res, I3, { mode: 'full', bedPad: true });
  assert(none.fill.islands === 0 && !heldBy(none, isl[0]), 'without vertex ids or opts.islands, no island targets');
});
