// The package's manifest, plugin.json, built from options.json so the export forms
// can't drift from the site: every setting the site has, with its default, range,
// choices and when it shows, in the site's units (a percent slider reads 0-100).
//
//   node plugins/solidcraft/src/manifest.js 0.7.123    # -> plugin.json on stdout
//
// build.py writes it into the package. SolidCraft draws each export slot's form from
// its input_schema and passes the values to exportFile (export.js), which turns
// them back into engine options with optionsFromDialog, as every plugin does.
import { OPTIONS_SCHEMA } from '../../shared/engine/fins_entry.js';
import { fieldOf, PERCENT_KEYS } from './fields.js';

export const ID = 'support-fins';
export const SLOTS = { 'export-3mf': ['3mf', 'Support Fins 3MF'], 'export-stl': ['stl', 'Support Fins STL'] };

// The package's icon (icons/, in SolidCraft's icon SVG subset; build.py copies it in): the
// export forms' header and the Model tab's one Support Fins button. SolidCraft shows an
// entry by its name, which may hold only lowercase letters, digits and dashes, so the
// two slots share a button labelled with the plugin's name, which drops down to them.
export const ICON = 'icons/support-fins.svg';

// The commands exportFile reads the design with: read-only, no files (an exporter may
// list no others).
export const COMMANDS = ['document.inspect', 'model.mesh', 'component.list'];

// The engine runs interpreted in the sandbox (QuickJS, no JIT), several times slower than
// in a browser: a simple part takes seconds, a part with a hundred walls minutes.
// Exporters may run for up to 10 minutes. Fuel only guards against a runaway loop here,
// so the plugin asks for the most SolidCraft lets Install allow (1e13): the deadline is
// the limit. The fuel and the memory are over SolidCraft's default ceilings (1e11 fuel,
// 128 MiB), so Install asks the user to allow them. A 10,444-triangle duct with about
// 120 walls (the plugin's README) needs about 3e12 fuel.
export const LIMITS = { fuel: 10_000_000_000_000, memory_mib: 512, deadline_ms: 600_000 };

const SECTION = Object.fromEntries(OPTIONS_SCHEMA.sections.map((s) => [s.id, s.label]));
const round = (v) => +v.toFixed(6);

// options.json's showIf (every item holds; an item is a bool key, {key, in} or {any})
// as SolidCraft's x-solidcraft-visible-when.
function condition(item) {
  if (typeof item === 'string') return { field: fieldOf(item), eq: true };
  if (item.any) return { any: item.any.map(condition) };
  return { field: fieldOf(item.key), in: item.in };
}

// The site's hint names the unit ("mm", "mm up", "°", "% of height") or says what the
// ends of a slider mean ("light ⟶ firm"); a unit goes after the number, the rest into
// the tooltip.
function unitOf(o) {
  if (PERCENT_KEYS.has(o.key)) return '%';
  if (/^mm\b/.test(o.hint ?? '')) return 'mm';
  if (o.hint === '°') return '°';
  return null;
}

function setting(o, section) {
  const p = { title: o.label };
  if (section) p['x-solidcraft-section'] = section;
  if (o.type === 'bool') Object.assign(p, { type: 'boolean', default: o.default });
  else if (o.type === 'choice') {
    Object.assign(p, { type: 'string', default: o.default,
      oneOf: o.choices.map((c) => ({ const: c.value, title: c.label })) });
  } else {
    const k = PERCENT_KEYS.has(o.key) ? 100 : 1;
    Object.assign(p, { type: 'number', default: round(o.default * k), minimum: round(o.min * k),
      maximum: round(o.max * k) });
    const unit = unitOf(o);
    if (unit) p.unit = unit;
  }
  const hint = o.hint && !unitOf(o) ? `${o.hint[0].toUpperCase()}${o.hint.slice(1)}. ` : '';
  if (o.tooltip || hint) p.description = `${hint}${o.tooltip ?? ''}`.trim();
  if (o.showIf?.length) {
    p['x-solidcraft-visible-when'] = o.showIf.length === 1 ? condition(o.showIf[0])
      : { all: o.showIf.map(condition) };
  }
  return p;
}

// The part: which bodies, and the pose they print in (the site's rotation readout).
const angle = (axis) => ({ type: 'number', title: `Rotate ${axis}`, default: 0, minimum: -360, maximum: 360,
  unit: '°', description: `Turn the part about ${axis} before finning it, as printfins.com's X · Y · Z readout `
    + 'does (X first, then Y, then Z). The file is written in that pose, seated on the plate.' });
const PART = {
  // SolidCraft's reserved `bodies` list: the form picks bodies in the view and sends their names
  bodies: { type: 'array', items: { type: 'string' }, title: 'Bodies', 'x-solidcraft-section': 'Part',
    description: 'The bodies to fin, as one part. None picked: every visible body.' },
  'rot-x': angle('X'), 'rot-y': angle('Y'), 'rot-z': angle('Z'),
};
const FINS_ONLY = { type: 'boolean', title: 'Fins only', default: false,
  description: 'Write the fins alone, lined up with the part where it is in the design, to add to a part you '
    + 'export yourself (the command line\'s --fins-only). It takes no rotation.' };

/** Every field, defined once: both slots' forms point at these ($ref). */
export function definitions() {
  const defs = { ...PART };
  let section = null;
  for (const o of OPTIONS_SCHEMA.options) {
    defs[fieldOf(o.key)] = setting(o, o.section !== section ? SECTION[o.section] : null);
    section = o.section;
  }
  return defs;
}

export function inputSchema(slot) {
  const ref = (name, extra = {}) => ({ $ref: `#/$defs/${name}`, ...extra });
  const properties = { bodies: ref('bodies') };
  // Fins only (STL) keeps the part where it is in the design, so it hides the rotation
  const turn = slot === 'export-stl' ? { 'x-solidcraft-visible-when': { field: 'fins-only', eq: false } } : {};
  for (const axis of ['rot-x', 'rot-y', 'rot-z']) properties[axis] = ref(axis, turn);
  if (slot === 'export-stl') properties['fins-only'] = FINS_ONLY;
  for (const o of OPTIONS_SCHEMA.options) properties[fieldOf(o.key)] = ref(fieldOf(o.key));
  return { type: 'object', 'x-solidcraft-field-order': 'declared', 'x-solidcraft-sections': 'collapsible',
    'x-solidcraft-icon': ICON, additionalProperties: false, properties };
}

export function manifest(version) {
  return {
    id: ID,
    name: 'Support Fins',
    version,
    description: 'Exports the part with breakaway support fins baked in, as printfins.com does, '
      + 'so it prints in its strong orientation in any slicer.',
    capabilities: ['formats@0.2'],
    $defs: definitions(),
    runtime: {
      module: `${ID}.wasm`,
      commands: COMMANDS,
      entries: Object.entries(SLOTS).map(([name, [ext, label]]) => (
        { name, kind: 'exporter', extensions: [ext], label, input_schema: inputSchema(name) })),
      ribbon_groups: [{ label: 'Support Fins', icon: ICON, entries: Object.keys(SLOTS) }],
      limits: LIMITS,
    },
  };
}

if (import.meta.main ?? (typeof process !== 'undefined' && import.meta.url === `file://${process.argv[1]}`)) {
  const version = (globalThis.Deno?.args ?? process.argv.slice(2))[0] ?? '0.7.0';
  console.log(JSON.stringify(manifest(version), null, 2));
}
