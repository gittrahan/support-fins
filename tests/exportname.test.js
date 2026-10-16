// Export file names (web/exportname.js, GitHub #279): the nozzle and layer height the
// fins were built for ride in the name, so the slicer gets set to match.

import { assert } from './_util.js';
import { exportName } from '../web/exportname.js';

const eq = (a, b) => assert(a === b, `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

Deno.test('export name: nozzle and layer height before the extension', () => {
  eq(exportName('bracket-fins', '.3mf', { nozzle: 0.6, layerHeight: 0.24 }), 'bracket-fins-0.6nozzle-0.24layer.3mf');
  eq(exportName('bracket-fins', '.stl', { nozzle: 0.4, layerHeight: 0.2 }), 'bracket-fins-0.4nozzle-0.2layer.stl');
  eq(exportName('bracket-fins-only', '.stl', { nozzle: 2, layerHeight: 0.6 }), 'bracket-fins-only-2nozzle-0.6layer.stl');
});

Deno.test('export name: no float noise, at most two decimals', () => {
  eq(exportName('p-fins', '.3mf', { nozzle: 0.25, layerHeight: 0.1 + 0.2 }), 'p-fins-0.25nozzle-0.3layer.3mf');
  eq(exportName('p-fins', '.3mf', { nozzle: '0.8', layerHeight: 0.08 }), 'p-fins-0.8nozzle-0.08layer.3mf');
});

Deno.test('export name: a missing or junk setting is left out, not written as NaN', () => {
  eq(exportName('p-fins', '.3mf', { nozzle: 0.4, layerHeight: NaN }), 'p-fins-0.4nozzle.3mf');
  eq(exportName('p-fins', '.3mf', {}), 'p-fins.3mf');
});
