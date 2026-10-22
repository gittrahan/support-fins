import { nozzleChoice, nozzleSize } from '../shared/engine/nozzle.js';
import { ENGINE_DEFAULTS } from '../shared/engine/fins_entry.js';

// Filament slots are not physical nozzle indices. Until tool mapping is supported,
// only a single diameter (or several identical ones) is unambiguous; anything else
// builds at the 0.4 default, as before this setting existed, and says so.
// Returns { nozzle (mm), nozzleSource: 'override' | 'project' | 'default', warning? }.
export function projectNozzle(settings, explicit) {
  if (explicit !== undefined) return { nozzle: Number(nozzleChoice(explicit)), nozzleSource: 'override' };
  const fallback = (why) => ({ nozzle: Number(ENGINE_DEFAULTS.nozzle), nozzleSource: 'default',
    warning: `${why}; fins sized for a ${ENGINE_DEFAULTS.nozzle} mm nozzle (pass --nozzle to change)` });
  const raw = settings.nozzle_diameter;
  const values = Array.isArray(raw) ? raw : [raw];
  let diameters;
  try {
    if (!values.length) throw new Error('empty nozzle list');
    diameters = values.map(nozzleSize);
  } catch {
    return fallback(`project nozzle_diameter is missing or unreadable (${JSON.stringify(raw ?? null)})`);
  }
  if (new Set(diameters).size !== 1) {
    return fallback(`project has different nozzle diameters (${diameters.join(', ')} mm)`);
  }
  return { nozzle: diameters[0], nozzleSource: 'project' };
}
