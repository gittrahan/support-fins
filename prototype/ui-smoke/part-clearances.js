/** #119: actual worker/inline geometry, history, sessions and translated controls.
 * deno run -A prototype/ui-smoke/part-clearances.js
 */
import puppeteer from 'npm:puppeteer-core@24';
import { serveDir } from 'jsr:@std/http@1/file-server';
import { assert, assertEquals } from 'jsr:@std/assert';
import { shelf } from '../calibration/part-contact.js';

const web = new URL('../../web/', import.meta.url).pathname;
const server = Deno.serve({port: 0, hostname: '127.0.0.1', onListen() {}},
  req => serveDir(req, {fsRoot: web, quiet: true}));
const browser = await puppeteer.launch({
  executablePath: Deno.env.get('CHROME') ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist'],
  defaultViewport: {width: 1400, height: 900},
});
const errors = [], outputs = [];
try {
  for (const inline of [false, true]) {
    const page = await browser.newPage();
    page.on('pageerror', e => errors.push(String(e)));
    if (inline) await page.evaluateOnNewDocument(() => {
      const Native = window.Worker;
      window.Worker = class extends Native {
        constructor(url, opts) {
          if (String(url).endsWith('/finworker.js')) throw Error('test: inline fallback');
          super(url, opts);
        }
      };
    });
    await page.goto(`http://127.0.0.1:${server.addr.port}/`, {waitUntil: 'load'});
    await page.waitForFunction(() => window.__sf);
    await page.evaluate(async pos => {
      window.h = { THREE: await import('three'), part: await import('./ui/part.js'),
        build: await import('./ui/finbuild.js'), settings: await import('./ui/settings.js'),
        history: await import('./ui/history.js'), session: await import('./ui/session.js'),
        i18n: await import('./ui/i18n.js'), mf: await import('./threemf.js') };
      h.i18n.setLanguage('en');
      const geom = new h.THREE.BufferGeometry();
      geom.setAttribute('position', new h.THREE.Float32BufferAttribute(pos, 3));
      h.part.setPart(geom, 'part-contact.stl');
      h.settings.setFinsVisible(true); h.build.refreshFins();
    }, Array.from(shelf()));
    const settle = async () => {
      await new Promise(r => setTimeout(r, 250)); // settings input has a 180 ms debounce
      await page.waitForFunction(() => !h.build.buildPending(), {timeout: 30000});
    };
    const change = async (id, value) => {
      await page.evaluate((id, value) => {
        const e = document.getElementById(id);
        if (e.type === 'checkbox') e.checked = value; else e.value = value;
        e.dispatchEvent(new Event('input', {bubbles: true}));
        e.dispatchEvent(new Event('change', {bubbles: true}));
      }, id, value);
      await settle();
    };
    const mesh = () => page.evaluate(() => JSON.stringify(h.build.finTris));
    await settle();
    const baseline = await mesh();
    assert(baseline.length > 100);
    await change('bottom-gap', '0.3');
    assert(await mesh() !== baseline, 'worker ignored bottom gap');
    await page.evaluate(() => h.history.undo()); await settle();
    assertEquals(await mesh(), baseline, 'undo did not restore geometry');
    await page.evaluate(() => h.history.redo()); await settle();
    assertEquals(await page.$eval('#bottom-gap', e => e.value), '0.3');
    await change('bottom-gap', '0.2');
    await change('bottom-anchors', true);
    const anchored = await mesh();
    assert(anchored !== baseline, 'worker ignored anchors');
    outputs.push(anchored);
    await change('tines', false);
    assertEquals(await page.$eval('#bottom-anchors-fld', e => e.hidden), false, 'anchors depend on tines');
    await change('tines', true);
    await change('tine-dir', 'vertical');
    assertEquals(await page.$eval('#bottom-anchors-fld', e => e.hidden), true);
    const resin = await mesh();
    await change('bottom-anchors', false);
    assertEquals(await mesh(), resin, 'resin geometry changed');
    await change('bottom-anchors', true);
    await change('tine-dir', 'horizontal');
    assertEquals(await mesh(), anchored, 'direction switch lost stored settings');

    const saved = await page.evaluate(async pos => {
      const triples = Array.from({length: pos.length / 3}, (_, i) => pos.slice(i * 3, i * 3 + 3));
      const session = h.session.sessionOf(triples);
      const blob = h.mf.writeThreeMF(triples, h.build.finTris, 'shelf', {separate: true, session});
      return (await h.mf.readThreeMF(new Uint8Array(await blob.arrayBuffer()))).session;
    }, Array.from(shelf()));
    assertEquals(saved.form['bottom-anchors'], true);
    await change('side-clearance', '0.6');
    await change('bottom-gap', '0.3');
    await page.evaluate(s => h.session.restoreSession(s), saved); await settle();
    assertEquals(await mesh(), anchored, '3MF settings round trip changed geometry');
    for (const key of ['bottom-anchors', 'bottom-gap', 'side-clearance']) delete saved.form[key];
    await page.evaluate(s => h.session.restoreSession(s), saved); await settle();
    assertEquals(await mesh(), baseline, 'older session inherited new settings');
    for (const lang of ['nl', 'de', 'pt', 'zh', 'ar']) {
      await page.evaluate(lang => h.i18n.setLanguage(lang), lang);
      for (const id of ['side-clearance', 'bottom-gap', 'bottom-anchors']) {
        const title = await page.$eval(`#${id}-fld`, e => e.title);
        assert(title && !title.startsWith('Clearance beside') && !title.startsWith('Gap between') && !title.startsWith('Add short'), `${lang}: untranslated ${id}`);
      }
    }
    await page.close();
    console.log(`PASS ${inline ? 'inline' : 'worker'}: geometry, history, session, resin and five locales`);
  }
  assertEquals(outputs[0], outputs[1], 'worker and inline differ');
  assertEquals(errors, []);
} finally {
  await browser.close(); await server.shutdown();
}
