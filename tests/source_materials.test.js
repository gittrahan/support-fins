// Procedural packages only; no user projects or slicer installation required.
import { assert, assertEquals, assertNotEquals, assertStringIncludes, assertThrows } from 'jsr:@std/assert';
import { readThreeMFParts, readThreeMF, meshXML } from '../web/threemf.js';
import { worldMaterialRegions } from '../web/threemf/materials.js';
import { zipStore } from '../web/zip.js';
import { block } from './_util.js';

const enc = new TextEncoder();
const CORE = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const PROD = 'http://schemas.microsoft.com/3dmanufacturing/production/2015/06';
const wrap = (resources, build = '', unit = 'millimeter') => `<model xmlns="${CORE}" xmlns:p="${PROD}" unit="${unit}"><resources>${resources}</resources><build>${build}</build></model>`;
const triples = (p) => Array.from({ length: p.length / 3 }, (_, i) => Array.from(p.slice(i * 3, i * 3 + 3)));
const mesh = (attrs = () => '') => meshXML(triples(block(0, 10, 0, 8, 0, 6)), attrs);
const xmlSettings = (object = '2', part = '3', extra = '') => `<config><object id="100"><metadata key="extruder" value="${object}"/>
  <part id="11" subtype="normal_part"><metadata key="extruder" value="${part}"/>${extra}</part></object></config>`;
const packageOf = (files) => new Map(Object.entries(files).map(([k, v]) => [k, enc.encode(v)]));
function fixture({ paint = '', settings = {}, config = xmlSettings(), mirror = false, duplicate = false, unit = 'millimeter' } = {}) {
  return packageOf({
    '3D/3dmodel.model': wrap('<object id="100"><components><component objectid="11" p:path="/3D/Objects/part.model" transform="0 1 0 -1 0 0 0 0 1 20 3 0"/>'
      + '<component objectid="11" p:path="/3D/Objects/part.model" transform="1 0 0 0 1 0 0 0 1 40 0 0"/></components></object>',
    `<item objectid="100" transform="${mirror ? '-1 0 0 0 1 0 0 0 1 100 0 0' : '1 0 0 0 1 0 0 0 1 0 0 0'}"/>`
      + (duplicate ? '<item objectid="100"/>' : ''), unit),
    '3D/Objects/part.model': wrap('<object id="11"><components><component objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 2"/></components></object>'
      + '<object id="1">' + mesh((i) => i === 0 ? paint : '') + '</object>'),
    'Metadata/model_settings.config': config,
    'Metadata/project_settings.config': JSON.stringify({ filament_colour: ['#FFFFFF', '#FFFFFF', '#000000'], extruder: '1', ...settings }),
  });
}
const read = (parts, opts = {}) => readThreeMFParts(parts, { withMaterials: true, ...opts }).objects[0];
const face = (obj, f = 0, c = 0) => obj.materials.occurrences[c].faces[f];
const id = (obj, f = 0, c = 0) => face(obj, f, c).regions.map((r) => r.material);

Deno.test('source materials: optional field preserves ordinary components, colours, source bytes and geometry', async () => {
  const parts = fixture({ paint: ' paint_color="480C0381" seam="8"', mirror: true });
  const before = [...parts].map(([k, v]) => [k, v.slice()]);
  for (const opts of [{}, { buildIndex: 0, doublePrecision: true, outwardWinding: true }]) {
    const ordinary = readThreeMFParts(parts, { ...opts, withComponents: true });
    const enriched = readThreeMFParts(parts, { ...opts, withMaterials: true });
    for (const o of enriched.objects) delete o.materials;
    assertEquals(enriched, ordinary);
  }
  assertEquals([...parts], before);
  assert(!('materials' in readThreeMFParts(parts).objects[0]));
  assert(!('components' in readThreeMFParts(parts).objects[0]));
  const bytes = new Uint8Array(await zipStore([...parts].map(([name, data]) => ({ name, data }))).arrayBuffer());
  assertEquals((await readThreeMF(bytes, { withMaterials: true })).objects[0].materials, read(parts).materials);
});

