// zip.js's writers: zipStore's bytes are pinned (the CLI's project files and the
// plates .zip are built on it), and zipDeflate -- what the 3MF writer uses -- must hand
// back exactly the entries it was given, in an archive other readers accept.
import { assert } from './_util.js';
import { crc32, unzip, zipDeflate, zipStore } from '../web/zip.js';
import { writeThreeMF } from '../web/threemf.js';

const hex = async (blob) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))]
  .map((x) => x.toString(16).padStart(2, '0')).join('');
const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

const noise = new Uint8Array(5000).map((_, i) => (i * 7) % 251);
const text = '<m>' + '<vertex x="1.5" y="2.25" z="3"/>'.repeat(400) + '</m>';
const FILES = [{ name: 'a.xml', data: '<a>hello</a>' }, { name: 'D/b.bin', data: noise },
               { name: 'D/c.model', data: text }, { name: 'e', data: '' }];

// every entry's central-directory facts: [name, method, crc, compressed size, size]
function directory(zip) {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = zip.length - 22;
  while (v.getUint32(eocd, true) !== 0x06054b50) eocd--;
  const n = v.getUint16(eocd + 10, true);
  let o = v.getUint32(eocd + 16, true);
  const out = [];
  for (let i = 0; i < n; i++) {
    const nl = v.getUint16(o + 28, true);
    out.push({ name: new TextDecoder().decode(zip.subarray(o + 46, o + 46 + nl)), method: v.getUint16(o + 10, true),
               crc: v.getUint32(o + 16, true), comp: v.getUint32(o + 20, true), size: v.getUint32(o + 24, true) });
    o += 46 + nl + v.getUint16(o + 30, true) + v.getUint16(o + 32, true);
  }
  return out;
}

Deno.test('zip: zipStore bytes are unchanged (a pinned digest from before zipDeflate existed)', async () => {
  const h = await hex(zipStore([{ name: 'a.xml', data: '<a>hello</a>' }, { name: 'D/b.bin', data: noise }, { name: 'e', data: '' }]));
  assert(h === '69fc080fc9360c9b0d13c81765f005b119b58384fdfc0040e37d7ee79e985e55', `zipStore digest ${h}`);
});

Deno.test('zip: zipDeflate round-trips every entry byte for byte, deflating the text and storing a tiny entry', async () => {
  const z = await bytesOf(await zipDeflate(FILES));
  const got = await unzip(z);
  const enc = new TextEncoder();
  for (const f of FILES) {
    const want = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    assert(got.has(f.name) && same(got.get(f.name), want), `${f.name} comes back as written`);
  }
  const d = Object.fromEntries(directory(z).map((e) => [e.name, e]));
  assert(d['D/c.model'].method === 8 && d['D/c.model'].comp < d['D/c.model'].size / 4, 'the text entry is deflated, well under a quarter');
  assert(d['a.xml'].method === 0 && d['e'].method === 0, 'a tiny entry is stored');
  assert(z.length < (await bytesOf(zipStore(FILES))).length, 'the archive is smaller than the stored one');
});

Deno.test('zip: every entry\'s CRC-32 and sizes in the directory match its inflated bytes', async () => {
  const z = await bytesOf(await zipDeflate(FILES));
  const got = await unzip(z);
  for (const e of directory(z)) {
    const b = got.get(e.name);
    assert(crc32(b) === e.crc && b.length === e.size, `${e.name}: crc/size`);
  }
});

Deno.test('zip: without CompressionStream the archive is stored, still valid, the same entries', async () => {
  const saved = globalThis.CompressionStream;
  let z;
  try {
    globalThis.CompressionStream = undefined;
    z = await bytesOf(await zipDeflate(FILES));
  } finally { globalThis.CompressionStream = saved; }
  assert(directory(z).every((e) => e.method === 0), 'all stored');
  assert(same(z, await bytesOf(zipStore(FILES))), 'identical to zipStore\'s');
});

Deno.test('3MF: the deflated file holds the very entries the stored build does, and is smaller', async () => {
  const part = [], fins = [];
  for (let i = 0; i < 300; i++) {
    const x = (i % 20) * 1.5, y = Math.floor(i / 20) * 1.5;
    part.push([x, y, 0], [x + 1, y, 0], [x, y + 1, 1]);
    fins.push([x, y, 2], [x + 1, y, 2], [x, y + 1, 3]);
  }
  const deflated = await bytesOf(await writeThreeMF(part, fins, 'zip test', { separate: true }));
  const saved = globalThis.CompressionStream;
  let stored;
  try {
    globalThis.CompressionStream = undefined;
    stored = await bytesOf(await writeThreeMF(part, fins, 'zip test', { separate: true }));
  } finally { globalThis.CompressionStream = saved; }
  const a = await unzip(deflated), b = await unzip(stored);
  assert([...a.keys()].join() === [...b.keys()].join(), 'the same entries, in the same order');
  for (const [k, v] of a) assert(same(v, b.get(k)), `${k} is byte-identical`);
  assert(directory(deflated).find((e) => e.name === '3D/3dmodel.model').method === 8, 'the model is deflated');
  assert(deflated.length < stored.length / 2, `${deflated.length} bytes vs ${stored.length} stored`);
});
