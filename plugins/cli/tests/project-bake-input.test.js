import { assert } from '../../../tests/_util.js';
import { zipStore } from '../../../web/zip.js';
import { ProjectZip } from '../project-zip.js';
import { bakeFixture } from './_bake-fixture.js';
import { bakeProjectObject } from '../project-bake-input.js';
import { bakeProjectNegatives } from '../project-bake.js';
const enc = new TextEncoder(), dec = new TextDecoder();
const identity = async () => 'a'.repeat(64);
const ROOT = '3D/3dmodel.model', CONFIG = 'Metadata/model_settings.config';
const SETTINGS = 'Metadata/project_settings.config';
const defaults = { filament_colour: ['#FFFFFF', '#FFFFFF'], extruder: '1', layer_height: '0.2',
  initial_layer_print_height: '0.24', wall_filament: '0', sparse_infill_filament: '2', solid_infill_filament: '0' };
const equal = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
async function archive(edit = () => {}, options = {}) {
  const { members, ...fixture } = bakeFixture(options);
  members.set(SETTINGS, enc.encode(JSON.stringify(defaults)));
  edit(members);
  const bytes = new Uint8Array(await zipStore([...members].map(([name, data]) => ({ name, data }))).arrayBuffer());
  return { ...fixture, bytes };
}
function replace(members, name, before, after) {
  const source = dec.decode(members.get(name));
  assert(source.includes(before), 'fixture edit did not match');
  members.set(name, enc.encode(source.replace(before, after)));
}
async function fails(bytes, pattern, options = {}) {
  try { await bakeProjectObject(bytes, { identity, ...options }); }
  catch (e) { assert(pattern.test(e.message), e.stack); return; }
  throw new Error('invalid project returned a conversion');
}

Deno.test('bake input: saved settings, equal-color slots and standalone conversion agree without mutation', async () => {
  const { bytes, model, expected } = await archive(), original = bytes.slice();
  const result = await bakeProjectObject(bytes, { identity });
  const direct = await bakeProjectNegatives(model, expected, { filamentCount: 2 });
  assert(equal(bytes, original));
  assert(equal(result.analysisPositions, direct.analysisPositions));
  assert(JSON.stringify(result.parts) === JSON.stringify(direct.parts));
  assert(result.warnings.length === 1 && /may differ/.test(result.warnings[0]));
  assert(result.compatibility.negativeOccurrences === 1);
  const m = result.compatibility.materials[0];
  assert(m.filament === 2 && m.roles.wall_filament === 1 && m.roles.sparse_infill_filament === 2);
  assert(m.roles.solid_infill_filament === 2 && m.layerHeight === 0.2 && m.firstLayerHeight === 0.24);
  assert(!('model' in result) && !('members' in result), 'source meshes escaped the object context');
});

Deno.test('bake input: fingerprints bind source, saved settings, runtime and selection deterministically', async () => {
  const { bytes } = await archive();
  const a = await bakeProjectObject(bytes, { identity });
  const b = await bakeProjectObject(bytes, { identity });
  const c = await bakeProjectObject(bytes, { identity: async () => 'b'.repeat(64) });
  const { bytes: changed } = await archive((members) => {
    members.set(SETTINGS, enc.encode(JSON.stringify({ ...defaults, sparse_infill_filament: '1' })));
  });
  const d = await bakeProjectObject(changed, { identity });
  assert(a.fingerprint === b.fingerprint && a.fingerprint !== c.fingerprint && a.fingerprint !== d.fingerprint);
  assert(a.sourceSHA256 === c.sourceSHA256 && a.settingsSHA256 === c.settingsSHA256);
  assert(a.sourceSHA256 !== d.sourceSHA256 && a.settingsSHA256 !== d.settingsSHA256);
  await fails(bytes, /runtime identity/, { identity: async () => 'unidentified' });
  await fails(bytes, /build index/, { buildIndex: -1 });
  await fails(bytes, /build item/, { buildIndex: 1 });
});

Deno.test('bake input: an unselected broken dependency is not loaded or changed', async () => {
  const { bytes } = await archive((members) => {
    replace(members, ROOT, '</resources>', '<object id="999"><components><component objectid="998" p:path="/3D/missing.model"/></components></object></resources>');
    replace(members, ROOT, '</build>', '<item objectid="999"/></build>');
    replace(members, CONFIG, '</config>', '<object id="999"><part id="998" subtype="normal_part"/></object></config>');
  });
  const zip = new ProjectZip(bytes), before = await zip.text(ROOT);
  const result = await bakeProjectObject(bytes, { identity });
  assert(result.parts.length === 1 && await zip.text(ROOT) === before);
  await fails(bytes, /no negative parts/, { buildIndex: 1 });
});

for (const [name, edit, pattern] of [
  ['variable layers', (m) => m.set('Metadata/layer_heights_profile.txt', enc.encode('object_id=1|0;0.2;1;0.1')), /variable layer/],
  ['layer ranges', (m) => m.set('Metadata/layer_config_ranges.xml', enc.encode('<objects><object id="1"/></objects>')), /layer setting ranges/],
  ['modifier', (m) => replace(m, CONFIG, 'normal_part', 'modifier_part'), /modifiers/],
  ['shared build instance', (m) => replace(m, ROOT, '</build>', '<item objectid="100"/></build>'), /shared build/],
  ['duplicate object settings', (m) => replace(m, CONFIG, '</config>', '<object id="100"/></config>'), /ambiguous selected/],
  ['missing selected part settings', (m) => replace(m, CONFIG, '<part id="1"', '<part id="999"'), /part settings/],
  ['duplicate assignment', (m) => replace(m, CONFIG, 'key="wall_filament"', 'key="extruder"'), /duplicate/],
  ['absent filament slot', (m) => m.set(SETTINGS, enc.encode(JSON.stringify({ ...defaults, filament_colour: ['#FFFFFF'] }))), /filament assignment/],
  ['missing role', (m) => m.set(SETTINGS, enc.encode(JSON.stringify({ ...defaults, sparse_infill_filament: undefined }))), /filament assignment/],
  ['missing layer height', (m) => m.set(SETTINGS, enc.encode(JSON.stringify({ ...defaults, layer_height: undefined }))), /fixed layer setting/],
  ['unidentified inherited material', (m) => { replace(m, CONFIG, 'key="extruder" value="1"', 'key="extruder" value="0"'); replace(m, CONFIG, 'key="extruder" value="2"', 'key="extruder" value="0"'); m.set(SETTINGS, enc.encode(JSON.stringify({ ...defaults, extruder: '0' }))); }, /ambiguous inherited/],
]) {
  Deno.test(`bake input: rejects ${name} without publishing a partial result`, async () => {
    const { bytes } = await archive(edit);
    await fails(bytes, pattern);
  });
}

Deno.test('bake input: conflicting component layer settings fail before subtraction', async () => {
  const { bytes } = await archive((m) => replace(m, CONFIG,
    '<part id="2" subtype="normal_part">',
    '<part id="2" subtype="normal_part"><metadata key="layer_height" value="0.3"/>'), { second: true });
  await fails(bytes, /conflicting fixed layer/);
});

Deno.test('bake input: malformed cutter failure cannot poison a later object context', async () => {
  const { bytes } = await archive((m) => m.delete('3D/Objects/cut.model'));
  await fails(bytes, /missing project member/);
  const good = await archive();
  const result = await bakeProjectObject(good.bytes, { identity });
  assert(result.parts.length === 1 && result.removed.length === 0);
});
