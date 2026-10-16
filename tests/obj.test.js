// The OBJ reader (web/obj.js), which the site and the command line use. Pins: an
// indexed mesh reads back as the same triangles an STL of it gives; quads and
// n-gons fan into triangles; `v/vt/vn` and negative (relative) references resolve;
// `o` splits objects but groups and materials don't; the sniffer tells an OBJ from
// a binary or ASCII STL; a file with no faces or a dangling reference fails loudly.

import { WEB, assert, block } from './_util.js';

const { readOBJ, isObj } = await import(`${WEB}obj.js`);
const { writeBinarySTL } = await import(`${WEB}stl.js`);

const enc = (s) => new TextEncoder().encode(s);
const buf = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);

/** A flat soup as an indexed OBJ (every corner its own vertex: the order stays). */
function objOf(flat, name) {
  let s = name ? `o ${name}\n` : '';
  for (let i = 0; i < flat.length; i += 3) s += `v ${flat[i]} ${flat[i + 1]} ${flat[i + 2]}\n`;
  return s;
}
function facesOf(nTris, base = 0) {
  let s = '';
  for (let t = 0; t < nTris; t++) s += `f ${base + 3 * t + 1} ${base + 3 * t + 2} ${base + 3 * t + 3}\n`;
  return s;
}

function throws(fn, pattern, msg) {
  try { fn(); } catch (e) {
    assert(pattern.test(e.message), `${msg}: wrong error "${e.message}"`);
    return;
  }
  throw new Error(`${msg}: did not throw`);
}

const CUBE = block(0, 10, 0, 20, 0, 5);

Deno.test('obj: an indexed mesh reads back as the same triangles', () => {
  const { objects } = readOBJ(enc(objOf(CUBE) + facesOf(CUBE.length / 9)));
  assert(objects.length === 1, `${objects.length} objects`);
  const got = objects[0].positions;
  assert(got.length === CUBE.length, `length ${got.length} vs ${CUBE.length}`);
  for (let i = 0; i < CUBE.length; i++) assert(got[i] === CUBE[i], `value ${i}`);
  assert(objects[0].tris === 12 && objects[0].bbox.size.join() === '10,20,5', `bbox ${objects[0].bbox.size}`);
});

Deno.test('obj: quads and n-gons fan; v/vt/vn and negative references resolve', () => {
  const text = [
    '# a square as one quad, then a pentagon by relative refs',
    'v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'v 0 1 0',
    'vt 0 0', 'vn 0 0 1',
    'f 1/1/1 2/1/1 3/1/1 4/1/1',
    'v 0 0 1', 'v 2 0 1', 'v 3 1 1', 'v 1 2 1', 'v -1 1 1',
    'f -5//1 -4//1 -3//1 -2//1 -1//1',
  ].join('\r\n');
  const p = readOBJ(enc(text)).objects[0].positions;
  assert(p.length === (2 + 3) * 9, `${p.length / 9} triangles, want 5`);
  // the quad's second triangle is 1 3 4; the pentagon's last is 5 8 9
  assert([...p.slice(9, 18)].join() === '0,0,0,1,1,0,0,1,0', `quad tri 2: ${[...p.slice(9, 18)]}`);
  assert([...p.slice(36, 45)].join() === '0,0,1,1,2,1,-1,1,1', `pentagon tri 3: ${[...p.slice(36, 45)]}`);
});

Deno.test('obj: `o` splits objects, groups and materials do not; a name before faces names it', () => {
  const a = CUBE, b = block(30, 40, 0, 10, 0, 10);
  const text = 'mtllib x.mtl\n' + objOf(a, 'first') + 'g top\nusemtl red\n' + facesOf(6)
    + 'g rest\nusemtl blue\n' + facesOf(6, 18)
    + objOf(b, 'second') + facesOf(12, 36);
  const { objects } = readOBJ(enc(text));
  assert(objects.map((o) => `${o.name}:${o.tris}`).join() === 'first:12,second:12',
    objects.map((o) => `${o.name}:${o.tris}`).join());
  assert(objects[1].bbox.lo[0] === 30, 'second object has its own vertices');
});

Deno.test('obj: the sniffer takes an OBJ, not a binary or ASCII STL', async () => {
  assert(isObj(buf(enc(objOf(CUBE) + facesOf(12)))), 'OBJ');
  assert(isObj(buf(enc('# exported\n\nmtllib a.mtl\no x\nv 1 2 3\n'))), 'OBJ after comments');
  const tris = [];
  for (let i = 0; i < CUBE.length; i += 3) tris.push([CUBE[i], CUBE[i + 1], CUBE[i + 2]]);
  const bin = new Uint8Array(await writeBinarySTL(tris, 'v 1 2 3').arrayBuffer());
  assert(!isObj(buf(bin)), 'binary STL whose header looks like a vertex');
  assert(!isObj(buf(enc('solid x\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\n'))), 'ASCII STL');
});

Deno.test('obj: no faces, a dangling reference or a bad vertex fail loudly', () => {
  throws(() => readOBJ(enc('v 0 0 0\nv 1 0 0\nv 0 1 0\nl 1 2\n')), /no faces/, 'lines only');
  throws(() => readOBJ(enc('v 0 0 0\nv 1 0 0\nf 1 2 3\n')), /isn't there.*line 3/, 'ref past the end');
  throws(() => readOBJ(enc('v 0 0 0\nf -2 -1 1\n')), /isn't there/, 'relative ref before the start');
  throws(() => readOBJ(enc('v 0 zero 0\n')), /bad vertex/, 'bad number');
});
