// options.json -- the settings every plugin dialog is built from -- must say what the
// website says (same defaults, ranges and choices as web/index.html) and must drive
// the engine (every option is one computeFins takes, and changing it changes the fins:
// no dialog control the math ignores).
//
//   deno test --allow-read plugins/shared/tests/
import { computeFins, ENGINE_DEFAULTS, optionsFromDialog, optionVisible } from '../engine/fins_entry.js';
import { DEFAULT_THRESHOLD } from '../../../web/overhangs.js';
import { readSTL, MODELS, rotY, assert } from '../../../tests/_util.js';
import { MATERIAL } from '../../../web/materials.js';
import { CUTOUT_PATTERNS } from '../../../web/cutout.js';
import { SWAY } from '../../../web/sway.js';

const SCHEMA = JSON.parse(Deno.readTextFileSync(new URL('../engine/options.json', import.meta.url)));
const HTML = Deno.readTextFileSync(new URL('../../../web/index.html', import.meta.url));
const OPTS = SCHEMA.options;
const byKey = Object.fromEntries(OPTS.map((o) => [o.key, o]));
const close = (a, b) => Math.abs(a - b) < 1e-9;

// The site's control for an id: its tag attributes, and for a <select> its options.
function siteControl(id) {
  const m = HTML.match(new RegExp(`<(input|select)\\b[^>]*(?<![\\w-])id="${id}"[^>]*>`));
  assert(m, `no control #${id} in web/index.html`);
  const attr = (name) => m[0].match(new RegExp(`(?<![\\w-])${name}="([^"]*)"`))?.[1];
  const ctl = { tag: m[1], type: attr('type'), checked: /\bchecked\b/.test(m[0]),
                value: attr('value'), min: attr('min'), max: attr('max'), step: attr('step') };
  if (ctl.tag === 'select') {
    const body = HTML.slice(m.index, HTML.indexOf('</select>', m.index));
    ctl.options = [...body.matchAll(/<option value="([^"]*)"([^>]*)>([^<]*)<\/option>/g)]
      .map(([, value, rest, label]) => ({ value, label: label.trim(), selected: /\bselected\b/.test(rest) }));
  }
  return ctl;
}
// With `percent`, the site shows the entry's value x 100.
const fromSite = (o, v) => (o.percent ? Number(v) / 100 : Number(v));
// Options the site shows that a plugin dialog deliberately leaves out (options.json $comment).
const SITE_ONLY_CHOICES = { padStyle: ['custom'] };
// Every site control that is NOT in options.json, and why. A new control on the site
// fails the test below until it is added to the schema or listed here.
const SITE_EXCLUDED = {
  'file': 'loading a model is the host\'s job', 'volume': 'site build-volume preview',
  'vx': 'site build-volume preview', 'vy': 'site build-volume preview', 'vz': 'site build-volume preview',
  'plugins-computer': 'picks which plugin download to offer',
  'show-layers': 'site display', 'highlight-small': 'site display',
  'fin-mode': 'plugins run Auto; Draw needs the site\'s canvas',
  'gap': 'hand-typed clearance; the material sets it',
  'pad-h': 'Custom pad', 'pad-gap': 'Custom pad', 'pad-grip': 'Custom pad', 'pad-margin': 'Custom pad',
};

Deno.test('options.json is well formed', () => {
  const sections = new Set(SCHEMA.sections.map((s) => s.id));
  assert(OPTS.length >= 10, `only ${OPTS.length} options`);
  assert(new Set(OPTS.map((o) => o.key)).size === OPTS.length, 'duplicate key');
  const checkCond = (key, c) => {
    if (typeof c === 'string') assert(byKey[c]?.type === 'bool', `${key}: showIf ${c} is not a bool option`);
    else if (c.any) c.any.forEach((x) => checkCond(key, x));
    else {
      assert(byKey[c.key]?.type === 'choice', `${key}: showIf ${c.key} is not a choice option`);
      for (const v of c.in) assert(byKey[c.key].choices.some((ch) => ch.value === v), `${key}: showIf ${c.key} has no ${v}`);
    }
  };
  for (const o of OPTS) {
    assert(sections.has(o.section), `${o.key}: unknown section ${o.section}`);
    assert(['bool', 'number', 'choice'].includes(o.type), `${o.key}: unknown type ${o.type}`);
    assert(o.label && o.tooltip, `${o.key}: needs a label and a tooltip`);
    if (o.showIf) { assert(Array.isArray(o.showIf), `${o.key}: showIf must be a list`); o.showIf.forEach((c) => checkCond(o.key, c)); }
    if (o.hostSupplied) assert(o.hostSupplied === 'slicer', `${o.key}: unknown hostSupplied ${o.hostSupplied}`);
    if (o.type === 'number') assert(o.min <= o.default && o.default <= o.max, `${o.key}: default out of range`);
    if (o.type === 'choice') assert(o.choices.some((c) => c.value === o.default), `${o.key}: default not a choice`);
  }
});

