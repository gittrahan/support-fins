import { deflateRawSync } from 'node:zlib';
import { run } from '../cli.js';
import { ProjectZip } from '../project-zip.js';
import { checkProjectOutput, writeProject } from '../project-io.js';
import { xmlTree, children, child, metadata, editXML, insert } from '../project-xml.js';
import { readThreeMF, readThreeMFParts, meshXML } from '../../../web/threemf.js';
import { zipStore } from '../../../web/zip.js';
import { computeFins, optionsFromDialog } from '../../shared/engine/fins_entry.js';
import { assert, assertClose, block } from '../../../tests/_util.js';

const ROOT = '3D/3dmodel.model', CONFIG = 'Metadata/model_settings.config';
const SETTINGS = 'Metadata/project_settings.config', SUPPORTS = '3D/SupportFins/supports.model';
const CORE = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const PROD = 'http://schemas.microsoft.com/3dmanufacturing/production/2015/06';
const RELS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const bytes = (s) => new TextEncoder().encode(s);
const triples = (flat) => Array.from({ length: flat.length / 3 }, (_, i) => Array.from(flat.slice(i * 3, i * 3 + 3)));
const equal = (a, b, label) => assert(a.length === b.length && a.every((v, i) => v === b[i]), label);

// Real compressed entries (also a Unicode name, opaque binary content and a ZIP
// comment), so a test cannot pass by rebuilding everything with zipStore.
async function compressed(files) {
  const zip = new ProjectZip(new Uint8Array(await zipStore(files).arrayBuffer()));
  const chunks = [], records = [];
  let offset = 0;
  for (const e of zip.entries.values()) {
    const header = zip.bytes.slice(e.offset, e.start), raw = deflateRawSync(await zip.read(e.name));
    const h = new DataView(header.buffer);
    h.setUint16(8, 8, true); h.setUint32(18, raw.length, true);
    const record = e.record.slice(), r = new DataView(record.buffer);
    r.setUint16(10, 8, true); r.setUint32(20, raw.length, true); r.setUint32(42, offset, true);
    chunks.push(header, raw); records.push(record); offset += header.length + raw.length;
  }
  const comment = bytes('test archive comment'), end = new Uint8Array(22 + comment.length), v = new DataView(end.buffer);
  v.setUint32(0, 0x06054b50, true); v.setUint16(8, records.length, true); v.setUint16(10, records.length, true);
  v.setUint32(12, records.reduce((n, r) => n + r.length, 0), true); v.setUint32(16, offset, true);
  v.setUint16(20, comment.length, true); end.set(comment, 22);
  return new Uint8Array(await new Blob([...chunks, ...records, end]).arrayBuffer());
}

