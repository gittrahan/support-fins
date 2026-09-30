// The STL reader (web/stl.js readSTL), which the command line and the tests use.
// Pins: our own writer's output reads back; ASCII reads; a binary file whose
// header starts with "solid" (SolidWorks does this) is still read as binary; a
// truncated or empty file fails loudly instead of giving an empty part.

import { WEB, assert, block } from './_util.js';

const { readSTL, writeBinarySTL } = await import(`${WEB}stl.js`);

function triples(flat) {
  const out = [];
  for (let i = 0; i < flat.length; i += 3) out.push([flat[i], flat[i + 1], flat[i + 2]]);
  return out;
}

async function bytesOf(tris, name) {
  return new Uint8Array(await writeBinarySTL(tris, name).arrayBuffer());
}

function ascii(flat) {
  let s = 'solid cube\n';
  for (let i = 0; i < flat.length; i += 9) {
    s += '  facet normal 0 0 0\n    outer loop\n';
    for (let v = 0; v < 3; v++) s += `      vertex ${flat[i + v * 3]} ${flat[i + v * 3 + 1]} ${flat[i + v * 3 + 2]}\n`;
    s += '    endloop\n  endfacet\n';
  }
  return new TextEncoder().encode(s + 'endsolid cube\n');
}

function throws(fn, pattern, msg) {
  try { fn(); } catch (e) {
    assert(pattern.test(e.message), `${msg}: wrong error "${e.message}"`);
    return;
  }
  throw new Error(`${msg}: did not throw`);
}

const CUBE = block(0, 10, 0, 20, 0, 5);

Deno.test('stl: our binary export reads back as the same triangles', async () => {
  const got = readSTL(await bytesOf(triples(CUBE), 'cube'));
  assert(got.length === CUBE.length, `length ${got.length} vs ${CUBE.length}`);
  for (let i = 0; i < CUBE.length; i++) assert(got[i] === CUBE[i], `value ${i}`);
});

Deno.test('stl: a binary file whose header starts with "solid" is still binary', async () => {
  const got = readSTL(await bytesOf(triples(CUBE), 'solid part'));
  assert(got.length === CUBE.length, `read ${got.length / 9} faces as ASCII instead of binary`);
});

Deno.test('stl: ASCII reads the same triangles', () => {
  const got = readSTL(ascii(CUBE));
  assert(got.length === CUBE.length, `length ${got.length} vs ${CUBE.length}`);
  for (let i = 0; i < CUBE.length; i++) assert(got[i] === CUBE[i], `value ${i}`);
});

Deno.test('stl: truncated, empty and non-STL files are refused', async () => {
  const bin = await bytesOf(triples(CUBE), 'cube');
  throws(() => readSTL(bin.subarray(0, bin.length - 7)), /not an STL/, 'truncated binary');
  throws(() => readSTL(new Uint8Array(0)), /not an STL/, 'empty file');
  throws(() => readSTL(new TextEncoder().encode('solid x\nendsolid x\n')), /no triangles/, 'empty ASCII');
  const cut = new TextDecoder().decode(ascii(CUBE)).split('\n').slice(0, 5).join('\n');
  throws(() => readSTL(new TextEncoder().encode(cut)), /truncated/, 'truncated ASCII');
  throws(() => readSTL(new TextEncoder().encode('hello')), /not an STL/, 'text file');
});