Deno.test('every default, range and choice is the website\'s', () => {
  for (const o of OPTS) {
    const site = siteControl(o.site);
    if (o.type === 'bool') {
      assert(site.type === 'checkbox', `${o.key}: #${o.site} is not a checkbox`);
      assert(site.checked === o.default, `${o.key}: default ${o.default}, site ${site.checked}`);
    } else if (o.type === 'number') {
      assert(close(fromSite(o, site.value), o.default), `${o.key}: default ${o.default}, site ${site.value}`);
      for (const k of ['min', 'max', 'step']) {
        assert(close(fromSite(o, site[k]), o[k]), `${o.key}: ${k} ${o[k]}, site ${site[k]}`);
      }
    } else {
      const siteChoices = site.options.filter((c) => !(SITE_ONLY_CHOICES[o.key] || []).includes(c.value));
      const want = siteChoices.map((c) => `${c.value}=${c.label}`).join(', ');
      const got = o.choices.map((c) => `${c.value}=${c.label}`).join(', ');
      assert(got === want, `${o.key}: choices [${got}], site [${want}]`);
      const siteDefault = (site.options.find((c) => c.selected) || site.options[0]).value;
      assert(o.default === siteDefault, `${o.key}: default ${o.default}, site ${siteDefault}`);
    }
  }
});

Deno.test('every site control is in the schema or left out on purpose', () => {
  const ids = [...HTML.matchAll(/<(?:input|select)\b[^>]*(?<![\w-])id="([^"]*)"/g)].map((m) => m[1]);
  assert(ids.length > 20, `found only ${ids.length} site controls`);
  const inSchema = new Set(OPTS.map((o) => o.site));
  for (const id of ids) assert(inSchema.has(id) || id in SITE_EXCLUDED, `#${id} is on the site but neither in options.json nor SITE_EXCLUDED`);
  for (const id of Object.keys(SITE_EXCLUDED)) assert(ids.includes(id), `SITE_EXCLUDED lists #${id}, which the site no longer has`);
});

Deno.test('the choices are exactly what the engine knows', () => {
  const values = (k) => byKey[k].choices.map((c) => c.value);
  assert(values('material').join() === Object.keys(MATERIAL).join(), 'material choices vs web/materials.js');
  assert(values('cutout').join() === CUTOUT_PATTERNS.join(), 'cutout choices vs web/cutout.js');
  // and the entry takes every choice offered (pad styles are the entry's own list)
  const cube = Float64Array.from(readSTL(Deno.readFileSync(`${MODELS}cube.stl`)));
  for (const o of OPTS.filter((x) => x.type === 'choice')) {
    for (const c of o.choices) computeFins(cube, optionsFromDialog({ [o.key]: c.value }));
  }
  computeFins(cube, {});
});

Deno.test('the entry\'s defaults are the schema\'s; sway\'s are sway.js\'s', () => {
  for (const o of OPTS) {
    if (o.key.startsWith('sway.')) continue;
    assert(ENGINE_DEFAULTS[o.key] === o.default, `${o.key}: entry ${ENGINE_DEFAULTS[o.key]}, schema ${o.default}`);
  }
  // Sway is passed whole by a host (sway: {on, ...}), so its defaults are sway.js's own.
  assert(ENGINE_DEFAULTS.sway === null && byKey['sway.on'].default === false, 'sway must default off');
  assert(byKey['sway.tineSpacing'].default === SWAY.tineSpacing, 'sway.tineSpacing vs SWAY');
  assert(byKey['sway.reach'].default === SWAY.reach, 'sway.reach vs SWAY');
  assert(byKey['sway.gripFrom'].default === 0, 'sway.gripFrom: sway.js defaults it to 0');
  assert(byKey.threshold.default === DEFAULT_THRESHOLD, 'threshold vs web/overhangs.js DEFAULT_THRESHOLD');
});

Deno.test('optionVisible hides exactly what the site hides (web/ui/settings.js)', () => {
  const shown = (key, values) => optionVisible(key, values);
  assert(shown('tineDensity', {}) && !shown('tineDensity', { tines: false }), 'tine grip follows Tines');
  // layer height: tines on, or a pad that is one layer tall (Light, or Auto's Light)
  assert(shown('layerHeight', { tines: false, padStyle: 'auto' }), 'layer height with the Auto pad');
  assert(shown('layerHeight', { tines: false, padStyle: 'light' }), 'layer height with the Light pad');
  assert(!shown('layerHeight', { tines: false, padStyle: 'sure' }), 'layer height with Sure hold, no tines');
  assert(!shown('layerHeight', { tines: false, padStyle: 'off' }), 'layer height with no pad, no tines');
  assert(shown('layerHeight', { tines: true, padStyle: 'off' }), 'layer height with tines');
  for (const k of ['sway.gripFrom', 'sway.tineSpacing', 'sway.reach']) assert(!shown(k, {}), `${k} while sway is off`);
  assert(shown('sway.reach', { 'sway.on': true, tines: false }), 'brace depth needs only sway');
  for (const k of ['sway.gripFrom', 'sway.tineSpacing']) {
    assert(shown(k, { 'sway.on': true }) && !shown(k, { 'sway.on': true, tines: false }), `${k} follows sway AND tines`);
  }
  for (const k of ['material', 'threshold', 'padStyle', 'cutout', 'coverage', 'tines', 'sway.on']) assert(shown(k, {}), `${k} always shown`);
});