async function fixture({ duplicate = false, negative = false, variable = false, layer = '0.16', printable = true, mirror = false } = {}) {
  const cube = triples(block(0, 20, 0, 20, 0, 20));
  const q = Math.SQRT1_2;
  const resource = (id, file) => `<object id="${id}" type="model" p:UUID="original-${id}"><components>`
    + `<component objectid="1" p:path="/3D/Objects/${file}.model" transform="1 0 0 0 1 0 0 0 1 0 0 0"/></components></object>`;
  const model = (paint) => `<model unit="millimeter" xmlns="${CORE}"><resources><object id="1" type="model">`
    + meshXML(cube, (i) => i % 3 ? ` paint_color="${paint}"` : '') + '</object></resources></model>';
  const obj = (id, slot) => `<object id="${id}"><metadata key="name" value="Part ${id}"/>`
    + `<metadata key="extruder" value="${slot}"/><metadata key="enable_support" value="1"/>`
    + `<part id="1" subtype="${negative && id === 10 ? 'negative_part' : 'normal_part'}">`
    + '<metadata key="name" value="painted body"/><metadata key="enable_support" value="1"/></part></object>';
  const plate = (n, id) => `<plate><metadata key="plater_id" value="${n}"/><metadata key="locked" value="true"/>`
    + `<metadata key="gcode_file" value="Metadata/plate_${n}.gcode"/>`
    + `<metadata key="thumbnail_file" value="Metadata/plate_${n}.png"/>`
    + `<model_instance><metadata key="object_id" value="${id}"/><metadata key="instance_id" value="${duplicate && n === 2 ? 1 : 0}"/>`
    + '<metadata key="identify_id" value="99"/></model_instance></plate>';
  const files = [
    { name: ROOT, data: `<model xmlns="${CORE}" xmlns:p="${PROD}" unit="millimeter" requiredextensions="p">`
      + '<metadata name="Application">BambuStudio-02.04.00.70</metadata><resources>'
      + resource(10, 'a') + resource(20, 'b') + '</resources><build>'
      + `<item objectid="10" printable="1" transform="${mirror ? -1 : 1} 0 0 0 ${q} ${q} 0 ${-q} ${q} 30 40 0"/>`
      + `<item objectid="${duplicate ? 10 : 20}" printable="${printable ? 1 : 0}" transform="1 0 0 0 ${q} ${q} 0 ${-q} ${q} 400 50 0"/>`
      + '</build></model>' },
    { name: CONFIG, data: `<config>${obj(10, 1)}${obj(20, 2)}${plate(1, 10)}${plate(2, duplicate ? 10 : 20)}<assemble/></config>` },
    { name: SETTINGS, data: JSON.stringify({ layer_height: layer, initial_layer_print_height: '0.3',
      filament_colour: ['#FFFFFF', '#123456'], filament_type: ['PETG', 'PETG'], enable_support: '1' }) },
    { name: '3D/Objects/a.model', data: model('4') },
    { name: '3D/Objects/b.model', data: model('8') },
    { name: '_rels/.rels', data: `<Relationships xmlns="${RELS}"><Relationship Id="root" Target="/${ROOT}" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>` },
    { name: '3D/_rels/3dmodel.model.rels', data: `<Relationships xmlns="${RELS}"><Relationship Id="a" Target="/3D/Objects/a.model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>` },
    { name: '[Content_Types].xml', data: '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/Metadata/plate_1.gcode" ContentType="text/x.gcode"/></Types>' },
    { name: 'Metadata/plate_1.gcode', data: 'obsolete toolpath 1' },
    { name: 'Metadata/plate_2.gcode', data: 'obsolete toolpath 2' },
    { name: 'Metadata/plate_1.png', data: new Uint8Array([1, 3, 5]) },
    { name: 'Metadata/plate_2.png', data: new Uint8Array([2, 4, 6]) },
    { name: 'Metadata/custom_gcode_per_layer.xml', data: '<custom_gcodes><code type="pause" print_z="5"/></custom_gcodes>' },
    { name: 'Metadata/slice_info.config', data: '<config/>' },
    { name: 'Auxiliaries/私有.bin', data: new Uint8Array([0, 255, 1, 128]) },
  ];
  if (variable) files.push({ name: 'Metadata/layer_heights_profile.txt', data: 'variable' });
  return compressed(files);
}

async function cli(source, flags = [], additional = {}) {
  const fs = new Map([['part.3mf', source], ...Object.entries(additional)]), out = [], err = [];
  const io = { read: async (p) => fs.get(p), write: async (p, b) => fs.set(p, b),
    out: (s) => out.push(s), err: (s) => err.push(s),
    checkProjectOutput: async (input, output, overwrite) => {
      if (input === output || fs.has(output) && !overwrite) throw new Error('unsafe output');
    },
    writeProject: async (_input, output, b) => { fs.set(output, b); } };
  const code = await run(['part.3mf', '--preserve-project', '--json', ...flags], io);
  return { code, fs, out, err, result: code === 0 ? JSON.parse(out[0]) : null };
}

