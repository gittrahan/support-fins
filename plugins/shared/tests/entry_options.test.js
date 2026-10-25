// The entry's gap / pad / cutout options: a plugin setting a wider Support gap, a pad
// style or a wall cutout gets what the website builds with the same picks.
//
//   deno test --allow-read plugins/shared/tests/
import { computeFins, ENGINE_DEFAULTS, optionsFromDialog } from '../engine/fins_entry.js';
import { readSTL, MODELS, analyze, fins, rotY, assert, isClosed } from '../../../tests/_util.js';
import { buildTopology, IDENTITY3 } from '../../../web/overhangs.js';
import { MATERIAL } from '../../../web/materials.js';
import { PROP } from '../../../web/prop.js';
import { PERP } from '../../../web/fins/wedges.js';
import { CUT } from '../../../web/cutout.js';
import { SWAY } from '../../../web/sway.js';
import { applyNozzle, applyWallLines } from '../../../web/nozzle.js';

const OPTS = { mode: 'auto', bedPad: true, tines: true, tineDensity: 0, coverage: 0.5, layerHeight: 0.2 };
const PLATE = [137.25, 88.5, 3.0];
const topoOf = (pos) => buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });

// lbracket @Y35, posed and parked on the plate (as a slicer hands it over), plus the
// same posed part centred at the origin (what the website builds on).
function posedLbracket(dx = 0, dy = 0, dz = 0) {
  const pos = readSTL(Deno.readFileSync(`${MODELS}lbracket.stl`)), m = rotY(35);
  const out = new Float64Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    out[i] = m[0] * x + m[3] * y + m[6] * z + dx;
    out[i + 1] = m[1] * x + m[4] * y + m[7] * z + dy;
    out[i + 2] = m[2] * x + m[5] * y + m[8] * z + dz;
  }
  return out;
}
function centred(pos) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    x0 = Math.min(x0, pos[i]); x1 = Math.max(x1, pos[i]);
    y0 = Math.min(y0, pos[i + 1]); y1 = Math.max(y1, pos[i + 1]); z0 = Math.min(z0, pos[i + 2]);
  }
  // ...and snapped to 1 nm exactly as fins_entry.js does: without it, the engine's
  // tine placement moves under the ~1e-13 mm residue (ENGINE-SENSITIVITY.md) and the
  // site and the entry differ by a few tines whatever the gap.
  const snap = (v) => Math.round(v * 1e6) / 1e6;
  const o = new Float64Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    o[i] = snap(pos[i] - (x0 + x1) / 2); o[i + 1] = snap(pos[i + 1] - (y0 + y1) / 2); o[i + 2] = snap(pos[i + 2] - z0);
  }
  return o;
}
const PART = posedLbracket(...PLATE);
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const tri = (a) => { const v = []; for (let i = 0; i < a.length; i += 3) v.push([a[i], a[i + 1], a[i + 2]]); return v; };
// The engine keeps the clearances as module state. Deno gives each test file its own,
// but the tests in THIS file share it: put the defaults back after any build that
// changes them, so a later test here never inherits them.
const resetPla = () => computeFins(PART, OPTS);
const flat = (b) => Float64Array.from([...b.triangles, ...(b.padTriangles || [])].flatMap((v) => [v[0], v[1], v[2]]));

// FIRST in the file on purpose: it reads the engine's built-in numbers before any
// build here has set clearances. The entry's defaults (PLA's pad, the Support gap's
// default) must BE those numbers, or a retune in web/fins/config.js etc. that skips
// materials.js would silently leave every plugin on the old value.
Deno.test('entry defaults = the engine\'s built-in clearances', () => {
  const pla = MATERIAL.pla, gap = ENGINE_DEFAULTS.gap;
  assert(gap === pla.propGap, `default gap ${gap}, PLA's ${pla.propGap}`);
  const pairs = [['FIN.padH', fins.FIN.padH, pla.padH],
                 ['PAD.grab', fins.PAD.grab, pla.padGrab], ['PROP.gap', PROP.gap, gap],
                 ['PERP.gap', PERP.gap, gap], ['SWAY.gap', SWAY.gap, gap],
                 ['PAD.style', fins.PAD.style, ENGINE_DEFAULTS.padStyle], ['CUT.pattern', CUT.pattern, ENGINE_DEFAULTS.cutout]];
  for (const [name, engine, profile] of pairs) assert(engine === profile, `${name} is ${engine}, the plugins' default ${profile}`);
});

