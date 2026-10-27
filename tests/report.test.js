// "Something didn't get supported?" (local issue 064, web/report.js): the settings
// JSON a user files carries everything the build read, so the part + the JSON
// rebuild the same fins headless. Pinned here:
//   - the round trip: a build from a page-like request (a pose, Full coverage's
//     island starts, settings off their defaults) and the replay of its JSON, after
//     a JSON.stringify/parse and with the engine put back to its defaults in
//     between, give the same triangles;
//   - a report against another file (scaled, or another mesh) refuses, not guesses;
//   - the issue link fills the form's fields and the JSON in it parses back whole.

import { MODELS, WEB, assert, readSTL, fins, prop } from './_util.js';

const { reportSettings, reportPart, replayReport, reportCoverage, reportUrl, REPORT } = await import(`${WEB}report.js`);
const { buildTopology, analyze } = await import(`${WEB}overhangs.js`);
const { findIslands } = await import(`${WEB}islands.js`);
const { FIN, PAD, applyTunables, buildFins } = fins;
const { PROP } = prop;

const stl = (name) => readSTL(Deno.readFileSync(`${MODELS}${name}.stl`));
const raw = stl('portal');
// a pose the page could hold: tipped 30 degrees about X then 20 about Z (column-major)
const rotOf = (ax, az) => {
  const [c, s, C, S] = [Math.cos(ax), Math.sin(ax), Math.cos(az), Math.sin(az)];
  // Rz * Rx
  const m = [[C, -S * c, S * s], [S, C * c, -C * s], [0, s, c]];
  return [m[0][0], m[1][0], m[2][0], m[0][1], m[1][1], m[2][1], m[0][2], m[1][2], m[2][2]];
};
const ROT = rotOf(Math.PI / 6, Math.PI / 9);
// lowledge at Y45 has an island start (tests/islands.test.js): Full coverage walls it
const RY45 = [Math.SQRT1_2, 0, -Math.SQRT1_2, 0, 1, 0, Math.SQRT1_2, 0, Math.SQRT1_2];
const CASES = { auto: { pos: raw, rot: ROT }, full: { pos: stl('lowledge'), rot: RY45 } };

// the page's request (ui/finbuild.js finOpts), with settings off their defaults
const DEFAULTS = { roundFeet: false, padH: FIN.padH, padGrab: PAD.grab, padStyle: PAD.style,
                   padCustom: { ...PAD.custom }, propGap: PROP.gap, iface: PROP.iface };
const pageOpts = (mode) => ({
  mode, bedPad: true, plateOnly: false, longWalls: true, separateWalls: false, tallRibs: true,
  curvedWalls: undefined, tines: true, tineDensity: 0.6, layerHeight: 0.2,
  coverage: mode === 'full' ? FIN.coverDefault : 0.7, sway: undefined,
  tunables: { ...DEFAULTS, roundFeet: true, propGap: 0.25, padStyle: 'sure' },
});

const sameTris = (a, b) => a.length === b.length && a.every((p, i) => p.every((v, k) => v === b[i][k]));

function pageBuild(mode, scale = 1) {
  const { pos, rot } = CASES[mode];
  const p = reportPart(pos, scale);
  const topo = buildTopology({ getAttribute: (k) => (k === 'position' ? { array: p } : null) });
  const res = analyze(topo, 45, rot);
  const opts = pageOpts(mode);
  if (mode === 'full') opts.islands = findIslands(topo, res, rot);
  const built = buildFins(topo, res, rot, opts);
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[i + k]); hi[k] = Math.max(hi[k], p[i + k]); }
  const rep = reportSettings({ threshold: 45, rot, opts, scale, size: lo.map((v, k) => hi[k] - v), faces: p.length / 9 });
  return { res, built, rep, opts };
}

