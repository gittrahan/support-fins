import { assert, block } from './_util.js';
import { supportMaterialWarnings } from '../web/support-material-warnings.js';
import { partitionSupportExport } from '../web/material-worker-client.js';
import { partitionSupportMaterials } from '../web/support-materials.js';
const soup = p => Array.from({ length: p.length / 3 }, (_, i) => Array.from(p.slice(i * 3, i * 3 + 3)));
const part = bounds => ({ role: 'tine', triangles: soup(block(...bounds)) });
const settings = { nozzle: .4, layerHeight: .2 };

Deno.test('material warning: narrow, off-layer and mixed tines warn without modifying geometry', () => {
  for (const parts of [[part([0, .2, 0, 3, 0, 1])], [part([0, 1, 0, 3, .21, .25])],
    [{ role: 'tine', triangles: [...part([0, 1, 0, 3, 0, 1]).triangles, ...part([5, 5.2, 0, 3, 0, 1]).triangles] }]]) {
    const before = JSON.stringify(parts), report = supportMaterialWarnings(parts, settings);
    assert(report.status === 'complete' && report.narrowTines, 'missing thin-tine warning');
    assert(JSON.stringify(parts) === before, 'preflight altered exported geometry');
  }
});
Deno.test('material warning: broad tines, rotations and other roles do not invent narrow findings', () => {
  const p = part([0, 1, 0, 3, 0, 1]);
  for (const angle of [0, .37, Math.PI / 2]) {
    const parts = [{ ...p, triangles: p.triangles.map(([x, y, z]) =>
      [x * Math.cos(angle) - y * Math.sin(angle) + 100, x * Math.sin(angle) + y * Math.cos(angle), z]) }];
    assert(supportMaterialWarnings(parts, settings).narrowTines === false);
  }
  assert(!supportMaterialWarnings([{ ...p, role: 'body' }]).narrowTines);
  assert(!supportMaterialWarnings([], settings).narrowTines);
  assert(supportMaterialWarnings([part([0, .3, 0, 3, 0, 1])], { nozzle: .2, layerHeight: .1 }).narrowTines === false);
  assert(supportMaterialWarnings([part([0, .3, 0, 3, 0, 1])], settings).narrowTines === true);
});
Deno.test('material warning: missing settings, invalid geometry and budget limits remain incomplete', () => {
  const p = part([0, 1, 0, 1, 0, 1]);
  for (const options of [{}, { nozzle: NaN, layerHeight: .2 }, { nozzle: .4, layerHeight: 1 }]) {
    assert(supportMaterialWarnings([p], options).status === 'incomplete');
  }
  assert(supportMaterialWarnings([part([0, 1, 0, 1, 0, 5000])], settings).status === 'incomplete');
  p.triangles[0][0] = NaN;
  assert(supportMaterialWarnings([p], settings).status === 'incomplete');
});
Deno.test('material warning: worker and inline report agree without altering partitions', async () => {
  const record = { role: 'tine' }, triangles = part([0, .2, 0, 3, 0, 1]).triangles.map(p => [...p, 0, record]);
  const plain = await partitionSupportMaterials(triangles), result = await partitionSupportExport(triangles, settings);
  assert(JSON.stringify(result.warnings) === JSON.stringify(supportMaterialWarnings(plain.parts, settings)));
  assert(result.warnings.narrowTines);
  delete result.warnings;
  assert(JSON.stringify(result) === JSON.stringify(plain), 'warning changed material export');
});

Deno.test('material warning: adjacent different-slot tines are inspected independently', () => {
  const parts = [{ ...part([0, 1, 0, 3, 0, 1]), filament: 1 },
    { ...part([1, 1.2, 0, 3, 0, 1]), filament: 2 }];
  assert(supportMaterialWarnings(parts, settings).narrowTines, 'wide neighbour hid the narrow material region');
});
