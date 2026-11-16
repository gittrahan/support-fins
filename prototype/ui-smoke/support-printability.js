// Focused, serial browser check. No slicer/physical-print claim is made here.
// deno run -A prototype/ui-smoke/support-printability.js
import puppeteer from 'npm:puppeteer-core@24';
import { serveDir } from 'jsr:@std/http@1/file-server';
import { assert, assertEquals } from 'jsr:@std/assert';
import { block } from '../../tests/_util.js';

const web = new URL('../../web/', import.meta.url).pathname;
const server = Deno.serve({ port: 0, hostname: '127.0.0.1', onListen() {} },
  (req) => serveDir(req, { fsRoot: web, quiet: true }));
const browser = await puppeteer.launch({
  executablePath: Deno.env.get('CHROME') ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist'],
  defaultViewport: { width: 1400, height: 900 },
});
const soup = [...block(-12, 12, -12, 12, 0, 6), ...block(-2, 2, -2, 2, 6, 26), ...block(-10, 10, -10, 10, 26, 28)];
const errors = [];
let page;
const settle = () => page.waitForFunction(() => !h.build.buildPending(), { timeout: 30000 });
const click = (id) => page.evaluate((id) => document.getElementById(id).click(), id);
const input = (id, value) => page.evaluate((id, value) => {
  const e = document.getElementById(id); e.value = value;
  e.dispatchEvent(new Event('input', { bubbles: true }));
}, id, value);
const load = (positions = soup) => page.evaluate((p) => {
  const g = new h.THREE.BufferGeometry();
  g.setAttribute('position', new h.THREE.Float32BufferAttribute(p, 3));
  h.part.setPart(g, 'support-sections.stl');
}, Array.from(positions));
const snapshot = () => page.evaluate(() => ({
  support: h.build.builtRequest()?.built?.printability,
  note: document.getElementById('s-fin-note').textContent,
  info: document.getElementById('s-fin-info').title,
  requests: window.requests,
}));
async function open(inline) {
  page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.evaluateOnNewDocument((inline) => {
    const Native = window.Worker;
    window.requests = 0; window.hold = false; window.pending = [];
    window.Worker = class {
      constructor(url, options) {
        this.fin = String(url).endsWith('/finworker.js');
        if (this.fin && inline) throw Error('test: inline fallback');
        this.worker = new Native(url, options);
        this.worker.onmessage = (e) => {
          const send = () => this.onmessage?.(e);
          if (this.fin && window.hold) window.pending.push(send); else send();
        };
        this.worker.onerror = (e) => this.onerror?.(e);
      }
      postMessage(...args) { if (this.fin) window.requests++; this.worker.postMessage(...args); }
      terminate() { this.worker.terminate(); }
    };
  }, inline);
  await page.goto(`http://127.0.0.1:${server.addr.port}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sf);
  await page.evaluate(async () => {
    window.h = { THREE: await import('three'), part: await import('./ui/part.js'),
      build: await import('./ui/finbuild.js'), settings: await import('./ui/settings.js'),
      readout: await import('./ui/readout.js'), i18n: await import('./ui/i18n.js'), remove: await import('./ui/remove.js'),
      pose: await import('./ui/pose.js') };
    h.i18n.setLanguage('en');
    const layer = document.getElementById('layer-height');
    layer.value = '0.2'; layer.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

try {
  await open(false);
  await load();
  assertEquals((await snapshot()).requests, 0, 'supports disabled must not inspect sections');
  await click('fins-toggle'); await settle();
  const worker = await snapshot();
  assertEquals(worker.support.status, 'complete');
  assert(worker.support.starts.some((s) => s.root === 'model-below'));
  assert(worker.note.includes('support-section'), worker.note);
  assert(worker.info.includes('proxy'), worker.info);
  for (const lang of ['nl', 'de', 'pt', 'zh', 'ar']) {
    await page.evaluate((lang) => { h.i18n.setLanguage(lang); h.readout.updateReadout(h.build.lastBuilt); }, lang);
    const s = await snapshot();
    assert(!s.note.includes('support-section'), `${lang}: untranslated finding`);
    assert(!/\{(?:n|z)\}/.test(s.note), `${lang}: unreplaced placeholder`);
    assertEquals(s.support, worker.support, 'translation must not regenerate or change diagnostics');
  }
  await page.evaluate(() => { h.i18n.setLanguage('en'); window.hold = true; });
  await page.evaluate(() => {
    const e = document.getElementById('layer-height'); e.value = '0.3'; e.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => window.pending.length > 0, { timeout: 30000 });
  await load(block(-5, 5, -5, 5, 0, 10));
  await page.evaluate(() => { window.hold = false; window.pending.splice(0).forEach((send) => send()); });
  await settle();
  const changed = await snapshot();
  assertEquals(changed.support?.starts.length, 0, 'old model findings returned after model switch');
  assert(!changed.note.includes('finding'), changed.note);

  await load(); await settle();
  await page.evaluate(() => {
    // Test readout invalidation; the general UI smoke test also exercises the
    // pointer-driven removal and its exported triangles.
    h.remove.removedIds.add(h.build.lastBuilt.fins[0].id);
    h.readout.updateReadout(h.build.lastBuilt);
  });
  assert((await snapshot()).note.includes('after manual changes'));
  await page.evaluate(() => { h.remove.resetRemovals(); h.readout.updateReadout(h.build.lastBuilt); });
  assert(!(await snapshot()).note.includes('after manual changes'));

  const beforeDrag = (await snapshot()).requests;
  await page.evaluate(() => {
    h.pose.gizmo.dragging = true;
    h.part.part.rotateX(Math.PI / 6);
    h.pose.gizmo.dispatchEvent({ type: 'objectChange' });
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const dragging = await snapshot();
  assertEquals(dragging.requests, beforeDrag, 'rotation preview regenerated support diagnostics');
  assertEquals(dragging.support, undefined, 'new pose retained an authoritative old report');
  assertEquals(dragging.note, '', 'rotation retained old diagnostic locations in the readout');
  await page.evaluate(() => { h.pose.gizmo.dragging = false; });
  await settle();
  assert((await snapshot()).requests > beforeDrag, 'drag completion did not regenerate');
  assert((await snapshot()).support, 'new pose has no diagnostic result');
  await click('rot-reset'); await settle();

  // Holding worker delivery makes cancellation/threshold races deterministic.
  await page.evaluate(() => { window.hold = true; });
  await input('thr', '60');
  await page.waitForFunction(() => window.pending.length > 0, { timeout: 30000 });
  assertEquals((await snapshot()).support, undefined, 'pending threshold rebuild exposed old findings');
  assertEquals((await snapshot()).note, '', 'pending threshold rebuild displayed old findings');
  await click('spinner-cancel');
  await page.evaluate(() => { window.hold = false; window.pending.splice(0).forEach((send) => send()); });
  await settle();
  assertEquals((await snapshot()).support, undefined, 'cancelled result was adopted');
  await click('fins-toggle'); await settle();
  assert((await snapshot()).support, 'generation did not recover after cancellation');
  await click('fins-toggle');
  await load();
  assertEquals((await snapshot()).support, undefined, 'disabled supports retained an old report');
  await page.close();

  await open(true); await load(); await click('fins-toggle'); await settle();
  const inline = await snapshot();
  assertEquals(inline.support, worker.support, 'inline and worker diagnostics differ');
  assert(inline.note.includes('support-section'));
  assertEquals(errors, []);
  console.log('Support diagnostics: worker, inline, five locales, disabled generation, stale models, manual edits, rotation, threshold and cancellation passed.');
} finally {
  await browser.close(); await server.shutdown();
}
