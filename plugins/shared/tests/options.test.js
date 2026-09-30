// options.json -- the settings every plugin dialog is built from -- must say what the
// website says (same defaults, ranges and choices as web/index.html) and must drive
// the engine (every option is one computeFins takes, and changing it changes the fins:
// no dialog control the math ignores).
//
//   deno test --allow-read plugins/shared/tests/
import { computeFins, ENGINE_DEFAULTS } from '../engine/fins_entry.js';
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
  const m = HTML.match(new RegExp(`<(input|select)\\b[^>]*\\bid="${id}"[^>]*>`));
  assert(m, `no control #${id} in web/index.html`);
  const attr = (name) => m[0].match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
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

Deno.test('options.json is well formed', () => {
  const sections = new Set(SCHEMA.sections.map((s) => s.id));
  assert(new Set(OPTS.map((o) => o.key)).size === OPTS.length, 'duplicate key');
  for (const o of OPTS) {
    assert(sections.has(o.section), `${o.key}: unknown section ${o.section}`);
    assert(['bool', 'number', 'choice'].includes(o.type), `${o.key}: unknown type ${o.type}`);
    assert(o.label && o.tooltip, `${o.key}: needs a label and a tooltip`);
    if (o.showIf) assert(byKey[o.showIf]?.type === 'bool', `${o.key}: showIf ${o.showIf} is not a bool option`);
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

Deno.test('the choices are exactly what the engine knows', () => {
  const values = (k) => byKey[k].choices.map((c) => c.value);
  assert(values('material').join() === Object.keys(MATERIAL).join(), 'material choices vs web/materials.js');
  assert(values('cutout').join() === CUTOUT_PATTERNS.join(), 'cutout choices vs web/cutout.js');
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
});

// Each option, set to each other value it offers, until one moves the fins.
function changesFins(part, o, base, build) {
  const tries = o.type === 'bool' ? [!o.default]
    : o.type === 'choice' ? o.choices.map((c) => c.value).filter((v) => v !== o.default)
    : [o.min, o.max].filter((v) => v !== o.default);
  const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  return tries.some((v) => !same(base, build(v).triangles));
}

Deno.test('every option reaches the geometry (no dead dialog control)', () => {
  const pos = readSTL(Deno.readFileSync(`${MODELS}lbracket.stl`)), m = rotY(35);
  const lbracket = new Float64Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    lbracket[i] = m[0] * x + m[3] * y + m[6] * z;
    lbracket[i + 1] = m[1] * x + m[4] * y + m[7] * z;
    lbracket[i + 2] = m[2] * x + m[5] * y + m[8] * z;
  }
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
