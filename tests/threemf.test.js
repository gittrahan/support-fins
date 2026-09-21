// The 3MF has to import as ONE object made of two locked bodies (the part + the
// fins), positions preserved, in Bambu Studio / OrcaSlicer / PrusaSlicer. That
// only holds if the file carries 3MF PRODUCTION-EXTENSION UUIDs: without a p:UUID
// on every object, the build, and the build item, PrusaSlicer 3.x falls back to a
// grouping/arrange heuristic that spreads the bodies out or drops them to the bed
// -- the "geometry is not as expected" import (gh issue #3). These pin the
// structure so a revert to a bare core-only file (no UUIDs, implicit transforms)
// fails loudly. See web/threemf.js for the why.

import { assert } from './_util.js';

const WEB = new URL('../web/', import.meta.url).pathname;
const { writeThreeMF } = await import(`${WEB}threemf.js`);

// A tetra part + a separate tetra "fin", enough to exercise the two-body assembly.
const PART = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0],
  [0, 0, 0], [0, 1, 0], [0, 0, 1],
  [0, 0, 0], [0, 0, 1], [1, 0, 0],
  [1, 0, 0], [0, 0, 1], [0, 1, 0],
];
const FIN = PART.map(([x, y, z]) => [x + 5, y, z]);

// The archive is written STORE (uncompressed), so the model part's bytes appear
// verbatim -- pull the model XML straight out without a zip library.
async function modelXML(part, fin) {
  const blob = await writeThreeMF(part, fin, 'TestPart');
  const text = new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()));
  const a = text.indexOf('<model');
  const b = text.indexOf('</model>');
  assert(a >= 0 && b > a, 'no <model> part found in the .3mf archive');
  return text.slice(a, b + '</model>'.length);
}

Deno.test('3mf: declares the production extension, but never REQUIRES it (old readers still open it)', async () => {
  const xml = await modelXML(PART, FIN);
  assert(xml.includes('xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06"'),
    'production namespace must be declared');
  assert(!xml.includes('requiredextensions'),
    'production must NOT be a required extension -- that would make core-only readers reject the file');
});

Deno.test('3mf: every object, the build, and the build item carry a p:UUID', async () => {
  const xml = await modelXML(PART, FIN);
  // three objects: part (1), fins (2), assembly (3)
  const objUUIDs = [...xml.matchAll(/<object\b[^>]*\bp:UUID="([^"]+)"/g)].map((m) => m[1]);
  assert(objUUIDs.length === 3, `expected 3 objects with p:UUID, got ${objUUIDs.length}`);
  assert(/<item\b[^>]*\bp:UUID="[^"]+"/.test(xml), 'the build <item> must carry a p:UUID');
  const all = objUUIDs;
  assert(new Set(all).size === all.length, 'UUIDs must be unique');
  // real UUID shape, not a placeholder
  for (const u of all) {
    assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(u), `bad UUID: ${u}`);
  }
});

Deno.test('3mf: the assembly locks the two bodies with an EXPLICIT identity transform', async () => {
  const xml = await modelXML(PART, FIN);
  const comps = [...xml.matchAll(/<component\b[^>]*\btransform="([^"]+)"/g)].map((m) => m[1]);
  assert(comps.length === 2, `expected 2 components with an explicit transform, got ${comps.length}`);
  for (const t of comps) {
    assert(t === '1 0 0 0 1 0 0 0 1 0 0 0', `component transform must be explicit identity, got "${t}"`);
  }
});

Deno.test('3mf: a part with NO fins still writes a single valid object referenced by the build', async () => {
  const xml = await modelXML(PART, []);
  const objUUIDs = [...xml.matchAll(/<object\b[^>]*\bp:UUID="([^"]+)"/g)];
  assert(objUUIDs.length === 1, `no-fins export should have exactly 1 object, got ${objUUIDs.length}`);
  assert(!xml.includes('<components>'), 'no assembly when there are no fins');
  assert(/<item objectid="1"/.test(xml), 'the build must reference the lone part object');
});
