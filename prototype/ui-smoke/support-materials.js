/** Opt-in material controls, worker export, real downloads and session reload.
 * CHROME=/path/to/chrome deno run -A prototype/ui-smoke/support-materials.js --out /temporary/directory
 * Run serially with the other Chrome checks. Generated files are not fixtures.
 */
import puppeteer from 'npm:puppeteer-core@24';
import { serveDir } from 'jsr:@std/http@1/file-server';
import { assert, assertEquals } from 'jsr:@std/assert';
import { unzip, zipDeflate } from '../../web/zip.js';
import { readThreeMF } from '../../web/threemf.js';
import { SESSION_PART } from '../../web/threemf/common.js';

const arg = Deno.args.indexOf('--out');
if (arg < 0 || !Deno.args[arg + 1]) throw new Error('--out directory required');
const out = await Deno.realPath(Deno.args[arg + 1]);
const root = new URL('../../', import.meta.url).pathname;
const server = Deno.serve({ hostname: '127.0.0.1', port: 0, onListen() {} }, (req) => {
  const models = new URL(req.url).pathname.startsWith('/models/');
  return serveDir(req, { fsRoot: root + (models ? 'prototype/stress' : 'web'), quiet: true });
});
const browser = await puppeteer.launch({ executablePath: Deno.env.get('CHROME'), headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'], defaultViewport: { width: 1400, height: 900 } });
const errors = [];
let page;
const settle = async () => {
  // Range controls debounce for 180 ms; buildPending alone can precede it.
  await new Promise((r) => setTimeout(r, 250));
  await page.waitForFunction(() => !h.build.buildPending(), { timeout: 30000 });
};
const change = async (id, value, event = 'change') => {
  await page.evaluate((id, value, event) => {
    const e = document.getElementById(id);
    if (e.type === 'checkbox') e.checked = value; else e.value = value;
    e.dispatchEvent(new Event(event, { bubbles: true }));
  }, id, value, event);
  await settle();
};
async function open(fallback = false) {
  page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.evaluateOnNewDocument(fallback => {
    const Worker = window.Worker;
    window.Worker = class extends Worker {
      constructor(url, opts) {
        if (fallback && String(url).endsWith('/materialworker.js')) throw new Error('test: unavailable export worker');
        super(url, opts);
        if (String(url).endsWith('/materialworker.js')) {
          const send = this.postMessage.bind(this);
          this.postMessage = (...args) => setTimeout(() => send(...args), 800);
        }
      }
    };
  }, fallback);
  await page.goto(`http://127.0.0.1:${server.addr.port}/?stl=models/cube.stl`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sf?.part);
  await page.evaluate(async () => {
    window.h = { THREE: await import('three'), part: await import('./ui/part.js'), build: await import('./ui/finbuild.js'),
      settings: await import('./ui/settings.js'), exp: await import('./ui/export.js'), i18n: await import('./ui/i18n.js'),
      prop: await import('./prop/config.js'), history: await import('./ui/history.js') };
    h.i18n.setLanguage('en');
    h.part.part.quaternion.setFromAxisAngle(new h.THREE.Vector3(1, 0, 0), 35 * Math.PI / 180);
    h.part.shade();
    document.getElementById('fins-toggle').click();
  });
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: out, eventsEnabled: true });
  await settle();
  return cdp;
}
async function download(cdp, tag, during = null) {
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cdp.off('Browser.downloadProgress', progress); reject(new Error('download timeout')); }, 30000);
    const progress = (e) => {
      if (e.state === 'completed' || e.state === 'canceled') {
        clearTimeout(timer); cdp.off('Browser.downloadProgress', progress);
        e.state === 'completed' ? resolve() : reject(new Error('download canceled'));
      }
    };
    cdp.on('Browser.downloadProgress', progress);
  });
  let filename, starts = 0;
  const count = () => starts++;
  cdp.on('Browser.downloadWillBegin', count);
  cdp.once('Browser.downloadWillBegin', (e) => { filename = e.suggestedFilename; });
  const startedState = await page.evaluate(() => {
    document.getElementById('export').click(); document.getElementById('export-3mf').click();
    const state = [document.getElementById('export-progress').hidden, document.getElementById('export').disabled];
    window.progressPainted = false;
    requestAnimationFrame(() => {
      const status = document.getElementById('export-progress'), r = status.getBoundingClientRect();
      const pointer = status.style.pointerEvents; status.style.pointerEvents = 'auto';
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      window.progressPainted = status.checkVisibility() && r.width > 0 && r.height > 0
        && r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight
        && (top === status || status.contains(top));
      status.style.pointerEvents = pointer;
    });
    document.getElementById('export-3mf').dispatchEvent(new Event('click'));
    return state;
  });
  assertEquals(startedState, [false, true], 'export did not show progress and prevent duplicate actions');
  if (during) await during();
  await done;
  await page.waitForFunction(() => document.getElementById('export-progress').hidden);
  assertEquals(await page.$eval('#export', e => e.disabled), false);
  assert(await page.evaluate(() => window.progressPainted), 'progress did not reach a rendered frame');
  cdp.off('Browser.downloadWillBegin', count);
  assertEquals(starts, 1, 'duplicate download');
  const bytes = await Deno.readFile(`${out}/${filename}`), path = `${out}/${tag}.3mf`;
  await Deno.rename(`${out}/${filename}`, path);
  const archive = await unzip(bytes), xml = new TextDecoder().decode(archive.get('3D/3dmodel.model'));
  const config = new TextDecoder().decode(archive.get('Metadata/Slic3r_PE_model.config')) + xml;
  return { path, filename, archive, xml, config, read: await readThreeMF(bytes) };
}
async function reviewControls(cdp, tag) {
  for (const iface of ['tines', 'all']) {
    await change('iface', iface); await change('separate-tines', true);
    for (const id of ['side-clearance', 'bottom-gap']) {
      const saved = await page.$eval('#' + id, e => e.value);
      await change(id, id === 'side-clearance' ? '.5' : '.3', 'input');
      assertEquals(await page.evaluate(() => [h.prop.PROP.iface, h.prop.PROP.separateTines,
        h.build.activeAdded().some(p => p[4]?.role === 'tine')]), [iface, iface !== 'tines', true], `${id} cleared material selection`);
      await change(id, saved, 'input');
    }
  }
  await change('iface', 'tines'); await change('separate-tines', false);
  await page.evaluate(() => {
    const saved = [...new Set(h.build.activeAdded())].map(p => [p, p[0], p[1]]);
    // A deliberately narrow but still closed export; do not alter source meshes.
    for (const [p] of saved) { p[0] *= .01; p[1] *= .01; }
    window.restoreTines = () => { for (const [p, x, y] of saved) { p[0] = x; p[1] = y; } };
  });
  await download(cdp, `narrow-${tag}`);
  assert(!await page.$eval('#export-warning', e => e.hidden), 'narrow tines exported silently');
  assert((await page.$eval('#export-warning', e => e.textContent)).includes('slicer may omit grip contacts'));
  await page.evaluate(() => window.restoreTines());
  await change('iface', 'off');
  for (const id of ['export-stl', 'export-3mf']) {
    await page.evaluate(id => {
      window.progressSeen = false;
      const e = document.getElementById('export-progress');
      window.observer = new MutationObserver(() => { if (!e.hidden) window.progressSeen = true; });
      window.observer.observe(e, { attributes: true, attributeFilter: ['hidden'] });
      window.originalClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = () => { throw Error('test download failure'); };
      document.getElementById('export').click(); document.getElementById(id).click();
    }, id);
    await page.waitForFunction(() => !document.getElementById('export-error').hidden && !document.getElementById('export').disabled);
    assert(!await page.evaluate(() => window.progressSeen), 'ordinary export showed material preparation');
    const error = await page.$eval('#export-error', e => e.textContent);
    assert(error.includes('Could not export.') && !error.includes('material'), 'ordinary failure showed material advice');
    await page.evaluate(() => { HTMLAnchorElement.prototype.click = window.originalClick; window.observer.disconnect(); });
  }
  await change('iface', 'tines');
}

