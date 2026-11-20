// The Orca settings page's logic (plugins/orca/src/config_page.js, #477), checked against the
// engine it configures: which controls show (optionVisible), and that whatever the page saves
// is a config the engine accepts (optionsFromDialog), with untouched settings left out so
// they keep following the site's defaults.
import { assert } from '../../../tests/_util.js';
import { OPTIONS_SCHEMA, optionsFromDialog, optionVisible } from '../../shared/engine/fins_entry.js';

// key order doesn't matter: compare as sorted JSON
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
const assertEquals = (a, b, msg) => assert(canon(a) === canon(b), `${msg ?? ''} ${canon(a)} != ${canon(b)}`);

const src = await Deno.readTextFile(new URL('../src/config_page.js', import.meta.url));
const SF = new Function(`${src}\nreturn SF;`)();
const DATA = { schema: OPTIONS_SCHEMA, defaults: { enabled: true, apply_to: 'no-supports' } };
const engine = SF.engineFields(OPTIONS_SCHEMA);

// The engine's dialog values for a saved config: what support_fins_orca.py's engine_options
// passes on (everything but the plugin's own keys).
const engineValues = (cfg) => Object.fromEntries(Object.entries(cfg).filter(([k]) => !(k in DATA.defaults)));

function* forms() {
  // every choice and bool value of every field, one at a time, plus some mixes
  yield SF.fromConfig({}, DATA);
  for (const f of engine) {
    const values = f.type === 'bool' ? [true, false] : f.type === 'choice' ? f.choices.map((c) => c.value) : [f.min, f.max];
    for (const v of values) yield { ...SF.fromConfig({}, DATA), [f.key]: v };
  }
  yield { ...SF.fromConfig({}, DATA), mode: 'full', tines: false, tineDir: 'vertical', 'sway.on': true, padStyle: 'light' };
  yield { ...SF.fromConfig({}, DATA), tines: false, padStyle: 'off', tineDir: 'vertical' };
}

Deno.test('orca settings page: shows exactly the controls the site would', () => {
  for (const form of forms()) {
    for (const f of engine) {
      assertEquals(SF.visible(f, form), optionVisible(f.key, form), `${f.key} with ${JSON.stringify(form)}`);
    }
  }
});

Deno.test('orca settings page: leaves out layer height and nozzle, which are Orca\'s own', () => {
  const keys = engine.map((f) => f.key);
  assert(!keys.includes('layerHeight') && !keys.includes('nozzle'));
  assertEquals(keys.length, OPTIONS_SCHEMA.options.filter((o) => !o.hostSupplied).length);
});

Deno.test('orca settings page: an untouched form saves only the plugin\'s own keys', () => {
  const cfg = SF.toConfig(SF.fromConfig({}, DATA), {}, DATA);
  assertEquals(cfg, { enabled: true, apply_to: 'no-supports' });
});

Deno.test('orca settings page: every form it can save is one the engine accepts', () => {
  for (const form of forms()) {
    const cfg = SF.toConfig(form, {}, DATA);
    optionsFromDialog(engineValues(cfg));   // throws on a bad key or value
    // and reading it back gives the same form
    assertEquals(SF.fromConfig(cfg, DATA), form);
  }
});

Deno.test('orca settings page: a setting set back to its default is removed, others are kept', () => {
  const stored = { enabled: true, apply_to: 'all', mode: 'full', gap: 0.3, someFutureKey: 1 };
  const form = SF.fromConfig(stored, DATA);
  assertEquals([form.mode, form.gap, form.apply_to], ['full', 0.3, 'all']);
  form.mode = 'auto';
  assertEquals(SF.toConfig(form, stored, DATA), { enabled: true, apply_to: 'all', gap: 0.3, someFutureKey: 1 });
});

Deno.test('orca settings page: older configs read as the plugin reads them', () => {
  const form = SF.fromConfig({ tine_density: 0.4, bed_pad: false, tines: '0', 'sway.on': 'true' }, DATA);
  assertEquals([form.tineDensity, form.padStyle, form.tines, form['sway.on']], [0.4, 'off', false, true]);
  const cfg = SF.toConfig(form, { tine_density: 0.4, bed_pad: false }, DATA);
  assert(!('tine_density' in cfg) && !('bed_pad' in cfg), 'old names are replaced by the field they mean');
  assertEquals([cfg.tineDensity, cfg.padStyle], [0.4, 'off']);
});

Deno.test('orca settings page: numbers stay in range and on their step', () => {
  const gap = engine.find((f) => f.key === 'gap');
  assertEquals([SF.fit(gap, 9), SF.fit(gap, -1), SF.fit(gap, 0.23), SF.fit(gap, ''), SF.fit(gap, 'x')],
    [gap.max, gap.min, 0.25, gap.default, gap.default]);
  const bad = SF.fromConfig({ mode: 'sideways', threshold: 400, tines: 'maybe' }, DATA);
  assertEquals([bad.mode, bad.threshold, bad.tines], ['auto', 70, true]);
});

Deno.test('orca settings page: layer height and nozzle in a stored config are dropped on save', () => {
  const stored = { enabled: true, apply_to: 'no-supports', layerHeight: 0.2, nozzle: '0.6', gap: 0.3 };
  const cfg = SF.toConfig(SF.fromConfig(stored, DATA), stored, DATA);
  assertEquals(cfg, { enabled: true, apply_to: 'no-supports', gap: 0.3 });
});

Deno.test('orca settings page: names the keys it has no control for', () => {
  assertEquals(SF.unknownKeys({ enabled: true, mode: 'full', sparkle: 1, tine_density: 0.2, layerHeight: 0.2 }, DATA), ['sparkle']);
});

Deno.test('orca settings page: a preset override keeps only what differs, plugin keys too', () => {
  const form = SF.fromConfig({}, DATA);
  assertEquals(SF.toConfig(form, {}, DATA, 'preset'), {});
  form.apply_to = 'all'; form.mode = 'full';
  assertEquals(SF.toConfig(form, {}, DATA, 'preset'), { apply_to: 'all', mode: 'full' });
});

Deno.test('orca settings page: engine on/off reads only what the engine takes, plugin keys read loosely', () => {
  const form = SF.fromConfig({ tines: 'yes', 'sway.on': 'on', enabled: 'no' }, DATA);
  assertEquals([form.tines, form['sway.on'], form.enabled], [true, false, false]);   // tines: 'yes' unreadable -> default true
  const off = SF.fromConfig({ tines: '0', 'sway.on': '1' }, DATA);
  assertEquals([off.tines, off['sway.on']], [false, true]);
});

Deno.test('orca settings page: Remove them drops the keys it has no control for, and only those', () => {
  const stored = { enabled: true, apply_to: 'no-supports', mode: 'full', sparkle: 1 };
  const form = SF.fromConfig(stored, DATA);
  assertEquals(SF.toConfig(form, stored, DATA, 'global', false).sparkle, 1);
  assertEquals(SF.toConfig(form, stored, DATA, 'global', true), { enabled: true, apply_to: 'no-supports', mode: 'full' });
});
