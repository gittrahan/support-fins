import { assert, assertEquals, assertThrows } from 'jsr:@std/assert';
import {
  assignedBrowserParts,
  browserMaterialOptions,
  materialKey,
  sourcePalette,
  transformMaterialField,
  validateMaterialField,
} from '../web/browser-materials.js';
import { readThreeMF, writeThreeMF } from '../web/threemf.js';
import { ProjectZip } from '../plugins/cli/project-zip.js';
import { block } from './_util.js';
const material = (slot) => ({
  id: `filament:${slot}`,
  kind: 'filament',
  slot,
  declared: true,
  displayColor: '#ffffff',
});
const field = {
  version: 1,
  key: 'file-a',
  materials: [material(1), material(2)],
  regions: [
    {
      triangle: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      material: 'filament:2',
      roleMaterials: { tine: 'filament:1' },
    },
  ],
};
const form = { 'match-contact-materials': true, 'material-body': '1', 'material-fallback': '2' };
Deno.test('browser materials: explicit fallback and destination slots, same colours keep different identities', () => {
  assertEquals(sourcePalette(field).length, 2);
  for (const slot of [-1, 1.5, 256, 1e12]) {
    assertThrows(() => sourcePalette({ materials: [material(slot)] }), Error, 'source filament slot');
  }
  const o = browserMaterialOptions(form, field);
  assertEquals(o.bodyMaterial, 'filament:1');
  assertEquals(o.fallbackMaterial, 'filament:2');
  assertEquals(o.regions[0].material, 'filament:2');
  assertEquals(o.regions[0].roleMaterials.tine, 'filament:1');
  assertThrows(
    () => browserMaterialOptions({ ...form, 'material-fallback': '' }, field),
    Error,
    'explicit fallback',
  );
  assertThrows(
    () => browserMaterialOptions({ ...form, 'material-body': '3' }, field),
    Error,
    'body filament',
  );
  assertEquals(browserMaterialOptions({ ...form, 'match-contact-materials': false }, field), null);
  assertEquals(browserMaterialOptions({ ...form, 'tine-dir': 'vertical' }, field), null);
});
Deno.test('browser materials: per-source mappings never leak to another file or infer a colour match', () => {
  const mapping = JSON.stringify({
    [materialKey(field, 'filament:2')]: '1',
    [materialKey(field, 'filament:1')]: '',
  });
  const own = browserMaterialOptions({ ...form, 'material-mapping': mapping }, field);
  assertEquals(own.regions[0].material, 'filament:1');
  assertEquals(own.regions[0].roleMaterials.tine, null);
  const other = browserMaterialOptions({ ...form, 'material-mapping': mapping }, {
    ...field,
    key: 'file-b',
  });
  assertEquals(other.regions[0].material, 'filament:2');
  const core = { ...field, materials: field.materials.map((m) => ({ ...m, kind: 'core' })) };
  assertEquals(
    browserMaterialOptions({ ...form, 'material-palette': JSON.stringify(sourcePalette(field)) }, core)
      .regions[0].material,
    null,
  );
});
Deno.test('browser materials: captured field transforms and saved metadata validate without mutation', () => {
  const before = structuredClone(field),
    moved = transformMaterialField(field, ([x, y, z]) => [10 - y, 20 + x, 30 + z]);
  validateMaterialField(moved);
  assertEquals(field, before);
  assertEquals(moved.regions[0].triangle[1], [10, 21, 30]);
  for (
    const mutate of [
      (f) => f.regions[0].triangle[0][0] = NaN,
      (f) => f.regions[0].material = 'missing',
      (f) => f.version = 2,
    ]
  ) {
    const bad = structuredClone(field);
    mutate(bad);
    assertThrows(() => validateMaterialField(bad));
  }
  assertThrows(() => assignedBrowserParts({ parts: [{ material: 'unknown' }] }, sourcePalette(field)));
});
Deno.test('3MF browser materials: several materials in one role preserve assigned volumes in both layouts', async () => {
  const soup = (p) => Array.from({ length: p.length / 3 }, (_, i) => [...p.slice(i * 3, i * 3 + 3)]);
  const source = soup(block(0, 5, 0, 5, 0, 5));
  const parts = [{ role: 'body', filament: 1, triangles: soup(block(7, 9, 0, 2, 0, 2)) }, {
    role: 'tine',
    filament: 1,
    triangles: soup(block(7, 8, 0, 1, 2, 3)),
  }, { role: 'tine', filament: 2, triangles: soup(block(8, 9, 0, 1, 2, 3)) }];
  for (const materialFormat of ['components', 'prusa2']) {
    const bytes = new Uint8Array(
      await (await writeThreeMF(source, [], 'fixture', {
        separate: true,
        materialParts: parts,
        materialFormat,
      })).arrayBuffer(),
    );
    const z = new ProjectZip(bytes),
      config = await z.text(
        materialFormat === 'components'
          ? 'Metadata/model_settings.config'
          : 'Metadata/Slic3r_PE_model.config',
      );
    assert(config.includes('filament 2'));
    assert(config.includes('key="extruder" value="2"'));
    assert(
      config.includes(
        materialFormat === 'components'
          ? 'key="wall_filament" value="2"'
          : 'key="perimeter_extruder" value="2"',
      ),
    );
    const read = await readThreeMF(bytes, { withMaterials: true });
    assertEquals(read.objects.length, 2);
    assertEquals(read.objects[1].positions.length, 3 * 108);
    assert(
      read.objects[1].materials.occurrences.some((o) => o.faces.some((f) => f.base === 'filament:2')),
    );
  }
});
Deno.test('browser materials: clearing a role mapping uses fallback, not the source base colour', async () => {
  const { matchContactMaterials } = await import('../web/contact-materials.js');
  const record = {
    role: 'tine',
    contact: { direction: [1, 0, 0], footprint: [[0, 0, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1]] },
  };
  const p = block(-1, 0, 0, 1, 0, 1),
    triangles = Array.from(
      { length: p.length / 3 },
      (_, i) => [...p.slice(i * 3, i * 3 + 3), 0, record],
    );
  const regions = [[[0, 0, 0], [0, 1, 0], [0, 1, 1]], [[0, 0, 0], [0, 1, 1], [0, 0, 1]]].map((
    triangle,
  ) => ({
    triangle,
    material: 'filament:1',
    roleMaterials: { tine: null },
  }));
  const result = await matchContactMaterials(triangles, {
    regions,
    bodyMaterial: 'filament:1',
    fallbackMaterial: 'filament:2',
  });
  assertEquals(result.parts.map((p) => p.material), ['filament:2']);
  assertEquals(result.diagnostics.length, 1);
});
Deno.test('browser materials: a superseded worker is terminated and cannot publish its result', async () => {
  const { partitionSupportExport } = await import('../web/material-worker-client.js');
  const Original = globalThis.Worker;
  let worker;
  globalThis.Worker = class {
    constructor() {
      worker = this;
      this.terminated = false;
    }
    postMessage() {}
    terminate() {
      this.terminated = true;
    }
  };
  try {
    const controller = new AbortController(),
      pending = partitionSupportExport([], null, { signal: controller.signal });
    controller.abort();
    let name;
    try {
      await pending;
    } catch (error) {
      name = error.name;
    }
    assertEquals(name, 'AbortError');
    assert(worker.terminated);
    assertEquals(worker.onmessage, null);
  } finally {
    globalThis.Worker = Original;
  }
});
Deno.test('browser materials: source geometry/paint/settings changes invalidate saved fields', async () => {
  const { unzip, zipDeflate } = await import('../web/zip.js');
  const source = Array.from({ length: 12 }, () => [[0, 0, 0], [1, 0, 0], [0, 1, 0]]).flat();
  const session = { v: 1, part: { size: [1, 1, 0] }, materialField: field };
  const bytes = new Uint8Array(
    await (await writeThreeMF(source, [], 'session', { session })).arrayBuffer(),
  );
  assertEquals((await readThreeMF(bytes)).session.materialField, field);
  assert(!session.materialFieldFingerprint, 'writer mutated caller snapshot');
  const parts = await unzip(bytes);
  for (
    const change of [(p) =>
      p.set(
        '3D/3dmodel.model',
        new TextEncoder().encode(
          new TextDecoder().decode(p.get('3D/3dmodel.model')).replace(
            'v1="0"',
            'paint_color="8" v1="0"',
          ),
        ),
      ), (p) =>
      p.set(
        'Metadata/project_settings.config',
        new TextEncoder().encode('{"filament_colour":["#FFFFFF"]}'),
      )]
  ) {
    const modified = new Map(parts);
    change(modified);
    const data = new Uint8Array(
      await (await zipDeflate([...modified].map(([name, data]) => ({ name, data })))).arrayBuffer(),
    );
    const read = await readThreeMF(data);
    assert(!read.session.materialField);
    assert(read.session.materialFieldStale);
  }
});