Deno.test('project: preserve compressed painted meshes/settings, plates and source; add aligned supports', async () => {
  const source = await fixture(), before = source.slice(), r = await cli(source);
  assert(r.code === 0, r.err.join('\n'));
  equal(source, before, 'source bytes changed');
  const old = new ProjectZip(source), output = r.fs.get('part-fins-project.3mf'), zip = new ProjectZip(output);
  for (const name of ['3D/Objects/a.model', '3D/Objects/b.model', SETTINGS,
    'Metadata/custom_gcode_per_layer.xml', 'Auxiliaries/私有.bin']) {
    const a = old.entries.get(name), b = zip.entries.get(name);
    equal(zip.bytes.slice(b.offset, b.end), old.bytes.slice(a.offset, a.end), `compressed entry changed: ${name}`);
  }
  equal(zip.comment, old.comment, 'archive comment');
  const root = xmlTree(await zip.text(ROOT)), originalRoot = xmlTree(await old.text(ROOT));
  assert(JSON.stringify(child(root, 'build').children.map((n) => n.attrs))
    === JSON.stringify(child(originalRoot, 'build').children.map((n) => n.attrs)), 'build items moved');
  const cfg = xmlTree(await zip.text(CONFIG)), originalCfg = xmlTree(await old.text(CONFIG));
  const membership = (c) => children(c, 'plate').map((p) => [metadata(p).plater_id,
    metadata(p).locked, children(p, 'model_instance').map(metadata)]);
  assert(JSON.stringify(membership(cfg)) === JSON.stringify(membership(originalCfg)), 'plate membership changed');
  assert(r.result.objects.map((o) => o.filament).join() === '1,2', 'base filament not inherited');
  assert(r.result.objects.every((o) => o.layerHeight === 0.16 && o.triangles > 0), 'regular height or fins missing');
  assert(r.err.some((s) => s.includes('native slicer supports remain enabled')), 'no native support warning');
  assert(children(cfg, 'object').every((o) => metadata(o).enable_support === '1'), 'native supports changed');
  assert(!zip.entries.has('Metadata/plate_1.gcode') && !zip.entries.has('Metadata/slice_info.config')
    && !zip.entries.has('Metadata/plate_1.png'), 'stale slice artifacts retained');
  assert(!(await zip.text('[Content_Types].xml')).includes('/Metadata/plate_1.gcode'), 'dangling content-type override');
  const objects = (await readThreeMF(output)).objects;
  const members = new Map(await Promise.all([...old.entries.keys()].map(async (n) => [n, await old.read(n)])));
  for (let i = 0; i < 2; i++) {
    const original = readThreeMFParts(members, { buildIndex: i, doublePrecision: true }).objects[0];
    const direct = computeFins(original.positions, optionsFromDialog({ layerHeight: 0.16 }));
    const fin = objects[i].positions.slice(original.positions.length);
    assert(fin.length === direct.triangles.length, 'support triangle count differs');
    const offset = [direct.offset.x, direct.offset.y, direct.offset.z];
    for (let j = 0; j < fin.length; j++) assertClose(fin[j], direct.triangles[j] - offset[j % 3], 4e-5, `object ${i} support coordinate ${j}`);
    assert(objects[i].colors.paint.filter(Boolean).length === original.colors.paint.filter(Boolean).length, 'paint lost or copied onto fins');
  }
});

Deno.test('project: selection retains unselected objects; override only selected native supports and filament', async () => {
  const source = await fixture(), r = await cli(source, ['--object', '2', '--fin-extruder', '1', '--disable-native-supports']);
  assert(r.code === 0, r.err.join('\n'));
  assert(r.result.objects.length === 1 && r.result.objects[0].number === 2 && r.result.objects[0].filament === 1, 'selection/slot');
  const cfg = xmlTree(await new ProjectZip(r.fs.get(r.result.output)).text(CONFIG));
  const [a, b] = children(cfg, 'object');
  assert(children(a, 'part').length === 1 && children(b, 'part').length === 2, 'wrong object got fins');
  assert(metadata(a).enable_support === '1' && metadata(b).enable_support === '0', 'wrong native support override');
  assert(metadata(child(b, 'part')).enable_support === '0', 'part-level native support stayed enabled');
  assert(!r.err.some((s) => s.includes('remain enabled')), 'misleading support warning');
});

Deno.test('project: list build ordinals/resource IDs without generating; skip nonprintable objects', async () => {
  const source = await fixture({ printable: false }), listing = await cli(source, ['--list-objects']);
  assert(listing.code === 0 && listing.fs.size === 1 && listing.result.output === null, 'listing wrote a file');
  assert(listing.result.objects[1].number === 2 && listing.result.objects[1].id === '20'
    && !listing.result.objects[1].printable, 'listing identity');
  const r = await cli(source);
  assert(r.code === 0 && r.result.objects.length === 1, r.err.join('\n'));
  const bad = await cli(source, ['--object', '2']);
  assert(bad.code === 1 && bad.fs.size === 1, 'nonprintable selection succeeded');
});

