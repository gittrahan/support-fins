/**
 * UI smoke run: drive the real page in headless Chrome through a fixed script of
 * clicks (load, rotate, fins, remove a fin, pad styles, draw a wall, undo/redo,
 * strength arrow, lay flat, suggest orientation, volume...) and dump what is
 * observable after every step -- panel text, control state, triangle counts +
 * checksums of the fins / pad / drawn walls, what the scene shows, the export
 * geometry, and any console error. Two dumps of the same script diff cleanly, so
 * a UI refactor can be checked for "no behaviour change" (compare.js).
 *
 *   deno run -A prototype/ui-smoke/ui-smoke.js --web web --out run.json [--model cone]
 *
 * The page is served here (web/ plus prototype/stress/models/ at /models/), so no
 * dev server and no gitignored dev-models are needed. CHROME overrides the browser.
 */
import puppeteer from 'npm:puppeteer-core@24';
import { serveDir } from 'jsr:@std/http@1/file-server';
import { parseArgs } from 'jsr:@std/cli@1/parse-args';
import { dirname, fromFileUrl, join, resolve } from 'jsr:@std/path@1';

const args = parseArgs(Deno.args, { string: ['web', 'out', 'model'], default: { model: 'cone' } });
const ROOT = resolve(dirname(fromFileUrl(import.meta.url)), '../..');
const WEB = resolve(args.web ?? join(ROOT, 'web'));
const MODELS = join(ROOT, 'prototype/stress/models');
const model = args.model.includes('/') ? args.model : `models/${args.model}.stl`;

const server = Deno.serve({ port: 0, hostname: '127.0.0.1', onListen() {} }, (req) => {
  const path = new URL(req.url).pathname;
  const res = path.startsWith('/models/')
    ? serveDir(req, { fsRoot: MODELS, urlRoot: 'models', quiet: true })
    : serveDir(req, { fsRoot: WEB, quiet: true });
  return res.then((r) => { r.headers.set('Cache-Control', 'no-store'); return r; });
});
const base = `http://127.0.0.1:${server.addr.port}`;

