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
//   - a malformed file fails loudly rather than opening blank or sheared.

import { WEB, MODELS, assert, assertClose, block, readSTL, buildTopology, analyze, rotX } from './_util.js';

const { writeThreeMF, readThreeMF } = await import(`${WEB}threemf.js`);
const { zipStore } = await import(`${WEB}zip.js`);

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
