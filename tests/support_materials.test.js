import { assert, block, blockTopo, loadModel, analyze, fins, prop, rotX } from './_util.js';
import { partitionSupportMaterials, hasSupportRoles } from '../web/support-materials.js';
import { moveSupportTriangles, recordSupportSolid, markSupportRole } from '../web/support-roles.js';
import { readThreeMF, writePlate3MF, scanXML } from '../web/threemf.js';
import { unzip } from '../web/zip.js';
import { partitionSupportExport } from '../web/material-worker-client.js';
import { drawnWall } from '../web/draw.js';

const xyz = (tris) => tris.flatMap((p) => p.slice(0, 3));
const soup = (p) => Array.from({ length: p.length / 3 }, (_, i) => [...p.slice(i * 3, i * 3 + 3)]);
const equal = (a, b, why) => assert(JSON.stringify(a) === JSON.stringify(b), why);
async function rejects(fn, why) {
  let failed = false;
  try { await fn(); } catch { failed = true; }
  assert(failed, why);
}

function build(name, rot, opts) {
  const topo = loadModel(name);
  return fins.buildFins(topo, analyze(topo, 45, rot), rot, { mode: 'auto', bedPad: false,
    ...opts, tunables: { iface: false, separateTines: false, tineDir: 'horizontal', cutout: 'none',
      nozzle: .4, ...(opts?.tunables ?? {}) } });
}

const cases = [
  ['cube', rotX(35), {}], ['plate', rotX(60), {}],
  ['lbracket', rotX(40), { mode: 'full' }],
  ['tshape', rotX(30), { tunables: { cutout: 'diamond' } }],
  ['lowledge', rotX(0), {}], ['lowledge', rotX(35), { bedPad: true }],
];
for (const [name, rot, options] of cases) {
  Deno.test(`material parts: ${name} ${options.mode ?? 'auto'} @${rot[4]}, tines only preserves geometry`, async () => {
    const off = build(name, rot, options);
    const on = build(name, rot, { ...options, tunables: { ...options.tunables, iface: 'tines' } });
    equal(xyz(on.triangles), xyz(off.triangles), 'material capture changed original coordinates/order');
    equal(xyz(on.padTriangles), xyz(off.padTriangles), 'material capture changed pad');
    equal(on.fins.map((f) => f.triRanges ?? f.triRange), off.fins.map((f) => f.triRanges ?? f.triRange), 'piece ownership changed');
    const all = [...on.triangles, ...on.padTriangles];
    const before = JSON.stringify(all);
    const p = await partitionSupportMaterials(all);
    const hasTines = all.some((p) => p[4]?.role === 'tine');
    assert(hasSupportRoles(all) === hasTines, 'a body-only build must use the ordinary export');
    assert(p.parts.some((p) => p.role === 'tine') === hasTines, 'missing or invented tines');
    assert(p.parts.every((p) => p.role !== 'interface'), 'tines-only generated a top interface');
    assert(p.contacts.some((c) => c.role === 'tine') === hasTines, 'missing contact records');
    equal(JSON.stringify(all), before, 'partition mutated generation');
    const again = await partitionSupportMaterials(structuredClone(all));
    equal(p, again, 'partition not deterministic through worker serialization');
    build(name, rot, {}); // reset module tunables
  });
}

for (const mode of ['flat', 'all']) {
  Deno.test(`material parts: ${mode} retains legacy geometry and separates all three roles`, async () => {
    const rot = rotX(35), off = build('cube', rot, { tunables: { iface: mode } });
    const on = build('cube', rot, { tunables: { iface: mode, separateTines: true } });
    equal(xyz(on.triangles), xyz(off.triangles), 'role split changed geometry');
    const p = await partitionSupportMaterials(on.triangles);
    assert(p.parts.some((p) => p.role === 'body') && p.parts.some((p) => p.role === 'tine'), 'missing body/tines');
    assert(p.parts.some((p) => p.role === 'interface') === (mode === 'all'), 'incorrect crest classification');
    const reset = build('cube', rot, { tunables: { iface: mode } });
    equal(reset.triangles, off.triangles, 'new metadata leaked after disabling');
  });
}