Deno.test('defaults are gap 0.2, Auto pad, no cutout: the website defaults', () => {
  assert(ENGINE_DEFAULTS.gap === 0.2 && ENGINE_DEFAULTS.padStyle === 'auto'
         && ENGINE_DEFAULTS.cutout === 'none', 'defaults moved');
  const plain = computeFins(PART, OPTS).triangles;
  const explicit = computeFins(PART, { ...OPTS, gap: 0.2, padStyle: 'auto', cutout: 'none' }).triangles;
  assert(same(plain, explicit), 'spelling out the defaults changed the fins');
});

Deno.test('nozzle: adapter matches the website at each diameter and resets between calls', () => {
  try {
    const baseline = computeFins(PART, OPTS).triangles;
    for (const nozzle of [0.8, undefined, 0.2, 0.4, 0.6, 0.25, 1, 1.2, 1.4, 1.6, 1.8, 2]) {
      // An unrelated browser/host call may have changed both pieces of state.
      applyNozzle(0.6); applyWallLines(4);
      const actual = computeFins(PART, { ...OPTS, ...(nozzle === undefined ? {} : { nozzle }) });
      const m = MATERIAL.pla, topo = topoOf(centred(PART));
      const expected = Float32Array.from(flat(fins.buildFins(topo, analyze(topo, 45, IDENTITY3), IDENTITY3, {
        ...OPTS, tunables: { nozzle: nozzle ?? 0.4, wallLines: 2, padH: m.padH, padGrab: m.padGrab,
          propGap: 0.2, padStyle: 'auto', cutout: 'none', tineDir: 'horizontal', pinDepth: 0.1 },
      })));
      assert(actual.triangles.length > 0 && same(actual.triangles, expected), `nozzle ${nozzle}: differs from website`);
      if (nozzle === undefined || nozzle === 0.4) assert(same(actual.triangles, baseline), 'default geometry leaked');
      else assert(!same(actual.triangles, baseline), `nozzle ${nozzle} did not change supports`);
      assert(PROP.gap === 0.2, 'nozzle changed the support gap');
    }
  } finally { resetPla(); }
});

Deno.test('nozzle: a host\'s own size is used as is; what the engine can\'t scale to is refused', () => {
  try {
    // A slicer's 0.5 (hostSupplied): its own widths, not 0.4's or 0.6's.
    const half = computeFins(PART, { ...OPTS, nozzle: 0.5 }).triangles;
    for (const other of [0.4, 0.6]) assert(!same(half, computeFins(PART, { ...OPTS, nozzle: other }).triangles), `0.5 built as ${other}`);
    assert(same(half, computeFins(PART, { ...OPTS, ...optionsFromDialog({ nozzle: '0.5' }) }).triangles), 'dialog spelling differs');
  } finally { resetPla(); }
  for (const nozzle of [null, true, [], {}, '', ' ', '0.8mm', 0, -1, 0.05, 2.5, NaN, Infinity]) {
    let error;
    try { computeFins(PART, { nozzle }); } catch (e) { error = e; }
    assert(error?.message.includes('nozzle'), `accepted ${JSON.stringify(nozzle)}`);
  }
});

Deno.test('Separate walls: Auto follows the tine direction, browser parity, ignored in Auto mode', () => {
  const sphere = Float64Array.from(readSTL(Deno.readFileSync(`${MODELS}sphere.stl`)));
  for (let i = 0; i < sphere.length; i++) sphere[i] += PLATE[i % 3];
  try {
    for (const tineDir of ['horizontal', 'vertical']) {
      const opts = { ...OPTS, mode: 'full', tineDir };
      const joined = computeFins(sphere, { ...opts, separateWalls: 'off' }).triangles;
      const apart = computeFins(sphere, { ...opts, separateWalls: 'on' }).triangles;
      assert(!same(joined, apart), `${tineDir}: separation did not reach geometry`);
      // Auto (the default) is the site's rule: on for resin pins, off for FDM
      const auto = computeFins(sphere, opts).triangles;
      assert(same(auto, tineDir === 'vertical' ? apart : joined), `${tineDir}: Auto does not follow the tine direction`);
      assert(same(apart, computeFins(sphere, { ...opts, separateWalls: true }).triangles), 'true is not On');
      assert(same(joined, computeFins(sphere, { ...opts, separateWalls: false }).triangles), 'false is not Off');
      assert(same(auto, computeFins(sphere, opts).triangles), 'separation leaked into next default call');
      const topo = topoOf(centred(sphere)), m = MATERIAL.pla;
      const web = fins.buildFins(topo, analyze(topo, 45, IDENTITY3), IDENTITY3, {
        ...opts, separateWalls: true,
        tunables: { nozzle: 0.4, wallLines: 2, padH: m.padH, padGrab: m.padGrab,
          propGap: 0.2, padStyle: 'auto', cutout: 'none', tineDir, pinDepth: 0.1 },
      });
      assert(web.fill.joined === 0, 'browser joined fill walls with separation enabled');
      assert(same(apart, Float32Array.from(flat(web))), `${tineDir}: adapter differs from browser geometry`);
      const autoMode = computeFins(sphere, { ...opts, mode: 'auto', separateWalls: 'off' }).triangles;
      assert(same(autoMode, computeFins(sphere, { ...opts, mode: 'auto', separateWalls: 'on' }).triangles),
        `${tineDir}: separation changed Auto placement`);
    }
  } finally { resetPla(); }
});

