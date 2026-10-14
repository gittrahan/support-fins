// nearestFaces (web/prop/nearface.js) answers through a bucket grid what
// tines.js used to answer by measuring every face: which faces are nearest a
// tine seed, ties included, in face order. It has to be the SAME answer, bit for
// bit -- a tine's bite heading comes from it, and a changed tie flips tines.
import { assert, loadModel, WEB } from './_util.js';

const { nearestFaces, ptTriDist2 } = await import(`${WEB}prop/nearface.js`);

// The full scan tines.js ran before the grid, verbatim in effect.
function scan(topo, rot, offset, px, py, pz) {
  const pos = topo.pos, nF = topo.nFaces;
  const P = [px, py, pz];
  const seat = (o) => [rot[0] * pos[o] + rot[3] * pos[o + 1] + rot[6] * pos[o + 2] + offset.x,
                       rot[1] * pos[o] + rot[4] * pos[o + 1] + rot[7] * pos[o + 2] + offset.y,
                       rot[2] * pos[o] + rot[5] * pos[o + 1] + rot[8] * pos[o + 2] + offset.z];
  const d2 = new Float64Array(nF);
  let best = Infinity;
  for (let f = 0; f < nF; f++) {
    const o = f * 9;
    d2[f] = ptTriDist2(P, seat(o), seat(o + 3), seat(o + 6));
    if (d2[f] < best) best = d2[f];
  }
  if (!(best < Infinity)) return [];
  const tol = best * 1e-9 + 1e-12;
  const out = [];
  for (let f = 0; f < nF; f++) if (!(d2[f] > best + tol)) out.push(f);
  return out;
}

// Deterministic pseudo-random (no Math.random: a failure must reproduce).
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9 >>> 0) / 2 ** 32);
}
function rotXY(ax, ay) {
  const cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay);
  // column-major 3x3 (three.js Matrix3.elements), R = Ry * Rx
  return [cy, 0, -sy, sy * sx, cx, cy * sx, sy * cx, -sx, cy * cx];
}

const MODELS = ['cube', 'staircase', 'torus', 'sphere', 'portal', 'tube', 'lbracket', 'needle', 'plate'];

Deno.test('nearestFaces matches the full scan exactly, ties and order included', () => {
  const r = rng(215);
  let checked = 0, tied = 0;
  for (const name of MODELS) {
    const topo = loadModel(name);
    for (const rot of [[1, 0, 0, 0, 1, 0, 0, 0, 1], rotXY(Math.PI / 4, 0), rotXY(0.6, 1.1)]) {
      const offset = { x: 3.25, y: -1.5, z: 12 };
      // seated bounds, to aim the probes at and around the part
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (let o = 0; o < topo.pos.length; o += 3) {
        const x = topo.pos[o], y = topo.pos[o + 1], z = topo.pos[o + 2];
        const p = [rot[0] * x + rot[3] * y + rot[6] * z + offset.x,
                   rot[1] * x + rot[4] * y + rot[7] * z + offset.y,
                   rot[2] * x + rot[5] * y + rot[8] * z + offset.z];
        for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
      }
      const probes = [];
      // inside / around the box, and well outside it
      for (let i = 0; i < 60; i++) probes.push([0, 1, 2].map((k) => lo[k] + (hi[k] - lo[k]) * (r() * 1.4 - 0.2)));
      for (let i = 0; i < 10; i++) probes.push([0, 1, 2].map((k) => lo[k] + (hi[k] - lo[k]) * (r() * 6 - 2.5)));
      // on vertices and edge midpoints: where faces tie
      for (let i = 0; i < 30; i++) {
        const f = Math.floor(r() * topo.nFaces), o = f * 9, j = Math.floor(r() * 3) * 3, j2 = (j + 3) % 9;
        const v = (q) => [rot[0] * topo.pos[o + q] + rot[3] * topo.pos[o + q + 1] + rot[6] * topo.pos[o + q + 2] + offset.x,
                          rot[1] * topo.pos[o + q] + rot[4] * topo.pos[o + q + 1] + rot[7] * topo.pos[o + q + 2] + offset.y,
                          rot[2] * topo.pos[o + q] + rot[5] * topo.pos[o + q + 1] + rot[8] * topo.pos[o + q + 2] + offset.z];
        const a = v(j), b = v(j2);
        probes.push(a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
      }
      for (const [x, y, z] of probes) {
        const want = scan(topo, rot, offset, x, y, z);
        const got = nearestFaces(topo, rot, offset, x, y, z);
        assert(JSON.stringify(got) === JSON.stringify(want),
          `${name} rot ${rot.map((v) => v.toFixed(3))} at ${[x, y, z]}: grid ${got} vs scan ${want}`);
        checked++;
        if (want.length > 1) tied++;
      }
    }
  }
  assert(tied > 50, `the probes should hit ties (corners, edges); only ${tied} of ${checked} did`);
});

Deno.test('nearestFaces rebuilds for a new pose of the same part', () => {
  const topo = loadModel('staircase');
  const a = [1, 0, 0, 0, 1, 0, 0, 0, 1], b = rotXY(0.9, 0.3), off = { x: 0, y: 0, z: 5 };
  for (const rot of [a, b, a]) {
    const want = scan(topo, rot, off, 4, -2, 9);
    assert(JSON.stringify(nearestFaces(topo, rot, off, 4, -2, 9)) === JSON.stringify(want), 'stale grid');
  }
});
