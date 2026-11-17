import { assert, assertEquals } from 'jsr:@std/assert';
import { materialFixture } from '../plugins/cli/tests/_material-fixture.js';
import { readThreeMF } from '../web/threemf.js';
import { sourceContactRegions } from '../web/contact-source.js';
import { cutNegatives } from '../web/cut.js';

Deno.test('contact source: exact recursive painting is mapped for each transformed component', async () => {
  const input = await materialFixture({ mirror: true, paint: () => '481' }),
    model = (await readThreeMF(input, { withMaterials: true, doublePrecision: true, outwardWinding: true }))
      .objects[0];
  const before = model.positions.slice(), regions = sourceContactRegions(model);
  assertEquals(regions.length, 24);
  assertEquals(new Set(regions.map((r) => r.material)), new Set(['filament:1', 'filament:2']));
  assertEquals(model.positions, before);
  assert(regions.every((r) => r.triangle.flat().every(Number.isFinite)));
});
Deno.test('contact source: subtraction retains proven exterior paint and leaves new cut surfaces unresolved', async () => {
  const model = (await readThreeMF(await materialFixture({ negative: true, paint: () => '8' }), {
    withMaterials: true,
    doublePrecision: true,
    outwardWinding: true,
  })).objects[0];
  const cut = await cutNegatives(model, { provenance: true });
  assertEquals(cut.cut, 1);
  const regions = sourceContactRegions(model, cut);
  assert(regions.some((r) => r.material === null), 'new cut surface received guessed paint');
  assert(regions.some((r) => r.material === 'filament:2'), 'surviving exterior paint was lost');
  assert(regions.every((r) => r.material === null || r.material === 'filament:2'));
  // A valid ID is insufficient: displacing its triangle invalidates ownership.
  const positions = cut.positions.slice();
  for (let i = 0; i < positions.length; i += 3) positions[i] += 100;
  const wrong = sourceContactRegions(model, { ...cut, positions });
  assert(wrong.every((r) => r.material === null));
});
