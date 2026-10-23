/** Focused browser regression for the completed-generation hole highlights.
 * deno run -A prototype/ui-smoke/small-holes.js
 * Uses only procedural meshes; run serially with other Chrome smoke checks.
 */
import puppeteer from 'npm:puppeteer-core@24';
import { serveDir } from 'jsr:@std/http@1/file-server';
import { assert, assertEquals } from 'jsr:@std/assert';
import { circularBore } from '../../tests/_bore.js';
import { block } from '../../tests/_util.js';

const web = new URL('../../web/', import.meta.url).pathname;
const server = Deno.serve({ port: 0, hostname: '127.0.0.1', onListen() {} },
  (req) => serveDir(req, { fsRoot: web, quiet: true }));
const browser = await puppeteer.launch({
  executablePath: Deno.env.get('CHROME') ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist'],
  defaultViewport: { width: 1400, height: 900 },
});
const errors = [];
let page;
const change = (id, value, event = 'change') => page.evaluate((id, value, event) => {
  const e = document.getElementById(id);
  if (e.type === 'checkbox') e.checked = value; else e.value = value;
  e.dispatchEvent(new Event(event, { bubbles: true }));
}, id, value, event);
const click = (id) => page.evaluate((id) => document.getElementById(id).click(), id);
const settle = () => page.waitForFunction(() => !window.h.build.buildPending(), { timeout: 30000 });
const release = () => page.evaluate(() => {
  window.holdBuilds = false;
  window.replies.splice(0).forEach((deliver) => deliver());
});
const held = () => page.waitForFunction(() => window.replies.length > 0, { timeout: 30000 });
async function load(soup = circularBore()) {
  await page.evaluate((soup) => {
    const g = new h.THREE.BufferGeometry();
    g.setAttribute('position', new h.THREE.Float32BufferAttribute(soup, 3));
    h.part.setPart(g, 'procedural.stl');
  }, Array.from(soup));
}
async function snapshot() {
  return await page.evaluate(() => {
    const { part, lastResult: res } = h.part;
    const colors = part.geometry.getAttribute('color').array;
    const shade = (hex) => new h.THREE.Color().setHex(hex, h.THREE.SRGBColorSpace);
    const expected = [shade(0xb9c2d0), shade(0xff5a4d), shade(0xffb454), shade(0x3f7fd0)];
    const faces = Array.from({ length: res.over.length }, (_, f) =>
      expected.findIndex((c) => [c.r, c.g, c.b].every((v, i) => Math.abs(colors[f * 9 + i] - v) < 1e-6)));
    return {
      text: document.getElementById('s-fins').textContent,
      warn: document.getElementById('s-fins').classList.contains('warn'),
      legend: document.getElementById('s-over').textContent,
      tip: document.querySelector('#s-over .sw-small')?.title,
      note: document.getElementById('s-fin-note').textContent,
      info: document.getElementById('s-fin-info').title,
      faces, kept: Array.from(res.kept), over: Array.from(res.over),
      mask: Array.from(h.build.lastBuilt?.smallHoleMask ?? []),
      fins: h.build.lastBuilt?.fins.length, requests: window.buildRequests,
    };
  });
}
function amber(s) {
  assert(s.mask.some(Boolean), 'fixture needs an excluded ceiling');
  s.mask.forEach((v, f) => { if (v) assertEquals(s.faces[f], 2, `face ${f} must be amber`); });
  assert(!s.warn, s.text);
  assert(s.text.includes('none needed'), s.text);
}
function original(s) {
  s.kept.forEach((v, f) => { if (v) assertEquals(s.faces[f], 1, `face ${f} must be red`); });
}
async function open(fallback) {
  page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' || (m.type() === 'warn'
      && !m.text().startsWith('support worker postMessage failed; building inline'))) errors.push(m.text());
  });
  await page.evaluateOnNewDocument((fallback) => {
    const NativeWorker = window.Worker;
    window.holdBuilds = false; window.replies = []; window.buildRequests = 0;
    window.Worker = class {
      constructor(url, opts) {
        this.fin = String(url).endsWith('/finworker.js');
        if (this.fin && fallback === 'unavailable') throw Error('test: worker unavailable');
        this.worker = new NativeWorker(url, opts);
        this.worker.onmessage = (e) => {
          const deliver = () => this.onmessage?.(e);
          if (this.fin && window.holdBuilds) window.replies.push(deliver); else deliver();
        };
        this.worker.onerror = (e) => this.onerror?.(e);
      }
      postMessage(...args) {
        if (this.fin) {
          window.buildRequests++;
          if (fallback === 'post-failure') throw Error('test: clone failure');
          if (fallback === 'worker-error') {
            queueMicrotask(() => this.onerror?.({ preventDefault() {} })); return;
          }
          if (fallback === 'build-error') {
            queueMicrotask(() => this.onmessage?.({ data: { id: args[0].id, error: 'test: build failure' } })); return;
          }
        }
        this.worker.postMessage(...args);
      }
      terminate() { this.worker.terminate(); }
    };
  }, fallback);
  await page.goto(`http://127.0.0.1:${server.addr.port}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sf);
  await page.evaluate(async () => {
    window.h = { THREE: await import('three'), part: await import('./ui/part.js'),
      build: await import('./ui/finbuild.js'), settings: await import('./ui/settings.js'),
      readout: await import('./ui/readout.js'), pose: await import('./ui/pose.js'),
      i18n: await import('./ui/i18n.js'), plates: await import('./ui/plates.js'),
      walls: await import('./ui/walls.js'), remove: await import('./ui/remove.js') };
    h.i18n.setLanguage('en');
  });
  await change('highlight-small', true); // viewer preferences persist between tabs
}

try {
  await open();
  await load();
  original(await snapshot());
  assertEquals((await snapshot()).requests, 0, 'supports off must not classify');
  await click('fins-toggle'); await settle();
  amber(await snapshot());
  const initial = await snapshot();
  assert(initial.info.includes('check bridging in the slicer'));
  assert(initial.tip.includes('small-hole ceilings'));
  await change('highlight-small', false);
  const hidden = await snapshot();
  initial.mask.forEach((v, f) => { if (v) assertEquals(hidden.faces[f], 0, 'hidden, never red'); });
  assertEquals(hidden.requests, initial.requests, 'display toggle must not rebuild');
  await change('highlight-small', true); amber(await snapshot());

  for (const mode of ['full', 'draw', 'auto']) {
    await page.evaluate((mode) => { h.settings.setFinMode(mode); h.build.refreshFins(); }, mode);
    await settle();
    if (mode === 'draw') original(await snapshot()); else amber(await snapshot());
  }
  await click('fins-toggle'); original(await snapshot());
  await click('fins-toggle'); await settle(); amber(await snapshot());
  console.log('PASS worker, Auto/Full/Draw, visibility and actual vertex colours');

  // Delay an actual worker result across a drag: no generation during the drag,
  // and its old reply may not repaint the newly analysed pose.
  await page.evaluate(() => { window.holdBuilds = true; h.build.refreshFins(); });
  await held();
  const drag = await page.evaluate(() => {
    const before = window.buildRequests, times = [];
    h.pose.gizmo.dragging = true;
    for (let i = 1; i <= 20; i++) {
      h.part.part.quaternion.setFromAxisAngle(new h.THREE.Vector3(0, 1, 0), i * Math.PI / 40);
      const start = performance.now(); h.part.shade(); times.push(performance.now() - start);
    }
    return { requests: window.buildRequests - before, maxMs: Math.max(...times) };
  });
  assertEquals(drag.requests, 0);
  await release(); await settle();
  original(await snapshot());
  await page.evaluate(() => { h.pose.gizmo.dragging = false; h.part.part.quaternion.identity(); h.part.shade(); });
  await settle(); amber(await snapshot());

  // Delayed results across a threshold change, supports off, Draw and a model
  // switch must all be discarded, even if delivered after worker termination.
  for (const action of ['threshold', 'off', 'draw', 'model']) {
    await page.evaluate(() => { window.holdBuilds = true; h.build.refreshFins(); });
    await held();
    if (action === 'threshold') await change('thr', 70, 'input');
    if (action === 'off') await click('fins-toggle');
    if (action === 'draw') await page.evaluate(() => { h.settings.setFinMode('draw'); h.build.refreshFins(); });
    if (action === 'model') await load(circularBore({ diameter: 10 }));
    await release(); await settle(); original(await snapshot());
    if (action === 'threshold') await change('thr', 45, 'input');
    if (action === 'off') await click('fins-toggle');
    if (action === 'draw') await page.evaluate(() => { h.settings.setFinMode('auto'); h.build.refreshFins(); });
    if (action === 'model') await load();
    await settle(); amber(await snapshot());
  }
  await page.evaluate(() => h.plates.addPlate());
  await load(circularBore({ diameter: 10 })); await settle(); original(await snapshot());
  await page.evaluate(() => h.plates.switchPlate(0)); await settle(); amber(await snapshot());
  console.log(`PASS stale replies, pose/threshold/model/plate changes; 20 drag frames, max ${drag.maxMs.toFixed(1)} ms`);

  // Exercise the actual view with failure results: the new headline must never
  // mask an unsafe seat, floating component, placement failure or removed wall.
  for (const failure of ['point', 'floating', 'unserved', 'onPart', 'sway', 'removed', 'drawn-bad', 'drawn-ok']) {
    await page.evaluate((failure) => {
      const b = { ...h.build.lastBuilt };
      if (failure === 'point') { b.seating = { kind: 'point' }; b.pad = null; }
      if (failure === 'floating') b.floating = [{ drop: 5 }];
      if (failure === 'unserved') b.unserved = 1;
      if (failure === 'onPart') b.skipped = { onPart: 1 };
      if (failure === 'sway') b.sway = { count: 0, reason: 'the upright sides are blocked by other parts of the model in this pose' };
      if (failure === 'removed') h.remove.removedIds.add('test');
      if (failure.startsWith('drawn')) {
        h.settings.setDrawAugment(true);
        h.walls.setDrawnWalls([{ ok: failure === 'drawn-ok', info: {} }]);
      }
      h.readout.updateReadout(b);
    }, failure);
    const s = await snapshot();
    assert(!s.text.includes('none needed'), `${failure}: ${s.text}`);
    if (failure !== 'drawn-ok') assert(s.warn, failure);
    else assert(s.text.includes('1 drawn') && !s.warn);
    await page.evaluate(() => {
      h.remove.removedIds.clear(); h.walls.setDrawnWalls([]); h.settings.setDrawAugment(false);
      h.readout.updateReadout(h.build.lastBuilt);
    });
  }
  await load(Float64Array.from([...circularBore(), ...block(30, 60, -10, 10, 10, 15)]));
  await settle();
  const mixed = await snapshot();
  assert(mixed.faces.includes(1) && mixed.faces.includes(2) && mixed.fins > 0);
  assert(!mixed.text.includes('none needed'));
  console.log('PASS failure readouts, drawn/removed walls and mixed red/amber overhangs');

  // Two distinct holes exercise plural text in every locale, after singular.
  for (const count of [1, 2]) {
    const one = circularBore(), two = one.map((v, i) => v + (i % 3 === 1 ? 30 : 0));
    await load(count === 1 ? one : Float64Array.from([...one, ...two])); await settle();
    for (const lang of ['nl', 'de', 'pt', 'zh', 'ar']) {
      const expected = await page.evaluate((lang, count) => {
        h.i18n.setLanguage(lang);
        return {
          text: h.i18n.tn('none needed: small hole left for bridging', 'none needed: small holes left for bridging', count),
          tip: h.i18n.t('Amber after generation: small-hole ceilings left for bridging'),
        };
      }, lang, count);
      const s = await snapshot();
      assertEquals(s.text, expected.text); assertEquals(s.tip, expected.tip);
      assert(!s.text.includes('none needed') && !s.note.includes('check the slicer'));
      assert(!s.warn && !s.legend.includes('{n}') && s.note.includes(String(count)));
    }
  }
  await page.close();
  console.log('PASS all five translations, singular/plural readouts and legends');

  for (const fallback of ['unavailable', 'post-failure', 'worker-error', 'build-error']) {
    await open(fallback); await load(); await click('fins-toggle'); await settle(); amber(await snapshot());
    await change('highlight-small', false);
    const s = await snapshot(); s.mask.forEach((v, f) => { if (v) assertEquals(s.faces[f], 0); });
    await page.close();
    console.log(`PASS inline fallback: ${fallback}`);
  }
  assertEquals(errors, [], 'uncaught browser errors');
} finally {
  await browser.close(); await server.shutdown();
}