Deno.test('project: repeated object selectors select several without duplicates', async () => {
  const r = await cli(await fixture(), ['--object', 'Part 20', '--object', '1', '--object', '1']);
  assert(r.code === 0 && r.result.objects.map((o) => o.number).join() === '1,2', r.err.join('\n'));
});

for (const [label, options, flags, message] of [
  ['shared instances', { duplicate: true }, [], 'shared build instances'],
  ['negative parts', { negative: true }, [], 'negative parts'],
  ['variable height', { variable: true }, [], 'variable layer'],
  ['missing height', { layer: '' }, [], 'regular layer'],
  ['absent filament', {}, ['--fin-extruder', '3'], 'filament slot'],
]) {
  Deno.test(`project: ${label} refuses without writing partial output`, async () => {
    const r = await cli(await fixture(options), flags);
    assert(r.code === 1 && r.fs.size === 1 && r.err.some((s) => s.includes(message)), r.err.join('\n'));
  });
}

Deno.test('project: explicit regular height overrides variable-height inference; no first-layer substitution', async () => {
  const r = await cli(await fixture({ variable: true, layer: '' }), ['--layer-height', '0.24']);
  assert(r.code === 0 && r.result.objects.every((o) => o.layerHeight === 0.24), r.err.join('\n'));
});

