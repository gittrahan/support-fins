// SHORT WALLS (issue #121, a headset's ring-and-strut lattice): every strut
// underside was 4-6 mm long, under minSpan, so each one was dropped as a stub and
// half the red printed into air. A wall down to minSpanShort is now kept while it
// stays stocky -- height at most maxShortAspect x its length. A tall short wall is
// a toothpick and is still refused.
import { buildTopology, analyze, fins, assert, block } from './_util.js';
import { PROP } from '../web/prop.js';
import { minSpanFor } from '../web/prop/clearance.js';

const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const topoOf = (...parts) => {
  const n = parts.reduce((s, p) => s + p.length, 0), pos = new Float32Array(n);
  let o = 0;
  for (const p of parts) { pos.set(p, o); o += p.length; }
  return buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
};
// a flat run at surface height z (the wall top sits `gap` under it), stations 1 mm apart
const run = (len, z) => Array.from({ length: len + 1 }, (_, i) => [i, 0, z]);

Deno.test('short walls: minSpanFor relaxes to minSpanShort only for a low wall', () => {
  const need = (len, z) => { const r = run(len, z); return minSpanFor(r, r.map(() => true), false, true); };
  const r0 = run(5, 10);
  assert(minSpanFor(r0, r0.map(() => true)) === PROP.minSpan, 'outside the last resort minSpan holds');
  assert(need(5, 10) === PROP.minSpanShort, `a 10 mm wall needs ${need(5, 10)}`);
  const h = 30 - PROP.gap;
  assert(Math.abs(need(5, 30) - h / PROP.maxShortAspect) < 1e-9, `a 30 mm wall scales with height: ${need(5, 30)}`);
  assert(need(5, 100) === PROP.minSpan, `a 100 mm wall keeps minSpan: ${need(5, 100)}`);
  // the TALLEST station decides: one high end makes the whole run tall
  const r = run(5, 10); r[5][2] = 100;
  assert(minSpanFor(r, r.map(() => true), false, true) === PROP.minSpan, 'the tallest station is what tips');
  assert(minSpanFor(r, r.map(() => true), true, true) === PROP.minSpanTube, 'a small tube keeps its own floor');
});

// A column with a short strut sticking out along +X at height z: the strut's
// underside is 6 x 4 mm, one wall long, under minSpan, and nothing else reaches it.
const strut = (z) => topoOf(block(-4, 4, -4, 4, 0, z + 4), block(4, 10, -2, 2, z, z + 3));
const walls = (topo, lastResort = true) => {
  const res = analyze(topo, 45, I);
  return fins.buildFins(topo, res, I, { mode: 'auto', bedPad: true, lastResort }).props
    .filter((p) => p.line.some((q) => q[0] > 4.5));   // walls under the strut, not the column
};

Deno.test('short walls: a low short strut gets a wall', () => {
  const w = walls(strut(12));
  assert(w.length >= 1, 'a 6 mm strut 12 mm up should get a wall');
  assert(w.every((p) => p.short), 'only the last resort builds it');
  assert(walls(strut(12), false).length === 0, 'without the last resort it is a stub');
  assert(w.every((p) => p.height <= PROP.maxShortAspect * p.span + 1e-6), 'no wall past the aspect cap');
});

Deno.test('short walls: a tall short strut is still refused (no toothpicks)', () => {
  assert(walls(strut(80)).length === 0, 'a 6 mm wall 80 mm tall must not be built');
});
