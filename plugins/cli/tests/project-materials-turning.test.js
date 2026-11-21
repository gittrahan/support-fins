import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert';
import { materialFixture, materialCLI } from './_material-fixture.js';
import { roofBody } from './_turning-fixture.js';
import { ProjectZip } from '../project-zip.js';
import { openProjectCache } from '../project-cache.js';

Deno.test('project materials: turning falls back explicitly while preserving roles and completed checkpoints', async () => {
  const zip = new ProjectZip(await materialFixture({ positions: await roofBody(), upright: true }));
  const settings = JSON.parse(await zip.text('Metadata/project_settings.config'));
  Object.assign(settings, { nozzle_diameter: ['0.8'], layer_height: '0.4', initial_layer_print_height: '0.4',
    line_width: '0.82', support_object_xy_distance: '0.35', bridge_angle: '90' });
  const source = new Uint8Array(await (await zip.patch(new Map([
    ['Metadata/project_settings.config', JSON.stringify(settings)],
  ]))).arrayBuffer());
  const folder = await Deno.makeTempDir({ prefix: 'materials-turning-' });
  try {
    const common = ['--turn-fins', '--gap', '.3', '--pad-style', 'off', '--tine-extruder', '2',
      '--interface-extruder', '3', '--interface-mode', 'all'];
    const plain = await materialCLI(source, common);
    assertEquals(plain.code, 0, plain.err.join('\n'));
    assert(plain.result.objectResults[0].diagnostics?.support, 'material export lost support diagnostics');
    assertEquals(plain.result.objects[0].stats.turnedFins, undefined);
    assertStringIncludes(plain.result.objectResults[0].warnings.join(' '), 'turning fins do not yet support separate support materials');
    assert(plain.result.objects[0].materials.some(p => p.role === 'interface' && p.filament === 3));
    const flags = [...common, '--resume'];
    const cache = async request => openProjectCache({ ...request, input: folder + '/source.3mf', buildIdentity: 'turn-material-test' });
    const failed = await materialCLI(source, flags, { openProjectCache: cache,
      writeProject: async () => { throw Error('simulated output failure'); } });
    assertEquals(failed.code, 1);
    const resumed = await materialCLI(source, flags, { openProjectCache: cache });
    assertEquals(resumed.code, 0, resumed.err.join('\n'));
    assertStringIncludes(resumed.err.join('\n'), 'reusing completed checkpoint');
    assertEquals(resumed.result.objects[0], plain.result.objects[0]);
    assertEquals(resumed.result.objectResults[0].warnings, plain.result.objectResults[0].warnings);
    const normalized = async result => (await new ProjectZip(result.files.get('part-fins-project.3mf'))
      .text('3D/SupportFins/supports.model')).replace(/p:UUID="[^"]*"/g, '');
    assertEquals(await normalized(resumed), await normalized(plain));
    const changed = await materialCLI(source, [...flags, '--no-turn-fins'], { openProjectCache: cache });
    assertEquals(changed.code, 0, changed.err.join('\n'));
    assertEquals(await normalized(changed), await normalized(plain), 'fallback changed material geometry');
    assert(!changed.err.some(s => s.includes('reusing completed checkpoint')), 'turn settings reused incompatible material geometry');
  } finally { await Deno.remove(folder, { recursive: true }); }
});
