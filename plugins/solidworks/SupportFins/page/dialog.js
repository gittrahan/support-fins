// The Support Fins dialog page. The add-in (FinsWindow.cs) hosts it in WebView2;
// the two talk in JSON messages:
//
//   page -> add-in   {type: 'ready'}                  page loaded, send the part
//                    {type: 'readPart'}               read the active part again
//                    {type: 'insert', pieces: [{name, stl}]}  stl: base64 binary STL, mm
//   add-in -> page   {type: 'part', name, soup, bodies, earlier, face, version}
//                      soup: base64 float64 triangles, model frame, mm; face: the
//                      selected planar face {normal, point} or null; earlier: fin
//                      bodies from an earlier run, left alone
//                    {type: 'part', error, version}   nothing to read
//                    {type: 'inserted', count, failed: [name], error}
//
// The engine runs here, in the page (WebView2 is Edge's V8, so as fast as the site),
// and its settings are built from options.json through the bundle, as every plugin's are.
import { BEDS, finsFor, stlBytes } from './host.js';

const engine = window.SupportFinsEngine;
const SCHEMA = engine?.OPTIONS_SCHEMA;
const STORE = 'supportfins.solidworks.v1';
const $ = (id) => document.getElementById(id);

let values = {};          // options.json key -> value, entry units (a percent / 100)
let bed = 'top';
let part = null;          // {soup: Float64Array, face, name, bodies, earlier}
let result = null;        // finsFor's answer for the current part + settings
let timer = null;
let busy = false;
let notice = '';           // 'Inserted 5 bodies.', kept in front of the next readout

function post(msg) {
  if (window.chrome?.webview) window.chrome.webview.postMessage(msg);
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) || '{}');
    values = s.values || {};
    if (BEDS.some((b) => b.value === s.bed)) bed = s.bed;
  } catch { /* first run, or storage cleared: the defaults */ }
  // Keep only keys this build knows, so an older store can't trip optionsFromDialog.
  const known = new Set(SCHEMA.options.map((o) => o.key));
  values = Object.fromEntries(Object.entries(values).filter(([k]) => known.has(k)));
}
function save() {
  try { localStorage.setItem(STORE, JSON.stringify({ values, bed })); } catch { /* not kept */ }
}

const current = (o) => (Object.hasOwn(values, o.key) ? values[o.key] : o.default);
const shown = (o, v) => (o.percent ? Math.round(v * 100) : v);

function row(label, tooltip, control, hint) {
  const r = document.createElement('label');
  r.className = 'row';
  r.title = tooltip || '';
  const name = document.createElement('span');
  name.textContent = label;
  const box = document.createElement('span');
  box.className = 'control';
  box.append(...[].concat(control));
  r.append(name, box);
  if (hint) {
    const h = document.createElement('span');
    h.className = 'hint';
    h.textContent = hint;
    r.append(h);
  }
  return r;
}

function controlFor(o) {
  const v = current(o);
  if (o.type === 'bool') {
    const c = document.createElement('input');
    c.type = 'checkbox';
    c.checked = v === true || v === 'true';
    c.onchange = () => set(o.key, c.checked);
    return c;
  }
  if (o.type === 'choice') {
    const c = document.createElement('select');
    for (const ch of o.choices) c.add(new Option(ch.label, ch.value, false, ch.value === v));
    c.onchange = () => set(o.key, c.value);
    return c;
  }
  const scale = o.percent ? 100 : 1;
  const c = document.createElement('input');
  c.type = o.slider ? 'range' : 'number';
  c.min = o.min * scale; c.max = o.max * scale; c.step = o.step * scale;
  c.value = shown(o, v);
  if (!o.slider) {
    c.onchange = () => {
      const n = Number(c.value);
      // hostSupplied (layer height): any positive value, as on the site
      const ok = Number.isFinite(n) && (o.hostSupplied ? n > 0 : n >= o.min * scale && n <= o.max * scale);
      if (ok) set(o.key, n / scale); else c.value = shown(o, current(o));
    };
    return c;
  }
  const out = document.createElement('output');
  out.value = shown(o, v);
  c.oninput = () => { out.value = c.value; };
  c.onchange = () => set(o.key, Number(c.value) / scale);
  return [c, out];
}

