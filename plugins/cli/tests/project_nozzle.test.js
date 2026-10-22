import { projectNozzle } from '../project-nozzle.js';
import { assert } from '../../../tests/_util.js';

Deno.test('project nozzle: single/uniform numeric diameters, not filament-slot indexing', () => {
  for (const raw of [0.8, '0.8', ['0.8'], ['0.80', 0.8]]) {
    const r = projectNozzle({ nozzle_diameter: raw, filament_colour: ['a', 'b', 'c'] });
    assert(r.nozzle === 0.8 && r.nozzleSource === 'project', JSON.stringify(r));
  }
  assert(projectNozzle({ nozzle_diameter: ['1', '1.0'] }).nozzle === 1, 'equivalent decimal spellings conflict');
});

Deno.test('project nozzle: missing, mixed and unsupported settings need an override', () => {
  for (const raw of [undefined, null, '', ' ', [], {}, true, 0, -0.4, 0.3, 2.5, NaN, Infinity,
    '0.8mm', 'NaN', ['0.4', '0.8'], ['0.4', null], [['0.4']], ['0.4', 'bad']]) {
    let error;
    try { projectNozzle({ nozzle_diameter: raw }); } catch (e) { error = e; }
    assert(error?.message.includes('--nozzle'), `accepted ${JSON.stringify(raw)}`);
    const r = projectNozzle({ nozzle_diameter: raw }, '0.6');
    assert(r.nozzle === 0.6 && r.nozzleSource === 'override', 'explicit override did not win');
  }
});