function overlappingRoles() {
  const out = [];
  prop.PROP.separateTines = true;
  prop.PROP.tineDir = 'horizontal';
  try {
    for (const [role, bounds] of [['body', [0, 10, 0, 2, 0, 10]], ['interface', [0, 10, 0, 2, 9.8, 10.2]],
      ['tine', [4, 6, 0, 4, 9.6, 10]]]) {
      const start = out.length;
      out.push(...soup(block(...bounds)));
      recordSupportSolid(out, start);
      if (role !== 'body') markSupportRole(out, start, role, { direction: [0, 1, 0], footprint: [[4, 4, 9.6], [6, 4, 10]] });
    }
  } finally { prop.PROP.separateTines = false; }
  return out;
}

Deno.test('material parts: overlap priority preserves the union; moved contacts remain registered', async () => {
  const tris = overlappingRoles(), p = await partitionSupportMaterials(tris);
  equal(p.parts.map((p) => p.role), ['body', 'tine', 'interface'], 'role order');
  assert(Math.abs(p.volume - 205.6) < 1e-5, `union volume ${p.volume}`);
  const volume = (tris) => {
    let v = 0;
    for (let i = 0; i < tris.length; i += 3) {
      const [a, b, c] = tris.slice(i, i + 3);
      v += a[0] * (b[1] * c[2] - b[2] * c[1])
        + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
    }
    return v / 6;
  };
  for (const part of p.parts) {
    const expected = { body: 195.2, tine: 3.2, interface: 7.2 }[part.role];
    assert(Math.abs(volume(part.triangles) - expected) < 1e-4, `${part.role}: incorrect overlap ownership`);
  }
  const shifted = moveSupportTriangles(tris, 50, -25), moved = await partitionSupportMaterials(shifted);
  equal(moved.contacts[0].footprint, p.contacts[0].footprint.map(([x, y, z]) => [x + 50, y - 25, z]), 'stale moved contact');
  assert(tris[0][0] === 0, 'move changed original');
});

Deno.test('material parts: Full tilted wedge preserves thin coplanar crests through complementary splits', async () => {
  const b = build('wedge', rotX(35), { mode: 'full', bedPad: true,
    tunables: { iface: 'all', separateTines: true } });
  const p = await partitionSupportMaterials([...b.triangles, ...b.padTriangles]);
  equal(p.parts.map((p) => p.role), ['body', 'tine', 'interface'], 'missing role');
  assert(p.residual.missingVolume < 1e-4 && p.residual.extraVolume < 1e-4,
    'independent boolean orders lost a thin region (previously 0.0266 mm³)');
});

for (const materialFormat of ['components', 'prusa2']) Deno.test(`material parts: ${materialFormat} stays one support object with unique resources across models`, async () => {
  const { parts } = await partitionSupportMaterials(overlappingRoles());
  const models = ['one', 'two'].map((name) => ({ name, partTris: soup(block(0, 10, 5, 10, 0, 10)), finTris: [], materialParts: parts, materialFormat }));
  const data = new Uint8Array(await (await writePlate3MF(models, { separate: true })).arrayBuffer());
  const xml = new TextDecoder().decode((await unzip(data)).get('3D/3dmodel.model'));
  const ids = [], refs = [], build = [];
  scanXML(xml, (tag, a) => {
    if (tag === 'object' || tag === 'basematerials') ids.push(a.id);
    if (tag === 'component') refs.push(a.objectid);
    if (tag === 'item') build.push(a.objectid);
  }, () => {});
  assert(ids.length === new Set(ids).size, 'duplicate resource ID');
  assert(refs.every((id) => ids.includes(id)), 'dangling component');
  assert(build.length === 4 && refs.length === (materialFormat === 'components' ? 6 : 0), 'floating material build objects');
  const read = await readThreeMF(data);
  assert(read.objects.length === 4, 'model/support objects lost on reimport');
  const config = materialFormat === 'prusa2' ? new TextDecoder().decode((await unzip(data)).get('Metadata/Slic3r_PE_model.config')) : xml;
  assert(config.includes('one tines') && config.includes('two top interfaces'), 'material part names');
  const ranges = [...config.matchAll(/firstid="(\d+)" lastid="(\d+)"/g)].map((m) => m.slice(1).map(Number));
  assert(ranges.length === (materialFormat === 'prusa2' ? 6 : 0), 'material volumes missing');
  for (let i = 0; i < ranges.length; i++) assert(ranges[i][0] === (i % 3 ? ranges[i - 1][1] + 1 : 0) && ranges[i][1] >= ranges[i][0], 'overlapping or missing range');
  await rejects(() => writePlate3MF(models), 'locked output silently lost material roles');
});

