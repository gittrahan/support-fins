import { turningSettings } from '../project-turning-settings.js';
import { assert } from '../../../tests/_util.js';

const settings = { nozzle_diameter: ['0.8'], layer_height: '0.4', initial_layer_print_height: '0.4',
  line_width: '0.82', support_object_xy_distance: '0.35', raft_layers: '0' };
const plan = { options: { tineDir: 'horizontal' }, byObject: false, variable: false, height: .4, nozzle: .8 };
function rejects(change = {}, planned = {}) {
  let failed = false;
  try { turningSettings({ ...settings, ...change }, { ...plan, ...planned }); } catch { failed = true; }
  assert(failed, JSON.stringify({ change, planned }));
}
Deno.test('turning dimensions use saved ordinary extrusion widths', () => {
  const result = turningSettings({ ...settings, inner_wall_line_width: '110%',
    support_line_width: '5' }, plan);
  assert(Math.abs(result.lineWidth - .88) < 1e-10);
  assert(result.nozzle === .8 && result.layerHeight === .4 && result.firstLayerHeight === .4);
  assert(result.sideGap === .35);
});
Deno.test('turning settings reject ambiguous and automatic widths instead of guessing', () => {
  rejects({ line_width: undefined }); rejects({ line_width: '0' });
  rejects({ line_width: ['0.82', '0.9'] }); rejects({ inner_wall_line_width: '0' });
  rejects({ nozzle_diameter: ['0.4', '0.8'] }); rejects({ nozzle_diameter: undefined });
  rejects({ initial_layer_print_height: undefined }); rejects({ support_object_xy_distance: '0' });
  rejects({ line_width: true }); rejects({ line_width: 'NaN' });
});
Deno.test('turning validates exported support settings and keeps other modes excluded', () => {
  rejects({}, { nozzle: .4 }); rejects({}, { height: .2 });
  rejects({}, { variable: true }); rejects({}, { byObject: true });
  rejects({}, { options: { tineDir: 'vertical' } }); rejects({ printer_technology: 'SLA' });
  rejects({ raft_layers: '1' }); rejects({ raft_layers: '-1' });
  rejects({ initial_layer_print_height: '1' });
});