Deno.test('gap 0.3: same fins as the website builds with Support gap 0.3, and not 0.2\'s', () => {
  try {
    const narrow = computeFins(PART, OPTS);
    const wide = computeFins(PART, { ...OPTS, gap: 0.3, padStyle: 'sure' });
    assert(!same(narrow.triangles, wide.triangles), 'gap 0.3 built gap 0.2\'s geometry');
    // The website: the same posed part, with the tunables ui/finbuild.js sends for a
    // 0.3 gap. Compared vertex by vertex, not by counts -- both gaps place the same
    // walls and tines on this part; only the clearance moves.
    const m = MATERIAL.pla, topo = topoOf(centred(PART));
    const web = flat(fins.buildFins(topo, analyze(topo, 45, IDENTITY3), IDENTITY3, { ...OPTS,
      tunables: { padH: m.padH, padGrab: m.padGrab, propGap: 0.3,
                  padStyle: 'sure', cutout: 'none' } }));
    assert(web.length === wide.triangles.length, `${wide.triangles.length / 9} vs site ${web.length / 9} triangles`);
    let worst = 0;
    for (let i = 0; i < web.length; i++) worst = Math.max(worst, Math.abs(web[i] - wide.triangles[i]));
    assert(worst < 1e-4, `gap 0.3 fins are ${worst} mm off the site's`);
  } finally { resetPla(); }
});

Deno.test('one engine, many calls: a wide gap never leaks into the next default build', () => {
  try {
    const before = computeFins(PART, OPTS).triangles;
    const wide1 = computeFins(PART, { ...OPTS, gap: 0.3, padStyle: 'sure', cutout: 'diamond' }).triangles;
    const after = computeFins(PART, OPTS).triangles;
    const wide2 = computeFins(PART, { ...OPTS, gap: 0.3, padStyle: 'sure', cutout: 'diamond' }).triangles;
    assert(same(before, after), 'the default build after gap 0.3 differs from the one before it');
    assert(same(wide1, wide2), 'gap 0.3 differs between two calls');
  } finally { resetPla(); }
});

Deno.test('pad style: Light and Sure hold build different pads, the fins stay put', () => {
  try {
    const light = computeFins(PART, { ...OPTS, padStyle: 'light' });
    const sure = computeFins(PART, { ...OPTS, padStyle: 'sure' });
    const fin = (r) => r.triangles.subarray(0, r.stats.finTriangles * 9);
    const pad = (r) => r.triangles.subarray(r.stats.finTriangles * 9);
    assert(same(fin(light), fin(sure)), 'pad style moved the fins');
    assert(!same(pad(light), pad(sure)), 'Light and Sure hold built the same pad');
    assert(isClosed(tri(pad(sure))), 'Sure hold pad is not closed');
  } finally { resetPla(); }
});

Deno.test('Tines off: plain walls are counted as walls (props), not lost', () => {
  const on = computeFins(PART, OPTS).stats, off = computeFins(PART, { ...OPTS, tines: false }).stats;
  assert(off.tines === 0 && off.braces === 0 && off.props >= 1, JSON.stringify(off));
  assert(on.props === 0 && on.braces >= 1, JSON.stringify(on));
});

