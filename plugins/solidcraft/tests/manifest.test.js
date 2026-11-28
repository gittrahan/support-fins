// plugin.json's export forms are written from options.json (src/manifest.js): every
// setting the site has, named as the command line's flag, with the site's default,
// range and choices, shown exactly when the site shows it -- and small enough for
// SolidCraft to read.
//
//   deno test -A plugins/solidcraft/tests/
import { COMMANDS, SLOTS, definitions, inputSchema, manifest } from '../src/manifest.js';
import { FIELD_OF_KEY, PERCENT_KEYS, fieldOf } from '../src/fields.js';
import { readOptions } from '../src/export.js';
import { flagOf } from '../../cli/cli.js';
import { OPTIONS_SCHEMA, optionVisible, optionsFromDialog } from '../../shared/engine/fins_entry.js';
import { assert } from '../../../tests/_util.js';

const OPTS = OPTIONS_SCHEMA.options;
const DEFS = definitions();

Deno.test('a setting is named as the command line\'s flag', () => {
  for (const o of OPTS) assert(fieldOf(o.key) === flagOf(o.key), `${o.key}: ${fieldOf(o.key)} vs --${flagOf(o.key)}`);
  assert(new Set(Object.values(FIELD_OF_KEY)).size === OPTS.length, 'two settings share a field name');
});

Deno.test('both slots offer every setting, in options.json\'s order, after the part', () => {
  for (const slot of Object.keys(SLOTS)) {
    const names = Object.keys(inputSchema(slot).properties);
    const settings = names.filter((n) => !['bodies', 'rot-x', 'rot-y', 'rot-z', 'fins-only'].includes(n));
    assert(settings.join() === OPTS.map((o) => fieldOf(o.key)).join(), `${slot}: ${settings}`);
    assert(names.slice(0, 4).join() === 'bodies,rot-x,rot-y,rot-z', `${slot} starts ${names.slice(0, 4)}`);
    assert(names.includes('fins-only') === (slot === 'export-stl'), `${slot}: fins-only`);
    for (const n of names) {
      const p = inputSchema(slot).properties[n];
      assert(p.$ref ? DEFS[p.$ref.replace('#/$defs/', '')] : p.type, `${slot}.${n} points nowhere`);
    }
  }
});

Deno.test('each setting has the site\'s default, range and choices, in the site\'s units', () => {
  for (const o of OPTS) {
    const d = DEFS[fieldOf(o.key)];
    const k = PERCENT_KEYS.has(o.key) ? 100 : 1;
    const close = (a, b) => Math.abs(a - b) < 1e-9;
    if (o.type === 'bool') assert(d.type === 'boolean' && d.default === o.default, o.key);
    else if (o.type === 'choice') {
      assert(d.type === 'string' && d.default === o.default, o.key);
      assert(d.oneOf.map((c) => c.const).join() === o.choices.map((c) => c.value).join(), `${o.key} choices`);
    } else {
      assert(d.type === 'number', o.key);
      assert(close(d.default, o.default * k) && close(d.minimum, o.min * k) && close(d.maximum, o.max * k), `${o.key} range`);
    }
  }
});

// SolidCraft's x-solidcraft-visible-when, evaluated as the app does (docs/plugins.md,
// "Conditional fields"): a hidden field is not sent, so the engine takes its default.
function holds(c, values) {
  if (c.all) return c.all.every((x) => holds(x, values));
  if (c.any) return c.any.some((x) => holds(x, values));
  if (c.not) return !holds(c.not, values);
  const v = values[c.field];
  return 'eq' in c ? v === c.eq : c.in.includes(v);
}

Deno.test('a setting shows exactly when the site shows it', () => {
  // every combination of the settings that other settings depend on
  const controllers = { tines: [true, false], 'tine-dir': ['horizontal', 'vertical'], 'pad-style': ['off', 'auto', 'light', 'sure'],
    sway: [true, false], mode: ['auto', 'full'] };
  const combos = Object.entries(controllers).reduce((acc, [f, vals]) => acc.flatMap((a) => vals.map((v) => ({ ...a, [f]: v }))), [{}]);
  const keyOf = Object.fromEntries(OPTS.map((o) => [fieldOf(o.key), o.key]));
  for (const form of combos) {
    const dialog = Object.fromEntries(Object.entries(form).map(([f, v]) => [keyOf[f], v]));
    for (const o of OPTS) {
      const when = DEFS[fieldOf(o.key)]['x-solidcraft-visible-when'];
      const shown = when ? holds(when, form) : true;
      assert(shown === optionVisible(o.key, dialog), `${o.key} with ${JSON.stringify(form)}: shown ${shown}`);
    }
  }
});

