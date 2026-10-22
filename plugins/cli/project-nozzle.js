import { nozzleChoice } from '../shared/engine/nozzle.js';

// Filament slots are not physical nozzle indices. Until tool mapping is supported,
// only a single diameter (or several identical ones) is unambiguous.
export function projectNozzle(settings, explicit) {
  if (explicit !== undefined) return { nozzle: Number(nozzleChoice(explicit)), nozzleSource: 'override' };
  const raw = settings.nozzle_diameter;
  const values = Array.isArray(raw) ? raw : [raw];
  let diameters;
  try {
    if (!values.length) throw new Error('empty nozzle list');
    diameters = values.map((v) => Number(nozzleChoice(v)));
  } catch {
    throw new Error('missing or unsupported project nozzle_diameter; supply --nozzle for fin generation');
  }
  if (new Set(diameters).size !== 1) {
    throw new Error('project has different nozzle diameters; select objects and supply --nozzle for the nozzle printing their fins');
  }
  return { nozzle: diameters[0], nozzleSource: 'project' };
}
