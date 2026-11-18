import assert from 'node:assert/strict';
import { computeFins } from '../../shared/engine/fins_entry.js';
import { rectangle, turnProjectFins, validateTurningNeighbor, turningBounds, turningBoundsOverlap } from '../project-turning.js';
import { turningRuntime } from '../project-turning-geometry.js';
import { roofBody, solid, finOptions, dimensions } from './_turning-fixture.js';

const settings = (positions, extra = {}) => ({ positions, options: finOptions, dimensions, gap: .3, validate: async () => {}, ...extra });
const world = (g) => Float64Array.from(g.triangles, (v, i) => v - [g.offset.x, g.offset.y, g.offset.z][i % 3]);

Deno.test('rectangular roof recognition permits mesh seams and rejects nonrectangular footprints', () => {
  const roof = rectangle([[-5, -3], [0, -3], [5, -3], [5, 3], [-5, 3]]);
  assert.equal(roof.length, 10); assert.equal(roof.width, 6);
  assert.equal(rectangle([[0, 0], [1, 0], [0, 1]]), null);
  assert.equal(rectangle([[0, 0], [2, 0], [1, 1], [0, 2]]), null);
});

Deno.test('accepted-turn envelopes conservatively retain clearance in all three axes', () => {
  const a = turningBounds([0, 0, 0, 1, 1, 1]);
  assert(turningBoundsOverlap(a, turningBounds([1.2, 0, 0, 2, 1, 1]), .35));
  assert(!turningBoundsOverlap(a, turningBounds([1.4, 0, 0, 2, 1, 1]), .35));
  assert(!turningBoundsOverlap(a, turningBounds([0, 0, 1.4, 1, 1, 2]), .35));
});

Deno.test('automatic turn replaces one real engine wall, preserves lower sections and produces one top strip', async () => {
  const positions = await roofBody(), generated = computeFins(positions, finOptions), snapshot = structuredClone(generated);
  const result = await turnProjectFins(settings(positions));
  assert.equal(result.stats.turnedFins, 1); assert.equal(result.stats.turningSkipped, 0);
  assert.deepEqual(generated, snapshot, 'input result mutated');
  for (const key of ['braces', 'props', 'tines', 'swayBraces', 'unserved', 'overhangRegions']) assert.equal(result.stats[key], generated.stats[key], key);
  const detail = result.stats.turningDetails[0];
  assert.equal(detail.topAngle, 0); assert.equal(detail.turnDegrees, -90); assert(Number.isFinite(detail.roofReach));
  const w = await turningRuntime(), before = solid(w, world(generated)), after = solid(w, world(result));
  try {
    for (let z = 3; z < detail.joinZ - .01; z += .4) {
      const a = before.slice(z), b = after.slice(z), ab = a.subtract(b), ba = b.subtract(a);
      try { assert(ab.area() + ba.area() < 2e-5, `lower section changed at ${z}`); }
      finally { a.delete(); b.delete(); ab.delete(); ba.delete(); }
    }
    const top = after.slice(43.4);
    try {
      const paths = top.toPolygons(); assert.equal(paths.length, 1);
      const strip = rectangle(paths[0]); assert(strip); assert(strip.width >= 1.2 && strip.width <= 1.6); assert.equal(strip.angle, 0);
    } finally { top.delete(); }
    const parts = after.decompose(); try { assert.equal(parts.length, 1); } finally { for (const p of parts) p.delete(); }
  } finally { before.delete(); after.delete(); }
  assert.deepEqual(await turnProjectFins(settings(positions)), result, 'non-deterministic replacement');
});