Deno.test('source materials: part, object and project inheritance preserve identical-colour slot identity and role overrides', () => {
  const obj = read(fixture({ paint: ' paint_color="481"', config: xmlSettings('2', '3',
    '<metadata key="wall_filament" value="2"/><metadata key="sparse_infill_filament" value="1"/><metadata key="solid_infill_filament" value="0"/>') }));
  assert(obj.materials.complete);
  assertEquals(id(obj), ['filament:2', 'filament:1']);
  assertEquals(id(obj, 1), ['filament:3']);
  assertEquals(face(obj).roles, { wall: 'filament:2', infill: 'filament:1', solidInfill: 'filament:3' });
  const [a, b] = obj.materials.materials;
  assertEquals(a.displayColor, b.displayColor);
  assertNotEquals(a.id, b.id);
  assertEquals(id(read(fixture({ config: xmlSettings('2', '0') }))), ['filament:2']);
  assertEquals(id(read(fixture({ config: xmlSettings('0', '0') }))), ['filament:1']);
  assertEquals(id(read(fixture({ config: '<config/>', settings: { extruder: '0', filament_colour: ['#FFFFFF'] } }))), ['filament:1']);
  const incomplete = read(fixture({ config: '<config/>', settings: { extruder: '0' } }));
  assert(!incomplete.materials.complete);
  assertEquals(id(incomplete), [null]);
});

Deno.test('source materials: recursive painting follows original corners through nested rotations, mirrors, units and occurrences', () => {
  for (const mirror of [false, true]) for (const unit of ['millimeter', 'inch']) {
    const obj = read(fixture({ mirror, unit, duplicate: true, paint: ' paint_color="481"' }), { outwardWinding: true, doublePrecision: true });
    const c = obj.components[0];
    const regions = worldMaterialRegions(c, 0, face(obj));
    // Independently transform the original first triangle's corners.
    const points = c.source.indices.slice(0, 3).map((v) => {
      const [x, y, z] = c.source.vertices.slice(v * 3, v * 3 + 3), m = c.transform;
      return [x*m[0]+y*m[3]+z*m[6]+m[9], x*m[1]+y*m[4]+z*m[7]+m[10], x*m[2]+y*m[5]+z*m[8]+m[11]].map((v) => v*c.unitScale);
    });
    const [a, b, d] = points, mid = b.map((v, k) => (v + d[k]) / 2);
    assertEquals(regions.map((r) => r.triangle), [[mid, d, a], [a, b, mid]]);
    assertEquals(regions.map((r) => r.material), ['filament:2', 'filament:1']);
    assertEquals(c.cornerOrder, mirror ? [0, 2, 1] : [0, 1, 2]);
    assertEquals(obj.materials.occurrences[0].sourceFaces, c.sourceFaces);
    assertNotEquals(obj.materials.occurrences[0].key, obj.materials.occurrences[1].key);
    assertNotEquals(regions, worldMaterialRegions(obj.components[1], 0, face(obj, 0, 1)));
    const objects = readThreeMFParts(fixture({ duplicate: true }), { withMaterials: true }).objects;
    assertNotEquals(objects[0].materials.occurrences[0].key, objects[1].materials.occurrences[0].key);
  }
});

Deno.test('source materials: core identities are scoped to resource file and entry, never RGB', () => {
  const resource = '<basematerials id="5"><base name="one&amp;two" displaycolor="#FFFFFF"/><base name="other" displaycolor="#FFFFFF"/></basematerials>';
  const part = (attr) => wrap(resource + '<object id="1" pid="5" pindex="0">' + mesh((i) => i === 0 ? attr : '') + '</object>');
  const parts = packageOf({
    '3D/3dmodel.model': wrap('<object id="100"><components><component objectid="1" p:path="/3D/a.model"/><component objectid="1" p:path="/3D/b.model"/></components></object>', '<item objectid="100"/>'),
    '3D/a.model': part(' p1="1"'), '3D/b.model': part(''),
  });
  const obj = read(parts);
  assert(obj.materials.complete);
  assertEquals(obj.materials.flavor, 'core');
  assertEquals(obj.materials.materials.length, 3);
  assertNotEquals(id(obj, 0), id(obj, 1));
  assertNotEquals(id(obj, 1, 0), id(obj, 1, 1));
  assert(obj.materials.materials.some((m) => m.name === 'one&two'));
  assert(obj.materials.materials.every((m) => m.displayColor === '#FFFFFF'));
});

