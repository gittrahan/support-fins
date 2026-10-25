// The 3MF import/export round trip. These pin the things that separate "opens
// our own export" from "opens the file a stranger exported from Fusion":
//   - our writer's output reads back as the same geometry (a real round trip);
//   - the declared UNIT is honoured -- an inch-unit file is not 25x too small;
//   - <build><item> and <component> transforms COMPOSE (or the part imports
//     offset from the plate);
//   - DEFLATE entries work, because every real 3MF is compressed and ours is not;
//   - ZIP64 archives read, because writers use it for reasons of their own and
//     not only past the 4GB limit (this shipped broken: a real file was refused);
//   - support/non-printable bodies stay out of the part geometry;
//   - a slicer's negative parts / modifiers stay out of it too, kept by kind (#104);
//   - a malformed file fails loudly rather than opening blank or sheared.

import { WEB, MODELS, assert, assertClose, block, readSTL, buildTopology, analyze, rotX } from './_util.js';

const { writeThreeMF, writePlate3MF, readThreeMF, mergeColors } = await import(`${WEB}threemf.js`);
const { zipStore, unzip } = await import(`${WEB}zip.js`);
const { wholeCode, fillUnpainted } = await import(`${WEB}paintcode.js`);

const REL = 'http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel';

// --- helpers ---------------------------------------------------------------

/** block() gives a flat Float32Array; the writer wants [x,y,z] triples. */
function triples(flat) {
  const out = [];
  for (let i = 0; i < flat.length; i += 3) out.push([flat[i], flat[i + 1], flat[i + 2]]);
  return out;
}

function bounds(positions) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], positions[i + k]);
      hi[k] = Math.max(hi[k], positions[i + k]);
    }
  }
  return { lo, hi };
}

const CUBE = triples(block(0, 1, 0, 1, 0, 1));

/** A one-triangle model part, so a test can state unit/transform in isolation. */
function modelXML({ unit = 'millimeter', extraObjects = '', build = '<item objectid="1"/>' } = {}) {
  const verts = [[0, 0, 0], [1, 0, 0], [0, 1, 0]]
    .map((p) => `<vertex x="${p[0]}" y="${p[1]}" z="${p[2]}"/>`).join('');
  return '<?xml version="1.0" encoding="UTF-8"?>'
    + `<model unit="${unit}" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">`
    + '<resources>'
    + `<object id="1" type="model"><mesh><vertices>${verts}</vertices>`
    + '<triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>'
    + extraObjects
    + '</resources>'
    + `<build>${build}</build></model>`;
}

/** Wrap a model part in a STORE-method package, the way an OPC reader expects. */
async function pack(xml) {
  const blob = zipStore([
    { name: '[Content_Types].xml', data: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>' },
    { name: '_rels/.rels', data: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + `<Relationship Id="r" Target="/3D/3dmodel.model" Type="${REL}"/></Relationships>` },
    { name: '3D/3dmodel.model', data: xml },
  ]);
  return new Uint8Array(await blob.arrayBuffer());
}

const readXML = async (opts) => readThreeMF(await pack(modelXML(opts)));

// --- the round trip --------------------------------------------------------

Deno.test('3MF round trip: our own export reads back as the same geometry', async () => {
  const fins = CUBE.map((p) => [p[0], p[1], p[2] + 1]);   // a second body on top
  const blob = writeThreeMF(CUBE, fins, 'test part');
  const r = await readThreeMF(new Uint8Array(await blob.arrayBuffer()));

  assert(r.positions.length === (CUBE.length + fins.length) * 3,
    `tri count ${r.positions.length / 9}, want ${(CUBE.length + fins.length) / 3}`);
  // The writer assembles part + fins under <components>; both must come back.
  assert(r.meshes === 2, `read ${r.meshes} meshes through <components>, want 2`);

  const { lo, hi } = bounds(r.positions);
  assert(lo.every((v) => v === 0), `min ${lo}, want 0,0,0`);
  assert(hi[0] === 1 && hi[1] === 1 && hi[2] === 2, `max ${hi}, want 1,1,2`);
});

// The site's default 3MF: part and supports as two OBJECTS (two build items), so a
// slicer slices them apart and a tine only touches the part (GitHub #38) -- the
// locked assembly above makes the slicer union them. Two objects keep their 3MF
// positions, so both carry ONE transform that puts the pair on the bed, in register.
Deno.test('3MF separate export: two objects, one shared transform, in register and on the bed', async () => {
  const part = CUBE.map((p) => [p[0] * 20 - 10, p[1] * 10 - 5, p[2] * 8]);   // centred on the origin, like print space
  const fins = CUBE.map((p) => [p[0] * 2 - 1, p[1] * 2 - 1, p[2] * 8 + 8]);
  const blob = writeThreeMF(part, fins, 'test part', { separate: true });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const xml = new TextDecoder().decode(bytes);
  const items = [...xml.matchAll(/<item objectid="(\d+)" transform="([^"]+)"\/>/g)];
  assert(items.length === 2, `${items.length} build items, want 2 (part, supports)`);
  assert(items[0][2] === items[1][2], `transforms differ: ${items[0][2]} vs ${items[1][2]}`);
  assert(!xml.includes('<components>'), 'separate export must not assemble one object');

  const r = await readThreeMF(bytes);
  assert(r.objects.length === 2, `read ${r.objects.length} objects, want 2`);
  const { lo, hi } = bounds(r.positions);
  // the footprint's centre lands on (90, 90), z untouched, and the two stay in register
  assertClose((lo[0] + hi[0]) / 2, 90, 1e-6, 'x centre');
  assertClose((lo[1] + hi[1]) / 2, 90, 1e-6, 'y centre');
  assert(lo[2] === 0 && hi[2] === 16, `z ${lo[2]}..${hi[2]}, want 0..16`);
  const fb = bounds(r.objects[1].positions);
  assertClose(fb.lo[0], 89, 1e-6, 'supports stay over the part (x)');
  assertClose(fb.lo[1], 89, 1e-6, 'supports stay over the part (y)');
});

Deno.test('3MF separate export: a footprint wider than the bed centre starts 5 mm in', async () => {
  const part = CUBE.map((p) => [p[0] * 240 - 120, p[1] * 10, p[2]]);
  const blob = writeThreeMF(part, CUBE, 'wide', { separate: true });
  const r = await readThreeMF(new Uint8Array(await blob.arrayBuffer()));
  const { lo } = bounds(r.positions);
  assertClose(lo[0], 5, 1e-6, 'x min');
});

Deno.test('3MF separate export with no fins is the part alone', async () => {
  const blob = writeThreeMF(CUBE, [], 'bare', { separate: true });
  const xml = new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()));
  assert((xml.match(/<item /g) ?? []).length === 1, 'one build item');
});

// --- units -----------------------------------------------------------------

// STL is unitless and 3MF is not; ignoring the attribute is the "imported at
// 1/25 scale" bug arriving through the front door instead of the back.
for (const [unit, mm] of [['inch', 25.4], ['centimeter', 10], ['meter', 1000], ['micron', 0.001]]) {
  Deno.test(`3MF unit ${unit} is converted to mm`, async () => {
    const r = await readXML({ unit });
    assertClose(bounds(r.positions).hi[0], mm, 1e-3, `${unit} edge`);
  });
}

// --- transforms ------------------------------------------------------------

Deno.test('3MF build-item transform is applied', async () => {
  // Row-major, translation last: scale x2 in X, move +10 in X.
  const r = await readXML({ build: '<item objectid="1" transform="2 0 0 0 1 0 0 0 1 10 0 0"/>' });
  const { lo, hi } = bounds(r.positions);
  assert(lo[0] === 10 && hi[0] === 12, `x ${lo[0]}..${hi[0]}, want 10..12`);
});

Deno.test('3MF component and item transforms compose', async () => {
  const r = await readXML({
    extraObjects: '<object id="2" type="model"><components>'
      + '<component objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 5"/></components></object>',
    build: '<item objectid="2" transform="1 0 0 0 1 0 0 0 1 0 0 1"/>',
  });
  // +5 from the component, +1 from the item: a reader that keeps only one gets 5 or 1.
  assert(bounds(r.positions).hi[2] === 6, `z ${bounds(r.positions).hi[2]}, want 6`);
});

// --- real-world containers -------------------------------------------------