Deno.test('a form left at its defaults is the engine\'s defaults', () => {
  for (const slot of Object.keys(SLOTS)) {
    const values = {};
    for (const [n, p] of Object.entries(inputSchema(slot).properties)) {
      const d = p.$ref ? DEFS[p.$ref.replace('#/$defs/', '')] : p;
      if ('default' in d) values[n] = d.default;
    }
    const { engine, rot, bodies, finsOnly } = readOptions(JSON.stringify(values), slot);
    const want = optionsFromDialog(Object.fromEntries(OPTS.map((o) => [o.key, o.default])));
    assert(JSON.stringify(engine) === JSON.stringify(want), `${slot}: ${JSON.stringify(engine)}`);
    assert(rot.join() === '0,0,0' && bodies.length === 0 && finsOnly === false, slot);
  }
});

Deno.test('one Support Fins button holds both slots, with an icon in SolidCraft\'s SVG subset', () => {
  const m = manifest('0.7.0');
  const groups = m.runtime.ribbon_groups;
  assert(groups.length === 1 && groups[0].label === 'Support Fins', JSON.stringify(groups));
  assert(groups[0].entries.join() === Object.keys(SLOTS).join(), `group entries ${groups[0].entries}`);
  for (const e of m.runtime.entries) assert(e.input_schema['x-solidcraft-icon'] === groups[0].icon, `${e.name} icon`);
  // the rules SolidCraft checks an icon against (crates/look/icons/design/tools/lint_icons.py)
  const svg = Deno.readTextFileSync(new URL(`../${groups[0].icon}`, import.meta.url));
  assert(/<svg [^>]*viewBox="0 0 64 64"/.test(svg) && !/<svg [^>]*(width|height)=/.test(svg), 'viewBox 0 0 64 64, no size');
  for (const [, tag] of svg.matchAll(/<([a-zA-Z]+)[\s>/]/g)) {
    assert(['svg', 'title', 'path', 'circle', 'defs', 'mask', 'clipPath', 'g'].includes(tag), `<${tag}> is not in the subset`);
  }
  assert(!/\b(transform|style|class)=/.test(svg), 'no transform, style or class');
  for (const [, d] of svg.matchAll(/ d="([^"]*)"/g)) assert(/^[MLCQAZ0-9 .-]+$/.test(d), `path data ${d}`);
  for (const [, paint] of svg.matchAll(/(?:fill|stroke)="([^"]*)"/g)) {
    assert(paint === 'none' || paint === 'currentColor', `${paint}: draw in currentColor, as the theme does`);
  }
  for (const stroke of svg.match(/<path [^>]*stroke="currentColor"[^>]*>/g) ?? []) {
    assert(/stroke-linejoin="round"/.test(stroke) && /stroke-linecap="round"/.test(stroke), 'strokes need round joins and caps');
  }
});

Deno.test('plugin.json is an exporter SolidCraft takes: read-only commands, under its size cap', () => {
  const m = manifest('0.7.0');
  assert(m.capabilities.join() === 'formats@0.2', 'capabilities');
  assert(m.runtime.entries.every((e) => e.kind === 'exporter' && !e.slots), 'entries');
  assert(COMMANDS.every((c) => ['document.inspect', 'model.mesh', 'component.list'].includes(c)), `commands ${COMMANDS}`);
  assert(!m.runtime.permissions, 'an exporter asks for no permission');
  // build.py writes it with indent=1; SolidCraft reads at most 64 KiB of it
  // (MAX_MANIFEST_BYTES in its crates/craft-plugin), the $defs keep both forms in one copy
  const bytes = new TextEncoder().encode(JSON.stringify(m, null, 1)).length;
  assert(bytes < 32 * 1024, `plugin.json is ${bytes} bytes`);
});
