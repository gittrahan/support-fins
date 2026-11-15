// Byte gate for the 3MF writer and reader: fixed inputs in, a hash of what comes
// out. Written before web/threemf.js was split into web/threemf/ (code health,
// move only), so the split is proved to change nothing; it stays as the tripwire
// for any later edit that is meant to be output-neutral. A deliberate format
// change updates the hashes here in the same commit, and says why.
//
// Writer: every entry of the package, unzipped (the deflate stream itself is the
// runtime's), for the locked, separate, interface, coloured, slicer-part (Bambu,
// PrusaSlicer 3) and multi-model-on-a-bed layouts, with and without a session.
// Reader: readThreeMF on the three slicer fixtures and on each written file, and
// readThreeMFParts with each of its options.

import { WEB, block } from './_util.js';

const { writeThreeMF, writePlate3MF, readThreeMF, readThreeMFParts } = await import(`${WEB}threemf.js`);
const { unzip } = await import(`${WEB}zip.js`);

const NEG_FIX = new URL('./fixtures/negative-parts/', import.meta.url);
const FIXTURES = ['bambu.3mf', 'orca.3mf', 'prusaslicer3.3mf'];

function triples(flat) {
  const out = [];
  for (let i = 0; i < flat.length; i += 3) out.push([flat[i], flat[i + 1], flat[i + 2]]);
  return out;
}

/** Canonical JSON: typed arrays as arrays, Maps and Sets as sorted entries. */
function canon(v) {
  return JSON.stringify(v, (_k, x) => {
    if (ArrayBuffer.isView(x)) return Array.from(x);
    if (x instanceof Map) return ['Map', [...x.entries()]];
    if (x instanceof Set) return ['Set', [...x]];
    return x;
  });
}

async function sha(text) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

/** A written package's entries, unzipped, in name order. */
async function packageText(blob) {
  const parts = await unzip(new Uint8Array(await blob.arrayBuffer()));
  const dec = new TextDecoder();
  return [...parts.keys()].sort().map((k) => `${k}\n${dec.decode(parts.get(k))}`).join('\n--\n');
}

const PART = triples(block(0, 10, 0, 8, 0, 6));
const FINS = triples(block(2, 3, 1, 7, -1, 0.5));
const IFACE = triples(block(2, 3, 1, 7, 0.3, 0.5));
const SESSION = { v: 1, rot: [1, 0, 0, 0, 1, 0, 0, 0, 1], opts: { gap: 0.2 } };

async function fixture(name) {
  return readThreeMF(await Deno.readFile(new URL(name, NEG_FIX)));
}

/** The first object of a slicer fixture, as the site re-exports it. */
async function fixtureModel(name) {
  const o = (await fixture(name)).objects[0];
  return {
    partTris: triples(o.positions), finTris: FINS, name: o.name, iface: [], colors: o.colors,
    extras: o.extras.map((e) => ({ ...e, tris: triples(e.positions) })),
  };
}

async function writes() {
  const out = {};
  out.locked = await writeThreeMF(PART, FINS, 'gate');
  out.separate = await writeThreeMF(PART, FINS, 'gate', { separate: true });
  out.iface = await writeThreeMF(PART, FINS, 'gate', { separate: true, iface: IFACE });
  out.session = await writeThreeMF(PART, FINS, 'gate', { separate: true, session: SESSION });
  const mod = { kind: 'modifier', name: 'dense', tris: triples(block(-1, 0.5, 0, 1, 0, 1)),
    settings: { bambu: [['sparse_infill_density', '80%'], ['extruder', '2']] } };
  const neg = { kind: 'negative', name: 'hole', tris: triples(block(1, 2, 1, 2, 1, 2)) };
  const paint = []; paint[3] = { name: 'paint_color', v: '8' }; paint[7] = { name: 'paint_color', v: '0C' };
  const rgb = []; rgb[0] = '#FF0000'; rgb[5] = '#00FF00AA';
  out.painted = await writeThreeMF(PART, FINS, 'gate', { separate: true, colors: { paint, rgb },
    extras: [mod, { ...neg, settings: { bambu: [] } }] });
  out.prusa2 = await writeThreeMF(PART, FINS, 'gate', { separate: true,
    colors: { paint: [{ name: 'slic3rpe:mmu_segmentation', v: '8' }], rgb: [] },
    extras: [{ ...neg, settings: { prusa2: [] } }] });
  for (const f of FIXTURES) {
    const m = await fixtureModel(f);
    out[`extras-${f}`] = await writeThreeMF(m.partTris, m.finTris, m.name,
      { separate: true, colors: m.colors, extras: m.extras });
  }
  const second = { partTris: triples(block(30, 36, 0, 6, 0, 4)), finTris: [], name: 'second', iface: [], colors: null, extras: [] };
  out.plate = await writePlate3MF([{ partTris: PART, finTris: FINS, name: 'first', iface: IFACE, colors: null, extras: [] }, second],
    { title: 'plate', separate: true });
  out.plateBed = await writePlate3MF([{ partTris: PART, finTris: FINS, name: 'first', iface: [], colors: null, extras: [] }, second],
    { title: 'plate', separate: false, bed: { x: 256, y: 256 }, session: SESSION });
  return out;
}

