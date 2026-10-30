// The optional tighter broad phase used by isolated-strut walls must return
// the SAME closest point and distance as the ordinary exact clearance query.
import {assert,blockTopo,rotX} from './_util.js';
import {solidClearance} from '../web/inside.js';

const I=[1,0,0,0,1,0,0,0,1], zero={x:0,y:0,z:0};
function same(topo,rot,off,tris,reach=0.25) {
  const before=solidClearance(topo,rot,off,tris,reach);
  const after=solidClearance(topo,rot,off,tris,reach,true);
  assert(JSON.stringify(after)===JSON.stringify(before), `clearance changed: ${JSON.stringify({before,after})}`);
  return after;
}

Deno.test('strut clearance: tight bounds retain near contacts, crossings, ties and degenerate triangles',()=>{
  const topo=blockTopo(-10,10,-10,10,-10,10);
  for(const gap of [0,0.1,0.249999999,0.25,0.250000001,0.3]) {
    for(const z of [-10-gap,10+gap]) same(topo,I,zero,[[-9,-9,z],[9,-9,z],[0,9,z]]);
  }
  const crossing=[[-10,0,-10.5],[10,0,-9.98],[10,0.5,-10.5]];
  assert(same(topo,I,zero,crossing)?.d<1e-6,'real crossing lost');
  same(topo,I,zero,[[0,0,10.1],[0,0,10.1],[0,0,10.1]]);
  same(topo,I,zero,[[0,0,10.1],[5,0,10.1],[10,0,10.1]]);
  same(topo,I,zero,[[-9,-9,-10.2],[9,-9,-10.2],[0,9,-10.2],[-9,-9,10.2],[0,9,10.2],[9,-9,10.2]]);
});

Deno.test('strut clearance: tight bounds retain rotated end-cap contacts and float-noise ties',()=>{
  const topo=blockTopo(-15,15,-15,15,-15,15);
  for(const k of [0,-35,-29,-20,-12,-7,10]) {
    const a=40*Math.PI/180+k*1e-9,c=Math.cos(a),s=Math.sin(a),rot=[1,0,0,0,c,s,0,-s,c];
    const y=15*c+15*s,ze=15*s-15*c,cap=[];
    for(const x of [-15,-5,5]) {
      cap.push([x,y,ze-25],[x+10,y,ze-25],[x+10,y,ze-0.2],
        [x,y,ze-25],[x+10,y,ze-0.2],[x,y,ze-0.2]);
    }
    assert(same(topo,rot,zero,cap,0.45),'contact lost');
  }
});

Deno.test('strut clearance: deterministic scattered queries agree at different scales and translations',()=>{
  let state=13;
  const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/2**32;};
  for(const scale of [0.01,1,100]) for(const shift of [0,1e6]) {
    const topo=blockTopo(shift-10*scale,shift+10*scale,-10*scale,10*scale,-10*scale,10*scale);
    const rot=rotX(37),off={x:-shift+17,y:23,z:29};
    for(let n=0;n<60;n++) {
      const tris=Array.from({length:3},()=>{
        const x=shift+(random()*24-12)*scale,y=(random()*24-12)*scale,z=(random()*24-12)*scale;
        return [rot[0]*x+rot[3]*y+rot[6]*z+off.x,rot[1]*x+rot[4]*y+rot[7]*z+off.y,rot[2]*x+rot[5]*y+rot[8]*z+off.z];
      });
      same(topo,rot,off,tris,0.25*scale);
    }
  }
});