Deno.test('aligned, square and blocked turns preserve original triangles', async () => {
  for (const [sx, sy] of [[1, 1], [.6, .8]]) {
    const positions = await roofBody(sx, sy), generated = computeFins(positions, finOptions);
    const result = await turnProjectFins(settings(positions, {dimensions:{...dimensions,bridgeAngle:null}}));
    assert.equal(result.stats.turnedFins, 0); assert.deepEqual(result.triangles, generated.triangles);
  }
  const positions = await roofBody(), generated = computeFins(positions, finOptions);
  let calls = 0;
  const rejected = await turnProjectFins(settings(positions, { validate: async () => { calls++; throw Error('neighbor obstructs turn'); } }));
  assert(calls > 0); assert.equal(rejected.stats.turnedFins, 0); assert.equal(rejected.stats.turningSkipped, 1);
  assert.deepEqual(rejected.triangles, generated.triangles);
  assert(rejected.stats.turningReasons.some((s) => s.includes('neighbor obstructs turn')));
});

Deno.test('explicit angle and closed-input requirement are enforced', async () => {
  const positions = await roofBody(), generated = computeFins(positions, finOptions);
  const aligned = await turnProjectFins(settings(positions, { angle: 90 }));
  assert.equal(aligned.stats.turnedFins, 0);
  const explicit = await turnProjectFins(settings(positions, { angle: 0 }));
  assert.equal(explicit.stats.turnedFins, 1);
  const open = await turnProjectFins(settings(positions.slice(9)));
  assert.equal(open.stats.turnedFins, 0); assert(open.stats.turningReasons[0].includes('closed solid'));
  await assert.rejects(() => turnProjectFins({ positions, options: finOptions, dimensions, gap: .3 }), /validator/);
});

Deno.test('plate-object clearance rejects intersections and uninspectable neighbors', async () => {
  const positions = await roofBody();
  await assert.rejects(() => validateTurningNeighbor(positions, positions, .35), /intersects/);
  await assert.rejects(() => validateTurningNeighbor(positions, positions.slice(9), .35), /closed/);
  const distant = Float64Array.from(positions, (v, i) => v + (i % 3 === 0 ? 50 : 0));
  await validateTurningNeighbor(positions, distant, .35);
});

Deno.test('a plate-rooted turn retains existing foot shells without adding disconnected components', async () => {
  const positions = await roofBody(.5, .8, false), generated = computeFins(positions, finOptions);
  const result = await turnProjectFins(settings(positions));
  assert.equal(result.stats.turnedFins, 1);
  const w = await turningRuntime(), before = solid(w, world(generated)), after = solid(w, world(result));
  const a = before.decompose(), b = after.decompose();
  try {
    assert.equal(b.length, a.length);
    const x = before.slice(.2), y = after.slice(.2), xy = x.subtract(y), yx = y.subtract(x);
    try { assert(xy.area() + yx.area() < 1e-8, 'foot geometry changed'); }
    finally { x.delete(); y.delete(); xy.delete(); yx.delete(); }
    assert.equal(b.filter((s) => s.boundingBox().max[2] > result.stats.turningDetails[0].joinZ).length, 1);
  } finally { for (const s of [...a, ...b, before, after]) s.delete(); }
});

Deno.test('rotated and mirrored world geometry retains ordinary placement refusals', async () => {
  const original = await roofBody(.5, .8, false);
  for (const mirrored of [false, true]) {
    const radians = 37 * Math.PI / 180, transform = (flat) => {
      const out = Float64Array.from(flat);
      for (let i = 0; i < out.length; i += 3) {
        const x = out[i] * (mirrored ? -1 : 1), y = out[i + 1];
        out[i] = x * Math.cos(radians) - y * Math.sin(radians) + 120;
        out[i + 1] = x * Math.sin(radians) + y * Math.cos(radians) + 150;
      }
      if (mirrored) for (let i = 0; i < out.length; i += 9) for (let k = 0; k < 3; k++) [out[i + 3 + k], out[i + 6 + k]] = [out[i + 6 + k], out[i + 3 + k]];
      return out;
    };
    const positions = transform(original);
    const result = await turnProjectFins(settings(positions));
    const ordinary=computeFins(positions,finOptions);
    if (!ordinary.triangles.length) { assert.equal(result.triangles.length,0); assert.equal(result.stats.unserved,ordinary.stats.unserved); }
    else { assert.equal(result.stats.turnedFins,1,result.stats.turningReasons.join(';')); }
  }
});