Deno.test('sway braces come back as their own block: fins | braces | pad', () => {
  // lbracket at twice the size gets fins, sway braces AND a pad (review, 018): the
  // braces must slot in between without disturbing either neighbour. At Y20, not the
  // file's Y35: with Sway on, free edges past 30deg keep their old rows (a flush end
  // wall would take the braces' column, PROP.edgeFlatDegSway), so at Y35 the fins
  // differ by design; at 20deg both cutoffs agree.
  const raw = readSTL(Deno.readFileSync(`${MODELS}lbracket.stl`)), m = rotY(20);
  const big = new Float64Array(raw.length);
  for (let i = 0; i < raw.length; i += 3) {
    for (let k = 0; k < 3; k++) big[i + k] = 2 * (m[k] * raw[i] + m[3 + k] * raw[i + 1] + m[6 + k] * raw[i + 2]);
  }
  const off = computeFins(big, OPTS), on = computeFins(big, { ...OPTS, sway: { on: true } });
  const s = on.stats;
  assert(off.stats.swayTriangles === 0, 'braces nobody asked for');
  assert(s.swayBraces >= 1 && s.swayTriangles > 0 && s.finTriangles > 0 && s.padTriangles > 0, JSON.stringify(s));
  assert(Number.isInteger(s.swayTriangles), `${s.swayTriangles} brace triangles`);
  const cut = (r, a, b) => r.triangles.subarray(a * 9, b * 9);
  const nOff = off.stats.finTriangles, nOn = s.finTriangles;
  assert(nOn === nOff && same(cut(on, 0, nOn), cut(off, 0, nOff)), 'the fins changed, or braces are counted as fins');
  const padOn = cut(on, nOn + s.swayTriangles, nOn + s.swayTriangles + s.padTriangles);
  assert(same(padOn, cut(off, nOff, nOff + off.stats.padTriangles)), 'the pad block moved: braces filed as pad');
  assert((nOn + s.swayTriangles + s.padTriangles) * 9 === on.triangles.length, 'counts don\'t cover the soup');
});

Deno.test('Sway on keeps its braces on a tilted part (the flush end walls give way, PROP.edgeFlatDegSway)', () => {
  // lbracket @Y35 at twice the size: a flush end wall at the foot of its upright side
  // took the brace's column (1 -> 0) until Sway kept the old rows past 30deg
  const big = PART.map((v) => v * 2);
  const off = computeFins(big, OPTS).stats, on = computeFins(big, { ...OPTS, sway: { on: true } }).stats;
  assert(on.swayBraces >= 1, JSON.stringify(on));
  assert(on.finTriangles < off.finTriangles, `Sway on kept the flush rows: ${on.finTriangles} vs ${off.finTriangles} fin triangles`);
});

Deno.test('pad style Off is bedPad: false', () => {
  const off = computeFins(PART, { ...OPTS, padStyle: 'off' });
  assert(off.stats.padTriangles === 0, 'Off still built a pad');
  assert(same(off.triangles, computeFins(PART, { ...OPTS, bedPad: false }).triangles), 'Off differs from bedPad: false');
});

Deno.test('cutout: holes in the walls, still closed solids', () => {
  try {
    const solid = computeFins(PART, OPTS);
    const cut = computeFins(PART, { ...OPTS, cutout: 'diamond' });
    assert(cut.stats.braces === solid.stats.braces, 'cutout changed the fin count');
    assert(cut.stats.finTriangles > solid.stats.finTriangles, 'no holes cut');
    assert(isClosed(tri(cut.triangles.subarray(0, cut.stats.finTriangles * 9))), 'cut walls are not closed');
  } finally { resetPla(); }
});

Deno.test('sway braces take the Support gap; a null from the host is unset', () => {
  try {
    const bar = Float64Array.from(readSTL(Deno.readFileSync(`${MODELS}bar.stl`)));  // upright: braced
    const wide = (sway) => computeFins(bar, { ...OPTS, gap: 0.3, sway: { on: true, ...sway } });
    const byGap = wide({});
    assert(byGap.stats.swayBraces >= 1, `no sway braces on the bar (${byGap.stats.swayReason})`);
    assert(same(byGap.triangles, wide({ gap: null }).triangles),
           'sway gap: null dropped the braces off the 0.3 Support gap');
    const narrowBraces = wide({ gap: 0.2 });
    assert(!same(byGap.triangles, narrowBraces.triangles), 'braces ignored the 0.3 Support gap');
  } finally { resetPla(); }
});

Deno.test('a bad gap / pad style / cutout, or the old material option, is refused', () => {
  for (const bad of [{ gap: 3 }, { gap: '0.3' }, { material: 'petg' }, { padStyle: 'custom' }, { cutout: 'stars' }]) {
    let threw = false;
    try { computeFins(PART, { ...OPTS, ...bad }); } catch { threw = true; }
    assert(threw, `accepted ${JSON.stringify(bad)}`);
  }
});