// Recorded on origin/main d72062e, before the split.
const WANT = {
  "parts components bambu.3mf": "c8b1940f6cd70f1e",
  "parts components orca.3mf": "0b57a0e2b080cee8",
  "parts components prusaslicer3.3mf": "d85c08ceeee513a6",
  "parts double+outward bambu.3mf": "014960f75679abc6",
  "parts double+outward orca.3mf": "35c9b7f1a3d41b3e",
  "parts double+outward prusaslicer3.3mf": "43828807a6e3baa3",
  "parts item 0 bambu.3mf": "9427838c47d79a53",
  "parts item 0 orca.3mf": "b0543bbace969acd",
  "parts item 0 prusaslicer3.3mf": "a2f509197cc020c4",
  "read bambu.3mf": "4ca08efe64a6a9a5",
  "read orca.3mf": "ce4e9309e02eee70",
  "read prusaslicer3.3mf": "8323677f413d7400",
  "reread extras-bambu.3mf": "fbe4d5bfdba03cd1",
  "reread extras-orca.3mf": "a29a4846d95a035d",
  "reread extras-prusaslicer3.3mf": "d3c3439e0d6e99d9",
  "reread iface": "3831ed0e65b70df4",
  "reread locked": "b928f3c1601fe6da",
  "reread painted": "eb7c583f50c690e1",
  "reread plate": "380a0c9ac782e176",
  "reread plateBed": "69b423b339cc06b9",
  "reread prusa2": "8c611155f44a63d5",
  "reread separate": "f768aef0bad91966",
  "reread session": "84f1df8ce404704c",
  "write extras-bambu.3mf": "ae6ec45bca87ba0a",
  "write extras-orca.3mf": "4ba818c893e4c4b6",
  "write extras-prusaslicer3.3mf": "5b0b06b2bbfda7b6",
  "write iface": "21d5481cbfd61a0b",
  "write locked": "cf29a13a3bfb9b67",
  "write painted": "bd1b8f75f44e18ee",
  "write plate": "dbdf6e43693efde8",
  "write plateBed": "275289e097e54bb4",
  "write prusa2": "23949275741a67d2",
  "write separate": "ad38c91c1fcddeef",
  "write session": "83491909fd42cbfd",
};

Deno.test('3MF byte gate: writer output and reader results are unchanged', async () => {
  const got = {};
  const written = await writes();
  for (const [k, blob] of Object.entries(written)) {
    got[`write ${k}`] = await sha(await packageText(blob));
    got[`reread ${k}`] = await sha(canon(await readThreeMF(new Uint8Array(await blob.arrayBuffer()))));
  }
  for (const f of FIXTURES) {
    const bytes = await Deno.readFile(new URL(f, NEG_FIX));
    got[`read ${f}`] = await sha(canon(await readThreeMF(bytes)));
    const parts = await unzip(bytes);
    for (const [label, opts] of [
      ['components', { withComponents: true }],
      ['double+outward', { doublePrecision: true, outwardWinding: true }],
      ['item 0', { buildIndex: 0, withComponents: true, doublePrecision: true }],
    ]) got[`parts ${label} ${f}`] = await sha(canon(readThreeMFParts(parts, opts)));
  }
  if (Deno.env.get('GATE_PRINT')) console.log(JSON.stringify(got, null, 2));
  const bad = Object.keys({ ...got, ...WANT }).filter((k) => got[k] !== WANT[k]);
  if (bad.length) throw new Error(`3MF output changed: ${bad.map((k) => `${k}: ${WANT[k]} -> ${got[k]}`).join('; ')}`);
});