function build() {
  const form = $('settings');
  form.textContent = '';
  const setup = document.createElement('fieldset');
  const legend = document.createElement('legend');
  legend.textContent = 'Print bed';
  const beds = document.createElement('select');
  for (const b of BEDS) beds.add(new Option(b.label, b.value, false, b.value === bed));
  beds.onchange = () => { bed = beds.value; save(); schedule(); };
  setup.append(legend, row('Stands on', 'Pose the part the way it will print. Selected face: '
    + 'pick the flat face it stands on in SolidWorks, then press Read part.', beds));
  form.append(setup);
  for (const sec of SCHEMA.sections) {
    const opts = SCHEMA.options.filter((o) => o.section === sec.id);
    if (!opts.length) continue;
    const fs = document.createElement('fieldset');
    const lg = document.createElement('legend');
    lg.textContent = sec.label;
    fs.append(lg);
    for (const o of opts) {
      const r = row(o.label, o.tooltip, controlFor(o), o.hint);
      r.dataset.key = o.key;
      fs.append(r);
    }
    form.append(fs);
  }
  showHide();
}

function showHide() {
  for (const r of document.querySelectorAll('.row[data-key]')) r.hidden = !engine.optionVisible(r.dataset.key, values);
}

function set(key, v) {
  values[key] = v;
  save();
  showHide();
  schedule();
}

function say(text, kind = '') {
  const el = $('readout');
  el.textContent = text;
  el.className = kind;
}

function schedule() {
  result = null;
  $('insert').disabled = true;
  clearTimeout(timer);
  if (!part) return;
  say('Computing fins…', 'busy');
  // a beat first, so the line above paints and a dragged slider settles
  timer = setTimeout(compute, 120);
}

function compute() {
  let r;
  try {
    r = finsFor(engine, part.soup, bed, part.face, values);
  } catch (e) {
    return say(`Engine error: ${e.message || e}`, 'warn');
  }
  if (r.error) return say(r.error, 'warn');
  result = r;
  const n = r.pieces.length;
  const earlier = part.earlier ? ` (${part.earlier} fin bod${part.earlier === 1 ? 'y' : 'ies'} from an earlier run left as they are)` : '';
  const warn = r.stats.unserved || r.stats.floating;
  say(`${notice}${n ? `${r.line}.` : 'No fins needed this way up.'}${earlier}`, warn ? 'warn' : '');
  notice = '';
  $('insert').disabled = busy || n === 0;
}

function insert() {
  if (!result || busy) return;
  busy = true;
  $('insert').disabled = true;
  say(`Inserting ${result.pieces.length} bod${result.pieces.length === 1 ? 'y' : 'ies'}…`, 'busy');
  post({
    type: 'insert',
    pieces: result.pieces.map((p) => ({ name: p.name, stl: engine.bytesToB64(stlBytes(p.triangles, p.name)) })),
  });
}

function onMessage(msg) {
  if (msg.version) $('version').textContent = `v${msg.version}`;
  if (msg.type === 'part') {
    if (msg.error) {
      part = null;
      $('part').textContent = 'No part';
      return say(msg.error, 'warn');
    }
    const bytes = engine.b64ToBytes(msg.soup);
    part = {
      soup: new Float64Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 8),
      face: msg.face || null, name: msg.name, bodies: msg.bodies, earlier: msg.earlier || 0,
    };
    $('part').textContent = `${msg.name} · ${msg.bodies} bod${msg.bodies === 1 ? 'y' : 'ies'}`
      + `${msg.face ? ' · face selected' : ''}`;
    return schedule();
  }
  if (msg.type === 'inserted') {
    busy = false;
    if (msg.error) return say(`Insert failed: ${msg.error}`, 'warn');
    const failed = msg.failed?.length ? ` ${msg.failed.length} didn't import: ${msg.failed.join(', ')}.` : '';
    say(`Inserted ${msg.count} bod${msg.count === 1 ? 'y' : 'ies'}.${failed}`, failed ? 'warn' : '');
    if (failed) return;
    // The part now holds them; reading it again counts them as an earlier run.
    notice = `Inserted ${msg.count} bod${msg.count === 1 ? 'y' : 'ies'}. `;
    post({ type: 'readPart' });
  }
}

(() => {
  if (!engine || typeof engine.computeFins !== 'function') {
    return say('The engine bundle (fins_engine.js) did not load. Rebuild the add-in.', 'warn');
  }
  load();
  build();
  $('read').onclick = () => { say('Reading the part…', 'busy'); post({ type: 'readPart' }); };
  $('insert').onclick = insert;
  if (!window.chrome?.webview) return say('Open this page from SolidWorks (Support Fins on the ribbon).', 'warn');
  window.chrome.webview.addEventListener('message', (e) => onMessage(e.data));
  say('Reading the part…', 'busy');
  post({ type: 'ready' });
})();
