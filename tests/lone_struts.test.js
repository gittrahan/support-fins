// #121: an isolated narrow strut needs the same longitudinal route as one in a
// net. Down-slope tracks can cross its width and disappear as short fragments.
import { buildTopology, analyze, fins, assert, isClosed, isOriented } from './_util.js';
import { solidClearance } from '../web/inside.js';
import { welds } from '../web/prop/clearance.js';
import { loneStrut } from '../web/prop/lattice.js';
import { lastResortWalls } from '../web/fins/shortwalls.js';

const I = [1,0,0,0,1,0,0,0,1];
// Closed L-profile extrusion with a slope ACROSS the beam, not down its length.
export function strut({ height = 24, width = 3, length = 24, angle = 0, mirror = false } = {}) {
  const xs = [-length - 3, -length, 0], zs = [0, height, height + 3], t = [];
  const solid = (x,z) => x >= 0 && x < 2 && z >= 0 && z < 2 && (x === 0 || z === 1);
  const q = (a,b,c,d) => t.push(a,b,c,a,c,d);
  for (let x = 0; x < 2; x++) for (let z = 0; z < 2; z++) {
    if (!solid(x,z)) continue;
    const a = xs[x], b = xs[x+1], lo = zs[z], hi = zs[z+1], y = width/2;
    q([a,-y,lo],[b,-y,lo],[b,-y,hi],[a,-y,hi]); q([b,y,lo],[a,y,lo],[a,y,hi],[b,y,hi]);
    if (!solid(x-1,z)) q([a,y,lo],[a,-y,lo],[a,-y,hi],[a,y,hi]);
    if (!solid(x+1,z)) q([b,-y,lo],[b,y,lo],[b,y,hi],[b,-y,hi]);
    if (!solid(x,z-1)) q([a,y,lo],[b,y,lo],[b,-y,lo],[a,-y,lo]);
    if (!solid(x,z+1)) q([a,-y,hi],[b,-y,hi],[b,y,hi],[a,y,hi]);
  }
  const c = Math.cos(angle*Math.PI/180), s = Math.sin(angle*Math.PI/180);
  const out = t.map(([x,y,z]) => {
    z += 0.4*y; if (mirror) x = -x;
    return [c*x-s*y, s*x+c*y, z];
  });
  if (mirror) for (let i = 0; i < out.length; i += 3) [out[i+1],out[i+2]] = [out[i+2],out[i+1]];
  return Float32Array.from(out.flat());
}
const topoOf = pos => buildTopology({getAttribute: () => ({array: pos})});
const options = {mode: 'auto', tines: false, bedPad: false};
const build = (topo, extra = {}) => fins.buildFins(topo, analyze(topo,45,I), I, {...options, ...extra});

Deno.test('lone strut: cross-sloped beam gains a closed, clear wall, including rotated and mirrored copies', () => {
  for (const angle of [0,37,90]) for (const mirror of [false,true]) {
    const pos = strut({angle,mirror}), topo = topoOf(pos), res = analyze(topo,45,I);
    const source = Array.from({length:pos.length/3}, (_,i) => Array.from(pos.slice(3*i,3*i+3)));
    assert(isClosed(source) && isOriented(source), 'fixture is not an outward closed solid');
    const before = build(topo,{loneStruts:false}), after = build(topo);
    if (angle === 0) assert(!before.props.length, 'fixture no longer reproduces the missing wall');
    assert(after.props.length > 0 && after.unserved === 0, `beam left bare at ${angle}, mirror=${mirror}`);
    assert(isClosed(after.triangles) && isOriented(after.triangles), 'invalid support shell');
    const hit = solidClearance(topo,I,res.offset,after.triangles,0.25);
    // Measure the complete solid against the existing top/flank acceptance,
    // rather than treating the nominal vertical gap as a Euclidean distance.
    assert(!hit || !welds(hit), `wall violates existing clearance: ${JSON.stringify(hit)}`);
  }
});

Deno.test('lone strut: broad served faces and short tall toothpicks keep their existing result', () => {
  for (const spec of [{width:12}, {height:80,length:6}, {width:1,length:6}]) {
    const topo = topoOf(strut(spec)), a = build(topo,{loneStruts:false}), b = build(topo);
    assert(JSON.stringify(a.triangles) === JSON.stringify(b.triangles), `guard changed: ${JSON.stringify(spec)}`);
  }
  assert(!loneStrut([[0,0],[0,0],[0,0]]), 'degenerate footprint accepted');
  assert(!loneStrut([[0,0],[20,0],[20,20],[0,20]]), 'broad face accepted');
});

Deno.test('lone strut: an existing support still prevents a conflicting last-resort wall', () => {
  const topo = topoOf(strut()), res = analyze(topo,45,I), first = build(topo);
  assert(first.props.length > 0);
  const blocked = lastResortWalls(topo,res,I,options,[],[],first.triangles);
  assert(blocked.triangles.length === 0 && blocked.props.length === 0, 'duplicated an existing wall');
});
