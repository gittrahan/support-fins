import { assert, assertEquals } from 'jsr:@std/assert';
import { projectPrintability } from '../project-printability.js';

const settings = { nozzle_diameter: ['0.8'], layer_height: '0.4', initial_layer_print_height: '0.3',
  line_width: '0.82', outer_wall_line_width: '0.84', initial_layer_line_width: '0.9', support_bottom_z_distance: '0.2',
  support_line_width: '0.5' };

Deno.test('project diagnostics: use saved ordinary widths, first layer and nozzle, not native-support widths', () => {
  assertEquals(projectPrintability(settings), { nozzle: 0.8, layerHeight: 0.4, firstLayerHeight: 0.3,
    lineWidth: 0.84, firstLayerWidth: 0.9, bottomGap: 0.2, basis: 'saved-project', frame: 'input' });
  assertEquals(projectPrintability({ ...settings, outer_wall_line_width: '0' }).lineWidth, 0.82);
});

Deno.test('project diagnostics: unresolved, conflicting and out-of-scope settings are explicit', () => {
  for (const change of [
    { nozzle_diameter: ['0.4', '0.8'] }, { layer_height: undefined }, { initial_layer_print_height: '' },
    { initial_layer_line_width: 0, line_width: 0 }, { support_bottom_z_distance: 0 }, { outer_wall_line_width: true },
    { outer_wall_line_width: '105%' }, { initial_layer_line_width: '105%' },
  ]) assert(projectPrintability({ ...settings, ...change }).unavailable, JSON.stringify(change));
  for (const options of [{ byObject: true }, { variable: true }, { resin: true }]) assert(projectPrintability(settings, options).unavailable);
});
