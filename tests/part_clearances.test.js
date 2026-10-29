// #119: bottom clearance and optional line contacts are independent of top gap.
import { assert, block, isClosed, prop, fins } from './_util.js';
import { drawnWall } from '../web/draw.js';
import { bottomAnchors, AnchorContactError } from '../web/prop/anchors.js';
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
    fins.applyTunables({ tineDir: 'horizontal', bottomGap: gap, bottomAnchors: false });
    const r = draw();
    assert(r.ok && isClosed(r.tris), r.reason);
    assert(Math.abs(Math.min(...r.tris.map(p => p[2])) - 5 - gap) < 1e-6, `bottom gap ${gap}`);
    assert(Math.abs(Math.max(...r.tris.map(p => p[2])) - 35 + PROP.gap) < 1e-6, 'top gap changed');
    const plate = draw(block(-40, 40, -10, 10, 35, 39));
    assert(plate.ok && Math.min(...plate.tris.map(p => p[2])) === 0, 'plate foot lifted');
  }
}));

Deno.test('line anchors: closed outward contacts reach the floor and overlap the wall for every nozzle', () => withSettings(() => {
  for (const nozzle of [0.2, 0.4, 0.6, 0.8, 1.0, 2.0]) {
    fins.applyTunables({ nozzle, wallLines: 2, tineDir: 'horizontal', bottomGap: 0.2, bottomAnchors: false });
    const plain = draw();
    fins.applyTunables({ bottomAnchors: true });
    const anchored = draw();
    assert(plain.ok && anchored.ok, `nozzle ${nozzle}: ${anchored.reason}`);
    const contacts = anchored.tris.slice(plain.tris.length);
    assert(contacts.length > 0 && isClosed(contacts), `nozzle ${nozzle}: no closed contacts`);
    assert(same(plain.tris.flat(), anchored.tris.slice(0, plain.tris.length).flat()), 'wall changed');
    for (let i = 0; i < contacts.length; i += 36) {
      const t = contacts.slice(i, i + 36), xs = t.map(p => p[0]), zs = t.map(p => p[2]);
      assert(volume(t) > 0, 'inward contact');
      assert(Math.max(...xs) - Math.min(...xs) >= 2 * nozzle - 1e-6, 'point contact instead of line');
      assert(Math.min(...zs) === 5 && Math.max(...zs) > 5.2 && Math.max(...zs) < 5.4, 'disconnected contact');
    }
  }
}));

Deno.test('line anchors: a hole, a step or missing source geometry cannot become a contact', () => withSettings(() => {
  fins.applyTunables({ nozzle: 0.4, tineDir: 'horizontal', bottomGap: 0.2, bottomAnchors: true });
  const stations = [-2, 2].map(x => ({ p: [x, 0, 35], sx: 0, sy: -1, bot: 5.2, botN: 5.2, botP: 5.2, sh: 0.4, ztip: 33 }));
  const cases = [undefined,
    new Float32Array([...block(-10, -0.05, -10, 10, 0, 5), ...block(0.05, 10, -10, 10, 0, 5)]),
    new Float32Array([...block(-10, 0, -10, 10, 0, 5), ...block(0, 10, -10, 10, 0, 5.1)])];
  for (const tris of cases) {
    let error;
    try { bottomAnchors(stations, tris); } catch (e) { error = e; }
    assert(error instanceof AnchorContactError, 'unsafe contact accepted');
  }
}));

Deno.test('line anchors: resin, zero gap and plate feet retain their existing geometry', () => withSettings(() => {
  for (const tineDir of ['horizontal', 'vertical']) for (const bottomGap of [0, 0.2]) {
    if (tineDir === 'horizontal' && bottomGap > 0) continue;
    fins.applyTunables({ tineDir, bottomGap, bottomAnchors: false });
    const a = draw();
    fins.applyTunables({ tineDir, bottomGap, bottomAnchors: true });
    const b = draw();
    assert(a.ok && b.ok && same(a.tris.flat(), b.tris.flat()), 'inactive anchors changed geometry');
  }
  fins.applyTunables({ tineDir: 'horizontal', bottomGap: 0.2, bottomAnchors: false });
  const a = draw(block(-40, 40, -10, 10, 35, 39));
  fins.applyTunables({ bottomAnchors: true });
  const b = draw(block(-40, 40, -10, 10, 35, 39));
  assert(a.ok && b.ok && same(a.tris.flat(), b.tris.flat()), 'anchors changed plate feet');
}));

Deno.test('line anchors: a sloping floor is followed exactly and an intervening surface refuses the contact', () => withSettings(() => {
  fins.applyTunables({ nozzle: 0.4, tineDir: 'horizontal', bottomGap: 0.2, bottomAnchors: true });
  const stations = [-2, 2].map(x => ({ p: [x, 0, 35], sx: 0, sy: -1, bot: 5.3, botN: 5.3, botP: 5.3, sh: 0.4, ztip: 33 }));
  const floor = Float64Array.from([-10,-10,3, 10,-10,3, 0,10,7]); // z = 5 + 0.2y
  const contact = bottomAnchors(stations, floor);
  assert(isClosed(contact) && volume(contact) > 0);
  for (const p of contact) if (p[2] < 5.3) assert(Math.abs(p[2] - 5 - 0.2*p[1]) < 1e-7, 'bottom left the floor');
  const obstruction = Float64Array.from([...floor, ...block(-0.05,0.05,-1,1,5.1,5.5)]);
  let rejected = false;
  try { bottomAnchors(stations, obstruction); } catch (e) { rejected = e instanceof AnchorContactError; }
  assert(rejected, 'contact crosses an intervening surface');
}));

Deno.test('part clearances: adapter validates controls and resets them between calls', () => withSettings(() => {
  const opts = { tines: false, bedPad: false };
  const original = computeFins(model, opts).triangles;
  assert(original.length > 0, 'fixture has no supports');
  for (const change of [{ bottomGap: 0.4 }, { bottomAnchors: true }]) {
    const altered = computeFins(model, { ...opts, ...change }).triangles;
    assert(!same(original, altered), `setting did not reach geometry: ${JSON.stringify(change)}`);
    assert(same(original, computeFins(model, opts).triangles), 'settings leaked');
  }
  for (const change of [{ bottomGap: -0.1 }, { bottomGap: 0.5 }, { bottomGap: '0.2' },
    { sideClearance: -1 }, { sideClearance: 2 }, { sideClearance: NaN }, { bottomAnchors: 'false' }]) {
    let error;
    try { computeFins(model, { ...opts, ...change }); } catch (e) { error = e; }
    assert(error, `invalid setting accepted: ${JSON.stringify(change)}`);
  }
}));
