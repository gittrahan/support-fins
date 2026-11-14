import assert from 'node:assert/strict';
import { computeFins } from '../../shared/engine/fins_entry.js';
import { rectangle, topDirection, turnProjectFins, validateTurningNeighbor, turningBounds, turningBoundsOverlap } from '../project-turning.js';
import { turningRuntime } from '../project-turning-geometry.js';
import { roofBody, solid, finOptions, dimensions } from './_turning-fixture.js';

const settings = (positions, extra = {}) => ({ positions, dimensions, gap: .3, validate: async () => {}, ...extra });
const world = (g) => Float64Array.from(g.triangles, (v, i) => v - [g.offset.x, g.offset.y, g.offset.z][i % 3]);

Deno.test('turn direction uses roof geometry, supports an absolute override and avoids square ambiguity', () => {
  const roof = rectangle([[-5, -3], [0, -3], [5, -3], [5, 3], [-5, 3]]);
  assert.equal(roof.length, 10); assert.equal(roof.width, 6);
  assert.equal(topDirection(roof, 0), 90);
  assert.equal(topDirection(roof, 0, 32), 32);
  assert.equal(topDirection({ ...roof, width: 9.5 }, 23), 23);
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
  const result = await turnProjectFins(generated, settings(positions));
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
    const top = after.slice(33.4);
    try {
      const paths = top.toPolygons(); assert.equal(paths.length, 1);
      const strip = rectangle(paths[0]); assert(strip); assert(Math.abs(strip.width - 1.64) < 1e-5); assert.equal(strip.angle, 0);
    } finally { top.delete(); }
    const parts = after.decompose(); try { assert.equal(parts.length, 1); } finally { for (const p of parts) p.delete(); }
  } finally { before.delete(); after.delete(); }
  assert.deepEqual(await turnProjectFins(generated, settings(positions)), result, 'non-deterministic replacement');
});

Deno.test('aligned, square, zero-fin and blocked turns preserve original triangles', async () => {
  for (const [sx, sy] of [[1, 1], [.6, .8]]) {
    const positions = await roofBody(sx, sy), generated = computeFins(positions, finOptions);
    const result = await turnProjectFins(generated, settings(positions));
    assert.equal(result.stats.turnedFins, 0); assert.strictEqual(result.triangles, generated.triangles);
  }
  const positions = await roofBody(), generated = computeFins(positions, finOptions);
  const zero = await turnProjectFins({ ...generated, triangles: new Float32Array() }, settings(positions));
  assert.equal(zero.stats.turnedFins, 0);
  let calls = 0;
  const rejected = await turnProjectFins(generated, settings(positions, { validate: async () => { calls++; throw Error('neighbor obstructs turn'); } }));
  assert(calls > 0); assert.equal(rejected.stats.turnedFins, 0); assert.equal(rejected.stats.turningSkipped, 1);
  assert.strictEqual(rejected.triangles, generated.triangles);
  assert(rejected.stats.turningReasons.some((s) => s.includes('neighbor obstructs turn')));
});

Deno.test('explicit angle, closed-input requirement and excluded columns are enforced', async () => {
  const positions = await roofBody(), generated = computeFins(positions, finOptions);
  const aligned = await turnProjectFins(generated, settings(positions, { angle: 90 }));
  assert.equal(aligned.stats.turnedFins, 0);
  const explicit = await turnProjectFins(generated, settings(positions, { angle: 0 }));
  assert.equal(explicit.stats.turnedFins, 1);
  const open = await turnProjectFins(generated, settings(positions.slice(9)));
  assert.equal(open.stats.turnedFins, 0); assert(open.stats.turningReasons[0].includes('closed solid'));
  const excluded = await turnProjectFins({ ...generated, smallFaces: generated.overFaces }, settings(positions));
  assert.equal(excluded.stats.turnedFins, 0); assert(excluded.stats.turningReasons.some((s) => s.includes('excluded')));
  await assert.rejects(() => turnProjectFins(generated, { positions, dimensions, gap: .3 }), /validator/);
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
  const result = await turnProjectFins(generated, settings(positions));
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

Deno.test('rotated and mirrored world geometry retains saved layer registration and a single top', async () => {
  const original = await roofBody(.5, .8, false), g = computeFins(original, finOptions);
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
    const positions = transform(original), placed = { ...g, triangles: Float32Array.from(transform(world(g))), offset: { x: 0, y: 0, z: 0 } };
    const result = await turnProjectFins(placed, settings(positions));
    assert.equal(result.stats.turnedFins, 1, result.stats.turningReasons.join(';'));
    const d = result.stats.turningDetails[0];
    assert(Math.abs(d.topAngle - 37) < .001);
    assert(Math.abs(d.firstPrintZ / .4 - Math.round(d.firstPrintZ / .4)) < 1e-8);
  }
});