function prusaFixture({ paint = ' slic3rpe:mmu_segmentation="481"', ranges = '', metadata = '' } = {}) {
  return packageOf({
    '3D/3dmodel.model': wrap('<object id="1">' + mesh((i) => i === 0 ? paint : '') + '</object>', '<item objectid="1"/>'),
    'Metadata/Slic3r_PE.config': '; filament_colour = #FFFFFF;#FFFFFF;#000000\n; extruder = 1\n; filament_type = PLA\n; filament_settings_id = "Profile; name";Other;Third',
    'Metadata/Slic3r_PE_model.config': `<config><object id="1"><metadata type="object" key="extruder" value="2"/>${metadata}${ranges}</object></config>`,
  });
}
const range = (a, b, slot) => `<volume firstid="${a}" lastid="${b}"><metadata type="volume" key="extruder" value="${slot}"/></volume>`;
Deno.test('source materials: Prusa 2 volume ranges, inherited painting and independent material roles', () => {
  const obj = read(prusaFixture({ ranges: range(0, 5, '3') + range(6, 11, '0'),
    metadata: '<metadata key="perimeter_extruder" value="1"/><metadata key="infill_extruder" value="3"/>' }));
  assert(obj.materials.complete, JSON.stringify(obj.materials.issues));
  assertEquals(obj.materials.flavor, 'prusa');
  assertEquals(id(obj), ['filament:2', 'filament:1']);
  assertEquals(id(obj, 1), ['filament:3']);
  assertEquals(id(obj, 6), ['filament:2']);
  assertEquals(face(obj, 1).roles, { wall: 'filament:1', infill: 'filament:3', solidInfill: 'filament:3' });
  assertEquals(obj.materials.materials[0].name, 'Profile; name');
  assertEquals(obj.materials.materials[1].materialType, null, 'profile description must not invent slot identity');
  const inherited = read(prusaFixture({ paint: ' slic3rpe:mmu_segmentation="401"' }));
  assertEquals(id(inherited), ['filament:2', 'filament:1']);
});

Deno.test('source materials: Prusa extended painting and Prusa 3 component assignments', () => {
  const parts = prusaFixture({ paint: ' slic3rpe:mmu_segmentation="400EC1"' });
  parts.set('Metadata/Slic3r_PE.config', enc.encode('filament_colour = ' + Array(20).fill('#FFFFFF').join(';')));
  assertEquals(id(read(parts)), ['filament:17', 'filament:1']);
  const components = fixture({ config: '<config/>' });
  components.set('Metadata/PrusaSlicer3_project.json', enc.encode(JSON.stringify({ objects: [{ id: 100,
    object_settings: { extruder: '2' }, volumes: [{ id: 11, volume_settings: { extruder: '3' } }] }] })));
  assertEquals(id(read(components)), ['filament:3']);
  const bambu = fixture({ paint: ' paint_color="2FC"', settings: { filament_colour: Array(20).fill('#FFFFFF') } });
  assertEquals(id(read(bambu)), ['filament:20']);
});

Deno.test('source materials: selected object decoding is deterministic and does not load unrelated meshes', () => {
  const parts = fixture();
  const root = new TextDecoder().decode(parts.get('3D/3dmodel.model'));
  parts.set('3D/3dmodel.model', enc.encode(root.replace('</resources>', '<object id="200"><components><component objectid="1" p:path="/3D/missing.model"/></components></object></resources>')
    .replace('</build>', '<item objectid="200"/></build>')));
  const first = read(parts, { buildIndex: 0 });
  assert(first.materials.complete);
  assertEquals(read(parts, { buildIndex: 0 }), first);
  assertThrows(() => read(parts, { buildIndex: 1 }), Error, 'missing resources');
});