Deno.test('material parts: invalid and incomplete meshes fail without partial output; empty succeeds', async () => {
  equal((await partitionSupportMaterials([])).parts, [], 'empty output');
  const bad = overlappingRoles();
  await rejects(() => partitionSupportMaterials(bad.slice(3)), 'open source shell accepted');
  await rejects(() => partitionSupportMaterials(bad.slice(1)), 'incomplete triangle accepted');
  const invalid = structuredClone(bad); invalid[0][0] = NaN;
  await rejects(() => partitionSupportMaterials(invalid), 'nonfinite coordinate accepted');
  const inconsistent = structuredClone(bad); inconsistent[1][4] = { role: 'tine' };
  await rejects(() => partitionSupportMaterials(inconsistent), 'mixed role triangle accepted');
  const inward = structuredClone(bad);
  for (let i = 0; i < inward.length; i += 3) [inward[i], inward[i + 1]] = [inward[i + 1], inward[i]];
  await rejects(() => partitionSupportMaterials(inward), 'inward source silently changed to a cavity');
  assert((await partitionSupportMaterials(bad)).parts.length === 3, 'failed call contaminated next object');
});

Deno.test('material parts: incompatible Prusa source metadata and unknown targets are explicit failures', async () => {
  const { parts } = await partitionSupportMaterials(overlappingRoles());
  const model = { name: 'source', partTris: soup(block(0, 10, 5, 10, 0, 10)), finTris: [], materialParts: parts, materialFormat: 'prusa2' };
  await rejects(() => writePlate3MF([{ ...model, colors: { paint: [{ name: 'paint_color', v: '8' }], rgb: [] } }], { separate: true }), 'foreign paint silently lost');
  await rejects(() => writePlate3MF([{ ...model, extras: [{ kind: 'negative', name: 'hole', tris: soup(block(2, 3, 6, 7, 0, 10)), settings: { bambu: [] } }] }], { separate: true }), 'foreign part settings silently lost');
  await rejects(() => writePlate3MF([{ ...model, materialFormat: 'unknown' }], { separate: true }), 'unknown target silently accepted');
  await rejects(() => writePlate3MF([{ ...model, finTris: model.partTris }], { separate: true }), 'unpartitioned triangles silently dropped');
});

for (const flavor of ['bambu', 'prusa2', 'prusa3']) {
  Deno.test(`material parts: preserve ${flavor} source painting and slicer parts`, async () => {
    const { parts } = await partitionSupportMaterials(overlappingRoles());
    const settings = flavor === 'prusa3' ? { prusa3: { perimeters: 4 } }
      : { [flavor]: [[flavor === 'bambu' ? 'wall_loops' : 'perimeters', '4']] };
    const partTris = soup(block(0, 10, 5, 15, 0, 10));
    const paint = []; paint[11] = { name: flavor === 'bambu' ? 'paint_color' : 'slic3rpe:mmu_segmentation', v: '8' };
    const extras = [{ kind: 'negative', name: 'hole', tris: soup(block(2, 3, 6, 7, -1, 11)), settings: { [flavor]: flavor === 'prusa3' ? {} : [] } },
      { kind: 'modifier', name: 'walls', tris: soup(block(2, 8, 6, 14, 0, 10)), settings }];
    const models = ['one', 'two'].map((name) => ({ name, partTris, finTris: [], materialParts: parts,
      colors: { paint, rgb: [] }, extras }));
    const bytes = new Uint8Array(await (await writePlate3MF(models, { separate: true })).arrayBuffer());
    const read = await readThreeMF(bytes);
    for (const name of ['one', 'two']) {
      const source = read.objects.find((o) => o.name === name), support = read.objects.find((o) => o.name === `${name} supports`);
      assert(source.tris === 12 && source.colors.paint[11]?.v === '8', 'source paint or topology lost');
      equal(source.extras.map((e) => e.kind), ['negative', 'modifier'], 'source extras lost');
      equal(source.extras[1].settings[flavor], settings[flavor], 'modifier settings changed');
      assert(support.meshes === 3 && support.extras.length === 0 && support.tris === parts.reduce((n, p) => n + p.triangles.length / 3, 0), 'cutter or material attached to wrong object');
    }
  });
}

