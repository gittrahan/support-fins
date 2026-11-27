import { rootedMaterialFixture } from '../material-parts/fixture.js';
/** Browser contact matching: real imports, material colours, downloads, stale
 * previews, worker/inline parity and persistence. Run serially with Chrome checks.
 * CHROME=/path/to/chrome deno run -A prototype/ui-smoke/contact-materials.js --out /existing/temp
 */
import puppeteer from 'npm:puppeteer-core@24';
import { serveDir } from 'jsr:@std/http@1/file-server';
import { assert, assertEquals } from 'jsr:@std/assert';
import { materialFixture } from '../../plugins/cli/tests/_material-fixture.js';
import { unzip, zipDeflate } from '../../web/zip.js';
import { readThreeMF } from '../../web/threemf.js';
const at = Deno.args.indexOf('--out');
if (at < 0 || !Deno.args[at + 1]) throw new Error('--out directory required');
const out = await Deno.realPath(Deno.args[at + 1]), root = new URL('../../', import.meta.url).pathname;
const shape = Float32Array.from((await rootedMaterialFixture()).flat());
const fixture = () => materialFixture({ paint: () => '8', positions: shape, upright: true });
const input = `${out}/painted-source.3mf`;
await Deno.writeFile(input, await fixture());
const prusa = await unzip(await fixture());
prusa.delete('Metadata/model_settings.config');
prusa.delete('Metadata/project_settings.config');
const enc = new TextEncoder(), dec = new TextDecoder();
for (const [name, data] of prusa) {
  if (name.endsWith('.model')) {
    prusa.set(
      name,
      enc.encode(
        dec.decode(data).replace(
          '<model ',
          '<model xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06" ',
        )
          .replaceAll('paint_color=', 'slic3rpe:mmu_segmentation='),
      ),
    );
  }
}
prusa.set('Metadata/Slic3r_PE.config', enc.encode('filament_colour = #FFFFFF;#FFFFFF;#123456\n'));
prusa.set(
  'Metadata/Slic3r_PE_model.config',
  enc.encode(
    '<config><object id="100"><metadata type="object" key="extruder" value="1"/></object></config>',
  ),
);
const prusaInput = `${out}/prusa-source.3mf`;
await Deno.writeFile(
  prusaInput,
  new Uint8Array(
    await (await zipDeflate([...prusa].map(([name, data]) => ({ name, data })))).arrayBuffer(),
  ),
);
const server = Deno.serve(
  { hostname: '127.0.0.1', port: 0, onListen() {} },
  (req) =>
    serveDir(req, {
      fsRoot: root + (new URL(req.url).pathname.startsWith('/models/') ? 'prototype/stress' : 'web'),
      quiet: true,
    }),
);
const browser = await puppeteer.launch({
  executablePath: Deno.env.get('CHROME'),
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1500, height: 1000 },
});
let page, cdp;
const errors = [];
const settle = async () => {
  await new Promise((r) => setTimeout(r, 300));
  await page.waitForFunction(() => !h.build.buildPending(), { timeout: 45000 });
};
const change = async (id, value) => {
  await page.evaluate(
    (id, value) => {
      const e = document.getElementById(id);
      if (e.type === 'checkbox') e.checked = value;
      else e.value = value;
      e.dispatchEvent(new Event('change', { bubbles: true }));
    },
    id,
    value,
  );
  await settle();
};
async function load(path) {
  await (await page.$('#file')).uploadFile(path);
  await page.waitForFunction(() => h.part.part?.geometry.userData.materialField?.regions.length);
  await settle();
}
async function open(inline = false) {
  page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.evaluateOnNewDocument(inline => {
    const Base = Worker;
    window.Worker = class extends Base {
      constructor(url, o) {
        if (inline && String(url).endsWith('/materialworker.js')) throw new Error('test inline');
        super(url, o);
        if (String(url).endsWith('/materialworker.js')) {
          const send = this.postMessage.bind(this);
          this.postMessage = (...args) => setTimeout(() => send(...args), 800);
        }
      }
    };
  }, inline);
  await page.goto(`http://127.0.0.1:${server.addr.port}/?stl=models/cube.stl`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sf?.part);
  await page.evaluate(async () => {
    window.h = {
      part: await import('./ui/part.js'),
      build: await import('./ui/finbuild.js'),
      settings: await import('./ui/settings.js'),
      scene: await import('./ui/scene.js'),
      exp: await import('./ui/export.js'),
      history: await import('./ui/history.js'),
      plates: await import('./ui/plates.js'),
      i18n: await import('./ui/i18n.js'),
    };
  });
  cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: out,
    eventsEnabled: true,
  });
  await load(input);
  await page.evaluate(() => {
    if (!h.settings.finsVisible) document.getElementById('fins-toggle').click();
  });
  await settle();
  await change('match-contact-materials', true);
  await change('material-fallback', '3');
  await change(
    'material-palette',
    JSON.stringify([{ name: 'Body', color: '#0000ff' }, { name: 'Contact', color: '#ff0000' }, {
      name: 'Fallback',
      color: '#ffff00',
    }]),
  );
}
async function preview() {
  await change('show-materials', true);
  try {
    await page.waitForFunction(
      () => h.scene.scene.children.some((m) => m.userData.materialPreview?.role === 'tine'),
      { timeout: 15000 },
    );
  } catch (error) {
    console.log(
      'PREVIEW FAILURE',
      await page.evaluate(() => ({
        status: document.getElementById('material-status').textContent,
        pending: h.build.buildPending(),
        counts: h.build.lastBuilt?.stats,
        visible: h.settings.finsVisible,
      })),
    );
    const replay = await page.evaluate(async () => {
      const g = h.exp.buildExportGeometry(),
        { supportSolidGroups } = await import('./support-materials.js');
      return {
        groups: supportSolidGroups(g.finTris),
        field: g.materialField,
        form: g.materialOptions?.form,
      };
    });
    await Deno.writeTextFile(`${out}/failure-input.json`, JSON.stringify(replay));
    await page.screenshot({ path: `${out}/failure.png` });
    throw error;
  }
}
async function download(tag, during = null) {
  let filename;
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('download timeout')), 45000);
    const progress = (e) => {
      if (e.state === 'completed' || e.state === 'canceled') {
        clearTimeout(timer);
        cdp.off('Browser.downloadProgress', progress);
        e.state === 'completed' ? resolve() : reject(new Error('canceled'));
      }
    };
    cdp.on('Browser.downloadProgress', progress);
  });
  cdp.once('Browser.downloadWillBegin', (e) => filename = e.suggestedFilename);
  await page.evaluate(() => {
    document.getElementById('export').click();
    document.getElementById('export-3mf').click();
  });
  if (during) await during();
  await done;
  const bytes = await Deno.readFile(`${out}/${filename}`), path = `${out}/${tag}.3mf`;
  await Deno.rename(`${out}/${filename}`, path);
  const archive = await unzip(bytes);
  return {
    path,
    bytes,
    archive,
    xml: dec.decode(archive.get('3D/3dmodel.model')),
    read: await readThreeMF(bytes, { withMaterials: true }),
  };
}
try {
  await open();
  await preview();
  const state = await page.evaluate(() =>
    h.scene.scene.children.filter((m) => m.userData.materialPreview).map((m) => ({
      role: m.userData.materialPreview.role,
      filament: m.userData.materialPreview.filament,
      rgb: [...m.geometry.getAttribute('color').array.slice(0, 3)],
    }))
  );
  assert(state.some((p) => p.role === 'body' && p.filament === 1 && p.rgb[2] === 1));
  assert(state.some((p) => p.role === 'tine' && p.filament === 2 && p.rgb[0] === 1));
  await page.evaluate(() => {
    const details = document.getElementById('match-materials-fld').closest('details');
    if (details) details.open = true;
    document.getElementById('material-controls').scrollIntoView();
  });
  await page.screenshot({ path: `${out}/matched-preview.png` });
  const first = await download('matched-worker');
  assertEquals(first.read.objects.length, 2);
  assert(first.xml.includes('tines (filament 2)'));
  const snapshot = await download('matched-snapshot', async () => {
    await page.evaluate(() => {
      h.plates.addPlate();
      const e = document.getElementById('material-palette');
      e.value = JSON.stringify([{ name: 'Changed', color: '#00ff00' }]);
      e.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
  assertEquals(snapshot.xml, first.xml, 'plate switch changed in-flight matched geometry or slots');
  assertEquals(snapshot.read.session, first.read.session, 'plate switch changed captured material session');
  await page.evaluate(() => h.plates.dropEmptyPlate()); await settle();
  // Visibility and an immediately superseded threshold build cannot leave a
  // coloured result from the old analysis on screen.
  await page.evaluate(() => document.getElementById('fins-toggle').click());
  assert(await page.evaluate(() => !h.scene.scene.children.some((m) => m.userData.materialPreview)));
  await page.evaluate(() => document.getElementById('fins-toggle').click());
  await settle();
  await preview();
  await page.evaluate(() => {
    const e = document.getElementById('thr'), old = e.value;
    e.value = '47';
    e.dispatchEvent(new Event('input', { bubbles: true }));
    if (h.scene.scene.children.some((m) => m.userData.materialPreview)) {
      throw new Error('stale threshold preview');
    }
    e.value = old;
    e.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
  await preview();
  const key = await page.evaluate(() => h.part.part.geometry.userData.materialField.key);
  await change('show-materials', false);
  assert(
    await page.evaluate(() =>
      h.part.part.visible && !h.scene.scene.children.some((m) => m.userData.materialPreview)
    ),
  );
  // Mapping edits, undo and a genuinely unresolved contact remain explicit.
  const mapping = JSON.stringify({ [JSON.stringify([key, 'filament:2'])]: '' });
  await change('material-mapping', mapping);
  await preview();
  await page.waitForFunction(() =>
    document.getElementById('material-status').textContent.includes('fallback filament 3')
  );
  assert(
    await page.evaluate(() =>
      h.scene.scene.children.some((m) =>
        m.userData.materialPreview?.role === 'tine' && m.userData.materialPreview.filament === 3
      )
    ),
  );
  await page.evaluate(() => document.getElementById('undo').click());
  await settle();
  await change('material-mapping', '');
  await preview();
  // A pose update removes old colours immediately, then shows newly registered contacts.
  await page.evaluate(async () => {
    const THREE = await import('three');
    h.part.part.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), .37);
    h.part.shade();
  });
  await settle();
  await preview();
  assert(
    await page.evaluate(() =>
      h.scene.scene.children.some((m) =>
        m.userData.materialPreview?.role === 'tine' && m.userData.materialPreview.filament === 2
      )
    ),
  );
  await change('scale-x-pct', '120');
  await preview();
  assert(
    await page.evaluate(() =>
      h.part.part.geometry.userData.materialField.regions.every((r) =>
        r.triangle.flat().every(Number.isFinite)
      )
    ),
  );
  await change('show-materials', false);
  await load(first.path);
  await page.waitForFunction(() =>
    document.getElementById('match-contact-materials').checked &&
    document.getElementById('material-fallback').value === '3'
  );
  await settle();
  assertEquals(await page.evaluate(() => h.part.part.geometry.userData.materialField.key), key);
  await preview();
  const reload = await download('matched-reloaded');
  assert(reload.xml.includes('tines (filament 2)'));
  // Parked plate exports keep captured material settings and compatibility.
  await page.evaluate(() => {
    h.parked = h.plates.currentPlate();
    h.plates.addPlate();
  });
  await change('material-body', '2');
  const parked = await page.evaluate(async () => {
    const [blob] = await h.exp.plate3MF(h.exp.plateGeometry(h.parked));
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  assert(
    dec.decode((await unzip(new Uint8Array(parked))).get('3D/3dmodel.model')).includes(
      'support bodies (filament 1)',
    ),
  );
  await page.evaluate(() => h.plates.switchPlate(0));
  await settle();
  await change('show-materials', false);
  await load(prusaInput);
  await change('material-format', 'prusa2');
  await preview();
  const prusaOut = await download('matched-prusa');
  assert(
    dec.decode(prusaOut.archive.get('Metadata/Slic3r_PE_model.config')).includes(
      'key="extruder" value="2"',
    ),
  );
  for (const lang of ['nl', 'de', 'pt', 'zh', 'ar']) {
    await page.evaluate((lang) => h.i18n.setLanguage(lang), lang);
    assert(
      !await page.$eval(
        '#match-materials-fld',
        (e) => e.textContent.includes('Match contact materials'),
      ),
      lang,
    );
  }
  console.log(
    'PASS actual preview colours, mapped fallback, visibility/threshold invalidation, pose/scale, session and parked plate, Prusa painting, locales and downloads',
  );
  await page.close();
  await open(true);
  const inline = await download('matched-inline');
  assertEquals(inline.xml, first.xml);
  console.log('PASS identical worker/inline assigned geometry');
  assertEquals(errors, []);
} finally {
  await browser.close();
  await server.shutdown();
}
