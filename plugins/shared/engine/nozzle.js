import SCHEMA from './options.json' with { type: 'json' };

const choices = SCHEMA.options.find((o) => o.key === 'nozzle').choices;

// Hosts/project settings may supply numbers or numeric strings. Return the
// schema's spelling (1 -> "1.0"), never clamp or silently ignore a bad diameter.
export function nozzleChoice(value) {
  const n = typeof value === 'number' || typeof value === 'string' && value.trim() !== ''
    ? Number(value) : NaN;
  const choice = choices.find((c) => Number(c.value) === n);
  if (!choice) throw new Error(`nozzle must be one of ${choices.map((c) => c.value).join(', ')} mm, got ${JSON.stringify(value)}`);
  return choice.value;
}
