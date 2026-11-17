// #119: bottom and side clearances are independent of top gap.
import { assert, block, isClosed, prop, fins, buildTopology, analyze } from './_util.js';
import { drawnWall } from '../web/draw.js';
import { computeFins, ENGINE_DEFAULTS } from '../plugins/shared/engine/fins_entry.js';
import { shelf } from '../prototype/calibration/part-contact.js';

import { clearances, seatSoup, flatten } from '../plugins/shared/engine/seat.js';
import { IDENTITY3 } from '../web/overhangs.js';

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
    { sideClearance: -1 }, { sideClearance: 0 }, { sideClearance: 0.1 }, { sideClearance: 2 }, { sideClearance: NaN }]) {
    let error;
    try { computeFins(model, { ...opts, ...change }); } catch (e) { error = e; }
    assert(error, `invalid setting accepted: ${JSON.stringify(change)}`);
  }
}));

Deno.test('part clearances: a measured side gap admits or refuses the wall, in the engine and adapter', () => withSettings(() => {
  // The pocket sides are at y=+-1.1. Its one central wall is 1 mm wide:
  // 0.6 mm of measured air admits a 0.35 mm requirement, but not 0.8 mm.
  const pocket = new Float32Array([...block(-20,20,-5,5,0,5), ...block(-20,20,-5,5,15,17),
    ...block(-20,20,-5,-1.1,5,15), ...block(-20,20,1.1,5,5,15)]);
  const { pos } = seatSoup(pocket);
  const topo = buildTopology({getAttribute: () => ({array:pos})});
  const analysis = analyze(topo,45,IDENTITY3);
  for (const mode of ['auto', 'full']) {
    const opts = {...ENGINE_DEFAULTS, mode, tines:false, bedPad:false};
    const original = computeFins(pocket, opts).triangles;
    assert(original.length > 0, `${mode}: missing control wall`);
    const sides = [];
    for (let i=0; i<original.length; i+=3) {
      if (original[i+2] > 5.01 && original[i+2] < 14) sides.push(Math.abs(original[i+1]));
    }
    const measured = 1.1 - Math.max(...sides);
    assert(Math.abs(measured - 0.6) < 1e-6, `${mode}: unexpected flank gap ${measured}`);
    for (const sideClearance of [0.35,0.8,0.35]) {
      const settings = {...opts,sideClearance}, actual = computeFins(pocket,settings).triangles;
      const site = fins.buildFins(topo,analysis,IDENTITY3,{...opts,...clearances(settings)});
      assert(same(actual,flatten(site.triangles)), `${mode}: browser/adapter differ`);
      if (sideClearance > measured) {
        assert(!same(actual, original), `${mode}: side clearance did not change placement`);
        if (mode === 'auto') assert(actual.length === 0, 'Auto retained the wall with insufficient flank clearance');
        // Full may replace the refused Auto wall in its separate fill pass.
      }
      else assert(same(actual,original), `${mode}: default/restore changed geometry`);
    }
    assert(same(computeFins(pocket,opts).triangles, original), 'clearance leaked to next call');
  }
}));

Deno.test('part clearances: a wall standing on the part relaxes down to the 0.2 mm floor', () => withSettings(() => {
  // 0.22 mm beside the wall: past the 0.205 mm weld guard, but inside the old fixed
  // 0.24 mm probe that attached walls kept whatever Side clearance said.
  const pocket = new Float32Array([...block(-20,20,-5,5,0,5), ...block(-20,20,-5,5,15,17),
    ...block(-20,20,-5,-0.72,5,15), ...block(-20,20,0.72,5,5,15)]);
  const opts = {...ENGINE_DEFAULTS, mode:'auto', tines:false, bedPad:false};
  assert(computeFins(pocket, opts).triangles.length === 0, 'default 0.35 mm admitted a 0.22 mm gap');
  const tight = computeFins(pocket, {...opts, sideClearance:0.2}).triangles;
  assert(tight.length > 0, 'Side clearance 0.2 did not admit a 0.22 mm gap');
  for (let i = 0; i < tight.length; i += 3) {
    if (tight[i+2] > 5.01 && tight[i+2] < 14) assert(Math.abs(tight[i+1]) <= 0.72 - 0.2 + 1e-6, 'wall closer than 0.2 mm');
  }
}));
