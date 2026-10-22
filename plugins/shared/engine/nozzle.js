import SCHEMA from './options.json' with { type: 'json' };
import { NOZZLE_MAX } from '../../../web/nozzle.js';

const choices = SCHEMA.options.find((o) => o.key === 'nozzle').choices;
const NOZZLE_MIN = 0.1;   // web/nozzle.js applyNozzle ignores anything finer

const asNumber = (value) => (typeof value === 'number' || typeof value === 'string' && value.trim() !== ''
  ? Number(value) : NaN);

// A diameter someone typed (--nozzle, a dialog): one of the site's choices, in the
// schema's spelling (1 -> "1.0"); never clamp or silently ignore a bad diameter.
export function nozzleChoice(value) {
  const n = asNumber(value);
  const choice = choices.find((c) => Number(c.value) === n);
  if (!choice) throw new Error(`nozzle must be one of ${choices.map((c) => c.value).join(', ')} mm, got ${JSON.stringify(value)}`);
  return choice.value;
}

// A diameter a host or project supplies (hostSupplied: slicer): its own value, used
// as is like a slicer's layer height, so a 0.3 or 0.5 nozzle isn't sized as another.
// Only what the engine can't scale to is refused. Returns mm.
export function nozzleSize(value) {
  const n = asNumber(value);
  if (!(n >= NOZZLE_MIN && n <= NOZZLE_MAX)) {
    throw new Error(`nozzle must be ${NOZZLE_MIN}..${NOZZLE_MAX} mm, got ${JSON.stringify(value)}`);
  }
  return n;
}