for (const mode of ['auto', 'full']) {
  Deno.test(`report: ${mode} -- the JSON + the file rebuild the same fins`, () => {
    try {
      const page = pageBuild(mode);
      assert(page.built.fins.length > 0, 'supports in this pose');
      if (mode === 'full') assert(page.opts.islands.length > 0, 'an island start for Full coverage to find again');
      applyTunables(DEFAULTS);            // the engine as a fresh process has it
      const filed = JSON.parse(JSON.stringify(page.rep));
      assert(!('islands' in filed.opts), 'island starts are vertex ids: buildFins finds them again, not filed');
      const back = replayReport(CASES[mode].pos, filed);
      assert(!back.why, back.why);
      assert(page.built.triangles.length > 0, 'no support triangles to compare');
      for (const k of ['triangles', 'padTriangles']) assert(sameTris(back.built[k], page.built[k]), `${k} differ`);
      assert(JSON.stringify(reportCoverage(back.built, back.res)) === JSON.stringify(reportCoverage(page.built, page.res)),
        'coverage numbers differ');
    } finally { applyTunables(DEFAULTS); }
  });
}

Deno.test('report: a scaled part replays at its scale; another file is refused', () => {
  try {
    const page = pageBuild('auto', 1.5);
    applyTunables(DEFAULTS);
    const back = replayReport(raw, JSON.parse(JSON.stringify(page.rep)));
    assert(!back.why, back.why);
    assert(sameTris(back.built.triangles, page.built.triangles), 'scaled fins differ');
    assert(replayReport(raw, { ...page.rep, scale: 1 }).why?.includes('the part is'), 'wrong size not refused');
    assert(replayReport(stl('arch'), page.rep).why, 'another mesh not refused');
    assert(replayReport(raw, { ...page.rep, v: 99 }).why?.includes('version'), 'unknown version not refused');
  } finally { applyTunables(DEFAULTS); }
});

Deno.test('report: the issue link fills the form and its JSON parses back whole', () => {
  try {
    const page = pageBuild('full');
    const cov = reportCoverage(page.built, page.res);
    const url = new URL(reportUrl(page.rep, cov, { where: 'printfins.com', when: '2026-10-27', drawn: 2 }));
    assert(url.href.length <= REPORT.maxUrl, `link is ${url.href.length} chars`);
    assert(url.href.startsWith(`${REPORT.repo}/issues/new?`), url.href);
    const q = url.searchParams;
    assert(q.get('template') === 'coverage-report.yml', 'template');
    assert(q.get('title') === 'Not supported: Full coverage', q.get('title'));
    assert(JSON.stringify(JSON.parse(q.get('settings'))) === JSON.stringify(page.rep), 'settings JSON changed in the link');
    const sum = q.get('summary');
    for (const s of ['Site: printfins.com (2026-10-27)', 'Mode: Full coverage', 'Walls drawn by hand: 2', 'triangles']) {
      assert(sum.includes(s), `summary lacks "${s}":\n${sum}`);
    }
    // the form's field ids are the ones the link fills
    const form = Deno.readTextFileSync(new URL('../.github/ISSUE_TEMPLATE/coverage-report.yml', import.meta.url));
    for (const id of ['summary', 'settings']) assert(form.includes(`id: ${id}`), `form has no ${id} field`);
    // a request too big for a link keeps the summary and points at Copy settings
    const big = { ...page.rep, opts: { ...page.rep.opts, pad: 'x'.repeat(REPORT.maxUrl) } };
    const cut = new URL(reportUrl(big, cov, { where: 'printfins.com', when: '2026-10-27' }));
    assert(cut.href.length <= REPORT.maxUrl && cut.searchParams.get('settings').includes('Copy settings'), 'long link not cut');
  } finally { applyTunables(DEFAULTS); }
});

// the links and their tooltips are on the page in every language the site has
Deno.test('report: the links are translated in every locale', async () => {
  const keys = ['Something didn’t get supported?', 'Copy settings', 'Copied', 'Copy failed',
    'Opens a GitHub issue filled in with this build’s settings and numbers (not your model: attach it there if you can)',
    'Copy this build’s settings as JSON: with the model, they rebuild exactly these supports'];
  const page = Deno.readTextFileSync(new URL('../web/index.html', import.meta.url))
    + Deno.readTextFileSync(new URL('../web/ui/report.js', import.meta.url));
  for (const k of keys) assert(page.includes(k), `the page no longer says "${k}": update this list`);
  for (const lang of ['nl', 'de', 'pt', 'zh', 'ar']) {
    const { default: dict } = await import(`../web/i18n/${lang}.js`);
    for (const k of keys) assert(dict[k] && dict[k] !== k, `${lang}: untranslated "${k}"`);
  }
});