Deno.test('material parts: resin and ordinary calls do not retain FDM role records', () => {
  build('cube', rotX(35), { tunables: { iface: 'tines' } });
  const resin = build('cube', rotX(35), { tunables: { iface: 'all', separateTines: true, tineDir: 'vertical' } });
  assert(!resin.triangles.some((p) => p[4]), 'resin acquired material roles');
  const off = build('cube', rotX(35), {});
  assert(!off.triangles.some((p) => p[4]), 'ordinary build retained role records');
});

Deno.test('material parts: disposable worker agrees with inline and rejects invalid geometry', async () => {
  const triangles = overlappingRoles();
  equal(await partitionSupportExport(triangles), await partitionSupportMaterials(triangles), 'worker output differs');
  await rejects(() => partitionSupportExport(triangles.slice(3)), 'worker silently accepted open mesh');
});

Deno.test('material parts: sway tines and drawn walls retain geometry and contacts', async () => {
  const topo = blockTopo(-6, 6, -6, 6, 0, 100), rot = rotX(0), analysis = analyze(topo, 45, rot);
  const make = (iface) => fins.buildFins(topo, analysis, rot, { mode: 'auto', bedPad: false,
    sway: { on: true }, tunables: { iface, separateTines: false, tineDir: 'horizontal' } });
  const off = make(false), on = make('tines');
  equal(xyz(on.triangles), xyz(off.triangles), 'sway geometry changed');
  const p = await partitionSupportMaterials(on.triangles);
  assert(p.contacts.some((c) => c.role === 'tine'), 'sway contacts not captured');
  assert(p.parts.some((p) => p.role === 'tine'), 'sway tines not separate');
  // Draw's top band uses the same capture without needing an automatic pass.
  const roof = block(-10, 10, -10, 10, 15, 18);
  prop.PROP.iface = 'all'; prop.PROP.separateTines = true;
  try {
    const wall = drawnWall([-8, 0, 15], [8, 0, 15], roof, 0, { layerHeight: .2 });
    assert(wall.ok, wall.reason);
    const parts = await partitionSupportMaterials(wall.tris);
    assert(parts.parts.some((p) => p.role === 'interface'), 'Draw interface missing');
  } finally { prop.PROP.iface = false; prop.PROP.separateTines = false; }
});

Deno.test('material parts: five translations cover controls, warnings and export failures', async () => {
  const html = await Deno.readTextFile(new URL('../web/index.html', import.meta.url));
  const tip = html.match(/<label data-tip-pic="iface"[^>]*title="([^"]+)"/)[1];
  const separate = html.match(/<label id="separate-tines-fld"[^>]*title="([^"]+)"/)[1];
  const keys = ['3MF compatibility', 'Tines only', 'Separate tine material', tip, separate,
    'Could not export support material parts. No file was written.', 'No tines to separate in this build.',
    '3MF exports tines as their own material part. Assign filaments in the slicer; different-material tines may lose grip.'];
  for (const lang of ['de', 'nl', 'pt', 'zh', 'ar']) {
    const { default: dictionary } = await import(`../web/i18n/${lang}.js`);
    for (const key of keys) assert(typeof dictionary[key] === 'string' && dictionary[key] !== key, `${lang}: ${key}`);
  }
});
