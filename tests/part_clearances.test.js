// #119: bottom and side clearances are independent of top gap.
import { assert, block, isClosed, prop, fins } from './_util.js';
import { drawnWall } from '../web/draw.js';
import { computeFins } from '../plugins/shared/engine/fins_entry.js';
import { shelf } from '../prototype/calibration/part-contact.js';

const { PROP } = prop;
const model = new Float32Array([...block(-40, 40, -10, 10, 0, 5), ...block(-40, 40, -10, 10, 35, 39)]);
const draw = (tris = model) => drawnWall([-30, 0, 35], [30, 0, 35], tris);
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
function withSettings(fn) {
  const saved = { ...PROP };
  try { fn(); } finally { Object.assign(PROP, saved); }
}
const volume = t => t.reduce((s, a, i) => {
  if (i % 3) return s;
  const b = t[i + 1], c = t[i + 2];
  return s + (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
}, 0);

Deno.test('part contact coupon is one closed outward shelf', () => {
  const pos = shelf(), t = Array.from({length: pos.length / 3}, (_, i) => Array.from(pos.slice(3*i, 3*i+3)));
  assert(isClosed(t) && volume(t) > 0, 'coupon must not depend on slicer mesh repair');
});

Deno.test('part clearances: bottom gap changes only the bottom; plate feet stay seated', () => withSettings(() => {
  for (const gap of [0, 0.1, 0.2, 0.4]) {
    fins.applyTunables({ tineDir: 'horizontal', bottomGap: gap });
    const r = draw();
    assert(r.ok && isClosed(r.tris), r.reason);
    assert(Math.abs(Math.min(...r.tris.map(p => p[2])) - 5 - gap) < 1e-6, `bottom gap ${gap}`);
    assert(Math.abs(Math.max(...r.tris.map(p => p[2])) - 35 + PROP.gap) < 1e-6, 'top gap changed');
    const plate = draw(block(-40, 40, -10, 10, 35, 39));
    assert(plate.ok && Math.min(...plate.tris.map(p => p[2])) === 0, 'plate foot lifted');
  }
}));

Deno.test('part clearances: adapter validates controls and resets them between calls', () => withSettings(() => {
  const opts = { tines: false, bedPad: false };
  const original = computeFins(model, opts).triangles;
  assert(original.length > 0, 'fixture has no supports');
  for (const change of [{ bottomGap: 0.4 }]) {
    const altered = computeFins(model, { ...opts, ...change }).triangles;
    assert(!same(original, altered), `setting did not reach geometry: ${JSON.stringify(change)}`);
    assert(same(original, computeFins(model, opts).triangles), 'settings leaked');
  }
  for (const change of [{ bottomGap: -0.1 }, { bottomGap: 0.5 }, { bottomGap: '0.2' },
    { sideClearance: -1 }, { sideClearance: 2 }, { sideClearance: NaN }]) {
    let error;
    try { computeFins(model, { ...opts, ...change }); } catch (e) { error = e; }
    assert(error, `invalid setting accepted: ${JSON.stringify(change)}`);
  }
}));
