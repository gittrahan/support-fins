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
const change = async (id, value) => {
  await page.evaluate((id, value) => {
    const e = document.getElementById(id);
    if (e.type === 'checkbox') e.checked = value; else e.value = value;
    e.dispatchEvent(new Event('change', { bubbles: true }));
  }, id, value);
  await settle();
};
async function open(fallback = false) {
  page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  if (fallback) await page.evaluateOnNewDocument(() => {
    const Worker = window.Worker;
    window.Worker = class extends Worker {
      constructor(url, opts) {
        if (String(url).endsWith('/materialworker.js')) throw new Error('test: unavailable export worker');
        super(url, opts);
      }
    };
  });
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
async function download(cdp, tag) {
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
  let filename;
  cdp.once('Browser.downloadWillBegin', (e) => { filename = e.suggestedFilename; });
  await page.evaluate(() => { document.getElementById('export').click(); document.getElementById('export-3mf').click(); });
  await done;
  const bytes = await Deno.readFile(`${out}/${filename}`), path = `${out}/${tag}.3mf`;
  await Deno.rename(`${out}/${filename}`, path);
  const archive = await unzip(bytes), xml = new TextDecoder().decode(archive.get('3D/3dmodel.model'));
  const config = new TextDecoder().decode(archive.get('Metadata/Slic3r_PE_model.config')) + xml;
  return { path, xml, config, read: await readThreeMF(bytes) };
}
try {
  let cdp = await open();
  await change('iface', 'tines');
  const first = await download(cdp, 'tines-worker');
  assert(first.config.includes(' tines"') && !first.config.includes('top interfaces'), 'tines-only parts');
  assertEquals(first.read.objects.length, 2, 'materials must remain parts of the support object');
  await change('iface', 'all'); await change('separate-tines', true);
  const all = await download(cdp, 'all-worker');
  assert(all.config.includes('support bodies') && all.config.includes('top interfaces') && all.config.includes(' tines"'));
  assertEquals(all.read.objects.length, 2);
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
  cdp.off('Browser.downloadWillBegin', started);
  assert(!unexpectedDownload, 'failed material export downloaded a partial file');
  console.log('PASS worker downloads, three roles, undo, resin suppression, five locales, old/new session reload and visible failure without download');
  await page.close();
  cdp = await open(true); await change('iface', 'tines');
  const inline = await download(cdp, 'tines-inline');
  assertEquals(inline.xml, first.xml, 'inline geometry differs from worker');
  console.log('PASS inline fallback and identical exported model XML');
  assertEquals(errors, []);
} finally { await browser.close(); await server.shutdown(); }