const browser = await puppeteer.launch({
  executablePath: Deno.env.get('CHROME')
    ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist'],
  defaultViewport: { width: 1400, height: 900 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warn') errors.push(`${m.type()}: ${m.text()}`);
});
page.on('dialog', async (d) => { errors.push(`dialog: ${d.message()}`); await d.dismiss(); });

const steps = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (s) => Deno.stderr.writeSync(new TextEncoder().encode(s + '\n'));

/** Wait for any support build in flight to land. */
async function settle() {
  await sleep(150);
  for (let i = 0; i < 200; i++) {
    const busy = await page.evaluate(() =>
      document.getElementById('s-fins')?.textContent === 'generating supports…'
      || document.getElementById('spinner').classList.contains('show'));
    if (!busy) break;
    await sleep(100);
  }
  await sleep(250);
}

async function snap(name) {
  await settle();
  const s = await page.evaluate(() => {
    const SKIP = new Set(['s-time', 'fps']);        // timings: never equal run to run
    const dom = {};
    for (const e of document.querySelectorAll('[id]')) {
      if (SKIP.has(e.id)) continue;
      const r = {};
      if (e.hidden) r.h = 1;
      if (e.disabled) r.d = 1;
      if (e.className && typeof e.className === 'string') r.c = e.className;
      if ('value' in e && e.tagName !== 'BUTTON' && e.tagName !== 'LI') {
        r.v = e.type === 'checkbox' ? e.checked : e.value;
      }
      if (e.children.length === 0 || e.id.startsWith('s-') || e.id.endsWith('-note')
          || e.id === 'suggest-list') {
        r.t = e.textContent.trim().replace(/\s+/g, ' ').slice(0, 400);
      }
      if (e.title && e.id === 's-fin-info') r.title = e.title;
      if (e.tagName === 'SELECT') r.opts = [...e.options].map((o) => o.textContent).join('|');
      dom[e.id] = r;
    }
    const sf = window.__sf;
    const sum = (tris) => {
      let a = 0;
      for (const t of tris) a += t[0] * 1.3 + t[1] * 1.7 + t[2] * 2.1;
      return Math.round(a * 10) / 10;
    };
    const scene = sf.part?.parent;
    const vis = [], mats = new Set();
    scene?.traverse((o) => {
      if (!(o.isMesh || o.isLine || o.isLineSegments)) return;
      let v = o.visible;
      for (let p = o.parent; v && p; p = p.parent) v = p.visible;
      if (v) {
        vis.push(`${o.type}:${o.material?.color?.getHexString?.() ?? ''}:`
          + `${o.geometry?.getAttribute('position')?.count ?? 0}`);
      }
      if (o.isMesh && o.material?.color) {
        mats.add(`${o.material.color.getHexString()}:${o.material.transparent ? 't' : 'o'}:`
          + `${o.material.opacity}`);
      }
    });
    const q = sf.part?.quaternion;
    const exp = sf.buildExportGeometry();
    return {
      dom,
      quat: q ? [q.x, q.y, q.z, q.w].map((v) => Math.round(v * 1e4) / 1e4) : null,
      finTris: sf.finTris.length, finSum: sum(sf.finTris),
      padTris: sf.padTris.length, padSum: sum(sf.padTris),
      drawnTris: sf.drawnTris.length, drawnSum: sum(sf.drawnTris),
      walls: sf.drawnWalls.map((w) => ({ kind: w.kind ?? 'wall', ok: w.ok })),
      export: exp && { part: exp.partTris.length, fins: exp.finTris.length, base: exp.base,
                       sum: sum(exp.finTris) },
      vis: vis.sort(),
      mats: [...mats].sort(),
      cursor: document.querySelector('#viewport canvas').style.cursor,
    };
  });
  steps.push({ name, ...s });
  log(`${name}: fins=${s.finTris} pad=${s.padTris} drawn=${s.drawnTris} | ${s.dom['s-fins']?.t}`);
}

const click = (id) => page.evaluate((id) => document.getElementById(id).click(), id);
const setVal = (id, v, ev = 'change') => page.evaluate((id, v, ev) => {
  const e = document.getElementById(id);
  if (e.type === 'checkbox') e.checked = v; else e.value = v;
  e.dispatchEvent(new Event(ev, { bubbles: true }));
}, id, v, ev);

/** Screen point of a world point returned by `body` (a function body of sf, THREE). */
function screenOf(body) {
  return page.evaluate(async (body) => {
    const THREE = await import('three');
    const sf = window.__sf;
    const p = new THREE.Vector3(...new Function('sf', 'THREE', body)(sf, THREE));
    p.project(sf.camera);
    const r = document.querySelector('#viewport canvas').getBoundingClientRect();
    return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height };
  }, body);
}
/** Hover then click the world-space centroid of part face `pick(sf)`. */
async function clickFace(pick) {
  const p = await screenOf(`
    const g = sf.part.geometry.getAttribute('position'); sf.part.updateMatrixWorld();
    const f = (${pick})(sf);
    const c = new THREE.Vector3();
    for (let i = 0; i < 3; i++) c.add(new THREE.Vector3().fromBufferAttribute(g, f * 3 + i));
    c.multiplyScalar(1 / 3); sf.part.localToWorld(c); return [c.x, c.y, c.z];`);
  await page.mouse.move(p.x, p.y);
  await sleep(60);
  await page.mouse.click(p.x, p.y);
}
/** The overhang face furthest along ±x in world space (spans a drawn wall). */
const extremeOverhang = (sign) => `(sf) => {
  const kept = sf.result.kept, g = sf.part.geometry.getAttribute('position');
  sf.part.updateMatrixWorld();
  const v = new sf.part.position.constructor();
  let best = -1, bv = -Infinity;
  for (let f = 0; f < kept.length; f++) {
    if (!kept[f]) continue;
    v.set(0, 0, 0);
    for (let i = 0; i < 3; i++) {
      v.x += g.getX(f * 3 + i) / 3; v.y += g.getY(f * 3 + i) / 3; v.z += g.getZ(f * 3 + i) / 3;
    }
    sf.part.localToWorld(v);
    const s = ${sign} * v.x - Math.abs(v.z) * 0.01;
    if (s > bv) { bv = s; best = f; }
  }
  return best; }`;