try {
  let cdp = await open();
  await change('iface', 'tines');
  const first = await download(cdp, 'tines-worker');
  assert(first.config.includes(' tines"') && !first.config.includes('top interfaces'), 'tines-only parts');
  assertEquals(first.read.objects.length, 2, 'materials must remain parts of the support object');
  await reviewControls(cdp, 'worker');
  await change('iface', 'all'); await change('separate-tines', true);
  const all = await download(cdp, 'all-worker');
  assert(all.config.includes('support bodies') && all.config.includes('top interfaces') && all.config.includes(' tines"'));
  assertEquals(all.read.objects.length, 2);
  // The delayed worker must export the clicked snapshot even if the user
  // changes controls and switches to another plate before partitioning completes.
  const snapshot = await download(cdp, 'snapshot-worker', async () => {
    await page.evaluate(async () => {
      h.plates = await import('./ui/plates.js');
      for (const [id, value] of [['nozzle', '0.8'], ['iface', 'off']]) {
        const e = document.getElementById(id); e.value = value;
        e.dispatchEvent(new Event('change', { bubbles: true }));
      }
      h.plates.addPlate();
    });
  });
  assertEquals(snapshot.xml, all.xml, 'edited controls or plate switch changed in-flight geometry');
  assertEquals(snapshot.filename, all.filename, 'edited nozzle changed in-flight filename');
  const savedSnapshot = JSON.parse(new TextDecoder().decode(snapshot.archive.get(SESSION_PART)));
  const savedAll = JSON.parse(new TextDecoder().decode(all.archive.get(SESSION_PART)));
  assertEquals(savedSnapshot, savedAll, 'edited controls changed in-flight session');
  await page.evaluate(() => h.plates.switchPlate(0)); await settle();
  await change('nozzle', '0.4'); await change('iface', 'all');
  await change('material-format', 'prusa2');
  const prusa = await download(cdp, 'all-prusa');
  assertEquals(prusa.read.objects.length, 2);
  assert(prusa.config.includes('top interfaces') && prusa.config.includes('firstid='));
  // Export-all reads parked plates while another plate's controls are live.
  await page.evaluate(async () => {
    h.plates = await import('./ui/plates.js');
    h.parked = h.plates.currentPlate();
    h.plates.addPlate();
  });
  await change('material-format', 'components');
  const parkedBytes = new Uint8Array(await page.evaluate(async () => {
    const gs = h.exp.plateGeometry(h.parked);
    const [blob] = await h.exp.plate3MF(gs);
    return [...new Uint8Array(await blob.arrayBuffer())];
  }));
  const parked = await unzip(parkedBytes);
  assert(new TextDecoder().decode(parked.get('Metadata/Slic3r_PE_model.config')).includes('firstid='),
    'parked plate used the live plate’s compatibility format');
  await page.evaluate(() => h.plates.switchPlate(0)); await settle();
  assertEquals(await page.$eval('#material-format', (e) => e.value), 'prusa2');
  await change('material-format', 'components');
  await change('separate-tines', false);
  await page.evaluate(() => document.getElementById('undo').click()); await settle();
  assert(await page.$eval('#separate-tines', (e) => e.checked), 'undo restores role selection');
  await change('tine-dir', 'vertical');
  assertEquals(await page.evaluate(() => [h.prop.PROP.separateTines, document.getElementById('separate-tines-fld').hidden]), [false, true]);
  await change('tine-dir', 'horizontal');
  assert(await page.evaluate(() => h.prop.PROP.separateTines), 'return to FDM retains selection');
  for (const lang of ['nl', 'de', 'pt', 'zh', 'ar']) {
    await page.evaluate((lang) => h.i18n.setLanguage(lang), lang);
    const text = await page.$eval('#separate-tines-fld', (e) => e.textContent);
    assert(!text.includes('Separate tine material'), `${lang}: untranslated checkbox`);
    assert(!await page.$eval('#export-progress', e => e.textContent.includes('Preparing support parts')), `${lang}: untranslated progress`);
  }
  await page.evaluate(() => h.i18n.setLanguage('en'));
  await change('iface', 'off'); await change('separate-tines', false);
  await (await page.$('#file')).uploadFile(all.path);
  await page.waitForFunction(() => document.getElementById('iface').value === 'all'
    && document.getElementById('separate-tines').checked, { timeout: 30000 });
  await settle();
  const reload = await download(cdp, 'all-reloaded');
  assert(reload.config.includes('top interfaces') && reload.config.includes(' tines"'));
  // A session from before these controls must not inherit the page's last picks.
  const archive = await unzip(await Deno.readFile(all.path));
  const session = JSON.parse(new TextDecoder().decode(archive.get(SESSION_PART)));
  delete session.form['separate-tines']; delete session.form['material-format'];
  archive.set(SESSION_PART, new TextEncoder().encode(JSON.stringify(session)));
  const legacy = `${out}/legacy-session.3mf`;
  await Deno.writeFile(legacy, new Uint8Array(await (await zipDeflate([...archive].map(([name, data]) => ({ name, data })))).arrayBuffer()));
  await change('material-format', 'prusa2');
  await (await page.$('#file')).uploadFile(legacy);
  await page.waitForFunction(() => !document.getElementById('separate-tines').checked
    && document.getElementById('material-format').value === 'components');
  await settle();
  assert(!await page.evaluate(() => h.build.activeAdded().some((p) => p[4])), 'legacy session retained new roles');
  await change('separate-tines', true);
  let unexpectedDownload = false;
  const started = () => { unexpectedDownload = true; };
  cdp.on('Browser.downloadWillBegin', started);
  await page.evaluate(() => {
    h.build.activeAdded()[0][0] = NaN; // deliberately invalid export, not a source mesh
    document.getElementById('export').click(); document.getElementById('export-3mf').click();
  });
  await page.waitForFunction(() => !document.getElementById('export-error').hidden);
  await page.waitForFunction(() => document.getElementById('export-progress').hidden);
  assertEquals(await page.$eval('#export', e => e.disabled), false, 'failure left export disabled');
  const advice = await page.$eval('#export-error', e => e.textContent);
  assert(advice.includes('Turn off Separate tine material') && advice.includes('Tines only'), 'missing recovery advice');
  // The same actionable, atomic failure through a multi-model plate and
  // Export all plates, including a corrupt parked support result.
  await page.evaluate(async () => {
    h.models = await import('./ui/models.js');
    const geometry = h.part.part.geometry.clone();
    h.models.addSlot(geometry); h.part.setPart(geometry, 'second.stl');
    h.build.refreshFins();
  });
  await settle();
  for (const action of ['export-3mf', 'export-all']) {
    await page.evaluate(action => {
      // A rebuild may legitimately replace a parked result: corrupt its current
      // generated support only after the parked queue has settled.
      const bad = h.plates.currentPlate().models.find(m => m.stash)?.stash;
      if (!bad?.added.length) throw Error('missing parked support fixture');
      bad.added[0][0] = NaN;
      document.getElementById('export-error').hidden = true;
      document.getElementById(action).dispatchEvent(new Event('click'));
    }, action);
    await page.waitForFunction(() => !document.getElementById('export-error').hidden);
    await page.waitForFunction(() => document.getElementById('export-progress').hidden);
    assert((await page.$eval('#export-error', e => e.textContent)).includes('Turn off Separate tine material'));
    assert(!unexpectedDownload, `${action}: failed export downloaded a partial file`);
  }
  cdp.off('Browser.downloadWillBegin', started);
  assert(!unexpectedDownload, 'failed material export downloaded a partial file');
  console.log('PASS worker downloads, three roles, undo, resin suppression, five locales, old/new session reload and visible failure without download');
  await page.close();
  cdp = await open(true); await change('iface', 'tines');
  const inline = await download(cdp, 'tines-inline');
  assertEquals(inline.xml, first.xml, 'inline geometry differs from worker');
  await reviewControls(cdp, 'inline');
  console.log('PASS inline fallback and identical exported model XML');
  assertEquals(errors, []);
} finally { await browser.close(); await server.shutdown(); }