Deno.test('3MF browser materials: regrouped elevated roles retain every filament assignment', async () => {
  const soup = p => Array.from({ length: p.length / 3 }, (_, i) => Array.from(p.slice(i * 3, i * 3 + 3)));
  const source = soup(block(0, 5, 0, 5, 0, 15));
  const parts = [{ role: 'body', filament: 1, triangles: soup(block(7, 9, 0, 2, 10, 12)) },
    { role: 'tine', filament: 1, triangles: soup(block(7, 8, 0, 1, 12, 13)) },
    { role: 'tine', filament: 2, triangles: soup(block(8, 9, 0, 1, 12, 13)) }];
  for (const materialFormat of ['components', 'prusa2']) {
    const bytes = new Uint8Array(await (await writeThreeMF(source, [], 'elevated', { separate: true, materialParts: parts, materialFormat })).arrayBuffer());
    const z = new ProjectZip(bytes), config = await z.text(materialFormat === 'components'
      ? 'Metadata/model_settings.config' : 'Metadata/Slic3r_PE_model.config');
    assert(config.includes('tines (filament 1) supports on part') && config.includes('tines (filament 2) supports on part'));
    const volumes = config.match(materialFormat === 'components' ? /<part [\s\S]*?<\/part>/g : /<volume [\s\S]*?<\/volume>/g);
    for (const slot of [1, 2]) {
      const v = volumes.find(v => v.includes(`tines (filament ${slot}) supports on part`));
      for (const key of materialFormat === 'components' ? ['extruder', 'wall_filament', 'sparse_infill_filament', 'solid_infill_filament']
        : ['extruder', 'perimeter_extruder', 'infill_extruder', 'solid_infill_extruder']) assert(v.includes(`key="${key}" value="${slot}"`), `${key} lost`);
    }
    const read = await readThreeMF(bytes, { withMaterials: true });
    assertEquals(read.objects.length, 1, 'stranded mapped supports remained a separate object');
    assertEquals(read.objects[0].positions.length, source.length * 3, 'support faces entered the source material field');
  }
});
