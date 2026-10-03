// FLOAT-NOISE STABILITY (local issue 023). The same part nudged by 1e-9 rad -- far below
// anything a user, an STL writer or a browser's trig can do on purpose -- must build the
// same supports. Before #171 and this file, 14 of these 24 scenes changed under the
// nudge: an end station dropped one ulp outside surfaceZAt's grid, a part edge lying in
// a wall's end-cap plane read as a pierce (segTriHit's absolute parallel test), and a
// level wall's comb anchored at whichever end noise made lower.

import { assert, assertAlmostEquals } from 'jsr:@std/assert';
import { blockTopo } from './_util.js';
import { run, sitePose } from './_scene.js';

const { solidClearance } = await import('../web/inside.js');

// golden picks not already in the stress set at X40, plus every stress model at X40
const SCENES = [
  ['sphere', [0, 0, 0]], ['lbracket', [35, 0, 0]],
  ...[...Deno.readDirSync(new URL('../prototype/stress/models/', import.meta.url))]
    .map((e) => e.name.replace(/\.stl$/, '')).sort().map((m) => [m, [40, 0, 0]]),
];

Deno.test('stability: a 1e-9 rad nudge builds the same supports (24 scenes)', () => {
  const flips = [];
  for (const [model, rot] of SCENES) {
    const sig = (eps) => {
      const o = run({ model, rot }, sitePose(rot, eps));
      return `${o.walls}w ${o.tines}t ${o.tris.length / 3}tri`;
    };
    const base = sig(0);
    for (const eps of [1e-9, -1e-9]) {
      const got = sig(eps);
      if (got !== base) flips.push(`${model} X${rot[0]} ${eps}: ${base} -> ${got}`);
    }
  }
  assert(flips.length === 0, `output moved under a 1e-9 rad nudge:\n  ${flips.join('\n  ')}`);
});

// A wall's end cap standing in the plane of the part's edge, 0.2 below it -- cube X40's
// geometry: a 30 mm block at 40 deg, the cap in three 10 mm tiles. At these nudges the
// old absolute parallel test read the edge as piercing a tile (d 0); the nearest part
// is the underside, 0.2 x cos 40 away, approached from above.
Deno.test('stability: an edge lying in a wall\'s end-cap plane is clearance, not a weld', () => {
  const topo = blockTopo(-15, 15, -15, 15, -15, 15);
  const off = { x: 0, y: 0, z: 0 };
  for (const k of [0, -35, -29, -20, -12, -7, 10]) {
    const a = (40 * Math.PI) / 180 + k * 1e-9, c = Math.cos(a), s = Math.sin(a);
    const rot = [1, 0, 0, 0, c, s, 0, -s, c];
    const y0 = 15 * c + 15 * s, ze = 15 * s - 15 * c;   // the edge: local (x, 15, -15)
    const cap = [];
    for (const x0 of [-15, -5, 5]) {
      const x1 = x0 + 10, lo = ze - 25, hi = ze - 0.2;
      cap.push([x0, y0, lo], [x1, y0, lo], [x1, y0, hi], [x0, y0, lo], [x1, y0, hi], [x0, y0, hi]);
    }
    const hit = solidClearance(topo, rot, off, cap, 0.45);
    assert(hit, 'no part within reach');
    assertAlmostEquals(hit.d, 0.2 * Math.cos((40 * Math.PI) / 180), 1e-3, `nudge ${k}e-9: d ${hit.d}`);
  }
});

// The relative parallel test must not let a real crossing through: a cap tipped 1e-4 rad
// so its top edge runs 0.02 mm INTO the part still measures ~0.
Deno.test('stability: a shallow real crossing still measures as touching', () => {
  const topo = blockTopo(-10, 10, -10, 10, -10, 10);
  const rot = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  // a 20 mm long triangle under the part's bottom face (z = -10), rising 0.02 into it
  const tri = [[-10, 0, -10.5], [10, 0, -9.98], [10, 0.5, -10.5]];
  const hit = solidClearance(topo, rot, { x: 0, y: 0, z: 0 }, tri, 0.45);
  assert(hit && hit.d < 1e-6, `crossing read as ${hit?.d} clear`);
});