Deno.test('3MF with DEFLATE entries reads (every real exporter compresses)', async () => {
  // Compress with the same platform primitive the reader inflates with, so this
  // exercises method 8 rather than our own STORE path.
  const xml = new TextEncoder().encode(modelXML());
  const comp = new Uint8Array(await new Response(
    new Blob([xml]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());

  const enc = new TextEncoder();
  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

  const files = [
    { name: '_rels/.rels', data: enc.encode('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + `<Relationship Id="r" Target="/3D/3dmodel.model" Type="${REL}"/></Relationships>`), comp: null },
    { name: '3D/3dmodel.model', data: xml, comp },
  ];

  const local = [], central = [];
  let off = 0;
  for (const f of files) {
    const nb = enc.encode(f.name);
    const payload = f.comp ?? f.data;
    const method = f.comp ? 8 : 0;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(8, method, true);
    lh.setUint32(14, crc32(f.data), true);
    lh.setUint32(18, payload.length, true); lh.setUint32(22, f.data.length, true);
    lh.setUint16(26, nb.length, true);
    local.push(new Uint8Array(lh.buffer), nb, payload);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
    ch.setUint16(10, method, true); ch.setUint32(16, crc32(f.data), true);
    ch.setUint32(20, payload.length, true); ch.setUint32(24, f.data.length, true);
    ch.setUint16(28, nb.length, true); ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), nb);
    off += 30 + nb.length + payload.length;
  }
  const cdBytes = central.reduce((n, a) => n + a.length, 0);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, files.length, true); eocd.setUint16(10, files.length, true);
  eocd.setUint32(12, cdBytes, true); eocd.setUint32(16, off, true);

  const parts = [...local, ...central, new Uint8Array(eocd.buffer)];
  const total = parts.reduce((n, a) => n + a.length, 0);
  const bytes = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { bytes.set(p, o); o += p.length; }

  const r = await readThreeMF(bytes);
  assert(r.positions.length === 9, `deflated read gave ${r.positions.length / 9} tris, want 1`);
});

/**
 * Assemble a package whose EOCD carries ZIP64 PLACEHOLDERS (0xffff / 0xffffffff)
 * with the real values in a ZIP64 end-of-central-directory record, and per-entry
 * values in each entry's ZIP64 extra field.
 *
 * `placeholdSizes` toggles whether the sizes overflow too or only the offset --
 * the extra field holds only the overflowed fields, in a fixed order, so a
 * reader that assumes all three are always present mis-parses the offset-only
 * case. Both shapes occur in the wild.
 */
async function zip64Package(xml, { placeholdSizes = true } = {}) {
  const enc = new TextEncoder();
  const T = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = T[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const deflate = async (b) => new Uint8Array(await new Response(
    new Blob([b]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());

  const files = [
    ['[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'],
    ['_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + `<Relationship Id="r" Target="/3D/3dmodel.model" Type="${REL}"/></Relationships>`],
    ['3D/3dmodel.model', xml],
  ];

  const local = [], central = [];
  const U32 = 0xffffffff;
  let off = 0;
  for (const [name, text] of files) {
    const data = enc.encode(text);
    const comp = await deflate(data);
    const nb = enc.encode(name);
    const crc = crc32(data);

    // local header, with a ZIP64 extra carrying the true sizes
    const lx = new DataView(new ArrayBuffer(20));
    lx.setUint16(0, 0x0001, true); lx.setUint16(2, 16, true);
    lx.setBigUint64(4, BigInt(data.length), true); lx.setBigUint64(12, BigInt(comp.length), true);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 45, true); lh.setUint16(8, 8, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, placeholdSizes ? U32 : comp.length, true);
    lh.setUint32(22, placeholdSizes ? U32 : data.length, true);
    lh.setUint16(26, nb.length, true); lh.setUint16(28, 20, true);
    local.push(new Uint8Array(lh.buffer), nb, new Uint8Array(lx.buffer), comp);

    // central header: placeholders, plus the overflowed fields in spec order
    const vals = [];
    if (placeholdSizes) vals.push(BigInt(data.length), BigInt(comp.length));
    vals.push(BigInt(off));
    const cx = new DataView(new ArrayBuffer(4 + vals.length * 8));
    cx.setUint16(0, 0x0001, true); cx.setUint16(2, vals.length * 8, true);
    vals.forEach((v, i) => cx.setBigUint64(4 + i * 8, v, true));
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 45, true); ch.setUint16(6, 45, true);
    ch.setUint16(10, 8, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, placeholdSizes ? U32 : comp.length, true);
    ch.setUint32(24, placeholdSizes ? U32 : data.length, true);
    ch.setUint16(28, nb.length, true); ch.setUint16(30, cx.byteLength, true);
    ch.setUint32(42, U32, true);
    central.push(new Uint8Array(ch.buffer), nb, new Uint8Array(cx.buffer));

    off += 30 + nb.length + 20 + comp.length;
  }

  const cdBytes = central.reduce((n, a) => n + a.length, 0);
  const z64 = new DataView(new ArrayBuffer(56));
  z64.setUint32(0, 0x06064b50, true); z64.setBigUint64(4, 44n, true);
  z64.setUint16(12, 45, true); z64.setUint16(14, 45, true);
  z64.setBigUint64(24, BigInt(files.length), true); z64.setBigUint64(32, BigInt(files.length), true);
  z64.setBigUint64(40, BigInt(cdBytes), true); z64.setBigUint64(48, BigInt(off), true);

  const loc = new DataView(new ArrayBuffer(20));
  loc.setUint32(0, 0x07064b50, true);
  loc.setBigUint64(8, BigInt(off + cdBytes), true); loc.setUint32(16, 1, true);

  // the plain EOCD says nothing but "look in the ZIP64 record"
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(4, 0xffff, true); eocd.setUint16(6, 0xffff, true);
  eocd.setUint16(8, 0xffff, true); eocd.setUint16(10, 0xffff, true);
  eocd.setUint32(12, U32, true); eocd.setUint32(16, U32, true);

  const all = [...local, ...central, new Uint8Array(z64.buffer), new Uint8Array(loc.buffer), new Uint8Array(eocd.buffer)];
  const bytes = new Uint8Array(all.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of all) { bytes.set(a, o); o += a.length; }
  return bytes;
}

// REGRESSION: this exact shape was rejected with "ZIP64 archives are not
// supported" on a real user file. The 4GB limit is not the only reason a writer
// reaches for ZIP64, so the size of the archive says nothing about whether the
// markers are there.
for (const placeholdSizes of [true, false]) {
  Deno.test(`a ZIP64 3MF reads (${placeholdSizes ? 'sizes + offset' : 'offset only'} overflowed)`, async () => {
    const r = await readThreeMF(await zip64Package(modelXML(), { placeholdSizes }));
    assert(r.positions.length === 9, `ZIP64 read gave ${r.positions.length / 9} tris, want 1`);
  });
}

Deno.test('ZIP64 placeholders with no ZIP64 record are reported as corrupt', async () => {
  // Truncating the ZIP64 record away leaves the placeholders unresolvable;
  // walking those offsets would read garbage, so this must fail loudly.
  const good = await zip64Package(modelXML());
  const broken = good.slice();
  broken[good.length - 22 - 20 - 56] = 0;     // clobber the ZIP64 record signature
  let threw = false;
  try { await readThreeMF(broken); } catch { threw = true; }
  assert(threw, 'unresolvable ZIP64 placeholders should throw');
});

Deno.test('3MF support bodies stay out of the part geometry', async () => {
  // A plate carrying leftover support from an earlier slicer session: pulling it
  // in as part geometry would poison the overhang analysis.
  const r = await readXML({
    extraObjects: '<object id="9" type="support"><mesh><vertices>'
      + '<vertex x="0" y="0" z="0"/><vertex x="99" y="0" z="0"/><vertex x="0" y="99" z="0"/>'
      + '</vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>',
    build: '<item objectid="1"/><item objectid="9"/>',
  });
  assert(r.skipped === 1, `skipped ${r.skipped} non-printable bodies, want 1`);
  assert(bounds(r.positions).hi[0] === 1, `support geometry leaked in (max x ${bounds(r.positions).hi[0]})`);
});

Deno.test('3MF with no <build> falls back to the mesh objects', async () => {
  // A few CAD exporters omit the build section; refusing a file that plainly
  // contains a mesh would be obtuse.
  const r = await readXML({ build: '' });
  assert(r.positions.length === 9, `fallback gave ${r.positions.length / 9} tris, want 1`);
});

// --- failing loudly --------------------------------------------------------

Deno.test('a triangle indexing a missing vertex drops that face only', async () => {
  // Dropping a partial face instead would shift every later vertex by one and
  // shear the rest of the mesh -- worse than a hole, because it still renders.
  const xml = modelXML().replace(
    '<triangles><triangle v1="0" v2="1" v3="2"/></triangles>',
    '<triangles><triangle v1="0" v2="1" v3="2"/><triangle v1="0" v2="1" v3="77"/></triangles>');
  const r = await readThreeMF(await pack(xml));
  assert(r.dropped === 1, `dropped ${r.dropped}, want 1`);
  assert(r.positions.length === 9, `kept ${r.positions.length / 9} tris, want the 1 good one`);
});

Deno.test('a non-ZIP file is rejected, not read as an empty part', async () => {
  let threw = false;
  try { await readThreeMF(new Uint8Array([1, 2, 3, 4, 5])); } catch { threw = true; }
  assert(threw, 'reading a non-ZIP should throw');
});

Deno.test('a 3MF with no mesh anywhere is rejected', async () => {
  let threw = false;
  try {
    await readThreeMF(await pack('<?xml version="1.0"?><model unit="millimeter"><resources/><build/></model>'));
  } catch { threw = true; }
  assert(threw, 'a geometry-free 3MF should throw rather than open blank');
});

// --- the production extension (real slicer output) -------------------------
// Bambu/Orca/MakerWorld split each object into its own part and reference it
// from the root by <component p:path="..."/>. This is where issue #14 bit:
// a reader that parses only the root throws, and one that pools every part's
// ids into a single map silently assembles the wrong geometry on an id clash.

const CORE_NS = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';

/** A model part holding one right-triangle object of the given leg length. */
function triPart(id, edge) {
  const verts = `<vertex x="0" y="0" z="0"/><vertex x="${edge}" y="0" z="0"/><vertex x="0" y="${edge}" z="0"/>`;
  return `<?xml version="1.0"?><model unit="millimeter" xmlns="${CORE_NS}"><resources>`
    + `<object id="${id}" type="model"><mesh><vertices>${verts}</vertices>`
    + '<triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>'
    + '</resources></model>';
}

/** Package arbitrary named parts, with the OPC boilerplate a reader expects. */
async function packParts(entries) {
  const blob = zipStore([
    { name: '[Content_Types].xml', data: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>' },
    { name: '_rels/.rels', data: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + `<Relationship Id="r" Target="/3D/3dmodel.model" Type="${REL}"/></Relationships>` },
    ...entries,
  ]);
  return new Uint8Array(await blob.arrayBuffer());
}

Deno.test('3MF production extension: a mesh in a separate part (p:path) reads', async () => {
  const root = `<?xml version="1.0"?><model unit="millimeter" xmlns="${CORE_NS}"><resources>`
    + '<object id="10" type="model"><components>'
    + '<component p:path="/3D/Objects/a.model" objectid="1"/></components></object>'
    + '</resources><build><item objectid="10"/></build></model>';
  const r = await readThreeMF(await packParts([
    { name: '3D/3dmodel.model', data: root },
    { name: '3D/Objects/a.model', data: triPart(1, 3) },
  ]));
  assert(r.positions.length === 9, `p:path read gave ${r.positions.length / 9} tris, want 1`);
  assert(bounds(r.positions).hi[0] === 3, `wrong geometry pulled from the part (max x ${bounds(r.positions).hi[0]})`);
});

Deno.test('3MF per-file id scoping: colliding ids across parts stay distinct', async () => {
  // Both parts legally define object id="1" -- ids are scoped to the file, not
  // the package. A global id->object map (three.js's ThreeMFLoader) would make
  // both build items resolve to the SAME geometry, so the two edge lengths would
  // come back equal instead of 1 and 5. That silent swap is the #14 bug.
  const root = `<?xml version="1.0"?><model unit="millimeter" xmlns="${CORE_NS}"><resources>`
    + '<object id="10" type="model"><components><component p:path="/3D/Objects/a.model" objectid="1"/></components></object>'
    + '<object id="20" type="model"><components><component p:path="/3D/Objects/b.model" objectid="1"/></components></object>'
    + '</resources><build><item objectid="10"/><item objectid="20"/></build></model>';
  const r = await readThreeMF(await packParts([
    { name: '3D/3dmodel.model', data: root },
    { name: '3D/Objects/a.model', data: triPart(1, 1) },
    { name: '3D/Objects/b.model', data: triPart(1, 5) },
  ]));
  assert(r.objects.length === 2, `got ${r.objects.length} objects, want 2`);
  const sizes = r.objects.map((o) => Math.round(o.bbox.size[0])).sort((x, y) => x - y);
  assert(sizes[0] === 1 && sizes[1] === 5,
    `edge lengths ${sizes}, want 1 and 5 -- equal means ids collided into one geometry`);
});

Deno.test('3MF objects come back separately, named from model_settings.config', async () => {
  // A plate of distinct objects must arrive as a list the caller can offer the
  // user, not a single merged soup -- and with the human names Bambu stores.
  const root = `<?xml version="1.0"?><model unit="millimeter" xmlns="${CORE_NS}"><resources>`
    + '<object id="10" type="model"><components><component p:path="/3D/Objects/a.model" objectid="1"/></components></object>'
    + '<object id="20" type="model"><components><component p:path="/3D/Objects/b.model" objectid="1"/></components></object>'
    + '</resources><build><item objectid="10"/><item objectid="20"/></build></model>';
  const config = '<?xml version="1.0"?><config>'
    + '<object id="10"><metadata key="name" value="waffle.stl"/></object>'
    + '<object id="20"><metadata key="name" value="butter.stl"/></object></config>';
  const r = await readThreeMF(await packParts([
    { name: '3D/3dmodel.model', data: root },
    { name: '3D/Objects/a.model', data: triPart(1, 2) },
    { name: '3D/Objects/b.model', data: triPart(1, 4) },
    { name: 'Metadata/model_settings.config', data: config },
  ]));
  assert(r.objects.length === 2, `got ${r.objects.length} objects, want 2`);
  assert(r.objects[0].name === 'waffle' && r.objects[1].name === 'butter',
    `names ${r.objects.map((o) => o.name)}, want waffle, butter (extension stripped)`);
});

// --- a slicer's negative parts and modifiers (#104) -------------------------
// Each is an ordinary mesh in the model; only a slicer config says it is not
// printed. Read as part, a negative part comes in solid: the cut it makes is
// filled and finned. They come back apart, by kind, in the part's space.

/** A Bambu/Orca object: a printing part and one non-printing part, each a component. */
async function bambuParts({ subtype = 'negative_part', type = 'other' } = {}) {
  const root = `<?xml version="1.0"?><model unit="millimeter" xmlns="${CORE_NS}"><resources>`
    + '<object id="10" type="model"><components>'
    + '<component p:path="/3D/Objects/o.model" objectid="1"/>'
    + '<component p:path="/3D/Objects/o.model" objectid="2" transform="1 0 0 0 1 0 0 0 1 7 0 0"/>'
    + '</components></object></resources><build><item objectid="10"/></build></model>';
  const obj = triPart(1, 2).replace('</resources>',
    triPart(2, 1).match(/<object[\s\S]*<\/object>/)[0].replace('type="model"', `type="${type}"`) + '</resources>');
  const config = '<?xml version="1.0"?><config><object id="10"><metadata key="name" value="bracket.stl"/>'
    + '<part id="1" subtype="normal_part"><metadata key="name" value="bracket.stl"/></part>'
    + `<part id="2" subtype="${subtype}"><metadata key="name" value="Generic-Cylinder"/></part>`
    + '</object></config>';
  return readThreeMF(await packParts([
    { name: '3D/3dmodel.model', data: root },
    { name: '3D/Objects/o.model', data: obj },
    { name: 'Metadata/model_settings.config', data: config },
  ]));
}

Deno.test('3MF Bambu negative part stays out of the part, kept by kind (#104)', async () => {
  const r = await bambuParts();
  const o = r.objects[0];
  assert(o.name === 'bracket', `object named ${o.name}, not after its part`);
  assert(o.tris === 1 && bounds(o.positions).hi[0] === 2, `part is ${o.tris} tris, max x ${bounds(o.positions).hi[0]}: the negative got in`);
  assert(r.skipped === 0, `the negative part counted as ${r.skipped} skipped body`);
  assert(o.extras.length === 1 && o.extras[0].kind === 'negative' && o.extras[0].name === 'Generic-Cylinder',
    `extras ${JSON.stringify(o.extras.map((e) => [e.kind, e.name]))}`);
  // the component's transform applies: the negative sits where the slicer put it
  assert(bounds(o.extras[0].positions).lo[0] === 7, `negative at x ${bounds(o.extras[0].positions).lo[0]}, want 7`);
});

Deno.test('3MF Bambu: a negative part typed "model" (OrcaSlicer) is still not solid', async () => {
  const o = (await bambuParts({ type: 'model' })).objects[0];
  assert(o.tris === 1 && o.extras[0]?.kind === 'negative', `part ${o.tris} tris, extras ${o.extras.length}`);
});

Deno.test('3MF Bambu modifier, blocker and enforcer each keep their kind', async () => {
  for (const [subtype, kind] of [['modifier_part', 'modifier'], ['support_blocker', 'blocker'], ['support_enforcer', 'enforcer']]) {
    const o = (await bambuParts({ subtype })).objects[0];
    assert(o.tris === 1 && o.extras[0]?.kind === kind, `${subtype}: part ${o.tris} tris, extra ${o.extras[0]?.kind}`);
  }
  const o = (await bambuParts({ subtype: 'normal_part', type: 'model' })).objects[0];
  assert(o.tris === 2 && o.extras.length === 0, `a second normal part is part: ${o.tris} tris, ${o.extras.length} extras`);
});

/** A PrusaSlicer object: ONE mesh of three triangles, its volumes as triangle ranges. */
async function prusaVolumes(volumes, triAttr = '', objMeta = '') {
  const verts = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [5, 0, 0], [6, 0, 0], [5, 1, 0], [9, 0, 0], [10, 0, 0], [9, 1, 0]]
    .map((p) => `<vertex x="${p[0]}" y="${p[1]}" z="${p[2]}"/>`).join('');
  const tris = [0, 3, 6].map((v, i) => `<triangle v1="${v}" v2="${v + 1}" v3="${v + 2}"${i === 2 ? triAttr : ''}/>`).join('');
  const model = `<?xml version="1.0"?><model unit="millimeter" xmlns="${CORE_NS}" xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06">`
    + `<resources><object id="1" type="model"><mesh><vertices>${verts}</vertices><triangles>${tris}</triangles></mesh></object>`
    + '</resources><build><item objectid="1"/></build></model>';
  const config = '<?xml version="1.0"?><config><object id="1" instances_count="1">'
    + '<metadata type="object" key="name" value="bracket.stl"/>' + objMeta
    + volumes.map(([first, last, meta]) => `<volume firstid="${first}" lastid="${last}">${meta}</volume>`).join('')
    + '</object></config>';
  return readThreeMF(await packParts([
    { name: '3D/3dmodel.model', data: model },
    { name: 'Metadata/Slic3r_PE_model.config', data: config },
  ]));
}
const vtype = (v, name = 'v') => `<metadata type="volume" key="name" value="${name}"/>`
  + `<metadata type="volume" key="volume_type" value="${v}"/>`;

Deno.test('3MF PrusaSlicer: volumes are triangle ranges -- the negative one stays out of the part', async () => {
  const r = await prusaVolumes([[0, 0, vtype('ModelPart')], [1, 1, vtype('NegativeVolume', 'hole.stl')], [2, 2, vtype('ModelPart')]],
    ' slic3rpe:mmu_segmentation="8"');
  const o = r.objects[0];
  assert(o.tris === 2, `part is ${o.tris} tris, want 2 (the negative range got in)`);
  assert(o.extras.length === 1 && o.extras[0].kind === 'negative' && o.extras[0].name === 'hole',
    `extras ${JSON.stringify(o.extras.map((e) => [e.kind, e.name]))}`);
  assert(bounds(o.extras[0].positions).lo[0] === 5, 'the wrong triangle went to the negative part');
  // the colour of the part's LAST triangle lands on its own index, not shifted by the negative
  assert(o.colors?.paint[1]?.v === '8' && !o.colors.paint[0], `paint at ${Object.keys(o.colors?.paint ?? {})}, want 1`);
});

Deno.test('3MF PrusaSlicer: modifier, blocker, enforcer, and an old file\'s modifier="1"', async () => {
  const o = (await prusaVolumes([[0, 0, vtype('ModelPart')], [1, 1, vtype('ParameterModifier')],
    [2, 2, '<metadata type="volume" key="modifier" value="1"/>']])).objects[0];
  assert(o.tris === 1 && o.extras.map((e) => e.kind).join() === 'modifier,modifier', `got ${o.tris} tris, ${o.extras.map((e) => e.kind)}`);
  const b = (await prusaVolumes([[0, 0, vtype('ModelPart')], [1, 1, vtype('SupportBlocker')], [2, 2, vtype('SupportEnforcer')]])).objects[0];
  assert(b.extras.map((e) => e.kind).join() === 'blocker,enforcer', `got ${b.extras.map((e) => e.kind)}`);
});

Deno.test('3MF an object that is only non-printing parts is not offered as a part', async () => {
  const r = await prusaVolumes([[0, 0, vtype('ModelPart')], [1, 2, vtype('NegativeVolume')]]);
  assert(r.objects.length === 1 && r.objects[0].tris === 1, 'baseline');
  let threw = false;
  try { await prusaVolumes([[0, 2, vtype('NegativeVolume')]]); } catch { threw = true; }
  assert(threw, 'a file that is all negative part opened as a part');
});

Deno.test('3MF PrusaSlicer 2: a second instance (a wrapper over the first one\'s mesh) keeps its negative out', async () => {
  // PrusaSlicer 2 writes instance 1 as the mesh and each further instance as an
  // object whose one component points at it; the config names only the mesh's id.
  const verts = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [5, 0, 0], [6, 0, 0], [5, 1, 0]]
    .map((p) => `<vertex x="${p[0]}" y="${p[1]}" z="${p[2]}"/>`).join('');
  const model = `<?xml version="1.0"?><model unit="millimeter" xmlns="${CORE_NS}"><resources>`
    + `<object id="1" type="model"><mesh><vertices>${verts}</vertices><triangles>`
    + '<triangle v1="0" v2="1" v3="2"/><triangle v1="3" v2="4" v3="5"/></triangles></mesh></object>'
    + '<object id="2" type="model"><components><component objectid="1"/></components></object>'
    + '</resources><build><item objectid="1"/><item objectid="2" transform="1 0 0 0 1 0 0 0 1 20 0 0"/></build></model>';
  const config = '<?xml version="1.0"?><config><object id="1" instances_count="2">'
    + `<volume firstid="0" lastid="0">${vtype('ModelPart')}</volume><volume firstid="1" lastid="1">${vtype('NegativeVolume')}</volume>`
    + '</object></config>';
  const r = await readThreeMF(await packParts([
    { name: '3D/3dmodel.model', data: model },
    { name: 'Metadata/Slic3r_PE_model.config', data: config },
  ]));
  assert(r.objects.length === 2, `got ${r.objects.length} objects`);
  for (const [i, o] of r.objects.entries()) {
    assert(o.tris === 1 && o.extras.length === 1 && o.extras[0].kind === 'negative',
      `instance ${i + 1}: part ${o.tris} tris, ${o.extras.length} extras -- the negative read solid`);
  }
});

Deno.test('3MF one negative part placed twice is two extras, each its own shell', async () => {
  const root = `<?xml version="1.0"?><model unit="millimeter" xmlns="${CORE_NS}"><resources>`
    + '<object id="10" type="model"><components>'
    + '<component p:path="/3D/Objects/o.model" objectid="1"/>'
    + '<component p:path="/3D/Objects/o.model" objectid="2" transform="1 0 0 0 1 0 0 0 1 7 0 0"/>'
    + '<component p:path="/3D/Objects/o.model" objectid="2" transform="1 0 0 0 1 0 0 0 1 20 0 0"/>'
    + '</components></object></resources><build><item objectid="10"/></build></model>';
  const obj = triPart(1, 2).replace('</resources>',
    triPart(2, 1).match(/<object[\s\S]*<\/object>/)[0] + '</resources>');
  const config = '<?xml version="1.0"?><config><object id="10">'
    + '<part id="1" subtype="normal_part"/><part id="2" subtype="negative_part"/></object></config>';
  const o = (await readThreeMF(await packParts([
    { name: '3D/3dmodel.model', data: root },
    { name: '3D/Objects/o.model', data: obj },
    { name: 'Metadata/model_settings.config', data: config },
  ]))).objects[0];
  assert(o.tris === 1 && o.extras.length === 2, `part ${o.tris} tris, ${o.extras.length} extras, want 1 and 2`);
  const xs = o.extras.map((e) => bounds(e.positions).lo[0]).sort((a, b) => a - b);
  assert(xs[0] === 7 && xs[1] === 20, `extras at x ${xs}, want 7 and 20`);
});

Deno.test('3MF Bambu plate: two objects whose part ids collide each keep their own negative', async () => {
  // part ids are scoped to their object (both use 1 and 2): only the second
  // object's part 2 is negative
  const root = `<?xml version="1.0"?><model unit="millimeter" xmlns="${CORE_NS}"><resources>`
    + '<object id="10" type="model"><components><component p:path="/3D/Objects/a.model" objectid="1"/>'
    + '<component p:path="/3D/Objects/a.model" objectid="2"/></components></object>'
    + '<object id="20" type="model"><components><component p:path="/3D/Objects/b.model" objectid="1"/>'
    + '<component p:path="/3D/Objects/b.model" objectid="2" transform="1 0 0 0 1 0 0 0 1 7 0 0"/></components></object>'
    + '</resources><build><item objectid="10"/><item objectid="20"/></build></model>';
  const two = (e) => triPart(1, e).replace('</resources>', triPart(2, e).match(/<object[\s\S]*<\/object>/)[0] + '</resources>');
  const config = '<?xml version="1.0"?><config>'
    + '<object id="10"><part id="1" subtype="normal_part"/><part id="2" subtype="normal_part"/></object>'
    + '<object id="20"><part id="1" subtype="normal_part"/><part id="2" subtype="negative_part"/></object></config>';
  const r = await readThreeMF(await packParts([
    { name: '3D/3dmodel.model', data: root },
    { name: '3D/Objects/a.model', data: two(1) },
    { name: '3D/Objects/b.model', data: two(3) },
    { name: 'Metadata/model_settings.config', data: config },
  ]));
  const [a, b] = r.objects;
  assert(a.tris === 2 && a.extras.length === 0, `first object: ${a.tris} tris, ${a.extras.length} extras, want 2 and 0`);
  assert(b.tris === 1 && b.extras.length === 1 && bounds(b.extras[0].positions).lo[0] === 7,
    `second object: ${b.tris} tris, ${b.extras.length} extras`);
});

// The real files: a 40 mm cube with a negative cube cut into an edge, saved as a
// project by each slicer (tests/fixtures/negative-parts/, stripped to the model
// and the part-type config). Orca types the negative part "model" (it read solid);
// Bambu "other" (it was dropped); PrusaSlicer 3 names it in PrusaSlicer3_project.json.
const NEG_FIX = new URL('./fixtures/negative-parts/', import.meta.url);
for (const [file, name] of [['bambu.3mf', 'Generic-Cube'], ['orca.3mf', 'Generic-Cube'], ['prusaslicer3.3mf', 'Cube']]) {
  Deno.test(`3MF real ${file}: the cube is the part, the negative cube is kept beside it`, async () => {
    const r = await readThreeMF(await Deno.readFile(new URL(file, NEG_FIX)));
    assert(r.objects.length === 1 && r.skipped === 0, `${r.objects.length} objects, ${r.skipped} skipped`);
    const o = r.objects[0];
    const b = bounds(o.positions);
    assert(o.tris === 12 && b.hi.every((h, k) => Math.abs(h - b.lo[k] - 40) < 1e-3),
      `part is ${o.tris} tris, ${b.hi.map((h, k) => h - b.lo[k])} mm: the negative got in`);
    assert(o.extras.length === 1 && o.extras[0].kind === 'negative' && o.extras[0].name === name,
      `extras ${JSON.stringify(o.extras.map((e) => [e.kind, e.name]))}`);
    // placed where the slicer put it: cutting into the cube, not at the origin
    const n = bounds(o.extras[0].positions);
    assert([0, 1, 2].every((k) => n.lo[k] < b.hi[k] && n.hi[k] > b.lo[k]), 'the negative part does not overlap the cube');
  });
}

// --- the slicer's parts written back (#104) ----------------------------------
// The export carries them out beside the part, each its own kind and its settings
// verbatim, apart from the supports (a negative part cuts every part of its object).

/** Write `extras` beside a 1 mm cube with a block of supports, read it back. */
async function writeExtras(extras, { partTris = CUBE, colors = null, separate = true } = {}) {
  const blob = writeThreeMF(partTris, triples(block(3, 4, 0, 1, 0, 1)), 'cube',
    { separate, colors, extras: extras.map((e) => ({ ...e, tris: triples(e.positions) })) });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { r: await readThreeMF(bytes), parts: await unzip(bytes) };
}
const NEG = { kind: 'negative', name: 'hole', settings: { bambu: [] }, positions: block(0.5, 2, 0.5, 2, 0.5, 2) };
const MOD = { kind: 'modifier', name: 'dense', positions: block(-1, 0.5, 0, 1, 0, 1),
  settings: { bambu: [['sparse_infill_density', '80%'], ['extruder', '2']] } };

Deno.test('3MF reader: a slicer part keeps its settings, in its own slicer\'s words', async () => {
  const b = (await bambuParts({ subtype: 'modifier_part' })).objects[0].extras[0];
  assert(JSON.stringify(b.settings) === '{"bambu":[]}', `bambu ${JSON.stringify(b.settings)}`);
  const p = (await prusaVolumes([[0, 0, vtype('ModelPart')], [1, 1, vtype('ParameterModifier')
    + '<metadata type="volume" key="fill_density" value="40%"/><metadata type="volume" key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>'],
    [2, 2, vtype('ModelPart')]])).objects[0].extras[0];
  // where it sits is not a setting: the export writes that afresh
  assert(JSON.stringify(p.settings) === '{"prusa2":[["fill_density","40%"]]}', `prusa2 ${JSON.stringify(p.settings)}`);
  const ps3 = (await readThreeMF(await Deno.readFile(new URL('prusaslicer3.3mf', NEG_FIX)))).objects[0].extras[0];
  assert(JSON.stringify(ps3.settings) === '{"prusa3":{"wipe_into_infill":false}}', `prusa3 ${JSON.stringify(ps3.settings)}`);
});

Deno.test('3MF export: negative part and modifier go back out beside the part, the supports apart', async () => {
  const { r, parts } = await writeExtras([NEG, MOD]);
  assert(r.objects.length === 2, `${r.objects.length} objects`);
  const [part, supports] = r.objects;
  assert(part.tris === 12 && supports.extras.length === 0 && / supports$/.test(supports.name),
    `part ${part.tris} tris, supports ${supports.name} with ${supports.extras.length} extras`);
  assert(part.extras.map((e) => `${e.kind}:${e.name}`).join() === 'negative:hole,modifier:dense',
    `extras ${part.extras.map((e) => `${e.kind}:${e.name}`)}`);
  assert(JSON.stringify(part.extras[1].settings.bambu) === JSON.stringify(MOD.settings.bambu),
    `modifier settings ${JSON.stringify(part.extras[1].settings)}`);
  // in register with the part: both moved by the one bed shift
  const shift = bounds(part.positions).lo[0] - 0;
  assertClose(bounds(part.extras[0].positions).lo[0] - shift, 0.5, 1e-5, 'negative x');
  assertClose(bounds(part.extras[1].positions).lo[0] - shift, -1, 1e-5, 'modifier x');
  // both slicers' configs (Bambu/Orca, PrusaSlicer 3), and no PrusaSlicer 2 one
  assert(parts.has('Metadata/model_settings.config') && parts.has('Metadata/PrusaSlicer3_project.json')
    && !parts.has('Metadata/Slic3r_PE_model.config'), `parts ${[...parts.keys()]}`);
  // PrusaSlicer 3 asserts on a volume without a volume_settings object
  const ps3 = JSON.parse(new TextDecoder().decode(parts.get('Metadata/PrusaSlicer3_project.json')));
  assert(ps3.objects[0].volumes.every((v) => v.volume_settings && typeof v.volume_settings === 'object'),
    `volumes ${JSON.stringify(ps3.objects[0].volumes)}`);
  // and neither config is read for a file that claims to be the slicer's own project
  const model = new TextDecoder().decode(parts.get('3D/3dmodel.model'));
  assert(model.includes('<metadata name="Application">Support Fins</metadata>'), 'Application changed');
});

Deno.test('3MF export: read back and written again, the settings of both slicers survive', async () => {
  const both = { ...MOD, settings: { bambu: [['wall_loops', '4']], prusa3: { perimeters: 4 } } };
  const { r } = await writeExtras([both]);
  const again = await writeExtras(r.objects[0].extras);
  const s = again.r.objects[0].extras[0].settings;
  assert(JSON.stringify(s) === '{"bambu":[["wall_loops","4"]],"prusa3":{"perimeters":4}}', `settings ${JSON.stringify(s)}`);
});

Deno.test('3MF export: a PrusaSlicer 2 part goes back as triangle ranges of one mesh', async () => {
  const neg = { ...NEG, settings: { prusa2: [] } };
  const mod = { ...MOD, settings: { prusa2: [['fill_density', '40%']] } };
  // a degenerate part triangle is dropped by the writer: the ranges must not shift
  const partTris = [...CUBE, [0, 0, 0], [0, 0, 0], [1, 0, 0]];
  const paint = []; paint[11] = { name: 'slic3rpe:mmu_segmentation', v: '8' };
  const { r, parts } = await writeExtras([neg, mod], { partTris, colors: { paint, rgb: [] } });
  assert(parts.has('Metadata/Slic3r_PE_model.config') && !parts.has('Metadata/model_settings.config'),
    `parts ${[...parts.keys()]}`);
  const [part] = r.objects;
  assert(part.tris === 12 && part.extras.map((e) => e.kind).join() === 'negative,modifier',
    `part ${part.tris} tris, extras ${part.extras.map((e) => e.kind)}`);
  assert(part.extras[0].positions.length === NEG.positions.length && part.extras[1].positions.length === MOD.positions.length,
    'a slicer part took the wrong triangles');
  assert(JSON.stringify(part.extras[1].settings.prusa2) === '[["fill_density","40%"]]', `settings ${JSON.stringify(part.extras[1].settings)}`);
  assert(part.colors?.paint[11]?.v === '8', 'the part lost its paint');
});

Deno.test('3MF export: with a colour table and the interface crest, every resource id is its own', async () => {
  const rgb = Array(12).fill('#FF0000');
  const blob = writeThreeMF(CUBE, triples(block(3, 4, 0, 1, 0, 1)), 'cube', { separate: true,
    colors: { paint: [], rgb }, iface: triples(block(3, 4, 0, 1, 1, 1.2)),
    extras: [NEG, MOD].map((e) => ({ ...e, tris: triples(e.positions) })) });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const model = new TextDecoder().decode((await unzip(bytes)).get('3D/3dmodel.model'));
  const ids = [...model.matchAll(/<(?:object|basematerials) id="(\d+)"/g)].map((m) => m[1]);
  assert(new Set(ids).size === ids.length, `resource ids ${ids}: one used twice`);
  const r = await readThreeMF(bytes);
  const part = r.objects.find((o) => !/ supports$/.test(o.name));
  assert(part.tris === 12 && part.extras.length === 2 && part.colors?.rgb[0], 'the part, its colour or its slicer parts got lost');
  // the supports stay one object of two parts, out of the slicer parts' reach
  const sup = r.objects.find((o) => / supports$/.test(o.name));
  assert(sup && sup.extras.length === 0 && sup.meshes === 2, `supports ${sup?.meshes} meshes, ${sup?.extras.length} extras`);
});

Deno.test('3MF export: the locked form writes no slicer parts (they would cut the fins)', async () => {
  const { r, parts } = await writeExtras([NEG], { separate: false });
  assert(!parts.has('Metadata/model_settings.config') && r.objects.every((o) => o.extras.length === 0),
    'a negative part rode into the object holding the fins');
});

// --- several models on one plate (writePlate3MF) ----------------------------

const at = (tris, dx, dy = 0) => tris.map((p) => [p[0] + dx, p[1] + dy, p[2]]);
const box = (x0, x1, y0, y1, z0, z1) => triples(block(x0, x1, y0, y1, z0, z1));
async function writePlate(models, opts = { separate: true }) {
  const bytes = new Uint8Array(await writePlate3MF(models, opts).arrayBuffer());
  const parts = await unzip(bytes);
  return { r: await readThreeMF(bytes), parts, model: new TextDecoder().decode(parts.get('3D/3dmodel.model')) };
}
/** Every resource id is its own, and every reference names one of them. */
function idsResolve(model) {
  const ids = [...model.matchAll(/<(?:object|basematerials) id="(\d+)"/g)].map((m) => m[1]);
  assert(new Set(ids).size === ids.length, `resource ids ${ids}: one used twice`);
  const refs = [...model.matchAll(/(?:objectid|pid)="(\d+)"/g)].map((m) => m[1]);
  assert(refs.every((id) => ids.includes(id)), `a reference to a missing id: ${refs} of ${ids}`);
}

Deno.test('plate 3MF: two models, each its part and supports, one shared shift, as they stood', async () => {
  const a = { partTris: box(-40, -30, -5, 5, 0, 8), finTris: box(-36, -34, -1, 1, 8, 10), name: 'a' };
  const b = { partTris: box(20, 30, 10, 20, 0, 5), finTris: [], name: 'b' };
  const { r, model } = await writePlate([a, b]);
  const items = [...model.matchAll(/<item objectid="(\d+)" transform="([^"]+)"\/>/g)];
  assert(items.length === 3, `${items.length} build items, want 3 (a, a supports, b)`);
  assert(new Set(items.map((m) => m[2])).size === 1, 'the items do not share one transform');
  idsResolve(model);
  assert(r.objects.map((o) => o.name).join() === 'a,a supports,b', `objects ${r.objects.map((o) => o.name)}`);
  // the plate's footprint is centred on the bed, and the models keep their spacing
  const [pa, fa, pb] = r.objects.map((o) => bounds(o.positions));
  assertClose((pa.lo[0] + pb.hi[0]) / 2, 90, 1e-6, 'x centre');
  assertClose(pb.lo[0] - pa.lo[0], 60, 1e-6, 'a to b along x');
  assertClose(pb.lo[1] - pa.lo[1], 15, 1e-6, 'a to b along y');
  assertClose(fa.lo[0] - pa.lo[0], 4, 1e-6, "a's supports stay over a");
});

Deno.test('plate 3MF on a known bed: each model where it stands on it, a lone one too', async () => {
  const a = { partTris: box(-40, -30, -5, 5, 0, 8), finTris: box(-36, -34, -1, 1, 8, 10), name: 'a' };
  const b = { partTris: box(20, 30, 10, 20, 0, 5), finTris: [], name: 'b' };
  const bed = { x: 250, y: 210 };
  const { r } = await writePlate([a, b], { separate: true, bed });
  const [pa, , pb] = r.objects.map((o) => bounds(o.positions));
  // the plate's origin is the bed's centre; a slicer's bed counts from its corner
  assertClose(pa.lo[0], 125 - 40, 1e-6, 'a x');
  assertClose(pa.lo[1], 105 - 5, 1e-6, 'a y');
  assertClose(pb.lo[0], 125 + 20, 1e-6, 'b x');
  // one model moved off the bed's centre keeps its spot (no centring of its footprint)
  const lone = await writePlate([a], { separate: true, bed });
  const [pl] = lone.r.objects.map((o) => bounds(o.positions));
  assertClose(pl.lo[0], 125 - 40, 1e-6, 'lone a x');
  // and a lone part with no supports too (without a bed it is written as it stands)
  const bare = await writePlate([{ ...a, finTris: [] }], { separate: true, bed });
  assertClose(bounds(bare.r.objects[0].positions).lo[0], 125 - 40, 1e-6, 'bare part x');
});

Deno.test('plate 3MF: colours, interface and slicer parts on both models, each id and config entry its own', async () => {
  const rgb = Array(12).fill('#FF0000');
  const one = (dx, name, colour) => ({
    partTris: at(CUBE, dx), finTris: box(3 + dx, 4 + dx, 0, 1, 0, 1), iface: box(3 + dx, 4 + dx, 0, 1, 1, 1.2), name,
    colors: { paint: [], rgb: rgb.map(() => colour) },
    extras: [NEG, MOD].map((e) => ({ ...e, tris: at(triples(e.positions), dx) })),
  });
  const { r, parts, model } = await writePlate([one(0, 'left', '#FF0000'), one(20, 'right', '#00FF00')]);
  idsResolve(model);
  const tables = [...model.matchAll(/<basematerials id="(\d+)"/g)].map((m) => m[1]);
  assert(tables.length === 2, `${tables.length} colour tables, want one per model`);
  // one config for both models, an entry each naming that model's own part
  const bambu = new TextDecoder().decode(parts.get('Metadata/model_settings.config'));
  const entries = [...bambu.matchAll(/<object id="(\d+)">.*?<part id="(\d+)" subtype="normal_part">/g)];
  assert(entries.length === 2 && entries[0][2] !== entries[1][2], `config entries ${entries.map((e) => e.slice(1))}`);
  const ps3 = JSON.parse(new TextDecoder().decode(parts.get('Metadata/PrusaSlicer3_project.json')));
  assert(ps3.objects.length === 2 && ps3.objects.map((o) => String(o.id)).join() === entries.map((e) => e[1]).join(),
    `PrusaSlicer 3 objects ${JSON.stringify(ps3.objects.map((o) => o.id))}`);
  for (const [name, colour] of [['left', '#FF0000'], ['right', '#00FF00']]) {
    const p = r.objects.find((o) => o.name === name);
    assert(p && p.tris === 12 && p.extras.map((e) => e.kind).join() === 'negative,modifier' && p.colors?.rgb[0] === colour,
      `${name}: ${p?.tris} tris, extras ${p?.extras.map((e) => e.kind)}, colour ${p?.colors?.rgb[0]}`);
    const s = r.objects.find((o) => o.name === `${name} supports`);
    assert(s && s.meshes === 2 && s.extras.length === 0, `${name} supports: ${s?.meshes} meshes, ${s?.extras.length} extras`);
  }
});

Deno.test('plate 3MF: PrusaSlicer 2 parts on both models, one config with an object each', async () => {
  const neg = { ...NEG, settings: { prusa2: [] } };
  const one = (dx, name) => ({ partTris: at(CUBE, dx), finTris: box(3 + dx, 4 + dx, 0, 1, 0, 1), name,
    extras: [neg].map((e) => ({ ...e, tris: at(triples(e.positions), dx) })) });
  const { r, parts, model } = await writePlate([one(0, 'left'), one(20, 'right')]);
  idsResolve(model);
  const config = new TextDecoder().decode(parts.get('Metadata/Slic3r_PE_model.config'));
  const objs = [...config.matchAll(/<object id="(\d+)" instances_count="1">/g)].map((m) => m[1]);
  const meshes = [...model.matchAll(/<object id="(\d+)" type="model" name="(left|right)"/g)].map((m) => m[1]);
  assert(objs.length === 2 && objs.join() === meshes.join(), `config objects ${objs}, part objects ${meshes}`);
  for (const name of ['left', 'right']) {
    const p = r.objects.find((o) => o.name === name);
    assert(p && p.tris === 12 && p.extras.map((e) => e.kind).join() === 'negative', `${name}: ${p?.tris} tris, extras ${p?.extras.map((e) => e.kind)}`);
  }
});

Deno.test('plate 3MF: the locked form keeps several models where they stood too', async () => {
  const a = { partTris: box(-40, -30, 0, 10, 0, 8), finTris: box(-36, -34, 0, 1, 8, 10), name: 'a' };
  const b = { partTris: box(20, 30, 0, 10, 0, 5), finTris: [], name: 'b' };
  const { r, model } = await writePlate([a, b], { separate: false });
  idsResolve(model);
  assert(r.objects.length === 2, `${r.objects.length} objects, want 2 (a with its fins, b)`);
  assertClose(bounds(r.objects[1].positions).lo[0] - bounds(r.objects[0].positions).lo[0], 60, 1e-6, 'a to b along x');
  const items = [...model.matchAll(/<item objectid="\d+" transform="([^"]+)"\/>/g)];
  assert(items.length === 2 && items[0][1] === items[1][1], `items ${items.map((m) => m[1])}: want two, one transform`);
});

Deno.test('plate 3MF: a PrusaSlicer 2 model then a Bambu one, each component its own model\'s', async () => {
  const one = (dx, name, settings) => ({ partTris: at(CUBE, dx), finTris: box(3 + dx, 4 + dx, 0, 1, 0, 1), name,
    extras: [{ ...NEG, settings, tris: at(triples(NEG.positions), dx) }] });
  const { r, model } = await writePlate([one(0, 'left', { prusa2: [] }), one(20, 'right', { bambu: [] })]);
  idsResolve(model);
  // the Bambu assembly's components are the right model's part and negative, not the left's
  const names = new Map([...model.matchAll(/<object id="(\d+)" type="model" name="([^"]+)"/g)].map((m) => [m[1], m[2]]));
  const asm = model.match(/<object id="\d+" type="model" name="right"><components>(.*?)<\/components>/)[1];
  const parts = [...asm.matchAll(/objectid="(\d+)"/g)].map((m) => names.get(m[1]));
  assert(parts.join() === 'right,hole', `the right assembly holds ${parts}`);
  for (const name of ['left', 'right']) {
    const p = r.objects.find((o) => o.name === name);
    assert(p && p.tris === 12 && p.extras.length === 1, `${name}: ${p?.tris} tris, ${p?.extras.length} extras`);
  }
});

Deno.test('plate 3MF: PrusaSlicer paint on the second model alone still declares its namespace', async () => {
  const paint = [{ name: 'slic3rpe:mmu_segmentation', v: '8' }];
  const { r, model } = await writePlate([{ partTris: CUBE, finTris: [], name: 'a' },
    { partTris: at(CUBE, 20), finTris: [], name: 'b', colors: { paint, rgb: [] } }]);
  assert(model.includes('xmlns:slic3rpe='), 'no slic3rpe namespace');
  assert(r.objects.find((o) => o.name === 'b')?.colors?.paint[0]?.v === '8', 'b lost its paint');
});

// One model writes the bytes it did before writePlate3MF (sha-256 of origin/main's
// output for each): a change to the one-model file shows here, not just in the
// structure the tests above read back.
Deno.test('3MF one-model output is unchanged (golden)', async () => {
  const FINS = box(3, 4, 0, 1, 0, 1);
  const neg = { ...NEG, tris: triples(NEG.positions) };
  const cases = {
    locked: [CUBE, FINS, 'cube', {}, '6e0a954cd9732ce65e3a1e2694dbdca8d4cd8054282b39daed379d5f21943d86'],
    separate: [CUBE, FINS, 'cube', { separate: true, session: { v: 1 } }, '94a2c87a8244ea315905571abe2e7d4dddebf4f08cf29342993727977386d44a'],
    bare: [CUBE, [], 'cube', { separate: true }, '2b409bf49aba7d0cd8c550cb6a3dfc94c39f61402595c08366b4ae6f6be20dfb'],
    full: [CUBE, FINS, 'cube', { separate: true, iface: box(3, 4, 0, 1, 1, 1.2), colors: { paint: [], rgb: Array(12).fill('#FF0000') },
      extras: [neg] }, 'ef89e05cbb339217af6e3383a121bf98f423380caa56f6dad91503f767b16f49'],
    prusa2: [CUBE, FINS, 'cube', { separate: true, extras: [{ ...neg, settings: { prusa2: [] } }],
      colors: { paint: [{ name: 'slic3rpe:mmu_segmentation', v: '8' }], rgb: [] } }, '6eb7e99f0dad0e54699ce5083007f47c5f16f3cf3a2d7cbb5596060deaa57fd9'],
  };
  for (const [k, [part, fins, name, opts, want]] of Object.entries(cases)) {
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', await writeThreeMF(part, fins, name, opts).arrayBuffer()));
    const got = [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
    assert(got === want, `${k}: the one-model file changed (${got})`);
  }
});

// --- unit: more production-extension shapes --------------------------------

Deno.test('3MF production extension: a RELATIVE p:path resolves', async () => {
  // Absolute (/3D/...) is what Bambu writes, but a relative target is legal and
  // some writers use it; partName() has to normalise both to the same entry.
  const root = `<?xml version="1.0"?><model unit="millimeter" xmlns="${CORE_NS}"><resources>`
    + '<object id="10" type="model"><components>'
    + '<component p:path="3D/Objects/a.model" objectid="1"/></components></object>'
    + '</resources><build><item objectid="10"/></build></model>';
  const r = await readThreeMF(await packParts([
    { name: '3D/3dmodel.model', data: root },
    { name: '3D/Objects/a.model', data: triPart(1, 3) },
  ]));
  assert(bounds(r.positions).hi[0] === 3, `relative p:path did not resolve (max x ${bounds(r.positions).hi[0]})`);
});

Deno.test('3MF production extension: a two-hop p:path chain resolves', async () => {
  // root -> a.model (assembly) -> b.model (the mesh). Both hops must be walked.
  const root = `<?xml version="1.0"?><model unit="millimeter" xmlns="${CORE_NS}"><resources>`
    + '<object id="100" type="model"><components>'
    + '<component p:path="/3D/Objects/a.model" objectid="1"/></components></object>'
    + '</resources><build><item objectid="100"/></build></model>';
  const a = `<?xml version="1.0"?><model unit="millimeter" xmlns="${CORE_NS}"><resources>`
    + '<object id="1" type="model"><components>'
    + '<component p:path="/3D/Objects/b.model" objectid="1"/></components></object>'
    + '</resources></model>';
  const r = await readThreeMF(await packParts([
    { name: '3D/3dmodel.model', data: root },
    { name: '3D/Objects/a.model', data: a },
    { name: '3D/Objects/b.model', data: triPart(1, 4) },
  ]));
  assert(bounds(r.positions).hi[0] === 4, `two-hop chain gave max x ${bounds(r.positions).hi[0]}, want 4`);
});

Deno.test('3MF production extension: the root unit converts geometry pulled from a part', async () => {
  // The mesh is in its own part but the model is authored in inches; the
  // "1/25 scale on the way in" conversion must still happen through p:path.
  const root = `<?xml version="1.0"?><model unit="inch" xmlns="${CORE_NS}"><resources>`
    + '<object id="10" type="model"><components>'
    + '<component p:path="/3D/Objects/a.model" objectid="1"/></components></object>'
    + '</resources><build><item objectid="10"/></build></model>';
  const r = await readThreeMF(await packParts([
    { name: '3D/3dmodel.model', data: root },
    { name: '3D/Objects/a.model', data: triPart(1, 1) },
  ]));
  assertClose(bounds(r.positions).hi[0], 25.4, 1e-3, 'inch edge through p:path');
});

Deno.test('3MF a component that references its own object does not loop', async () => {
  // An assembly object listing itself among its components: the mesh must come
  // through once and the self-reference bail, not recurse forever (cycle guard).
  const xml = `<?xml version="1.0"?><model unit="millimeter" xmlns="${CORE_NS}"><resources>`
    + '<object id="1" type="model"><mesh><vertices>'
    + '<vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/>'
    + '</vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>'
    + '<object id="2" type="model"><components>'
    + '<component objectid="1"/><component objectid="2"/></components></object>'
    + '</resources><build><item objectid="2"/></build></model>';
  const r = await readThreeMF(await pack(xml));
  assert(r.positions.length === 9, `self-cycle gave ${r.positions.length / 9} tris, want 1`);
});

// --- colours (GitHub #236) -------------------------------------------------
// A painted or coloured part keeps its colours through fins + export: the reader
// keeps each triangle's colour beside it, and the writer puts it back on the same
// triangle. The fins stay uncoloured.

/** The cube as one object, every triangle's extra attributes from `attr(i)`. */
function colouredCube(attr, { ns = '', resources = '', objAttrs = '' } = {}) {
  let verts = '', faces = '';
  for (const p of CUBE) verts += `<vertex x="${p[0]}" y="${p[1]}" z="${p[2]}"/>`;
  for (let i = 0; i < CUBE.length; i += 3) {
    faces += `<triangle v1="${i}" v2="${i + 1}" v3="${i + 2}"${attr(i / 3)}/>`;
  }
  return `<?xml version="1.0"?><model unit="millimeter" xmlns="${CORE_NS}"${ns}><resources>${resources}`
    + `<object id="1" type="model"${objAttrs}><mesh><vertices>${verts}</vertices>`
    + `<triangles>${faces}</triangles></mesh></object></resources><build><item objectid="1"/></build></model>`;
}

/** Write `partTris` + a fin with `colors`, read it back; also the model XML. */
async function roundTrip(partTris, colors) {
  const fin = [[3, 0, 0], [4, 0, 0], [3, 1, 0]];
  const blob = writeThreeMF(partTris, fin, 'painted', { separate: true, colors });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const xml = new TextDecoder().decode((await unzip(bytes)).get('3D/3dmodel.model'));
  return { r: await readThreeMF(bytes), xml };
}

const TRIS = CUBE.length / 3;
// Bambu-style codes (opaque to us; any string the slicer wrote)
const code = (i) => (i % 3 ? `${i}C` : '');

Deno.test('3MF colours: Bambu/Orca paint_color survives fins + export on the same triangles', async () => {
  const src = await readThreeMF(await pack(colouredCube((i) => code(i) ? ` paint_color="${code(i)}"` : '')));
  const c = src.objects[0].colors;
  assert(c, 'painted part read no colours');
  for (let i = 0; i < TRIS; i++) {
    assert((c.paint[i]?.v ?? '') === code(i), `tri ${i}: read ${c.paint[i]?.v}, want ${code(i)}`);
  }

  const { r, xml } = await roundTrip(CUBE, c);
  const [part, fins] = r.objects;
  assert(!fins.colors, 'the supports object came back coloured');
  for (let i = 0; i < TRIS; i++) {
    const p = part.colors.paint[i];
    assert((p?.v ?? '') === code(i) && (!p || p.name === 'paint_color'), `tri ${i} after export: ${JSON.stringify(p)}`);
  }
  assert(!xml.includes('xmlns:slic3rpe'), 'Bambu paint declared the PrusaSlicer namespace');
});

Deno.test('3MF colours: paint inside a Bambu object file (p:path) comes through', async () => {
  // Bambu/Orca keep each mesh in 3D/Objects/object_N.model; the paint is there
  const part = colouredCube((i) => code(i) ? ` paint_color="${code(i)}"` : '')
    .replace(/<build>.*<\/build>/, '');
  const root = `<?xml version="1.0"?><model unit="millimeter" xmlns="${CORE_NS}"><resources>`
    + '<object id="10" type="model"><components>'
    + '<component p:path="/3D/Objects/object_1.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 5 0 0"/>'
    + '</components></object></resources><build><item objectid="10"/></build></model>';
  const r = await readThreeMF(await packParts([
    { name: '3D/3dmodel.model', data: root },
    { name: '3D/Objects/object_1.model', data: part },
  ]));
  const p = r.objects[0].colors.paint;
  for (let i = 0; i < TRIS; i++) assert((p[i]?.v ?? '') === code(i), `tri ${i}: ${p[i]?.v}`);
});

Deno.test('3MF colours: PrusaSlicer mmu_segmentation goes back out under its own name', async () => {
  const ns = ' xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06"';
  const src = await readThreeMF(await pack(colouredCube(
    (i) => code(i) ? ` slic3rpe:mmu_segmentation="${code(i)}"` : '', { ns })));
  const { r, xml } = await roundTrip(CUBE, src.objects[0].colors);
  assert(xml.includes(ns), 'a slic3rpe: attribute needs its namespace declared');
  assert(xml.includes('slic3rpe:mmu_segmentation="1C"'), 'Prusa paint not written under its own name');
  const p = r.objects[0].colors.paint;
  for (let i = 0; i < TRIS; i++) assert((p[i]?.v ?? '') === code(i), `tri ${i}: ${p[i]?.v}`);
});

Deno.test('3MF colours: core materials resolve per triangle (object default, p1 override, colorgroup)', async () => {
  const resources = '<basematerials id="7"><base name="red" displaycolor="#FF0000"/>'
    + '<base name="blue" displaycolor="#0000FF"/></basematerials>'
    + '<m:colorgroup id="8"><m:color color="#00FF00FF"/></m:colorgroup>';
  // object default red; triangle 1 blue; triangle 2 the colour group's green
  const attr = (i) => i === 1 ? ' p1="1"' : i === 2 ? ' pid="8" p1="0"' : '';
  const src = await readThreeMF(await pack(colouredCube(attr, { resources, objAttrs: ' pid="7" pindex="0"' })));
  const want = (i) => i === 1 ? '#0000FF' : i === 2 ? '#00FF00FF' : '#FF0000';
  const c = src.objects[0].colors;
  for (let i = 0; i < TRIS; i++) assert(c.rgb[i] === want(i), `tri ${i}: ${c.rgb[i]}, want ${want(i)}`);

  const { r, xml } = await roundTrip(CUBE, c);
  assert(/<basematerials id="5">/.test(xml) && /<object id="1"[^>]* pid="5"/.test(xml), 'no material table on the part');
  assert(!/<object id="2"[^>]* pid=/.test(xml), 'the supports got a material');
  for (let i = 0; i < TRIS; i++) assert(r.objects[0].colors.rgb[i] === want(i), `tri ${i} after export`);
});

Deno.test('3MF colours: a degenerate triangle the writer drops does not shift the others', async () => {
  // a zero-area triangle in the middle: written without it, and every colour
  // after it still lands on its own triangle
  const tris = [...CUBE.slice(0, 6), [0, 0, 0], [0, 0, 0], [1, 1, 1], ...CUBE.slice(6)];
  const n = tris.length / 3;
  const colors = { paint: [], rgb: [] };
  for (let i = 0; i < n; i++) colors.paint[i] = { name: 'paint_color', v: `${i}` };
  const { r } = await roundTrip(tris, colors);
  const got = r.objects[0].colors.paint.map((p) => +p.v);
  const want = [...Array(n).keys()].filter((i) => i !== 2);
  assert(got.join() === want.join(), `colours ${got}, want ${want}`);
});

Deno.test('3MF colours: an uncoloured part reads none and writes none', async () => {
  const src = await readThreeMF(await pack(colouredCube(() => '')));
  assert(src.objects[0].colors === null, 'plain part read colours');
  const { xml } = await roundTrip(CUBE, null);
  assert(!/pid=|basematerials|paint_color/.test(xml), 'plain part wrote colour markup');
});

Deno.test('3MF colours: merged objects keep their colours at the right offsets', () => {
  const a = { positions: new Float32Array(2 * 9), colors: { paint: [, { name: 'paint_color', v: 'A' }], rgb: [] } };
  const b = { positions: new Float32Array(3 * 9), colors: null };
  const c = { positions: new Float32Array(1 * 9), colors: { paint: [], rgb: ['#123456'] } };
  const m = mergeColors([a, b, c]);
  assert(m.paint[1].v === 'A' && m.paint.filter(Boolean).length === 1, 'paint offset');
  assert(m.rgb[5] === '#123456' && m.rgb.filter(Boolean).length === 1, 'rgb offset');
  assert(mergeColors([b]) === null, 'no colours should merge to null');
});

// --- filaments as paint ------------------------------------------------------
// A part coloured by FILAMENT (the slicer's object/part setting, not paint) goes
// out painted with it: the export's one object has no config to carry it.

Deno.test('paint codes: a whole triangle per filament, and a painted one keeps its strokes', () => {
  assert([1, 2, 3, 4, 18].map(wholeCode).join() === '4,8,0C,1C,FC', `whole codes ${[1, 2, 3, 4, 18].map(wholeCode)}`);
  assert(wholeCode(0) === null && wholeCode(19) === null, 'no code for state 0 or past the 4-bit range');
  // split in two (bits 1,0 + special side 0,0): one child state 0, one filament 2
  assert(fillUnpainted('801', 3) === '80C1', `filled ${fillUnpainted('801', 3)}`);
  assert(fillUnpainted('8', 3) === '8' && fillUnpainted('1C', 2) === '1C', 'a code with no state 0 changed');
  // two levels: a 2-way split whose first child is itself split, every leaf state 0
  // nibbles (first first): 1000 root | 1000 child | 0000 0000 its leaves | 0000 leaf
  // -> "00011"; each 0000 leaf becomes 0001 (filament 2) -> "88811"
  assert(fillUnpainted('00011', 2) === '88811', `deep split ${fillUnpainted('00011', 2)}`);
  // a split with no children, or junk: left alone by the caller
  assert(fillUnpainted('1', 2) === null && fillUnpainted('Z4', 2) === null && fillUnpainted('04', 2) === null,
    'an unparseable code came back as a code');
});

/** A Bambu object of two cube parts (part 2 at x 5) and a second object, with `config`. */
async function bambuFilaments(config, paint = '') {
  const cube = (id, attr = '') => colouredCube((i) => i === 0 ? attr : '')
    .match(/<object[\s\S]*<\/object>/)[0].replace('id="1"', `id="${id}"`);
  const objs = `<?xml version="1.0"?><model unit="millimeter" xmlns="${CORE_NS}"><resources>`
    + cube(1, paint) + cube(2) + cube(3) + '</resources></model>';
  const root = `<?xml version="1.0"?><model unit="millimeter" xmlns="${CORE_NS}"><resources>`
    + '<object id="10" type="model"><components><component p:path="/3D/Objects/o.model" objectid="1"/>'
    + '<component p:path="/3D/Objects/o.model" objectid="2" transform="1 0 0 0 1 0 0 0 1 5 0 0"/></components></object>'
    + '<object id="20" type="model"><components><component p:path="/3D/Objects/o.model" objectid="3"/></components></object>'
    + '</resources><build><item objectid="10"/><item objectid="20"/></build></model>';
  return readThreeMF(await packParts([
    { name: '3D/3dmodel.model', data: root },
    { name: '3D/Objects/o.model', data: objs },
    { name: 'Metadata/model_settings.config', data: `<?xml version="1.0"?><config>${config}</config>` },
  ]));
}

Deno.test('3MF filaments: a Bambu part and object on their own filaments go out painted with them', async () => {
  const r = await bambuFilaments('<object id="10"><metadata key="extruder" value="1"/>'
    + '<part id="1" subtype="normal_part"><metadata key="name" value="body"/></part>'
    + '<part id="2" subtype="normal_part"><metadata key="extruder" value="2"/></part></object>'
    + '<object id="20"><metadata key="extruder" value="3"/><part id="3" subtype="normal_part"/></object>');
  const [two, solo] = r.objects;
  const p = two.colors?.paint ?? [];
  assert(p.slice(0, TRIS).every((x) => !x), 'the part on filament 1 got painted');
  assert(p.slice(TRIS).filter((x) => x?.name === 'paint_color' && x.v === '8').length === TRIS, 'part 2 not on filament 2');
  assert(solo.colors?.paint.filter((x) => x?.v === '0C').length === TRIS, 'the object on filament 3 lost it');
  // and out through the export, on the same triangles
  const { r: back } = await roundTrip(triples(two.positions), two.colors);
  assert(back.objects[0].colors.paint.filter((x) => x?.v === '8').length === TRIS, 'filament 2 lost in the export');
});

Deno.test('3MF filaments: a painted triangle on filament 2 keeps its strokes, its own regions on 2', async () => {
  const r = await bambuFilaments('<object id="10"><metadata key="extruder" value="2"/>'
    + '<part id="1" subtype="normal_part"/><part id="2" subtype="normal_part"/></object>', ' paint_color="801"');
  const p = r.objects[0].colors.paint;
  // '801' is a state-0 half and a filament-2 half: both halves now 2
  assert(p[0]?.v === '881', `painted triangle ${p[0]?.v}, want 881`);
  assert(p.filter((x) => x?.v === '8').length === 2 * TRIS - 1, 'the unpainted triangles are not on filament 2');
});

Deno.test('3MF filaments: a modifier\'s filament paints nothing and stays its setting', async () => {
  const o = (await bambuParts({ subtype: 'modifier_part' })).objects[0];
  assert(!o.colors, 'a plain part read colours');
  const r = await bambuFilaments('<object id="10"><part id="2" subtype="modifier_part">'
    + '<metadata key="extruder" value="2"/></part></object>');
  const m = r.objects[0];
  assert(!m.colors && JSON.stringify(m.extras[0]?.settings) === '{"bambu":[["extruder","2"]]}',
    `colours ${JSON.stringify(m.colors)}, settings ${JSON.stringify(m.extras[0]?.settings)}`);
});

Deno.test('3MF filaments: PrusaSlicer 2 object and volume filaments, as mmu_segmentation', async () => {
  const r = await prusaVolumes([[0, 0, vtype('ModelPart')], [1, 1, vtype('ModelPart') + '<metadata type="volume" key="extruder" value="4"/>'],
    [2, 2, vtype('ModelPart')]]);
  const p = r.objects[0].colors?.paint ?? [];
  assert(!p[0] && p[1]?.name === 'slic3rpe:mmu_segmentation' && p[1].v === '1C' && !p[2], `paint ${JSON.stringify(p)}`);
  const { xml } = await roundTrip(triples(r.objects[0].positions), r.objects[0].colors);
  assert(xml.includes('xmlns:slic3rpe') && xml.includes('slic3rpe:mmu_segmentation="1C"'), 'not written as Prusa paint');
  // the object's own filament for the volumes that do not say (0 = the object's)
  const o = await prusaVolumes([[0, 0, vtype('ModelPart')], [1, 2, vtype('ModelPart') + '<metadata type="volume" key="extruder" value="0"/>']],
    '', '<metadata type="object" key="extruder" value="3"/>');
  const q = o.objects[0].colors?.paint ?? [];
  assert([0, 1, 2].every((i) => q[i]?.v === '0C'), `object filament: ${JSON.stringify(q.map((x) => x?.v))}`);
});

Deno.test('3MF filaments: a PrusaSlicer 2 second instance (a wrapper object) keeps the object\'s filament', async () => {
  const verts = [[0, 0, 0], [1, 0, 0], [0, 1, 0]].map((p) => `<vertex x="${p[0]}" y="${p[1]}" z="${p[2]}"/>`).join('');
  const model = `<?xml version="1.0"?><model unit="millimeter" xmlns="${CORE_NS}"><resources>`
    + `<object id="1" type="model"><mesh><vertices>${verts}</vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>`
    + '<object id="2" type="model"><components><component objectid="1"/></components></object>'
    + '</resources><build><item objectid="1"/><item objectid="2" transform="1 0 0 0 1 0 0 0 1 5 0 0"/></build></model>';
  const config = '<?xml version="1.0"?><config><object id="1" instances_count="2">'
    + '<metadata type="object" key="extruder" value="3"/><volume firstid="0" lastid="0"/></object></config>';
  const r = await readThreeMF(await packParts([
    { name: '3D/3dmodel.model', data: model },
    { name: 'Metadata/Slic3r_PE_model.config', data: config },
  ]));
  assert(r.objects.length === 2 && r.objects.every((o) => o.colors?.paint[0]?.v === '0C'),
    `instances ${JSON.stringify(r.objects.map((o) => o.colors?.paint[0]?.v))}`);
});

Deno.test('3MF filaments: an object on filament 2 paints its part, not its modifier', async () => {
  const r = await bambuFilaments('<object id="10"><metadata key="extruder" value="2"/>'
    + '<part id="1" subtype="normal_part"/><part id="2" subtype="modifier_part"><metadata key="sparse_infill_density" value="80%"/></part></object>');
  const o = r.objects[0];
  assert(o.colors?.paint.filter((x) => x?.v === '8').length === TRIS && o.tris === TRIS, `part paint ${o.colors?.paint.length}`);
  assert(o.extras.length === 1 && JSON.stringify(o.extras[0].settings) === '{"bambu":[["sparse_infill_density","80%"]]}',
    `modifier ${JSON.stringify(o.extras)}`);
});

Deno.test('3MF filaments: PrusaSlicer 3 object_settings / volume_settings extruder', async () => {
  const json = { objects: [{ id: 10, object_settings: { extruder: 2 }, volumes: [
    { id: 1, type: 'ModelPart', volume_settings: {} }, { id: 2, type: 'ModelPart', volume_settings: { extruder: 5 } }] }] };
  const cube = (id) => colouredCube(() => '').match(/<object[\s\S]*<\/object>/)[0].replace('id="1"', `id="${id}"`);
  const root = `<?xml version="1.0"?><model unit="millimeter" xmlns="${CORE_NS}"><resources>${cube(1)}${cube(2)}`
    + '<object id="10" type="model"><components><component objectid="1"/><component objectid="2"/></components></object>'
    + '</resources><build><item objectid="10"/></build></model>';
  const r = await readThreeMF(await packParts([
    { name: '3D/3dmodel.model', data: root },
    { name: 'Metadata/PrusaSlicer3_project.json', data: JSON.stringify(json) },
  ]));
  const p = r.objects[0].colors?.paint ?? [];
  assert(p.slice(0, TRIS).every((x) => x?.v === '8') && p.slice(TRIS).every((x) => x?.v === '2C')
    && p.every((x) => x.name === 'slic3rpe:mmu_segmentation'), `paint ${JSON.stringify(p.map((x) => x?.v))}`);
});

// --- integration: a 3MF part drives the real overhang engine ---------------
// The point of the reader is that a 3MF-loaded part behaves EXACTLY like the
// same part loaded as STL through the actual analysis, not just that the bytes
// parse. These run a real stress model through buildTopology + analyze both ways.

const posAttr = (arr) => ({ getAttribute: (k) => (k === 'position' ? { array: arr } : null) });

/** A model part whose one object is a raw triangle soup (3 verts per face). */
function soupModelPart(id, tris, unit = 'millimeter') {
  let verts = '', faces = '';
  for (const p of tris) verts += `<vertex x="${p[0]}" y="${p[1]}" z="${p[2]}"/>`;
  for (let i = 0; i + 3 <= tris.length; i += 3) faces += `<triangle v1="${i}" v2="${i + 1}" v3="${i + 2}"/>`;
  return `<?xml version="1.0"?><model unit="${unit}" xmlns="${CORE_NS}"><resources>`
    + `<object id="${id}" type="model"><mesh><vertices>${verts}</vertices>`
    + `<triangles>${faces}</triangles></mesh></object></resources></model>`;
}

Deno.test('INTEGRATION: a core 3MF part analyzes identically to the same STL', async () => {
  const stl = readSTL(Deno.readFileSync(`${MODELS}lbracket.stl`));
  const rot = rotX(40);
  const a = analyze(buildTopology(posAttr(stl)), 45, rot);

  const blob = writeThreeMF(triples(stl), [], 'lbracket');
  const r = await readThreeMF(new Uint8Array(await blob.arrayBuffer()));
  const b = analyze(buildTopology(posAttr(r.positions)), 45, rot);

  for (const k of ['x', 'y', 'z']) assertClose(b.size[k], a.size[k], 1e-3, `size ${k}`);
  assertClose(b.overArea, a.overArea, a.overArea * 1e-3 + 1e-4, 'overhang area');
  assertClose(b.bedArea, a.bedArea, a.bedArea * 1e-3 + 1e-4, 'bed-contact area');
  assert(b.regions.length === a.regions.length, `regions ${b.regions.length} vs STL's ${a.regions.length}`);
});

Deno.test('INTEGRATION: a production-extension 3MF (mesh via p:path) analyzes identically', async () => {
  const stl = readSTL(Deno.readFileSync(`${MODELS}lbracket.stl`));
  const rot = rotX(40);
  const a = analyze(buildTopology(posAttr(stl)), 45, rot);

  const root = `<?xml version="1.0"?><model unit="millimeter" xmlns="${CORE_NS}"><resources>`
    + '<object id="100" type="model"><components>'
    + '<component p:path="/3D/Objects/mesh.model" objectid="1"/></components></object>'
    + '</resources><build><item objectid="100"/></build></model>';
  const r = await readThreeMF(await packParts([
    { name: '3D/3dmodel.model', data: root },
    { name: '3D/Objects/mesh.model', data: soupModelPart(1, triples(stl)) },
  ]));
  const b = analyze(buildTopology(posAttr(r.positions)), 45, rot);

  for (const k of ['x', 'y', 'z']) assertClose(b.size[k], a.size[k], 1e-3, `size ${k} via p:path`);
  assertClose(b.overArea, a.overArea, a.overArea * 1e-3 + 1e-4, 'overhang area via p:path');
  assert(b.regions.length === a.regions.length, `regions ${b.regions.length} vs STL's ${a.regions.length}`);
});
