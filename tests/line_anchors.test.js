// #119: bottom and side clearances are independent of top gap.
import { assert, block, isClosed, prop, fins, buildTopology, analyze } from './_util.js';
import { drawnWall } from '../web/draw.js';
import { drawWall } from '../plugins/shared/engine/draw_entry.js';
import { computeFins, ENGINE_DEFAULTS } from '../plugins/shared/engine/fins_entry.js';
import { placeLine } from '../web/prop/place.js';
import { bottomAnchors, AnchorContactError } from '../web/prop/anchors.js';
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
  const plate = [-2, 2].map(x => ({p:[x,0,35],bot:0}));
  assert(bottomAnchors(plate).length === 0, 'plate-only anchors required model geometry');
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

function subdivide(source, depth) {
  if (!depth) return source;
  const out = [], mid = (a,b) => a.map((v,k) => (v+b[k])/2);
  for (let i=0; i<source.length; i+=9) {
    const a=source.slice(i,i+3),b=source.slice(i+3,i+6),c=source.slice(i+6,i+9);
    const ab=mid(a,b),bc=mid(b,c),ca=mid(c,a);
    out.push(...a,...ab,...ca,...ab,...b,...bc,...ca,...bc,...c,...ab,...bc,...ca);
  }
  return subdivide(out, depth-1);
}

Deno.test('line anchors: completed Auto and Full retain gap-only walls on all-skipped and mixed floors without losing ordinary diagnostics', () => withSettings(() => {
  const floor=block(-10,10,-6,6,0,3), roof=block(-10,10,-6,6,17,20);
  const fine=[...subdivide(floor,4),...roof];
  const other=[...floor,...roof].map((v,i) => i%3 === 0 ? v+45 : v);
  for (const mode of ['auto','full']) {
    const opts={mode,nozzle:0.8,tines:false,padStyle:'off',bottomAnchors:true,diagnostics:true};
    const all=computeFins(new Float64Array(fine),opts);
    const off=computeFins(new Float64Array(fine),{...opts,bottomAnchors:false});
    assert(all.stats.anchorsSkipped > 0 && same(all.triangles,off.triangles), `${mode}: gap-only walls changed`);
    assert(all.stats.anchorsSkipped === all.stats.braces + all.stats.props, `${mode}: counts attempts instead of retained walls`);
    assert(all.stats.unserved === off.stats.unserved && all.stats.floating === off.stats.floating, 'ordinary diagnostics lost');
    const mixed=computeFins(new Float64Array([...fine,...other]),opts);
    assert(mixed.triangles.length && mixed.stats.anchorsSkipped, `${mode}: mixed refusal hidden`);
    assert(mixed.stats.supportCheck, 'anchor warning displaced support-section diagnostics');
    const flat=computeFins(new Float64Array([...floor,...roof]),opts);
    assert(flat.triangles.length && !flat.stats.anchorsSkipped, 'safe floor warned');
    assert(off.triangles.length && !off.stats.anchorsSkipped, 'off setting warned or lost supports');
  }
}));

Deno.test('line anchors: Draw retains its gap-only wall when a finely tessellated floor cannot take anchors', () => withSettings(() => {
  fins.applyTunables({nozzle:0.8,tineDir:'horizontal',bottomGap:0.2,bottomAnchors:true});
  const tris=new Float64Array([...subdivide(block(-10,10,-6,6,0,3),4),...block(-10,10,-6,6,17,20)]);
  const r=drawnWall([-8,0,17],[8,0,17],tris);
  fins.applyTunables({bottomAnchors:false});
  const plain=drawnWall([-8,0,17],[8,0,17],tris);
  assert(r.ok && plain.ok && r.anchorsSkipped === 1, r.reason);
  assert(same(r.tris.flat(),plain.tris.flat()), 'fallback changed gap-only wall');
  const host=drawWall(tris,[-8,0,17],[8,0,17],{nozzle:0.8,tines:false,bottomAnchors:true});
  assert(host.ok && host.stats.anchorsSkipped===1, 'shared Draw adapter lost fallback count');
}));

Deno.test('line anchors: small-tube clearance checks the wall body, preserving validated floor contacts', () => withSettings(() => {
  fins.applyTunables({nozzle:0.4,tineDir:'horizontal',bottomGap:0.2,bottomAnchors:false});
  const partTris = new Float32Array([...block(-10,10,-6,6,0,3),...block(-10,10,-6,6,17,20)]);
  const topo = buildTopology({getAttribute:k => k === 'position' ? {array:partTris} : null});
  const lines = [Array.from({length:17},(_,i) => [i-8,0,17])];
  const run = () => {
    const pass = {topo,rot:IDENTITY3,off:{x:0,y:0,z:0},partTris,opts:{},out:[],props:[],
      skipped:{weld:0},served:new Set(),tally:{tines:0},capAt:()=>null,nextId:0,withTines:false};
    placeLine(lines,0,{smallTube:true,region:0,area:192},pass);
    return pass;
  };
  const plain = run();
  fins.applyTunables({bottomAnchors:true});
  const anchored = run();
  assert(plain.props.length === 1 && anchored.props.length === 1, 'clearance dropped the anchored wall');
  assert(anchored.skipped.weld === 0 && anchored.out.length > plain.out.length, 'no checked anchors');
  assert(same(anchored.out.slice(0,plain.out.length).flat(),plain.out.flat()), 'body changed');
  assert(isClosed(anchored.out), 'open anchored wall');
}));
