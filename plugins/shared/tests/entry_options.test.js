// The entry's material / pad / cutout options: a plugin picking PETG, a pad style or
// a wall cutout gets what the website builds with the same picks.
//
//   deno test --allow-read plugins/shared/tests/
import { computeFins, ENGINE_DEFAULTS } from '../engine/fins_entry.js';
import { readSTL, MODELS, analyze, fins, rotY, assert, isClosed } from '../../../tests/_util.js';
import { buildTopology, IDENTITY3 } from '../../../web/overhangs.js';
import { MATERIAL } from '../../../web/materials.js';

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
  const o = new Float64Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    o[i] = pos[i] - (x0 + x1) / 2; o[i + 1] = pos[i + 1] - (y0 + y1) / 2; o[i + 2] = pos[i + 2] - z0;
  }
  return o;
}
const PART = posedLbracket(...PLATE);
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const tri = (a) => { const v = []; for (let i = 0; i < a.length; i += 3) v.push([a[i], a[i + 1], a[i + 2]]); return v; };
// The engine keeps the clearances as module state, shared with every other test file
// in this process: put PLA back after anything that builds PETG.
const resetPla = () => computeFins(PART, OPTS);

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
    const petg = computeFins(PART, { ...OPTS, material: 'petg' });
    assert(!same(pla.triangles, petg.triangles), 'PETG built PLA\'s geometry');
    // The website: the same posed part, with the tunables ui/finbuild.js sends for PETG.
    const m = MATERIAL.petg, topo = topoOf(centred(PART));
    const web = fins.buildFins(topo, analyze(topo, 45, IDENTITY3), IDENTITY3, { ...OPTS,
      tunables: { tineBite: m.tineBite, padH: m.padH, padGrab: m.padGrab, propGap: m.propGap,
                  padStyle: 'auto', cutout: 'none' } });
    assert(petg.stats.braces === web.braceCount, `fin count ${petg.stats.braces} vs ${web.braceCount}`);
    assert(Math.abs(petg.stats.tines - web.tines) <= 3, `tines ${petg.stats.tines} vs ${web.tines}`);
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
  const light = computeFins(PART, { ...OPTS, padStyle: 'light' });
  const sure = computeFins(PART, { ...OPTS, padStyle: 'sure' });
  const fin = (r) => r.triangles.subarray(0, r.stats.finTriangles * 9);
  const pad = (r) => r.triangles.subarray(r.stats.finTriangles * 9);
  assert(same(fin(light), fin(sure)), 'pad style moved the fins');
  assert(!same(pad(light), pad(sure)), 'Light and Sure hold built the same pad');
  assert(isClosed(tri(pad(sure))), 'Sure hold pad is not closed');
});

Deno.test('cutout: holes in the walls, still closed solids', () => {
  const solid = computeFins(PART, OPTS);
  const cut = computeFins(PART, { ...OPTS, cutout: 'diamond' });
  assert(cut.stats.braces === solid.stats.braces, 'cutout changed the fin count');
  assert(cut.stats.finTriangles > solid.stats.finTriangles, 'no holes cut');
  assert(isClosed(tri(cut.triangles.subarray(0, cut.stats.finTriangles * 9))), 'cut walls are not closed');
});

Deno.test('unknown material / pad style / cutout is refused, not silently PLA', () => {
  for (const bad of [{ material: 'abs' }, { padStyle: 'custom' }, { cutout: 'stars' }]) {
    let threw = false;
    try { computeFins(PART, { ...OPTS, ...bad }); } catch { threw = true; }
    assert(threw, `accepted ${JSON.stringify(bad)}`);
  }
});
