// Source identity is separate from the flattened geometry consumed by the
// engine. In particular, paint coordinates refer to the ORIGINAL corner order.
import { WEB, assert, assertClose, block } from './_util.js';
const { readThreeMFParts, meshXML } = await import(`${WEB}threemf.js`);
const { cutNegatives } = await import(`${WEB}cut.js`);
const enc = new TextEncoder();
const CORE = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const PROD = 'http://schemas.microsoft.com/3dmanufacturing/production/2015/06';
const I = '1 0 0 0 1 0 0 0 1 0 0 0';
const triples = (p) => Array.from({ length: p.length / 3 }, (_, i) => Array.from(p.slice(i * 3, i * 3 + 3)));
const equal = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const wrap = (resources, build = '', unit = 'millimeter') => `<model xmlns="${CORE}" xmlns:p="${PROD}" unit="${unit}"><resources>${resources}</resources><build>${build}</build></model>`;

function fixture({ mirror = false, duplicate = false, empty = false, unit = 'millimeter' } = {}) {
  const root = '<object id="100"><components>'
    + '<component objectid="11" p:path="/3D/Objects/part.model" transform="1 0 0 0 1 0 0 0 1 3 4 0"/>'
    + '<component objectid="11" p:path="/3D/Objects/part.model" transform="1 0 0 0 1 0 0 0 1 20 4 0"/>'
    + '<component objectid="12" p:path="/3D/Objects/cut.model"/>'
    + '<component objectid="12" p:path="/3D/Objects/cut.model" transform="1 0 0 0 1 0 0 0 1 5 0 0"/>'
    + '</components></object>';
  const part = '<basematerials id="5"><base name="one" displaycolor="#FFFFFF"/><base name="two" displaycolor="#FFFFFF"/></basematerials>'
    + '<object id="1" pid="5" pindex="0">'
    + meshXML(triples(block(0, 10, 0, 10, 0, 10)), (i) => i === 0 ? ' paint_color="4" p1="1" seam="8" custom="keep&amp;this"' : '')
    + '</object><object id="11"><components><component objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 2"/></components></object>';
  const config = '<config><object id="100"><metadata key="extruder" value="2"/>'
    + '<part id="11" subtype="normal_part"><metadata key="name" value="body"/><metadata key="extruder" value="3"/><metadata key="source_file" value="original.stl"/></part>'
    + '<part id="12" subtype="negative_part"><metadata key="name" value="cut"/></part></object></config>';
  return new Map(Object.entries({
    '3D/3dmodel.model': wrap(root, `<item objectid="100" transform="${mirror ? '-1 0 0 0 1 0 0 0 1 100 0 0' : I}"/>`
      + (duplicate ? '<item objectid="100"/>' : ''), unit),
    '3D/Objects/part.model': wrap(part),
    '3D/Objects/cut.model': wrap('<object id="12">' + (empty ? '<mesh><vertices/><triangles/></mesh>'
      : meshXML(triples(block(1, 2, 1, 2, 1, 12)))) + '</object>'),
    'Metadata/model_settings.config': config,
  }).map(([k, v]) => [k, enc.encode(v)]));
}

for (const mirror of [false, true]) Deno.test(`provenance: nested/repeated components and original corners; mirrored=${mirror}`, () => {
  const parts = fixture({ mirror }), opts = { buildIndex: 0, doublePrecision: true, outwardWinding: true };
  const ordinary = readThreeMFParts(parts, opts).objects[0];
  const model = readThreeMFParts(parts, { ...opts, withComponents: true }).objects[0];
  assert(!('components' in ordinary), 'default reader API changed');
  assert(equal(model.positions, ordinary.positions), 'trace changed the engine geometry');
  assert(JSON.stringify(model.colors) === JSON.stringify(ordinary.colors), 'trace changed legacy colors');
  assert(model.components.length === 4 && model.extras.length === 2, 'occurrences were merged');
  assert(model.components[0].source === model.components[1].source, 'source mesh unnecessarily duplicated');
  assert(model.components.map((c) => c.route.join('/')).join(',') === '0/0,1/0,2,3');
  assert(model.components.map((c) => c.partId).join(',') === '11,11,12,12');
  assert(model.components.map((c) => c.objectId).join(',') === '1,1,12,12');
  for (const c of model.components) {
    assert(c.buildIndex === 0 && c.unitScale === 1);
    assert(equal(c.cornerOrder, mirror ? [0, 2, 1] : [0, 1, 2]));
    assert(c.positions.length === c.sourceFaces.length * 9);
    for (let t = 0; t < c.sourceFaces.length; t++) for (let k = 0; k < 3; k++) {
      const vertex = c.source.indices[c.sourceFaces[t] * 3 + c.cornerOrder[k]];
      const [x, y, z] = c.source.vertices.slice(vertex * 3, vertex * 3 + 3);
      const m = c.transform ?? I.split(' ').map(Number);
      const world = [x*m[0]+y*m[3]+z*m[6]+m[9], x*m[1]+y*m[4]+z*m[7]+m[10], x*m[2]+y*m[5]+z*m[8]+m[11]];
      for (let a = 0; a < 3; a++) assertClose(c.positions[t*9+k*3+a], world[a], 1e-10, 'source corner moved');
    }
  }
  for (let i = 0; i < model.extras.length; i++) assert(equal(model.extras[i].positions, ordinary.extras[i].positions));
  const c = model.components[0];
  assert(c.settings[0].metadata.some(([k, v]) => k === 'extruder' && v === '3'));
  assert(c.settings[0].metadata.some(([k, v]) => k === 'source_file' && v === 'original.stl'));
  assert(c.objectSettings[0][1] === '2');
  assert(c.source.attributes.pid === '5' && c.source.attributes.pindex === '0');
  const a = c.source.triangleAttributes[0];
  assert(a.paint_color === '4' && a.p1 === '1' && a.seam === '8' && a.custom === 'keep&amp;this');
  assert(c.source.properties[0].children.map((v) => v.attributes.name).join(',') === 'one,two', 'equal RGB collapsed material identity');
});

