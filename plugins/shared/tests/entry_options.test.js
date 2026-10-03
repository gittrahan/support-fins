// The entry's material / pad / cutout options: a plugin picking PETG, a pad style or
// a wall cutout gets what the website builds with the same picks.
//
//   deno test --allow-read plugins/shared/tests/
import { computeFins, ENGINE_DEFAULTS } from '../engine/fins_entry.js';
import { readSTL, MODELS, analyze, fins, rotY, assert, isClosed } from '../../../tests/_util.js';
import { buildTopology, IDENTITY3 } from '../../../web/overhangs.js';
import { MATERIAL } from '../../../web/materials.js';
import { PROP } from '../../../web/prop.js';
import { PERP } from '../../../web/fins/wedges.js';
import { CUT } from '../../../web/cutout.js';
import { SWAY } from '../../../web/sway.js';

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
  // site and the entry differ by a few tines whatever the material.
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
// build here has applied a profile. The entry's default (PLA) must BE those numbers,
// or a retune in web/fins/config.js etc. that skips materials.js would silently
// leave every plugin on the old value.
Deno.test('PLA profile = the engine\'s built-in clearances', () => {
  const pla = MATERIAL.pla;
  const pairs = [['FIN.padH', fins.FIN.padH, pla.padH],
                 ['PAD.grab', fins.PAD.grab, pla.padGrab], ['PROP.gap', PROP.gap, pla.propGap],
                 ['PERP.gap', PERP.gap, pla.propGap], ['SWAY.gap', SWAY.gap, pla.propGap],
                 ['PAD.style', fins.PAD.style, ENGINE_DEFAULTS.padStyle], ['CUT.pattern', CUT.pattern, ENGINE_DEFAULTS.cutout]];
  for (const [name, engine, profile] of pairs) assert(engine === profile, `${name} is ${engine}, the plugins' default ${profile}`);
});

Deno.test('defaults are PLA, Auto pad, no cutout: the website defaults', () => {
  assert(ENGINE_DEFAULTS.material === 'pla' && ENGINE_DEFAULTS.padStyle === 'auto'
         && ENGINE_DEFAULTS.cutout === 'none', 'defaults moved');
  const plain = computeFins(PART, OPTS).triangles;
  const explicit = computeFins(PART, { ...OPTS, material: 'pla', padStyle: 'auto', cutout: 'none' }).triangles;
  assert(same(plain, explicit), 'spelling out the defaults changed the fins');
});

Deno.test('PETG: same fins as the website builds for PETG, and not PLA\'s', () => {
  try {
    const pla = computeFins(PART, OPTS);
    const petg = computeFins(PART, { ...OPTS, material: 'petg', padStyle: 'sure' });
    assert(!same(pla.triangles, petg.triangles), 'PETG built PLA\'s geometry');
    // The website: the same posed part, with the tunables ui/finbuild.js sends for PETG.
    // Compared vertex by vertex, not by counts -- PLA and PETG place the same walls and
    // tines on this part; only the clearances move (Sure hold, so padH and padGrab show).
    const m = MATERIAL.petg, topo = topoOf(centred(PART));
    const web = flat(fins.buildFins(topo, analyze(topo, 45, IDENTITY3), IDENTITY3, { ...OPTS,
      tunables: { padH: m.padH, padGrab: m.padGrab, propGap: m.propGap,
                  padStyle: 'sure', cutout: 'none' } }));
    assert(web.length === petg.triangles.length, `${petg.triangles.length / 9} vs site ${web.length / 9} triangles`);
    let worst = 0;
    for (let i = 0; i < web.length; i++) worst = Math.max(worst, Math.abs(web[i] - petg.triangles[i]));
    assert(worst < 1e-4, `PETG fins are ${worst} mm off the site's`);
  } finally { resetPla(); }
});

Deno.test('one engine, many calls: PETG never leaks into the next PLA build', () => {
  try {
    const before = computeFins(PART, OPTS).triangles;
    const petg1 = computeFins(PART, { ...OPTS, material: 'petg', padStyle: 'sure', cutout: 'diamond' }).triangles;
    const after = computeFins(PART, OPTS).triangles;
    const petg2 = computeFins(PART, { ...OPTS, material: 'petg', padStyle: 'sure', cutout: 'diamond' }).triangles;
    assert(same(before, after), 'PLA after PETG differs from PLA before it');
    assert(same(petg1, petg2), 'PETG differs between two calls');
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
  // lbracket @Y35 at twice the size gets fins, sway braces AND a pad (review, 018): the
  // braces must slot in between without disturbing either neighbour.
  const big = PART.map((v) => v * 2);
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

Deno.test('sway braces take the material\'s clearances; a null from the host is unset', () => {
  try {
    const bar = Float64Array.from(readSTL(Deno.readFileSync(`${MODELS}bar.stl`)));  // upright: braced
    const petg = (sway) => computeFins(bar, { ...OPTS, material: 'petg', sway: { on: true, ...sway } });
    const byMaterial = petg({});
    assert(byMaterial.stats.swayBraces >= 1, `no sway braces on the bar (${byMaterial.stats.swayReason})`);
    assert(same(byMaterial.triangles, petg({ gap: null }).triangles),
           'gap: null dropped the braces off PETG\'s numbers');
    const plaBraces = petg({ gap: MATERIAL.pla.propGap });
    assert(!same(byMaterial.triangles, plaBraces.triangles), 'PETG braces built with PLA\'s gap');
  } finally { resetPla(); }
});

Deno.test('unknown material / pad style / cutout is refused, not silently PLA', () => {
  for (const bad of [{ material: 'abs' }, { padStyle: 'custom' }, { cutout: 'stars' }]) {
    let threw = false;
    try { computeFins(PART, { ...OPTS, ...bad }); } catch { threw = true; }
    assert(threw, `accepted ${JSON.stringify(bad)}`);
  }
});