for (const [label, member, replace, message] of [
  ['different mesh units', '3D/Objects/a.model', (s) => s.replace('millimeter', 'inch'), 'millimeter units'],
  ['nonfinite vertex', '3D/Objects/a.model', (s) => s.replace(/x="[^"]*"/, 'x="Infinity"'), 'invalid mesh vertex'],
  ['empty triangle index', '3D/Objects/a.model', (s) => s.replace(/v1="[^"]*"/, 'v1=""'), 'invalid triangle references'],
  ['missing mesh object', ROOT, (s) => s.replace('objectid="1"', 'objectid="999"'), 'missing resources'],
  ['invalid component transform', ROOT, (s) => s.replace('transform="1 0 0 0 1 0 0 0 1 0 0 0"', 'transform="1 2"'), 'invalid component/build transform'],
  ['singular component transform', ROOT, (s) => s.replace('transform="1 0 0 0 1 0 0 0 1 0 0 0"', 'transform="0 0 0 0 0 0 0 0 0 0 0 0"'), 'invalid component/build transform'],
  ['duplicate mesh ID', '3D/Objects/a.model', (s) => s.replace('</resources>', '<object id="1"/></resources>'), 'duplicate or invalid mesh object ID'],
  ['cyclic components', '3D/Objects/a.model', (s) => s.replace('</object>', '<components><component objectid="1"/></components></object>'), 'cyclic components'],
]) {
  Deno.test(`project: ${label} refuses without writing partial output`, async () => {
    const zip = new ProjectZip(await fixture());
    const source = new Uint8Array(await (await zip.patch(new Map([[member, replace(await zip.text(member))]]))).arrayBuffer());
    const r = await cli(source, ['--object', '1']);
    assert(r.code === 1 && r.fs.size === 1 && r.err.some((s) => s.includes(message)), r.err.join('\n'));
  });
}

Deno.test('project: mirrored build keeps its pose and outward supports', async () => {
  const r = await cli(await fixture({ mirror: true }), ['--object', '1']);
  assert(r.code === 0 && r.result.objects[0].triangles > 0, r.err.join('\n'));
  const zip = new ProjectZip(r.fs.get(r.result.output));
  const members = new Map(await Promise.all([...zip.entries.keys()].map(async (n) => [n, await zip.read(n)])));
  const object = readThreeMFParts(members, { buildIndex: 0, doublePrecision: true }).objects[0];
  const fins = object.positions.slice(12 * 9);
  let volume = 0;
  for (let i = 0; i < fins.length; i += 9) {
    volume += fins[i] * (fins[i + 4] * fins[i + 8] - fins[i + 5] * fins[i + 7])
      - fins[i + 1] * (fins[i + 3] * fins[i + 8] - fins[i + 5] * fins[i + 6])
      + fins[i + 2] * (fins[i + 3] * fins[i + 7] - fins[i + 4] * fins[i + 6]);
  }
  assert(volume > 0, 'mirrored supports wound inward');
});

Deno.test('project: generated project cannot be finned twice', async () => {
  const first = await cli(await fixture()), second = await cli(first.fs.get(first.result.output));
  assert(second.code === 1 && second.fs.size === 1 && second.err.some((s) => s.includes('already has generated fins')), 'duplicate fins accepted');
});

Deno.test('project: overwrite never replaces another source in a batch', async () => {
  const source = await fixture();
  const r = await cli(source, ['part-fins-project.3mf', '--overwrite'], { 'part-fins-project.3mf': source });
  assert(r.code === 1 && r.err.some((s) => s.includes('unsafe output')), 'source collision accepted');
  equal(r.fs.get('part.3mf'), source, 'first source changed');
  equal(r.fs.get('part-fins-project.3mf'), source, 'second source changed');
});

Deno.test('project: mode rejects conflicting flags before reading inputs', async () => {
  for (const flags of [['--rot', '0,45,0'], ['--fins-only'], ['--fin-extruder', '0']]) {
    const r = await cli(new Uint8Array(), flags);
    assert(r.code === 2 && r.fs.size === 1, `accepted ${flags}`);
  }
});

Deno.test('project ZIP: corruption rejected and replacement/deletion retains opaque members', async () => {
  const source = await fixture(), zip = new ProjectZip(source);
  const replaced = new ProjectZip(new Uint8Array(await (await zip.patch(new Map([
    [SETTINGS, 'replacement'], ['Metadata/plate_1.gcode', null], ['new.txt', 'new'],
  ]))).arrayBuffer()));
  assert(await replaced.text(SETTINGS) === 'replacement' && await replaced.text('new.txt') === 'new', 'patch');
  assert(!replaced.entries.has('Metadata/plate_1.gcode'), 'delete');
  const corrupt = source.slice(), e = zip.entries.get(SETTINGS);
  corrupt[e.start] ^= 255;
  let threw = false;
  try { await new ProjectZip(corrupt).read(SETTINGS); } catch { threw = true; }
  assert(threw, 'corrupt data accepted');
});

Deno.test('project XML: escaped names and self-closing nodes survive insertion', () => {
  const text = '<root><item name="a &amp; b &quot;&gt;&quot;"/></root>', root = xmlTree(text);
  assert(child(root, 'item').attrs.name === 'a & b ">"', 'attribute decode');
  assert(editXML(text, [insert(child(root, 'item'), '<child/>')])
    === '<root><item name="a &amp; b &quot;&gt;&quot;"><child/></item></root>', 'self-closing insertion');
});

Deno.test('project IO: aliases/symlinks/hard links cannot overwrite source; complete atomic output only', async () => {
  const dir = await Deno.makeTempDir();
  try {
    const source = `${dir}/source.3mf`, output = `${dir}/out.3mf`;
    await Deno.writeTextFile(source, 'original');
    await Deno.symlink(source, `${dir}/symlink.3mf`);
    await Deno.link(source, `${dir}/hardlink.3mf`);
    for (const target of [source, `${dir}/../${dir.split('/').pop()}/source.3mf`, `${dir}/symlink.3mf`, `${dir}/hardlink.3mf`]) {
      let threw = false;
      try { await writeProject(source, target, bytes('bad'), true); } catch { threw = true; }
      assert(threw, `accepted ${target}`);
    }
    await writeProject(source, output, bytes('complete'));
    assert(await Deno.readTextFile(output) === 'complete', 'new output');
    let refused = false;
    try { await checkProjectOutput(source, output); } catch { refused = true; }
    assert(refused, 'existing output not protected');
    await writeProject(source, output, bytes('replacement'), true);
    assert(await Deno.readTextFile(output) === 'replacement' && await Deno.readTextFile(source) === 'original', 'overwrite');
    const names = [];
    for await (const entry of Deno.readDir(dir)) names.push(entry.name);
    assert(!names.some((n) => n.startsWith('.support-fins')), 'temporary file leaked');
  } finally { await Deno.remove(dir, { recursive: true }); }
});
