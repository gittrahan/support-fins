// Focused, serial browser check. No slicer/physical-print claim is made here.
// deno run -A prototype/ui-smoke/support-printability.js
import puppeteer from 'npm:puppeteer-core@24';
import { serveDir } from 'jsr:@std/http@1/file-server';
import { assert, assertEquals } from 'jsr:@std/assert';
import { block, loadModel, rotX } from '../../tests/_util.js';

const web = new URL('../../web/', import.meta.url).pathname;
const server = Deno.serve({ port: 0, hostname: '127.0.0.1', onListen() {} },
  (req) => serveDir(req, { fsRoot: web, quiet: true }));
const browser = await puppeteer.launch({
  executablePath: Deno.env.get('CHROME') ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist'],
  defaultViewport: { width: 1400, height: 900 },
});
const seated = [...block(-12, 12, -12, 12, 0, 6), ...block(-2, 2, -2, 2, 6, 26), ...block(-10, 10, -10, 10, 26, 28)];
const source = loadModel('sphere').pos, rot = rotX(35), soup = [];
for (let i = 0; i < source.length; i += 3) {
  const [x, y, z] = source.slice(i, i + 3);
  soup.push(x, rot[4] * y + rot[7] * z, rot[5] * y + rot[8] * z);
}
const errors = [];
let page;
const settle = () => page.waitForFunction(() => !h.build.buildPending() && !h.build.inspectionPending(), { timeout: 30000 });
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
    window.requests = 0; window.hold = false; window.holdInspection = false; window.pending = [];
    window.Worker = class {
      constructor(url, options) {
        this.fin = String(url).endsWith('/finworker.js');
        if (this.fin && inline) throw Error('test: inline fallback');
        this.worker = new Native(url, options);
        this.worker.onmessage = (e) => {
          const send = () => this.onmessage?.(e);
          if (this.fin && (window.hold || window.holdInspection && e.data.inspection)) window.pending.push(send); else send();
        };
        this.worker.onerror = (e) => this.onerror?.(e);
      }
      postMessage(...args) {
        if (this.fin) window.requests++;
        if (this.fin && window.crashInspection && args[0].type === 'inspect') {
          setTimeout(() => this.onerror?.({ preventDefault() {} }), 0); return;
        }
        this.worker.postMessage(...args);
      }
      terminate() { this.worker.terminate(); }
    };
  }, inline);
  await page.goto(`http://127.0.0.1:${server.addr.port}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sf);
  await page.evaluate(async () => {
    window.h = { THREE: await import('three'), part: await import('./ui/part.js'),
      build: await import('./ui/finbuild.js'), settings: await import('./ui/settings.js'),
      readout: await import('./ui/readout.js'), i18n: await import('./ui/i18n.js'), remove: await import('./ui/remove.js'),
      pose: await import('./ui/pose.js'), scene: await import('./ui/scene.js'), diagnostics: await import('./fins/diagnostics.js') };
    h.i18n.setLanguage('en');
    const layer = document.getElementById('layer-height');
    layer.value = '0.4'; layer.dispatchEvent(new Event('input', { bubbles: true }));
    const nozzle = document.getElementById('nozzle');
    nozzle.value = '0.8'; nozzle.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

try {
  await open(false);
  await load(seated);
  assertEquals((await snapshot()).requests, 0, 'supports disabled must not inspect sections');
  await page.evaluate(() => { window.holdInspection = true; });
  await click('fins-toggle');
  await page.waitForFunction(() => window.pending.length > 0 && !h.build.buildPending(), { timeout: 30000 });
  assert(await page.evaluate(() => h.build.finMesh?.geometry.getAttribute('position').count > 0), 'fins waited for inspection');
  assertEquals((await snapshot()).support, undefined, 'inspection was folded into the generation reply');
  assert((await snapshot()).note.includes('Checking support sections'));
  await page.evaluate(() => { window.holdInspection = false; window.pending.splice(0).forEach((send) => send()); });
  await settle();
  const modelSeated = await snapshot();
  assertEquals(modelSeated.support.status, 'complete');
  assert(modelSeated.support.starts.some((s) => s.root === 'model-below'));
  assert(await page.evaluate(() => !h.diagnostics.supportFindings(h.build.lastBuilt.printability).some((f) => f.root === 'model-below')));
  await load(); await settle();
  const worker = await snapshot();
  assert(worker.note.includes('support-section'), worker.note);
  assert(worker.info.includes('proxy'), worker.info);
  await click('support-finding-toggle');
  assert(await page.evaluate(() => {
    const expected = h.diagnostics.supportFindings(h.build.lastBuilt.printability)[0];
    const box = h.scene.scene.getObjectByName('support-finding')?.box;
    return box && box.min.x === expected.bounds[0] && box.max.y === expected.bounds[3]
      && box.max.z === expected.z && document.getElementById('support-finding-location').textContent.includes('Finding 1 of');
  }), 'finding location/outline does not match the counted report');
  const initialLocation = await page.$eval('#support-finding-location', (e) => e.textContent);
  const out = Deno.args.indexOf('--out');
  if (out >= 0) {
    const dir = Deno.args[out + 1]; await Deno.mkdir(dir, { recursive: true });
    await page.screenshot({ path: `${dir}/finding.png` });
    await Deno.writeTextFile(`${dir}/findings.json`, JSON.stringify(worker.support, null, 2) + '\n');
  }
  const total = await page.evaluate(() => h.diagnostics.supportFindings(h.build.lastBuilt.printability).length);
  if (total > 1) {
    await click('support-finding-next');
    assert(await page.$eval('#support-finding-location', (e) => e.textContent.includes('Finding 2 of')));
    await click('support-finding-prev');
    assertEquals(await page.$eval('#support-finding-location', (e) => e.textContent), initialLocation);
  }
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
  assert(await page.evaluate(() => !h.scene.scene.getObjectByName('support-finding') && document.getElementById('support-findings').hidden), 'manual removal left authoritative diagnostic locations');
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

  await open(false); await load();
  await page.evaluate(() => { window.crashInspection = true; });
  await click('fins-toggle'); await settle();
  assert((await snapshot()).note.includes('checks are unavailable'), 'inspection crash was presented as a pass');
  assert(await page.evaluate(() => h.build.finMesh?.geometry.getAttribute('position').count > 0), 'inspection crash lost finished fins');
  await page.close();

  await open(true); await load(); await click('fins-toggle'); await settle();
  const inline = await snapshot();
  assertEquals(inline.support, undefined, 'unavailable worker performed blocking inline inspection');
  assert(inline.note.includes('checks are unavailable'), inline.note);
  assert(await page.evaluate(() => h.build.finMesh?.geometry.getAttribute('position').count > 0), 'fallback lost fins');
  assertEquals(errors, []);
  console.log('Support diagnostics: display before inspection, finding locations, worker-unavailable fallback, five locales, disabled generation, stale models, manual edits, rotation, threshold and cancellation passed.');
} finally {
  await browser.close(); await server.shutdown();
}
