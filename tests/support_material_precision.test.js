import { assert, assertEquals, assertThrows } from 'jsr:@std/assert';
import { manifold } from '../web/cut.js';
import { partitionSupportMaterials, supportSolid } from '../web/support-materials.js';
import { rootedMaterialFixture } from '../prototype/material-parts/fixture.js';
import { analyze, block, buildTopology, fins } from './_util.js';

Deno.test('material precision: generated double coordinates survive the float32 binding', async () => {
  const w = await manifold(), p = block(0, 1, 0, 1, 0, 1);
  const scale = [1.123456789, 2.234567891, 3.345678912],
    shift = [12.123456789, -8.123456789, 4.56789123];
  const triangles = Array.from(
    { length: p.length / 3 },
    (_, i) => Array.from(p.slice(i * 3, i * 3 + 3), (v, k) => v * scale[k] + shift[k]),
  );
  const before = structuredClone(triangles), s = supportSolid(w, triangles);
  try {
    assert(Math.abs(s.volume() - scale.reduce((a, b) => a * b)) < 1e-10);
    assertEquals(s.boundingBox().min, shift);
    assertEquals(triangles, before);
  } finally {
    s.delete();
  }
  const bad = structuredClone(triangles);
  bad[0][0] += 1e-8; // distinct corner, yet indistinguishable in the float32 binding
  assertThrows(() => supportSolid(w, bad), Error, 'distinct vertices');
});

Deno.test('material precision: rotating a rooted sloping-contact control retains complementary parts', async () => {
  const shape = await rootedMaterialFixture(), positions = Float32Array.from(shape.flat());
  const topo = buildTopology({ getAttribute: () => ({ array: positions }) });
  const a = .37, c = Math.cos(a), s = Math.sin(a), rot = [c, s, 0, -s, c, 0, 0, 0, 1];
  const result = fins.buildFins(topo, analyze(topo, 45, rot), rot, {
    mode: 'auto',
    coverage: 1,
    tines: true,
    bedPad: false,
    tunables: { iface: 'flat', separateTines: true, tineDir: 'horizontal', nozzle: .4 },
  });
  const before = structuredClone(result.triangles);
  const partition = await partitionSupportMaterials(result.triangles);
  assert(partition.parts.some((p) => p.role === 'tine'));
  assert(partition.residual.missingVolume <= partition.residual.roundoff);
  assert(partition.residual.extraVolume <= partition.residual.roundoff);
  assertEquals(result.triangles, before);
});
