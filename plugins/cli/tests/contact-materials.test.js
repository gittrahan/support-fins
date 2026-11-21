import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert';
import { materialCLI, materialFixture } from './_material-fixture.js';
import { ProjectZip } from '../project-zip.js';
import { openProjectCache } from '../project-cache.js';
const flags = ['--match-contact-materials', '--contact-fallback-extruder', '3'];
const output = (r) => r.files.get('part-fins-project.3mf');
Deno.test('matched project materials: matching requires an explicit existing fallback and excludes fixed contact assignments', async () => {
  for (
    const args of [
      ['--match-contact-materials'],
      ['--contact-fallback-extruder', '2'],
      [...flags, '--tine-extruder', '2'],
      [...flags, '--interface-extruder', '2'],
      [...flags, '--tine-dir', 'vertical'],
    ]
  ) {
    const r = await materialCLI(await materialFixture(), args);
    assertEquals(r.code, 2, r.err.join('\n'));
    assertEquals(r.files.size, 1);
  }
  const bad = await materialCLI(await materialFixture(), [
    '--match-contact-materials',
    '--contact-fallback-extruder',
    '4',
    '--object',
    '1',
  ]);
  assertEquals(bad.code, 1);
  assertEquals(bad.files.size, 1);
});
for (const sequence of ['by layer', 'by object']) {
  Deno.test(`matched project materials: ${sequence}, uniform painting retains source/tool identity`, async () => {
    const source = await materialFixture({ sequence, paint: () => '8' }),
      r = await materialCLI(source, flags);
    assertEquals(r.code, 0, r.err.join('\n'));
    const parts = r.result.objects[0].materials;
    assert(parts.some((p) => p.role === 'body' && p.filament === 1));
    assert(parts.some((p) => p.role === 'tine' && p.filament === 2), JSON.stringify(r.result.objectResults));
    assert(parts.every((p) => p.role === 'body' ? p.filament === 1 : [2, 3].includes(p.filament)));
    const a = new ProjectZip(source), b = new ProjectZip(output(r));
    for (const path of ['3D/Objects/body.model', 'Metadata/project_settings.config']) {
      assertEquals(await b.read(path), await a.read(path));
    }
  });
}
Deno.test('matched project materials: unknown painting uses the declared fallback and warns, including after resume', async () => {
  const source = await materialFixture({ paint: () => 'G' }), folder = await Deno.makeTempDir();
  try {
    let saves = 0, reused = 0;
    const io = {
      openProjectCache: async (request) => {
        const c = await openProjectCache({ ...request, cacheDir: folder }, async () => 'contact-test');
        return {
          ...c,
          save: async (...a) => {
            saves++;
            return c.save(...a);
          },
          load: async (...a) => {
            const v = await c.load(...a);
            if (v) reused++;
            return v;
          },
        };
      },
    };
    const failed = await materialCLI(source, [...flags, '--resume'], {
      ...io,
      writeProject: async () => {
        throw new Error('publication failed');
      },
    });
    assertEquals(failed.code, 1);
    assertEquals(saves, 1);
    const resumed = await materialCLI(source, [...flags, '--resume'], io),
      fresh = await materialCLI(source, flags);
    assertEquals(resumed.code, 0, resumed.err.join('\n'));
    assertEquals(reused, 1);
    assertEquals(resumed.result.objectResults, fresh.result.objectResults);
    assertStringIncludes(resumed.result.objectResults[0].warnings.join(' '), 'fallback filament 3');
    assert(
      resumed.result.objects[0].materials.every((p) =>
        p.role === 'body' ? p.filament === 1 : p.filament === 3
      ),
    );
  } finally {
    await Deno.remove(folder, { recursive: true });
  }
});
Deno.test('matched project materials: recursive paint spans multiple exported tine regions without recolouring bodies', async () => {
  const r = await materialCLI(await materialFixture({ paint: () => '481' }), flags);
  assertEquals(r.code, 0, r.err.join('\n'));
  const parts = r.result.objects[0].materials;
  assert(parts.some((p) => p.role === 'tine' && p.filament === 1));
  assert(parts.some((p) => p.role === 'tine' && p.filament === 2));
  assertEquals(parts.filter((p) => p.role === 'body').map((p) => p.filament), [1]);
});

Deno.test('matched project materials: mirrored negative components preserve cutters in layer mode and existing baking in sequential mode', async () => {
  for (const sequence of ['by layer', 'by object']) {
    const source = await materialFixture({ negative: true, mirror: true, sequence, paint: () => '8' }),
      r = await materialCLI(source, flags);
    assertEquals(r.code, 0, r.err.join('\n'));
    assert(r.result.objects[0].materials.some((p) => p.role === 'tine' && p.filament === 2));
    const z = new ProjectZip(output(r));
    assertEquals(
      (await z.text('Metadata/model_settings.config')).includes('negative_part'),
      sequence === 'by layer',
    );
  }
});