Deno.test('provenance: build instances have independent occurrence identity, source topology is shared', () => {
  const objects = readThreeMFParts(fixture({ duplicate: true }), { withComponents: true }).objects;
  assert(objects.length === 2);
  assert(objects[0].components[0].buildIndex === 0 && objects[1].components[0].buildIndex === 1);
  assert(objects[0].components[0].source === objects[1].components[0].source);
});

Deno.test('provenance: unit scaling and empty cutter occurrences remain explicit', () => {
  const model = readThreeMFParts(fixture({ unit: 'inch', empty: true }), { withComponents: true }).objects[0];
  assert(model.extras.length === 0, 'legacy empty-extra behavior changed');
  assert(model.components.length === 4 && model.components[2].sourceFaces.length === 0);
  assert(model.components[2].positions.length === 0 && model.components[2].kind === 'negative');
  assert(model.components[0].unitScale === 25.4);
  assertClose(model.components[0].positions[0], 3 * 25.4, 1e-5);
});

Deno.test('provenance: missing/cyclic geometry still fails selected-object decoding', () => {
  for (const cycle of [false, true]) {
    const parts = fixture();
    if (cycle) parts.set('3D/Objects/part.model', enc.encode(wrap('<object id="11"><components><component objectid="11"/></components></object>')));
    else parts.delete('3D/Objects/part.model');
    let failed = false;
    try { readThreeMFParts(parts, { buildIndex: 0, withComponents: true }); }
    catch (e) { failed = /missing resources|cyclic/.test(e.message); }
    assert(failed, 'invalid dependency tree accepted');
  }
});

Deno.test('provenance: subtraction identifies retained input faces and cutter surfaces without changing geometry', async () => {
  const obj = { positions: block(0, 10, 0, 10, 0, 10),
    extras: [{ kind: 'negative', positions: block(4, 11, 4, 11, 4, 11) }] };
  const plain = await cutNegatives(obj), traced = await cutNegatives(obj, { provenance: true });
  assert(!('sourceFaces' in plain));
  assert(equal(plain.positions, traced.positions), 'provenance changed boolean output');
  assert(plain.cut === traced.cut && plain.uncut === traced.uncut && plain.why === traced.why);
  assert(traced.sourceFaces.length === traced.positions.length / 9);
  assert(traced.sourceFaces.some((f) => f === -1) && traced.sourceFaces.some((f) => f >= 0));
  for (let t = 0; t < traced.sourceFaces.length; t++) {
    const f = traced.sourceFaces[t];
    if (f < 0) continue;
    assert(f < obj.positions.length / 9);
    // Coplanar source identity is a hint, not permission to copy opaque paint.
    const source = obj.positions.subarray(f * 9, f * 9 + 9);
    const axis = [0, 1, 2].find((a) => source[a] === source[a+3] && source[a] === source[a+6]);
    assert(axis !== undefined);
    for (let k = 0; k < 3; k++) assertClose(traced.positions[t*9+k*3+axis], source[axis], 1e-5);
  }
});

Deno.test('provenance: no-cut and fallback faces retain identity and caller precision', async () => {
  const positions = new Float64Array(block(0, 10, 0, 10, 0, 10));
  for (const extras of [[], [{ kind: 'negative', positions: block(-1, 11, -1, 11, -1, 11) }]]) {
    const r = await cutNegatives({ positions, extras }, { provenance: true });
    assert(r.positions === positions);
    assert(r.sourceFaces.every((f, i) => f === i));
  }
});