Deno.test('source materials: missing palettes, invalid paint, assignments and configuration stay explicit', () => {
  const cases = [
    [fixture({ paint: ' paint_color="4G"' }), 'hexadecimal'],
    [fixture({ paint: ' paint_color="1C"' }), 'unavailable state'],
    [fixture({ paint: ' paint_color="4" slic3rpe:mmu_segmentation="8"' }), 'conflicting colour'],
    [fixture({ config: xmlSettings('2', '99') }), 'unavailable filament'],
    [fixture({ config: xmlSettings('2', '-1') }), 'invalid extruder'],
    [fixture({ config: xmlSettings('2', '2', '<metadata key="extruder" value="3"/>') }), 'conflicting extruder'],
    [prusaFixture({ ranges: range(0, 6, '2') + range(6, 11, '2') }), 'overlapping component'],
    [prusaFixture({ ranges: range(0, 50, '2') }), 'invalid component'],
    [prusaFixture({ ranges: range('nan', 2, '2') }), 'invalid component'],
  ];
  const noPalette = fixture(); noPalette.delete('Metadata/project_settings.config');
  cases.push([noPalette, 'palette is missing']);
  const badJSON = fixture(); badJSON.set('Metadata/project_settings.config', enc.encode('{'));
  cases.push([badJSON, 'metadata is invalid']);
  const badPrusa = fixture(); badPrusa.set('Metadata/PrusaSlicer3_project.json', enc.encode('{"objects":[{"id":100,"object_settings":[]}]}'));
  cases.push([badPrusa, 'invalid component settings']);
  for (const [parts, expected] of cases) {
    const obj = read(parts);
    assert(!obj.materials.complete, expected);
    assertStringIncludes(JSON.stringify(obj.materials.issues), expected);
    assert(obj.materials.issues.length < 10, 'errors should be aggregated, not one per face');
  }
  // A broken inherited assignment cannot erase a separately known painted slot.
  const painted = read(fixture({ paint: ' paint_color="8"', config: xmlSettings('2', '-1') }));
  assertEquals(id(painted), ['filament:2']);
  assert(face(painted).unresolved);
});

Deno.test('source materials: gradients, unknown resources and unmapped core/filament combinations are not guessed', () => {
  const cases = [
    ['<basematerials id="5"><base name="A" displaycolor="#FFFFFF"/><base name="B" displaycolor="#FFFFFF"/></basematerials>', ' p1="0" p2="1"', 'interpolated'],
    ['<m:colorgroup id="5"><m:color color="#FFFFFF"/></m:colorgroup>', ' p1="9"', 'out of range'],
    ['<m:texture2dgroup id="5"/>', '', 'unsupported'],
    ['', '', 'missing or conflicting'],
  ];
  for (const [resource, attr, expected] of cases) {
    const parts = packageOf({ '3D/3dmodel.model': wrap(resource + '<object id="1" pid="5" pindex="0">' + mesh(() => attr) + '</object>', '<item objectid="1"/>') });
    const obj = read(parts);
    assert(!obj.materials.complete);
    assertStringIncludes(face(obj).unresolved, expected);
  }
  const parts = packageOf({ '3D/3dmodel.model': wrap('<m:colorgroup id="5"><m:color color="#FFFFFF"/></m:colorgroup><object id="1" pid="5" pindex="0">' + mesh() + '</object>', '<item objectid="1"/>'),
    'Metadata/project_settings.config': JSON.stringify({ filament_colour: ['#FFFFFF'] }) });
  const obj = read(parts);
  assertStringIncludes(face(obj).unresolved, 'no explicit filament mapping');
  assertEquals(id(obj), [null]);
  assert(face(obj).core && face(obj).base, 'keep both original identities for a later explicit mapping');
  assertThrows(() => worldMaterialRegions(obj.components[0], -1, face(obj)), Error, 'invalid material face');
});