Deno.test('optionsFromDialog: nests, checks, drops sway when off', () => {
  const o = optionsFromDialog({ material: 'petg', 'sway.on': 'True', 'sway.reach': 0.2, coverage: '0.25', tines: 'false' });
  assert(o.material === 'petg' && o.coverage === 0.25 && o.tines === false, JSON.stringify(o));
  assert(o.sway.on === true && o.sway.reach === 0.2, `sway not nested: ${JSON.stringify(o.sway)}`);
  assert(!('sway' in optionsFromDialog({ 'sway.on': false, 'sway.reach': 0.2 })), 'sway sent while off');
  assert(!('sway' in optionsFromDialog({ 'sway.on': 'false', 'sway.reach': 0.2 })), '"false" turned sway on');
  // null / '' = the default: the key is simply not sent
  const unset = optionsFromDialog({ layerHeight: '', tines: null, 'sway.on': true, 'sway.tineSpacing': null });
  assert(!('layerHeight' in unset) && !('tines' in unset) && !('tineSpacing' in unset.sway), JSON.stringify(unset));
  // a slicer's own layer height is used as is, even outside the dialog's range
  assert(optionsFromDialog({ layerHeight: 0.06 }).layerHeight === 0.06, 'host layer height clamped');
  for (const bad of [{ 'sway-on': true }, { toString: 1 }, { padStyle: 'custom' }, { coverage: 'lots' },
                     { coverage: 50 }, { tineDensity: 20 }, { 'sway.reach': 15 }, { threshold: true },
                     { tines: 1 }, { tines: 'no' }, { layerHeight: 0 }, { layerHeight: [] }]) {
    let threw = false;
    try { optionsFromDialog(bad); } catch { threw = true; }
    assert(threw, `accepted ${JSON.stringify(bad)}`);
  }
});

Deno.test('dialog defaults build exactly the engine defaults', () => {
  const defaults = Object.fromEntries(OPTS.map((x) => [x.key, x.default]));
  const same = (a, b) => a.length > 0 && a.length === b.length && a.every((v, i) => v === b[i]);
  const lbracket = posedLbracket(), bar = Float64Array.from(readSTL(Deno.readFileSync(`${MODELS}bar.stl`)));
  assert(same(computeFins(lbracket, optionsFromDialog(defaults)).triangles, computeFins(lbracket, {}).triangles),
         'lbracket: dialog defaults differ from engine defaults');
  const swayOn = { ...defaults, 'sway.on': true };
  assert(same(computeFins(bar, optionsFromDialog(swayOn)).triangles, computeFins(bar, { sway: { on: true } }).triangles),
         'bar: dialog sway defaults differ from sway.js defaults');
});

// lbracket tilted 35 deg about Y: gets walls, tines and a pad, so every option shows.
function posedLbracket() {
  const pos = readSTL(Deno.readFileSync(`${MODELS}lbracket.stl`)), m = rotY(35);
  const out = new Float64Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    out[i] = m[0] * x + m[3] * y + m[6] * z;
    out[i + 1] = m[1] * x + m[4] * y + m[7] * z;
    out[i + 2] = m[2] * x + m[5] * y + m[8] * z;
  }
  return out;
}

// Each option, set to each other value it offers, until one moves the fins.
function changesFins(part, o, base, build) {
  const tries = o.type === 'bool' ? [!o.default]
    : o.type === 'choice' ? o.choices.map((c) => c.value).filter((v) => v !== o.default)
    : [o.min, o.max].filter((v) => v !== o.default);
  const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  return tries.some((v) => !same(base, build(v).triangles));
}

Deno.test('every option reaches the geometry (no dead dialog control)', () => {
  const lbracket = posedLbracket();
  const bar = Float64Array.from(readSTL(Deno.readFileSync(`${MODELS}bar.stl`)));  // upright: braced
  try {
    const plain = computeFins(lbracket, {}).triangles;
    const braced = computeFins(bar, { sway: { on: true } }).triangles;
    for (const o of OPTS) {
      const [, sub] = o.key.split('.');
      const ok = o.key === 'sway.on'
        ? changesFins(bar, o, computeFins(bar, {}).triangles, (v) => computeFins(bar, { sway: { on: v } }))
        : sub
          ? changesFins(bar, o, braced, (v) => computeFins(bar, { sway: { on: true, [sub]: v } }))
          : changesFins(lbracket, o, plain, (v) => computeFins(lbracket, { [o.key]: v }));
      assert(ok, `${o.key}: no value it offers changes the fins`);
    }
  } finally { computeFins(bar, {}); }   // put the engine back on its defaults
});
