/**
 * "Something didn't get supported?" (local issue 064): a report a user files from
 * the page, so a bare overhang reaches us with the build that left it bare -- not
 * one model at a time, written from scratch, with no settings.
 *
 * Two pieces, both pure (no DOM), so a test can pin them:
 *   - the settings JSON: everything the build read -- the overhang threshold, the
 *     pose, the scale and the exact request the page sent buildFins (ui/finbuild.js
 *     finOpts, tunables included). With the user's STL it rebuilds the same fins
 *     headless (replayReport), as the page's Worker built them.
 *   - the GitHub new-issue link: the coverage-report form, filled in from it. No
 *     mesh goes in the link; the form asks for the file and a screenshot.
 */
import { analyze, buildTopology } from './overhangs.js';
import { buildFins } from './fins.js';
import { scaleAbout } from './scale.js';

export const REPORT = {
  v: 1,
  repo: 'https://github.com/gittrahan/support-fins',
  template: 'coverage-report.yml',
  // GitHub refuses a longer new-issue link; past it the JSON stays on the clipboard
  // (Copy settings) and the form asks for it instead
  maxUrl: 8000,
};

const r6 = (v) => Math.round(v * 1e6) / 1e6;

/**
 * The settings JSON for a build: `rot` the 3x3 pose (column-major, rotM3.elements),
 * `opts` the request buildFins got, `scale` the part's scale (1 = as loaded),
 * `size` its box in mm and `faces` its triangle count -- the replay checks both, so
 * a report against the wrong file says so rather than building something else.
 * The Full coverage island starts are left out: buildFins finds them itself when
 * none are passed (the page finds them only because its Worker has no vertex ids).
 */
export function reportSettings({ threshold, rot, opts, scale = 1, size, faces }) {
  const { islands, ...rest } = opts;
  return {
    v: REPORT.v,
    threshold,
    rot: [...rot],
    scale,
    part: { size: size.map(r6), faces },
    opts: JSON.parse(JSON.stringify(rest)),
  };
}

/**
 * The part as the page builds on it, from the file's triangles (`pos`, flat xyz):
 * centred on its box (ui/part.js setPart), and at `scale`, scaled about that centre
 * and centred again (ui/scale.js). Float32, as the page's geometry is.
 */
export function reportPart(pos, scale = 1) {
  let p = centred(Float32Array.from(pos));
  if (scale !== 1) p = centred(scaleAbout(p, scale, [0, 0, 0]));
  return p;
}

function boxOf(p) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) { if (p[i + k] < lo[k]) lo[k] = p[i + k]; if (p[i + k] > hi[k]) hi[k] = p[i + k]; }
  }
  return { lo, hi };
}
function centred(p) {
  const { lo, hi } = boxOf(p);
  const c = lo.map((v, k) => (v + hi[k]) / 2);
  const out = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) out[i + k] = p[i + k] - c[k];
  return out;
}

const SIZE_TOL = 0.05;   // mm, as a saved session's (ui/session.js)

/**
 * Rebuild a report's fins from the file's triangles: { topo, res, built }, or
 * { why } when the file isn't the one reported (another size or triangle count).
 * The same calls the page makes: analyze(topo, threshold, rot), then buildFins
 * with the reported request.
 */
export function replayReport(pos, rep) {
  if (rep?.v !== REPORT.v) return { why: `report version ${rep?.v}, this replays ${REPORT.v}` };
  const p = reportPart(pos, rep.scale ?? 1);
  const faces = p.length / 9;
  if (faces !== rep.part.faces) return { why: `${faces} triangles, the report has ${rep.part.faces}` };
  const { lo, hi } = boxOf(p);
  const size = lo.map((v, k) => hi[k] - v);
  if (size.some((v, k) => Math.abs(v - rep.part.size[k]) > SIZE_TOL)) {
    return { why: `the part is ${size.map((v) => v.toFixed(2)).join(' x ')} mm, the report's ${rep.part.size.join(' x ')}` };
  }
  const topo = buildTopology({ getAttribute: (k) => (k === 'position' ? { array: p } : null) });
  const res = analyze(topo, rep.threshold, rep.rot);
  return { topo, res, built: buildFins(topo, res, rep.rot, rep.opts) };
}

/**
 * The numbers a report leads with, from a build and its analysis: what was placed,
 * and what is still bare (the readout's own figures, ui/readout.js).
 */
export function reportCoverage(built, res) {
  const ba = built.bare, fl = built.fill;
  const n = (v) => (Number.isFinite(v) ? Math.round(v) : undefined);
  return {
    overhangs: res.regions.length,
    supports: built.fins.length,
    braces: built.braceCount, props: built.propCount, tines: built.tines,
    swayBraces: built.sway?.count,
    bareArea: n(ba?.area), redArea: n(ba?.total),
    barePct: ba?.total ? Math.round(100 * ba.area / ba.total) : undefined,
    fillWalls: fl?.walls, fillBare: n(fl?.unservedArea), fillCapped: fl?.capped || undefined,
    islandsBare: fl?.islandsBare,
    unserved: built.unserved || undefined,
    smallHoles: built.smallHoleRegions || undefined,
    floating: built.floating?.length || undefined,
    pad: built.pad ? (built.pad.style ?? 'on') : 'off',
  };
}

const MODES = { auto: 'Auto', full: 'Full coverage', draw: 'Draw', prop: 'Props' };
const line = (k, v) => (v === undefined ? null : `${k}: ${v}`);

/**
 * The new-issue link: the coverage-report form with its fields filled. `where` is
 * the site the report came from (printfins.com, or a preview, which names its
 * branch) and `when` the date, which with the history on main names the build.
 * `drawn` and `removed`: walls drawn by hand and fins removed by hand. Neither is
 * in the JSON (the form asks for the exported 3MF, which carries both: ui/session.js).
 */
export function reportUrl(rep, cov, { where, when, drawn = 0, removed = 0 }) {
  const mode = MODES[rep.opts.mode] ?? rep.opts.mode;
  const summary = [
    line('Site', `${where} (${when})`),
    line('Mode', mode),
    line('Overhangs', cov.overhangs),
    // Draw places no walls itself: the hand-drawn count below is its tally
    rep.opts.mode === 'draw' ? null : line('Supports placed', cov.supports),
    drawn ? line('Walls drawn by hand', drawn) : null,
    removed ? line('Fins removed by hand', removed) : null,
    cov.redArea !== undefined && rep.opts.mode !== 'draw' ? line('Still bare', `${cov.bareArea} of ${cov.redArea} mm² (${cov.barePct} %)`) : null,
    line('Full coverage could not reach', cov.fillBare !== undefined ? `${cov.fillBare} mm²` : undefined),
    line('Island starts left bare', cov.islandsBare),
    line('Too shallow for a fin', cov.unserved),
    line('Small holes left for bridging', cov.smallHoles),
    line('Loose pieces', cov.floating),
    line('Part as loaded', `${rep.part.size.map((v) => v.toFixed(1)).join(' x ')} mm, ${rep.part.faces} triangles`
      + (rep.scale !== 1 ? `, at ${+(rep.scale * 100).toFixed(2)} %` : '')),
  ].filter(Boolean).join('\n');
  const q = (fields) => `${REPORT.repo}/issues/new?${new URLSearchParams({
    template: REPORT.template, title: `Not supported: ${mode}`, ...fields })}`;
  const full = q({ summary, settings: JSON.stringify(rep) });
  return full.length <= REPORT.maxUrl ? full
    : q({ summary, settings: 'Too long for the link: click "Copy settings" on the site and paste them here.' });
}
