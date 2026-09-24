// STEP import. The browser runs the OpenCascade kernel in a worker; here we load
// the same vendored WASM directly and push its output through the same
// stepObjects() the app uses, so these tests exercise the real tessellation:
//   - a STEP is recognised by its content (the Part 21 magic), not its extension;
//   - a one-body file is one object with the right size and the right VOLUME
//     (a bore that tessellated inside-out or a face that went missing shows up
//     as a volume error, not just a bbox error), and it is a closed solid;
//   - curved faces are finely faceted -- the triangles we make are what prints;
//   - a file with several bodies comes back as several pickable objects;
//   - the imported part runs through the real fin pipeline like an STL does.
//
// Fixtures are made with FreeCAD (tests/fixtures/*.step): a 40x20x30 bracket
// with a flat 25 mm ledge and an 8 mm bore through base and ledge, and the same
// bracket next to a separate 10 mm peg.

import { createRequire } from 'node:module';
import { WEB, fins, buildTopology, analyze, rotX, isClosed, assert, assertClose } from './_util.js';

const { isStep, stepObjects, STEP_PARAMS } = await import(`${WEB}step.js`);

const FIX = new URL('./fixtures/', import.meta.url).pathname;
const OCCT = `${WEB}vendor/occt-import-js/`;

const occtimportjs = createRequire(import.meta.url)(`${OCCT}occt-import-js.js`);
const occt = await occtimportjs({ wasmBinary: Deno.readFileSync(`${OCCT}occt-import-js.wasm`) });

const readFixture = (name) =>
  stepObjects(occt.ReadStepFile(Deno.readFileSync(`${FIX}${name}`), STEP_PARAMS));

/** Signed volume of a closed flat triangle soup (divergence theorem). */
function volume(p) {
  let v = 0;
  for (let i = 0; i < p.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = p.subarray(i, i + 9);
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return v / 6;
}

const triples = (p) => {
  const out = [];
  for (let i = 0; i < p.length; i += 3) out.push([p[i], p[i + 1], p[i + 2]]);
  return out;
};

Deno.test('isStep sniffs the Part 21 magic, not the extension', () => {
  const buf = (s) => new TextEncoder().encode(s).buffer;
  assert(isStep(Deno.readFileSync(`${FIX}bracket.step`).buffer), 'fixture is STEP');
  assert(isStep(buf('﻿\n  ISO-10303-21;\nHEADER;')), 'BOM + leading whitespace');
  assert(!isStep(buf('solid cube\n facet normal 0 0 1')), 'ASCII STL is not STEP');
  assert(!isStep(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]).buffer), 'a ZIP (3MF) is not STEP');
  assert(!isStep(new Uint8Array(0).buffer), 'empty buffer');
});

Deno.test('one-body STEP -> one closed object, right size and volume', () => {
  const { objects } = readFixture('bracket.step');
  assert(objects.length === 1, `expected 1 object, got ${objects.length}`);
  const [o] = objects;
  assert(o.name === 'Bracket', `name from the file, got "${o.name}"`);
  assert(o.tris === o.positions.length / 9, 'tris matches the soup');
  o.bbox.size.forEach((s, k) => assertClose(s, [40, 20, 30][k], 1e-3, `bbox axis ${k}`));

  // base 40x20x10 + post 10x20x20 above it + ledge 25x20x6, minus the r4 bore
  // through base (10) and ledge (6). Faceting shaves the bore a hair.
  const exact = 8000 + 4000 + 3000 - Math.PI * 16 * 16;
  assertClose(volume(o.positions), exact, exact * 0.002, 'volume');
  assert(isClosed(triples(o.positions)), 'tessellation is a closed solid');
});

Deno.test('curved faces are finely faceted (the triangles are what prints)', () => {
  const [o] = readFixture('bracket.step').objects;
  // The r4 bore: count distinct vertex angles around its axis (x=30, y=10).
  const angles = new Set();
  const p = o.positions;
  for (let i = 0; i < p.length; i += 3) {
    const dx = p[i] - 30, dy = p[i + 1] - 10;
    if (Math.abs(Math.hypot(dx, dy) - 4) < 1e-3) angles.add(Math.round(Math.atan2(dy, dx) * 1e3));
  }
  // 0.1 rad angular deflection -> ~63 sides; an STL exported at "coarse" is ~16.
  assert(angles.size >= 60, `bore has ${angles.size} sides`);
});

Deno.test('several bodies -> several pickable objects', () => {
  const { objects } = readFixture('two-bodies.step');
  assert(objects.length === 2, `expected 2 objects, got ${objects.length}`);
  const names = objects.map((o) => o.name).sort();
  assert(names.join() === 'Bracket,Peg', `names: ${names}`);
  const peg = objects.find((o) => o.name === 'Peg');
  peg.bbox.size.forEach((s, k) => assertClose(s, [10, 10, 15][k], 0.01, `peg bbox axis ${k}`));
});

Deno.test('a kernel failure is an error, not an empty part', () => {
  let threw = false;
  try { stepObjects({ success: false }); } catch { threw = true; }
  assert(threw, 'unsuccessful read throws');
  const junk = occt.ReadStepFile(new TextEncoder().encode('ISO-10303-21;\nnot really'), STEP_PARAMS);
  threw = false;
  try { stepObjects(junk); } catch { threw = true; }
  assert(threw, 'garbage STEP throws');
});

Deno.test('an imported STEP part runs through the real fin pipeline', () => {
  const [o] = readFixture('bracket.step').objects;
  const topo = buildTopology({ getAttribute: (k) => (k === 'position' ? { array: o.positions } : null) });
  const rot = rotX(0);
  const res = analyze(topo, 45, rot);
  const built = fins.buildFins(topo, res, rot, { mode: 'auto', bedPad: true });
  // The ledge is a flat 25 mm overhang 24 mm up: it must be seen and supported.
  assert(built.fins.length > 0, 'the ledge gets a fin');
  assert(isClosed(built.triangles), 'added geometry is watertight');
});