try {
  await page.goto(`${base}/?stl=${model}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sf?.part, { timeout: 30000 });
  if (!(await page.evaluate(() => !!window.__sf.camera))) {
    throw new Error('this build has no window.__sf.camera (the harness needs it to aim clicks)');
  }
  await snap('loaded');

  await click('rot-x'); await snap('rot-x');
  await click('rot-y'); await snap('rot-y');
  await click('fins-toggle'); await snap('fins-on');

  // Remove the fin nearest the camera, then restore it and walk undo/redo.
  await click('remove-fins-toggle'); await snap('remove-armed');
  const fin = await screenOf(`
    const cam = sf.camera.position, t = sf.finTris; let best = null, bd = Infinity;
    for (let i = 0; i < t.length; i += 3) {
      const c = [0, 1, 2].map((k) => (t[i][k] + t[i + 1][k] + t[i + 2][k]) / 3);
      const d = Math.hypot(c[0] - cam.x, c[1] - cam.y, c[2] - cam.z);
      if (d < bd) { bd = d; best = c; }
    }
    return best ?? [0, 0, 0];`);
  await page.mouse.move(fin.x, fin.y); await sleep(80);
  await snap('remove-hover');
  await page.mouse.click(fin.x, fin.y); await snap('removed-one');
  await page.keyboard.press('Escape'); await snap('remove-esc');
  await click('restore-fins'); await snap('restored');
  await page.keyboard.down('Meta'); await page.keyboard.press('z'); await page.keyboard.up('Meta');
  await snap('undo-restore');
  await click('redo'); await snap('redo');

  // Options panel.
  await setVal('material', 'petg'); await snap('petg');
  await setVal('bed-pad', 'sure'); await snap('pad-sure');
  await setVal('bed-pad', 'custom'); await snap('pad-custom');
  await setVal('pad-gap', '0.2', 'input'); await snap('pad-custom-gap');
  await setVal('bed-pad', 'auto'); await snap('pad-auto');
  await setVal('tines', false); await snap('tines-off');
  await setVal('tines', true); await snap('tines-on');
  await setVal('sway', true); await snap('sway-on');
  await setVal('sway', false);
  await setVal('cutout', 'diamond'); await snap('cutout');
  await setVal('coverage', '80', 'input'); await snap('coverage-80');

  // Draw mode: a wall across the overhang, then undo / clear / their undos.
  await setVal('fin-mode', 'draw'); await snap('draw-mode');
  await clickFace(extremeOverhang(1)); await snap('draw-first');
  await clickFace(extremeOverhang(-1)); await snap('draw-second');
  await page.keyboard.press('Escape'); await snap('draw-esc');
  await click('draw-undo'); await snap('draw-undo');
  await click('undo'); await snap('undo-draw-undo');
  await click('draw-clear'); await snap('draw-clear');
  await click('undo'); await snap('undo-clear');

  // Back to Auto with the drawn wall layered on, and the "+ Add" augment.
  await setVal('fin-mode', 'auto'); await snap('auto-with-drawn');
  await click('augment-toggle'); await snap('augment-on');
  await click('augment-toggle'); await snap('augment-off');

  // Strength arrow + layer view.
  await click('load-up'); await snap('load-up');
  await click('load-right'); await snap('load-right');
  await click('load-suggest'); await snap('load-suggest');
  await click('load-clear'); await snap('load-clear');
  await setVal('show-layers', true); await snap('layers-on');

  // Lay the most camera-facing (-y) face flat, then undo it.
  await click('lay-face'); await snap('lay-armed');
  await clickFace(`(sf) => { const n = sf.topo.nrm; let b = 0, bv = -Infinity;
    for (let f = 0; f < sf.topo.nFaces; f++) { const s = -n[f * 3 + 1]; if (s > bv) { bv = s; b = f; } }
    return b; }`);
  await snap('laid');
  await click('undo'); await snap('undo-lay');

  // Suggest orientation.
  await click('suggest-orient'); await sleep(1500); await snap('suggest');
  await page.evaluate(() => document.querySelector('#suggest-list button:nth-child(2)')?.click());
  await snap('suggest-2');
  await click('suggest-toggle'); await snap('suggest-collapsed');
  await click('rot-reset'); await snap('rot-reset');

  // Fins off / on, threshold, build volume, then a run of undos.
  await click('fins-toggle'); await snap('fins-off');
  await click('fins-toggle'); await snap('fins-on-again');
  await setVal('thr', '55', 'input'); await snap('thr-55');
  await setVal('volume', 'custom'); await snap('vol-custom');
  await setVal('vx', '100', 'input'); await snap('vol-100');
  for (let i = 0; i < 6; i++) await click('undo');
  await snap('undo-x6');
} catch (err) {
  errors.push(`harness: ${err.message}`);
}

if (args.out) Deno.writeTextFileSync(args.out, JSON.stringify({ model, steps, errors }, null, 1));
log(`${steps.length} steps, ${errors.length} error(s)${errors.length ? '\n' + errors.join('\n') : ''}`);
await browser.close();
await server.shutdown();
Deno.exit(errors.length ? 1 : 0);
