// #50: a small tube bending in plan is convex around its local lowest line,
// even when one straight fitted axis lies beside part of that line.
import { buildTopology, analyze, fins, block, assert, isClosed, isOriented } from './_util.js';
import { tubeLine } from '../web/prop/tracks.js';
import { curvedTubeLine } from '../web/prop/tubecurve.js';
import { lineBend } from '../web/prop/curved.js';
import { solidClearance } from '../web/inside.js';
import { welds } from '../web/prop/clearance.js';

const I = [1,0,0,0,1,0,0,0,1];
export function rod(bend = 0.04, radius = 1.5, sides = 24) {
  const t = [], rings = [], count = 20;
  for (let j = 0; j <= count; j++) {
    const x = -10+j;
    rings.push(Array.from({length:sides}, (_,k) => {
      const a = 2*Math.PI*k/sides;
      return [x,bend*x*x+radius*Math.cos(a),16+0.1*x+radius*Math.sin(a)];
    }));
  }
  for (let j = 1; j <= count; j++) for (let k = 0; k < sides; k++) {
    const q = (k+1)%sides, a = rings[j-1][k], b = rings[j][k], c = rings[j][q], d = rings[j-1][q];
    t.push(a,c,b,a,d,c);
  }
  for (let k = 0; k < sides; k++) {
    const q = (k+1)%sides;
    t.push([-10,bend*100,15],rings[0][q],rings[0][k],
      [10,bend*100,17],rings.at(-1)[k],rings.at(-1)[q]);
  }
  return t;
}
export function curvedRodModel(angle = 0, mirror = false) {
  const raw = [...block(-13,-9,2.5,5.5,0,15),...rod().flat()];
  const c = Math.cos(angle*Math.PI/180), s = Math.sin(angle*Math.PI/180);
  for (let i = 0; i < raw.length; i += 3) {
    const x = raw[i]*(mirror ? -1 : 1), y = raw[i+1]; raw[i] = c*x-s*y; raw[i+1] = s*x+c*y;
  }
  if (mirror) for (let i = 0; i < raw.length; i += 9) for (let k = 0; k < 3; k++) {
    [raw[i+3+k],raw[i+6+k]] = [raw[i+6+k],raw[i+3+k]];
  }
  const pos = Float32Array.from(raw);
  return buildTopology({getAttribute: () => ({array:pos})});
}
function regionData(topo,res,region = res.regions[0]) {
  const tris = Float64Array.from(region.faces.flatMap(f => Array.from(topo.pos.slice(9*f,9*f+9))));
  const rn = region.faces.map(f => [Array.from(topo.nrm.slice(f*3,f*3+3)),topo.area[f]]), pts = [];
  for (let f = 0; f < tris.length; f += 9) {
    const v = [0,3,6].map(k => Array.from(tris.slice(f+k,f+k+3)));
    pts.push(...v,[0,1,2].map(k => v.reduce((s,p) => s+p[k],0)/3));
  }
  return {tris,rn,pts,region};
}

Deno.test('curved tube: the procedural rod is closed and oriented', () => {
  const tri = rod(); assert(isClosed(tri) && isOriented(tri), 'invalid source cylinder');
});

Deno.test('curved tube: cross-sections recover the bent underside, including rotations and mirroring', () => {
  for (const angle of [0,37,90]) for (const mirror of [false,true]) {
    const topo = curvedRodModel(angle,mirror), res = analyze(topo,45,I);
    const {tris,pts,region} = regionData(topo,res), copy = tris.slice();
    const lines = tubeLine(topo,region.faces,I,pts,tris);
    assert(lines?.length === 1, `no tube line at ${angle}, mirror=${mirror}`);
    assert(lineBend(lines[0]) > 10, 'candidate still follows one straight axis');
    assert(tris.every((v,i) => v === copy[i]), 'source geometry mutated');
    const built = fins.buildFins(topo,res,I,{mode:'auto',bedPad:true,tines:false});
    assert(built.props.length > 0 && built.unserved === 0, `tube left unsupported at ${angle}, mirror=${mirror}`);
    assert(isClosed(built.triangles) && isOriented(built.triangles), 'invalid support shell');
    const hit = solidClearance(topo,I,res.offset,built.triangles,0.25);
    assert(!hit || !welds(hit), `clearance failure: ${JSON.stringify(hit)}`);
  }
});

Deno.test('curved tube: disconnected minima and missing cross-sections are refused', () => {
  const topo = curvedRodModel(), res = analyze(topo,45,I), {tris,rn} = regionData(topo,res);
  const two = Float64Array.from([...tris,...Array.from(tris,(v,i) => i%3 === 1 ? v+10 : v)]);
  assert(curvedTubeLine([...rn,...rn],two,0,0,1,0,-9,9,1) === null, 'joined separate tubes');
  const cut = [], normals = [];
  for (let i = 0; i < tris.length; i += 9) {
    const xs = [tris[i],tris[i+3],tris[i+6]];
    if (Math.min(...xs) >= -1 && Math.max(...xs) <= 2) continue;
    cut.push(...tris.slice(i,i+9)); normals.push(rn[i/9]);
  }
  assert(curvedTubeLine(normals,Float64Array.from(cut),0,0,1,0,-9,9,1) === null, 'bridged a missing surface');
});
