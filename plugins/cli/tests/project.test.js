import { deflateRawSync } from 'node:zlib';
import { run } from '../cli.js';
import { ProjectZip } from '../project-zip.js';
import { checkProjectOutput, writeProject } from '../project-io.js';
import { openProjectCache } from '../project-cache.js';
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

async function fixture({ duplicate = false, negative = false, variable = null, layer = '0.16', printable = true, mirror = false,
  app = 'BambuStudio-02.04.00.70', sequence = 'by layer', plateSequence = null,
  plateIDs = [1, 2], emptyPlates = [], together = false, sameName = false, steep = false } = {}) {
  const cube = triples(block(0, 20, 0, 20, 0, 20));
  const q = steep ? 0.5 : Math.SQRT1_2, s = steep ? Math.sqrt(3) / 2 : q;
  const resource = (id, file) => `<object id="${id}" type="model" p:UUID="original-${id}"><components>`
    + `<component objectid="1" p:path="/3D/Objects/${file}.model" transform="1 0 0 0 1 0 0 0 1 0 0 0"/></components></object>`;
  const model = (paint) => `<model unit="millimeter" xmlns="${CORE}"><resources><object id="1" type="model">`
    + meshXML(cube, (i) => i % 3 ? ` paint_color="${paint}"` : '') + '</object></resources></model>';
  const obj = (id, slot) => `<object id="${id}"><metadata key="name" value="Part ${sameName ? 10 : id}"/>`
    + `<metadata key="extruder" value="${slot}"/><metadata key="enable_support" value="1"/>`
    + `<part id="1" subtype="${negative && id === 10 ? 'negative_part' : 'normal_part'}">`
    + '<metadata key="name" value="painted body"/><metadata key="enable_support" value="1"/></part></object>';
  const instance = (id, n) => `<model_instance><metadata key="object_id" value="${id}"/><metadata key="instance_id" value="${duplicate && n === 2 ? 1 : 0}"/>`
    + '<metadata key="identify_id" value="99"/></model_instance>';
  const plate = (n, instances) => `<plate><metadata key="plater_id" value="${plateIDs[n - 1]}"/><metadata key="locked" value="true"/>`
    + (plateSequence && n === 1 ? `<metadata key="print_sequence" value="${plateSequence}"/>` : '')
    + `<metadata key="gcode_file" value="Metadata/plate_${n}.gcode"/>`
    + `<metadata key="thumbnail_file" value="Metadata/plate_${n}.png"/>`
    + instances + '</plate>';
  const second = instance(duplicate ? 10 : 20, 2);
  const files = [
    { name: ROOT, data: `<model xmlns="${CORE}" xmlns:p="${PROD}" unit="millimeter" requiredextensions="p">`
      + `<metadata name="Application">${app}</metadata><resources>`
      + resource(10, 'a') + resource(20, 'b') + '</resources><build>'
      + `<item objectid="10" printable="1" transform="${mirror ? -1 : 1} 0 0 0 ${q} ${s} 0 ${-s} ${q} 30 40 0"/>`
      + `<item objectid="${duplicate ? 10 : 20}" printable="${printable ? 1 : 0}" transform="1 0 0 0 ${q} ${s} 0 ${-s} ${q} 400 50 0"/>`
      + '</build></model>' },
    { name: CONFIG, data: `<config>${obj(10, 1)}${obj(20, 2)}`
      + plate(1, instance(10, 1) + (together ? second : '')) + plate(2, together ? '' : second)
      + emptyPlates.map((id) => `<plate><metadata key="plater_id" value="${id}"/></plate>`).join('') + '<assemble/></config>' },
    { name: SETTINGS, data: JSON.stringify({ layer_height: layer, initial_layer_print_height: '0.3',
      filament_colour: ['#FFFFFF', '#123456'], filament_type: ['PETG', 'PETG'], enable_support: '1', print_sequence: sequence }) },
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
  // variable: the object_id a profile line names, by object order (1 = the first object)
  if (variable) files.push({ name: 'Metadata/layer_heights_profile.txt', data: `object_id=${variable}|0;0.2;5;0.1;20;0.1;\n` });
  return compressed(files);
}

async function cli(source, flags = [], additional = {}, overrides = {}) {
  const fs = new Map([['part.3mf', source], ...Object.entries(additional)]), out = [], err = [];
  const io = { read: async (p) => fs.get(p), write: async (p, b) => fs.set(p, b),
    out: (s) => out.push(s), err: (s) => err.push(s),
    checkProjectOutput: async (input, output, overwrite) => {
      if (input === output || fs.has(output) && !overwrite) throw new Error('unsafe output');
    },
    writeProject: async (_input, output, b) => { fs.set(output, b); } };
  const code = await run(['part.3mf', '--preserve-project', '--json', ...flags], { ...io, ...overrides });
  return { code, fs, out, err, result: out.length ? JSON.parse(out[0]) : null };
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
  const items = child(root, 'build').children, originalItems = child(originalRoot, 'build').children;
  assert(JSON.stringify(items.slice(0, 2).map((n) => n.attrs)) === JSON.stringify(originalItems.map((n) => n.attrs)), 'build items moved');
  // The fins are their own objects, appended after the originals with the same pose.
  const ids = r.result.objects.map((o) => o.supportObject);
  assert(items.length === 4 && items.slice(2).every((n, i) => n.attrs.objectid === ids[i]
    && n.attrs.transform === originalItems[i].attrs.transform), 'supports not their own objects in register');
  const cfg = xmlTree(await zip.text(CONFIG)), originalCfg = xmlTree(await old.text(CONFIG));
  const membership = (c) => children(c, 'plate').map((p) => [metadata(p).plater_id,
    metadata(p).locked, children(p, 'model_instance').map(metadata)]);
  const plates = membership(cfg), originalPlates = membership(originalCfg);
  plates.forEach(([id, locked, instances], i) => {
    assert(JSON.stringify([id, locked, instances.slice(0, -1)]) === JSON.stringify(originalPlates[i]), 'plate membership changed');
    assert(instances.at(-1).object_id === ids[i] && instances.at(-1).identify_id !== '99', 'supports not on their part\'s plate');
  });
  const supportCfg = children(cfg, 'object').filter((o) => ids.includes(o.attrs.id));
  assert(supportCfg.length === 2 && supportCfg.every((o) => metadata(o).enable_support === '0'), 'supports object supported by the slicer');
  assert(r.result.objects.map((o) => o.filament).join() === '1,2', 'base filament not inherited');
  assert(r.result.objects.every((o) => o.layerHeight === 0.16 && o.triangles > 0), 'regular height or fins missing');
  assert(r.err.some((s) => s.includes('native slicer supports remain enabled')), 'no native support warning');
  assert(children(cfg, 'object').filter((o) => !ids.includes(o.attrs.id)).every((o) => metadata(o).enable_support === '1'), 'native supports changed');
  assert(!zip.entries.has('Metadata/plate_1.gcode') && !zip.entries.has('Metadata/slice_info.config')
    && !zip.entries.has('Metadata/plate_1.png'), 'stale slice artifacts retained');
  assert(!(await zip.text('[Content_Types].xml')).includes('/Metadata/plate_1.gcode'), 'dangling content-type override');
  const objects = (await readThreeMF(output)).objects;
  const members = new Map(await Promise.all([...old.entries.keys()].map(async (n) => [n, await old.read(n)])));
  for (let i = 0; i < 2; i++) {
    const original = readThreeMFParts(members, { buildIndex: i, doublePrecision: true, outwardWinding: true }).objects[0];
    const direct = computeFins(original.positions, optionsFromDialog({ layerHeight: 0.16 }));
    assert(objects[i].positions.length === original.positions.length, 'fins inside the part object');
    const fin = objects[i + 2].positions;
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
  const [a, b, fins] = children(cfg, 'object');
  assert(children(a, 'part').length === 1 && children(b, 'part').length === 1, 'fins inside a part object');
  assert(fins.attrs.id === r.result.objects[0].supportObject && metadata(fins).extruder === '1', 'wrong object got fins');
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

Deno.test('project: plate summaries include nonprintable and empty plates without reading meshes or writing', async () => {
  const zip = new ProjectZip(await fixture({ plateIDs: [2, 5], printable: false, emptyPlates: [9], layer: '' }));
  const source = new Uint8Array(await (await zip.patch(new Map([['3D/Objects/a.model', 'invalid mesh XML']]))).arrayBuffer());
  const summaries = [{ id: '2', objects: 1, printableObjects: 1 },
    { id: '5', objects: 1, printableObjects: 0 }, { id: '9', objects: 0, printableObjects: 0 }];
  for (const flag of ['--list-objects', '--list-plates']) {
    const r = await cli(source, [flag], {}, { checkProjectOutput: undefined, writeProject: undefined });
    assert(r.code === 0 && r.fs.size === 1 && r.result.output === null, r.err.join('\n'));
    assert(JSON.stringify(r.result.plates) === JSON.stringify(summaries), 'plate counts or IDs');
    assert(r.result.report.startsWith('Plate 2: 1 objects, 1 printable\nPlate 5: 1 objects, 0 printable\nPlate 9: 0 objects, 0 printable'), 'human summary');
    if (flag === '--list-objects') {
      assert(r.result.objects[1].number === 2 && r.result.objects[1].plate === '5' && !r.result.objects[1].printable, 'existing object identity');
      assert(r.result.report.includes('\n2: Part 20 (resource 20, plate 5, not printable)'), 'object list missing');
    } else assert(!('objects' in r.result), 'plate listing includes individual objects');
  }
  const out = [], err = [];
  const code = await run(['part.3mf', '--preserve-project', '--list-plates'], {
    read: async () => source, out: (s) => out.push(s), err: (s) => err.push(s),
  });
  assert(code === 0 && out[0].includes('Plate 9: 0 objects, 0 printable') && !err.length, 'text listing needs a writer');
});

Deno.test('project: both listings filter plates, deduplicate IDs and retain global object numbers', async () => {
  const source = await fixture({ plateIDs: [2, 5], emptyPlates: [9] });
  for (const flag of ['--list-objects', '--list-plates']) {
    const r = await cli(source, [flag, '--plate=9', '--plate', '5', '--plate', '5']);
    assert(r.code === 0 && r.fs.size === 1, r.err.join('\n'));
    assert(r.result.plates.map((p) => p.id).join() === '5,9', 'listing order/filter');
    if (flag === '--list-objects') assert(r.result.objects.length === 1 && r.result.objects[0].number === 2, 'renumbered object');
    const empty = await cli(source, [flag, '--plate', '9']);
    assert(empty.code === 0 && empty.result.plates[0].objects === 0 && !empty.result.objects?.length, 'empty plate listing refused');
  }
});

Deno.test('project: plate selection preserves unselected meshes, poses, membership and native supports', async () => {
  const source = await fixture({ plateIDs: [2, 5] }), before = source.slice();
  const r = await cli(source, ['--plate', '5', '--disable-native-supports']);
  assert(r.code === 0 && r.result.objects.length === 1 && r.result.objects[0].number === 2
    && r.result.objects[0].plate === '5' && r.result.objects[0].triangles > 0, r.err.join('\n'));
  equal(source, before, 'input changed');
  const old = new ProjectZip(source), zip = new ProjectZip(r.fs.get(r.result.output));
  for (const name of ['3D/Objects/a.model', '3D/Objects/b.model', SETTINGS, 'Auxiliaries/私有.bin']) {
    const a = old.entries.get(name), b = zip.entries.get(name);
    equal(zip.bytes.slice(b.offset, b.end), old.bytes.slice(a.offset, a.end), `changed compressed ${name}`);
  }
  const originalRoot = xmlTree(await old.text(ROOT)), root = xmlTree(await zip.text(ROOT));
  const originalItems = children(child(originalRoot, 'build'), 'item'), items = children(child(root, 'build'), 'item');
  assert(items.length === 3 && JSON.stringify(items.slice(0, 2).map((o) => o.attrs))
    === JSON.stringify(originalItems.map((o) => o.attrs)), 'original poses/build changed');
  assert(items[2].attrs.transform === originalItems[1].attrs.transform, 'supports on wrong pose');
  const config = xmlTree(await zip.text(CONFIG)), originalConfig = xmlTree(await old.text(CONFIG));
  assert(metadata(children(config, 'object')[0]).enable_support === '1'
    && metadata(children(config, 'object')[1]).enable_support === '0', 'unselected settings changed');
  const plates = children(config, 'plate'), originalPlates = children(originalConfig, 'plate');
  assert(JSON.stringify(children(plates[0], 'model_instance').map(metadata))
    === JSON.stringify(children(originalPlates[0], 'model_instance').map(metadata)), 'unselected plate membership changed');
  assert(children(plates[1], 'model_instance').length === 2
    && metadata(children(plates[1], 'model_instance')[1]).object_id === r.result.objects[0].supportObject, 'supports on wrong plate');
});

Deno.test('project: repeatable plate IDs process each object once in original build order', async () => {
  const r = await cli(await fixture({ plateIDs: [2, 5] }), ['--plate', '5', '--plate=2', '--plate', '5']);
  assert(r.code === 0 && r.result.objects.map((o) => o.number).join() === '1,2', r.err.join('\n'));
});

Deno.test('project: plate-scoped object numbers and names do not select outside the plates', async () => {
  const source = await fixture({ plateIDs: [2, 5], sameName: true });
  for (const selector of ['2', 'Part 10']) {
    const r = await cli(source, ['--plate', '5', '--object', selector]);
    assert(r.code === 0 && r.result.objects.map((o) => o.number).join() === '2', r.err.join('\n'));
  }
  for (const flags of [['--plate', '5', '--object', '1'],
    ['--plate', '2', '--plate', '5', '--object', 'Part 10']]) {
    const r = await cli(source, flags);
    assert(r.code === 1 && r.fs.size === 1 && r.err.some((s) => /missing|ambiguous/.test(s)), 'invalid object selection wrote output');
  }
  const nonprintable = await cli(await fixture({ printable: false, together: true }), ['--plate', '1', '--object', '2']);
  assert(nonprintable.code === 1 && nonprintable.fs.size === 1 && nonprintable.err.some((s) => s.includes('not printable')), 'nonprintable object selected');
});

Deno.test('project: missing or empty requested plates fail before generation even alongside a valid plate', async () => {
  const source = await fixture({ plateIDs: [2, 5], printable: false, emptyPlates: [9] });
  const sentinel = bytes('existing output');
  for (const [id, message] of [['1', 'is missing'], ['5', 'has no printable objects'], ['9', 'has no printable objects']]) {
    const r = await cli(source, ['--plate', '2', '--plate', id, '--object', '1', '--overwrite'],
      { 'part-fins-project.3mf': sentinel });
    assert(r.code === 1 && r.fs.size === 2 && r.err.length === 1, 'selection error reached generation');
    assert(JSON.parse(r.err[0]).error.includes(`plate "${id}" ${message}`), r.err.join('\n'));
    equal(r.fs.get('part-fins-project.3mf'), sentinel, 'replaced output on selection error');
  }
  for (const flag of ['--list-objects', '--list-plates']) {
    const r = await cli(source, [flag, '--plate', '1']);
    assert(r.code === 1 && r.fs.size === 1 && r.err.some((s) => s.includes('missing')), 'listing accepted ordinal as plate ID');
  }
});

Deno.test('project: plate-only selection skips unsupported objects but explicit objects must all succeed', async () => {
  const source = await fixture({ together: true, negative: true });
  const r = await cli(source, ['--plate', '1']);
  assert(r.code === 0 && r.result.objects.map((o) => o.number).join() === '2'
    && r.err.some((s) => s.includes('skipped object 1')), r.err.join('\n'));
  const strict = await cli(source, ['--plate', '1', '--object', '1', '--object', '2']);
  assert(strict.code === 1 && strict.fs.size === 1 && strict.err.some((s) => s.includes('negative parts')), 'explicit unsupported object was skipped');
  const none = await cli(await fixture({ negative: true }), ['--plate', '1']);
  assert(none.code === 1 && none.fs.size === 1 && none.err.some((s) => s.includes('none of the selected objects')), 'all-unsupported plate wrote output');
});

Deno.test('project: filtering does not load the mesh on an unselected plate', async () => {
  const zip = new ProjectZip(await fixture());
  const source = new Uint8Array(await (await zip.patch(new Map([['3D/Objects/a.model', null]]))).arrayBuffer());
  const r = await cli(source, ['--plate', '2']);
  assert(r.code === 0 && r.result.objects.map((o) => o.number).join() === '2', r.err.join('\n'));
});

Deno.test('project: absent plate IDs use the same fallback in listing and selection', async () => {
  const zip = new ProjectZip(await fixture());
  const config = (await zip.text(CONFIG)).replace(/<metadata key="plater_id" value="\d+"\/>/g, '');
  const source = new Uint8Array(await (await zip.patch(new Map([[CONFIG, config]]))).arrayBuffer());
  const listing = await cli(source, ['--list-plates']);
  assert(listing.code === 0 && listing.result.plates.map((p) => p.id).join() === '1,2', 'fallback IDs');
  const r = await cli(source, ['--plate', '2']);
  assert(r.code === 0 && r.result.objects.map((o) => o.number).join() === '2', r.err.join('\n'));
});

Deno.test('project: duplicate or empty plate IDs cannot select an ambiguous plate', async () => {
  for (const plateIDs of [[2, 2], ['', 5]]) {
    const r = await cli(await fixture({ plateIDs }), ['--list-plates']);
    assert(r.code === 1 && r.fs.size === 1 && r.err.some((s) => s.includes('empty or duplicate plate ID')), 'ambiguous plate IDs accepted');
    const picked = await cli(await fixture({ plateIDs }), ['--plate', '5']);
    assert(picked.code === 1 && picked.fs.size === 1, 'a plate picked from ambiguous IDs');
    // no plate named: generation runs as it did before --plate existed
    const all = await cli(await fixture({ plateIDs }));
    assert(all.code === 0 && all.result.objects.length === (plateIDs[0] ? 2 : 1), all.err.join('\n'));
  }
});

for (const [label, options, flags, message] of [
  ['shared instances', { duplicate: true }, [], 'shared build instances'],
  ['negative parts', { negative: true }, ['--object', '1'], 'negative parts'],
  ['variable height', { variable: 1 }, ['--object', '1'], 'variable layer'],
  ['missing height', { layer: '' }, [], 'regular layer'],
  ['absent filament', {}, ['--fin-extruder', '3'], 'filament slot'],
]) {
  Deno.test(`project: ${label} refuses without writing partial output`, async () => {
    const r = await cli(await fixture(options), flags);
    assert(r.code === 1 && r.fs.size === 1 && r.err.some((s) => s.includes(message)), r.err.join('\n'));
  });
}

Deno.test('project: explicit regular height overrides variable-height inference; no first-layer substitution', async () => {
  const r = await cli(await fixture({ variable: 1, layer: '' }), ['--layer-height', '0.24']);
  assert(r.code === 0 && r.result.objects.every((o) => o.layerHeight === 0.24), r.err.join('\n'));
});

for (const [label, options] of [['negative part', { negative: true }], ['variable height', { variable: 1 }]]) {
  Deno.test(`project: every-object default skips a ${label} with a warning and fins the rest`, async () => {
    const r = await cli(await fixture(options));
    assert(r.code === 0 && r.result.objects.map((o) => o.number).join() === '2', r.err.join('\n'));
    assert(r.err.some((s) => s.includes('skipped object 1')), 'skip not reported');
  });
}

Deno.test('project: the variable profile marks only its own object', async () => {
  const r = await cli(await fixture({ variable: 2 }));
  assert(r.code === 0 && r.result.objects.map((o) => o.number).join() === '1', r.err.join('\n'));
});

Deno.test('project: a profile number is object order, never a resource ID', async () => {
  // Resource 2 doesn't exist here; 20 would be object 2's ID. Neither is an object's order.
  const r = await cli(await fixture({ variable: 20 }));
  assert(r.code === 0 && r.result.objects.map((o) => o.number).join() === '1,2', r.err.join('\n'));
});

Deno.test('project: a plate set to print by object keeps only its fins a part of the model', async () => {
  const r = await cli(await fixture({ plateSequence: 'by object' }));
  assert(r.code === 0, r.err.join('\n'));
  assert(r.result.objects[0].supportObject === null && r.result.objects[1].supportObject !== null, 'plate override ignored');
  assert(r.err.some((s) => s.includes('object 1 (Part 10) prints by object')), 'no by-object warning');
});

Deno.test('project: OrcaSlicer and QIDI Studio projects in the same layout are accepted', async () => {
  for (const app of ['OrcaSlicer-02.03.01', 'QIDIStudio-02.03.01.51']) {
    const r = await cli(await fixture({ app }), ['--object', '1']);
    assert(r.code === 0 && r.result.objects[0].triangles > 0, `${app}: ${r.err.join('\n')}`);
  }
});

Deno.test('project: a project without the Bambu-style settings is refused by layout', async () => {
  const zip = new ProjectZip(await fixture());
  const source = new Uint8Array(await (await zip.patch(new Map([[CONFIG, null]]))).arrayBuffer());
  const r = await cli(source);
  assert(r.code === 1 && r.err.some((s) => s.includes('Bambu Studio-style project')), r.err.join('\n'));
});

Deno.test('project: by-object printing keeps the fins a part of their model, with a warning', async () => {
  const r = await cli(await fixture({ sequence: 'by object' }), ['--object', '1']);
  assert(r.code === 0 && r.result.objects[0].supportObject === null, r.err.join('\n'));
  assert(r.err.some((s) => s.includes('prints by object')), 'no by-object warning');
  const cfg = xmlTree(await new ProjectZip(r.fs.get(r.result.output)).text(CONFIG));
  assert(children(cfg, 'object').length === 2 && children(children(cfg, 'object')[0], 'part').length === 2, 'fins not a part');
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
  const fins = readThreeMFParts(members, { buildIndex: 2, doublePrecision: true, outwardWinding: true }).objects[0].positions;
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

Deno.test('project check: read-only settings/mesh checks, even when output already exists', async () => {
  const source = await fixture(), before = source.slice();
  const forbidden = () => { throw new Error('check touched output'); };
  const r = await cli(source, ['--check'], { 'part-fins-project.3mf': bytes('keep') },
    { write: forbidden, checkProjectOutput: forbidden, writeProject: forbidden });
  assert(r.code === 0 && r.fs.size === 2, r.err.join('\n'));
  equal(source, before, 'check changed source');
  assert(new TextDecoder().decode(r.fs.get('part-fins-project.3mf')) === 'keep', 'existing output changed');
  assert(r.result.mode === 'check' && r.result.output === null && !r.result.outputWritten, 'check claims output');
  assert(r.result.objects.length === 0 && r.result.summary.compatible === 2, 'check claims generated objects');
  assert(r.result.objectResults.map((o) => o.plate).join() === '1,2', 'lost plate identities');
  assert(r.result.objectResults.every((o) => o.status === 'compatible' && o.layerHeight === 0.16), 'settings not resolved');
});

Deno.test('project check: all selected objects inspected, including explicit incompatible selections', async () => {
  const source = await fixture({ negative: true });
  for (const flags of [[], ['--object', '1', '--object', '2']]) {
    const r = await cli(source, ['--check', ...flags]);
    assert(r.code === 1 && r.out.length === 1 && !r.err.length && r.fs.size === 1, 'check stream/exit/write');
    const [bad, good] = r.result.objectResults;
    assert(bad.status === 'incompatible' && bad.reason.includes('negative parts'), 'missing blocking reason');
    assert(good.status === 'compatible' && r.result.summary.selected === 2, 'check stopped at first problem');
  }
  const selected = await cli(source, ['--check', '--object', '2', '--object', 'Part 20']);
  assert(selected.code === 0 && selected.result.summary.selected === 1, 'selection not respected/deduplicated');
});

Deno.test('project check: all-incompatible results are still a complete check report', async () => {
  const r = await cli(await fixture({ duplicate: true }), ['--check']);
  assert(r.code === 1 && r.result.summary.incompatible === 2 && !r.err.length, 'incomplete all-incompatible report');
  assert(r.result.objectResults.every((o) => o.reason.includes('shared build instances')), 'lost reasons');
});

Deno.test('project check: selection respects printable state and rejects invalid selectors', async () => {
  const source = await fixture({ printable: false });
  const r = await cli(source, ['--check']);
  assert(r.code === 0 && r.result.summary.selected === 1, 'checked nonprintable object');
  for (const object of ['2', 'missing']) {
    const bad = await cli(source, ['--check', '--object', object]);
    assert(bad.code === 1 && !bad.out.length && !JSON.parse(bad.err.at(-1)).outputWritten, 'bad selection accepted');
  }
});

Deno.test('project check: overrides resolve compatibility and warnings remain informational', async () => {
  const source = await fixture({ variable: 1, plateSequence: 'by object' });
  const bad = await cli(source, ['--check']);
  assert(bad.code === 1 && bad.result.objectResults[0].reason.includes('--layer-height'), 'missing corrective hint');
  const r = await cli(source, ['--check', '--layer-height', '0.24', '--fin-extruder', '2']);
  assert(r.code === 0 && r.result.objectResults.every((o) => o.layerHeight === 0.24 && o.filament === 2), 'overrides ignored');
  assert(r.result.objectResults[0].warnings.some((s) => s.includes('prints by object')), 'missing plate warning');
  assert(r.result.objectResults.every((o) => o.warnings.some((s) => s.includes('native slicer supports'))), 'missing native support warnings');
  const off = await cli(source, ['--check', '--layer-height', '0.24', '--disable-native-supports']);
  assert(off.code === 0 && off.result.objectResults.every((o) => !o.warnings.some((s) => s.includes('native slicer supports'))), 'disabled native supports warned');
});

for (const [label, member, change, message, affected = 1] of [
  ['missing mesh', '3D/Objects/a.model', () => null, 'missing project member'],
  ['invalid vertex', '3D/Objects/a.model', (s) => s.replace(/x="[^"]*"/, 'x="NaN"'), 'invalid mesh vertex'],
  ['invalid triangle', '3D/Objects/a.model', (s) => s.replace(/v1="[^"]*"/, 'v1="99999"'), 'invalid triangle references'],
  ['wrong units', '3D/Objects/a.model', (s) => s.replace('millimeter', 'inch'), 'millimeter units'],
  ['cyclic file references', '3D/Objects/a.model', (s) => s.replace('</object>', '<components><component objectid="1" p:path="/3D/Objects/a.model"/></components></object>'), 'cyclic model-part references'],
  // The existing strict reader parses all root transforms for each selection;
  // a malformed shared manifest prevents either object from being loaded.
  ['invalid transform', ROOT, (s) => s.replace('transform="1 0 0 0 1 0 0 0 1 0 0 0"', 'transform="1 2"'), 'invalid component/build transform', 2],
  ['inline components', ROOT, (s) => s.replace('p:path="/3D/Objects/a.model"', ''), 'inline component meshes'],
]) {
  Deno.test(`project check: ${label} reported without hiding other objects`, async () => {
    const zip = new ProjectZip(await fixture());
    const source = new Uint8Array(await (await zip.patch(new Map([[member, change(await zip.text(member))]]))).arrayBuffer());
    const r = await cli(source, ['--check']);
    assert(r.code === 1 && r.fs.size === 1, 'check accepted invalid mesh or wrote output');
    assert(r.result.objectResults[0].reason.includes(message), r.result.objectResults[0].reason);
    assert(r.result.summary.incompatible === affected && r.result.summary.not_processed === 0, 'later object not checked');
  });
}

Deno.test('project check: corrupt mesh bytes fail even though metadata can be listed', async () => {
  const source = await fixture(), zip = new ProjectZip(source);
  source[zip.entries.get('3D/Objects/a.model').start] ^= 255;
  const listed = await cli(source, ['--list-objects']);
  assert(listed.code === 0 && !('objectResults' in listed.result), 'listing contract changed');
  const r = await cli(source, ['--check']);
  assert(r.code === 1 && r.result.summary.incompatible === 1 && r.result.summary.compatible === 1, 'corrupt payload not detected');
});

Deno.test('project check: unreadable project/manifests use existing fatal-error stream', async () => {
  const zip = new ProjectZip(await fixture());
  for (const source of [bytes('not a zip'), new Uint8Array(await (await zip.patch(new Map([
    ['[Content_Types].xml', '<broken>'],
  ]))).arrayBuffer())]) {
    const r = await cli(source, ['--check']);
    assert(r.code === 1 && !r.out.length && r.fs.size === 1, 'fatal check stream/write');
    const error = JSON.parse(r.err.at(-1));
    assert(error.error && error.mode === 'check' && !error.outputWritten, 'missing fatal check context');
  }
});

Deno.test('project report: mixed generation retains successful objects and adds all selected outcomes', async () => {
  const r = await cli(await fixture({ negative: true }));
  assert(r.code === 0 && r.result.outputWritten && r.result.mode === 'generate', 'partial generation behavior changed');
  assert(r.result.objects.length === 1 && r.result.objects[0].number === 2, 'legacy objects changed');
  const [skipped, done] = r.result.objectResults;
  assert(skipped.status === 'skipped' && skipped.reason.includes('negative parts'), 'missing skipped outcome');
  assert(done.status === 'processed' && r.result.summary.processed === 1 && r.result.summary.skipped === 1, 'counts incomplete');
  assert(r.result.report.includes('skipped') && r.result.report.includes('Part 10'), 'human report omits skip');
});

Deno.test('project report: no generated supports is separate from skipped or unchecked', async () => {
  const zip = new ProjectZip(await fixture());
  const root = (await zip.text(ROOT)).replace(/transform="[^"]*"/g, 'transform="1 0 0 0 1 0 0 0 1 0 0 0"');
  const source = new Uint8Array(await (await zip.patch(new Map([[ROOT, root]]))).arrayBuffer());
  const r = await cli(source, ['--pad-style', 'off', '--no-sway']);
  assert(r.code === 0 && r.result.outputWritten && r.result.objects.every((o) => o.triangles === 0), 'fixture generated supports');
  assert(r.result.summary.no_supports === 2 && r.result.summary.skipped === 0, 'zero-support result missing');
});

Deno.test('project report: explicit planning failure marks remaining selections not processed', async () => {
  const r = await cli(await fixture({ negative: true }), ['--object', '1', '--object', '2']);
  assert(r.code === 1 && !r.out.length && r.fs.size === 1, 'explicit failure published output');
  const error = JSON.parse(r.err.at(-1));
  assert(!error.outputWritten && error.summary.failed === 1 && error.summary.not_processed === 1, 'lost abort outcomes');
  assert(error.objectResults[0].reason.includes('negative parts'), 'failure reason lost');
});

Deno.test('project report: later explicit mesh failure retains computation results without claiming output', async () => {
  const zip = new ProjectZip(await fixture());
  const source = new Uint8Array(await (await zip.patch(new Map([['3D/Objects/b.model', null]]))).arrayBuffer());
  const r = await cli(source, ['--object', '1', '--object', '2']);
  const error = JSON.parse(r.err.at(-1));
  assert(r.code === 1 && r.fs.size === 1 && !error.outputWritten, 'failed run claims output');
  assert(error.summary.processed === 1 && error.summary.failed === 1, 'known outcomes lost');
});

Deno.test('project report: all-skipped and output-write failures retain their complete outcomes', async () => {
  const skipped = await cli(await fixture({ duplicate: true }));
  const s = JSON.parse(skipped.err.at(-1));
  assert(skipped.code === 1 && s.summary.skipped === 2 && !s.outputWritten, 'all-skipped result');
  const failed = await cli(await fixture(), [], {}, { writeProject: () => { throw new Error('disk full'); } });
  const f = JSON.parse(failed.err.at(-1));
  assert(failed.code === 1 && failed.fs.size === 1 && f.summary.processed === 2 && !f.outputWritten, 'write failure lost results');
  assert(f.error === 'disk full', 'write error lost');
});

Deno.test('project check: conflicting flags rejected before input is read', async () => {
  for (const flags of [['--list-objects'], ['-o', 'out.3mf'], ['--overwrite'], ['--rot', '0,45,0'], ['--fins-only'], ['--check=yes']]) {
    const r = await cli(bytes('invalid'), ['--check', ...flags], {}, { read: () => { throw new Error('read input'); } });
    assert(r.code === 2 && !r.err.some((s) => s.includes('read input')), `accepted ${flags}`);
  }
  const errors = [];
  const code = await run(['part.3mf', '--check'], { err: (s) => errors.push(s) });
  assert(code === 2 && errors[0].includes('require --preserve-project'), 'check accepted outside project mode');
});

Deno.test('project check: batch reports every input and preserves a nonzero aggregate result', async () => {
  const r = await cli(await fixture({ negative: true }), ['--check', 'good.3mf'], { 'good.3mf': await fixture() });
  assert(r.code === 1 && r.out.length === 2 && r.fs.size === 2, 'batch stopped early or wrote output');
  assert(JSON.parse(r.out[0]).summary.incompatible === 1 && JSON.parse(r.out[1]).summary.compatible === 2, 'batch results lost');
});

Deno.test('project report: terminal output explains check, generation and abort outcomes', async () => {
  for (const [flags, expectedCode, expected] of [
    [['--check'], 1, ['compatibility only', 'no fins generated', 'incompatible', 'compatible']],
    [[], 0, ['output written', 'skipped', 'processed']],
    [['--object', '1', '--object', '2'], 1, ['no output written', 'failed', 'not processed']],
  ]) {
    const out = [], err = [];
    const code = await run(['part.3mf', '--preserve-project', ...flags], {
      read: async () => await fixture({ negative: true }), out: (s) => out.push(s), err: (s) => err.push(s),
      checkProjectOutput: () => {}, writeProject: () => {},
    });
    const text = [...out, ...err].join('\n');
    assert(code === expectedCode && expected.every((s) => text.includes(s)), text);
    assert(text.includes('Part 10') && text.includes('Part 20') && text.includes('negative parts'), 'missing object identities/reason');
  }
});

async function diskProject(fn, options = {}) {
  const dir = await Deno.makeTempDir(), input = `${dir}/part.3mf`;
  try {
    const source = await fixture({ ...options, steep: true }); await Deno.writeFile(input, source);
    const call = async (flags = [], wrap = (c) => c, writer = writeProject) => {
      const out = [], err = [], hits = [], saved = [];
      const code = await run([input, '--preserve-project', '--json', ...flags], {
        read: (p) => Deno.readFile(p), out: (s) => out.push(s), err: (s) => err.push(s),
        checkProjectOutput, writeProject: writer,
        openProjectCache: async (r) => {
          const cache = await openProjectCache(r, async () => 'integration-test');
          return wrap({ ...cache,
            load: async (n) => { const result = await cache.load(n); if (result) hits.push(n); return result; },
            save: async (n, data) => { await cache.save(n, data); saved.push(n); } });
        },
      });
      return { code, out, err, hits, saved, result: code === 0 ? JSON.parse(out[0]) : null };
    };
    await fn({ dir, input, source, call });
  } finally { await Deno.remove(dir, { recursive: true }); }
}

Deno.test('project resume: interrupted run reuses completed objects; output equals fresh run', () => diskProject(async ({ dir, input, source, call }) => {
  const stopped = await call(['--resume'], (cache) => ({ ...cache,
    load: (n) => { if (n === 2) throw new Error('simulated interruption'); return cache.load(n); } }));
  assert(stopped.code === 1 && stopped.saved.join() === '1', 'interruption did not retain object 1');
  let outputExists = true;
  try { await Deno.stat(`${dir}/part-fins-project.3mf`); } catch { outputExists = false; }
  assert(!outputExists, 'interruption published partial output');
  const resumed = await call(['--resume', '-o', `${dir}/resumed.3mf`]);
  assert(resumed.code === 0 && resumed.hits.join() === '1' && resumed.saved.join() === '2', resumed.err.join('\n'));
  const fresh = await call(['-o', `${dir}/fresh.3mf`]);
  assert(fresh.code === 0 && !fresh.hits.length && !fresh.saved.length, fresh.err.join('\n'));
  assert(fresh.result.objects.every((o) => o.stats.finTriangles > 0 && o.stats.padTriangles > 0), 'fixture needs both fins and bed pads');
  assert(JSON.stringify(resumed.result.objects) === JSON.stringify(fresh.result.objects), 'resumed object report changed');
  const a = new ProjectZip(await Deno.readFile(`${dir}/resumed.3mf`));
  const b = new ProjectZip(await Deno.readFile(`${dir}/fresh.3mf`));
  assert([...a.entries.keys()].join() === [...b.entries.keys()].join(), 'archive members changed on resume');
  for (const name of a.entries.keys()) {
    const x = await a.read(name), y = await b.read(name);
    if (name === ROOT || name === SUPPORTS) {
      const normalize = (v) => new TextDecoder().decode(v).replace(/p:UUID="[^"]*"/g, 'p:UUID="same"');
      assert(normalize(x) === normalize(y), `resumed geometry/project differs: ${name}`);
    } else equal(x, y, `resumed archive data changed: ${name}`);
  }
  equal(await Deno.readFile(input), source, 'source project changed');
  let cacheExists = true;
  try { await Deno.stat(`${input}.fins-cache`); } catch { cacheExists = false; }
  assert(!cacheExists, 'cache retained after successful output');
}));

Deno.test('project resume: final-output failure retains all checkpoints and retries without generation', () => diskProject(async ({ call }) => {
  const failed = await call(['--resume'], (c) => c, () => { throw new Error('output unavailable'); });
  assert(failed.code === 1 && failed.saved.join() === '1,2', 'output failure lost work');
  const done = await call(['--resume']);
  assert(done.code === 0 && done.hits.join() === '1,2' && !done.saved.length, done.err.join('\n'));
}));

Deno.test('project resume: checkpoint-write failure aborts default mode instead of skipping the object', () => diskProject(async ({ call }) => {
  const failed = await call(['--resume'], (c) => ({ ...c, save: (n, data) => {
    if (n === 2) throw new Error('checkpoint disk full');
    return c.save(n, data);
  } }));
  assert(failed.code === 1 && failed.saved.join() === '1' && failed.err.some((s) => s.includes('checkpoint disk full')), 'write failure swallowed');
  assert(!failed.err.some((s) => s.includes('skipped object 2')), 'cache failure treated as unsupported model');
  const resumed = await call(['--resume']);
  assert(resumed.code === 0 && resumed.hits.join() === '1' && resumed.saved.join() === '2', resumed.err.join('\n'));
}));

Deno.test('project resume: default skips are never cached; explicit selections still fail', () => diskProject(async ({ call }) => {
  const first = await call(['--resume'], (c) => c, () => { throw new Error('output unavailable'); });
  assert(first.code === 1 && first.saved.join() === '2', 'skipped object cached');
  const explicit = await call(['--resume', '--object', '1']);
  assert(explicit.code === 1 && !explicit.saved.length && explicit.err.some((s) => s.includes('negative parts')), 'explicit failure changed');
  const resumed = await call(['--resume']);
  assert(resumed.code === 0 && resumed.hits.join() === '2' && resumed.err.some((s) => s.includes('skipped object 1')), resumed.err.join('\n'));
}, { negative: true }));

Deno.test('project resume: invalid flags fail before touching files', async () => {
  for (const flags of [
    ['--resume'], ['--preserve-project', '--cache-dir', 'cache'],
    ['--preserve-project', '--resume', '--list-objects'], ['--preserve-project', '--resume=yes'],
    ['--preserve-project', '--resume', '--cache-dir='], ['--preserve-project', '--resume', '--cache-dir'],
  ]) {
    let touched = false;
    const code = await run(['part.3mf', ...flags], { read: () => { touched = true; }, out() {}, err() {} });
    assert(code === 2 && !touched, `bad flags accepted: ${flags}`);
  }
});

Deno.test('project resume: a killed subprocess leaves durable checkpoints reusable by the real CLI', () => diskProject(async ({ dir, input }) => {
  // Stop exactly after committing the first checkpoint, not a timing-dependent
  // sleep during geometry. The child then dies without finally/cleanup handlers.
  const url = (file) => JSON.stringify(new URL(`../${file}`, import.meta.url).href);
  const script = `${dir}/interrupt.mjs`;
  await Deno.writeTextFile(script, `
    import { run } from ${url('cli.js')};
    import { openProjectCache } from ${url('project-cache.js')};
    import { checkProjectOutput, writeProject } from ${url('project-io.js')};
    await run(Deno.args, { read: Deno.readFile, out() {}, err() {}, checkProjectOutput, writeProject,
      openProjectCache: async (r) => {
        const c = await openProjectCache(r);
        return { ...c, save: async (n, data) => { await c.save(n, data);
          console.error('CHECKPOINT_READY'); await new Promise(() => {}); } };
      } });
  `);
  const child = new Deno.Command(Deno.execPath(), { args: ['run', '-A', script, input, '--preserve-project', '--resume'],
    stdout: 'null', stderr: 'piped' }).spawn();
  const reader = child.stderr.getReader();
  let timer, received = '';
  try {
    await Promise.race([
      (async () => { while (!received.includes('CHECKPOINT_READY')) {
        const { done, value } = await reader.read();
        if (done) throw new Error(`checkpoint child exited early: ${received}`);
        received += new TextDecoder().decode(value);
      } })(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('checkpoint child timed out')), 30000); }),
    ]);
  } finally {
    clearTimeout(timer);
    try { child.kill('SIGKILL'); } catch { /* already exited */ }
    await child.status; await reader.cancel(); reader.releaseLock();
  }
  const command = new Deno.Command(Deno.execPath(), { args: ['run', '-RW',
    new URL('../support-fins.js', import.meta.url).href, input, '--preserve-project', '--resume', '--json'],
    stdout: 'piped', stderr: 'piped' });
  const result = await command.output(), err = new TextDecoder().decode(result.stderr);
  assert(result.code === 0 && err.includes('object 1: reusing completed checkpoint'), err);
  assert(!err.includes('object 2: reusing'), 'interrupted object falsely completed');
  assert(JSON.parse(new TextDecoder().decode(result.stdout)).objects.length === 2, 'resumed CLI omitted an object');
}));
