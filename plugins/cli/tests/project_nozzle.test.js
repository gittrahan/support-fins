import { projectNozzle } from '../project-nozzle.js';
import { assert } from '../../../tests/_util.js';

Deno.test('project nozzle: single/uniform numeric diameters, not filament-slot indexing', () => {
  for (const raw of [0.8, '0.8', ['0.8'], ['0.80', 0.8]]) {
    const r = projectNozzle({ nozzle_diameter: raw, filament_colour: ['a', 'b', 'c'] });
    assert(r.nozzle === 0.8 && r.nozzleSource === 'project' && !r.warning, JSON.stringify(r));
  }
  assert(projectNozzle({ nozzle_diameter: ['1', '1.0'] }).nozzle === 1, 'equivalent decimal spellings conflict');
  // A slicer's size off the site's list is the project's, used as is.
  assert(projectNozzle({ nozzle_diameter: ['0.5'] }).nozzle === 0.5, '0.5 not used as saved');
});

Deno.test('project nozzle: missing, mixed and unreadable settings build at 0.4 and say so', () => {
  for (const raw of [undefined, null, '', ' ', [], {}, true, 0, -0.4, 2.5, NaN, Infinity,
    '0.8mm', 'NaN', ['0.4', '0.8'], ['0.4', null], [['0.4']], ['0.4', 'bad']]) {
    const r = projectNozzle({ nozzle_diameter: raw });
    assert(r.nozzle === 0.4 && r.nozzleSource === 'default' && r.warning?.includes('--nozzle'), `${JSON.stringify(raw)}: ${JSON.stringify(r)}`);
    const o = projectNozzle({ nozzle_diameter: raw }, '0.6');
    assert(o.nozzle === 0.6 && o.nozzleSource === 'override' && !o.warning, 'explicit override did not win');
  }
});
