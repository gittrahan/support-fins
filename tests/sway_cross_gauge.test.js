import { block, blockTopo, analyze, assert, assertClose, isClosed, isOriented,
  insideCount, fins, prop, readSTL } from './_util.js';
import { swayAtFace, buildSwayBraces } from '../web/sway.js';
import { braceCrossRib } from '../web/prop/brace.js';
import { applyNozzle, applyWallLines } from '../web/nozzle.js';
import { writeBinarySTL } from '../web/stl.js';
import { writeThreeMF, readThreeMF } from '../web/threemf.js';
const ID = [1,0,0,0,1,0,0,0,1];
const post = () => blockTopo(-80,80,-60,60,0,1000);
const side = topo => Array.from({length:topo.nFaces},(_,f)=>f).find(f=>topo.nrm[3*f+1]<-.9);
const span = values => Math.max(...values)-Math.min(...values);

Deno.test('Sway Cross: actual brace gauge and flange margin at small/large nozzles and wall counts', () => {
  const topo=post(), result=analyze(topo,45,ID), face=side(topo);
  try {
    for(const nozzle of [0.2,0.4,0.8,1.6,2]) for(const lines of [2,4,8]) {
      applyNozzle(nozzle);applyWallLines(lines);
      const opts={full:true,tines:true,layerHeight:0.6};
      const plain=swayAtFace(topo,result,ID,face,[0,-60,1000],opts);
      const r=swayAtFace(topo,result,ID,face,[0,-60,1000],{...opts,crossAbove:100,crossRise:0.5});
      assert(plain.ok && r.ok,r.reason??plain.reason);
      assert(r.cross===2,`${nozzle}/${lines}: cross count ${r.cross}`);
      assert(r.tines===plain.tines && r.th===plain.th && r.height===plain.height,'main brace changed');
      const extra=r.tris.slice(plain.tris.length);
      assert(isClosed(extra) && isOriented(extra),'cross solids open or reversed');
      assert(insideCount(topo,ID,result.offset,extra.map(v=>[v[0],v[1],Math.max(v[2],0.001)]))===0);
      for(let i=0;i<2;i++) {
        const arm=r.arms[i], body=extra.slice(i*60,i*60+24), foot=extra.slice(i*60+24,(i+1)*60);
        assertClose(arm.th,r.th,1e-9,'collision record uses a narrower gauge');
        // A -Y face: its cross arms run along X. Undo the outer edge's lean
        // before measuring the extrusion width in Y.
        const lean=(r.levels.at(-1).b[1]-r.levels[0].b[1])/r.height;
        assertClose(span(body.map(v=>v[1]-lean*v[2])),r.th,1e-6,'body gauge');
        assertClose(span(foot.map(v=>v[1]-lean*v[2])),r.th+2*(prop.PROP.footMin-prop.PROP.th/2),1e-6,'flange margin');
      }
    }
  } finally { applyNozzle(0.4);applyWallLines(2); }
});

Deno.test('Sway Cross: thicker rib rechecks part and neighbouring supports, without changing global wall gauge', () => {
  const before=JSON.stringify(prop.PROP), obstacle=block(0.2,0.8,2,2.5,10,20);
  const thin=[], thick=[];
  assert(braceCrossRib(thin,obstacle,[0,0,0],[1,0],0,200,30,[0,0],()=>true,0.5,1));
  assert(braceCrossRib(thick,obstacle,[0,0,0],[1,0],0,200,30,[0,0],()=>true,0.5,6)===null,
    'wide body ignores the part beyond the old gauge');
  assert(thick.length===0);
  let checks=0;
  assert(braceCrossRib([],new Float32Array(),[0,0,0],[1,0],0,200,30,[0,0],mesh=>{
    checks++;assert(span(mesh.map(v=>v[1]))>6,'neighbour check sees the old narrow mesh');return false;
  },0.5,6)===null);
  assert(checks>0 && JSON.stringify(prop.PROP)===before,'global wall settings changed');
});

Deno.test('Sway Cross: metre-high worker ownership, contact material and STL/3MF export', async () => {
  const topology=post(),result=analyze(topology,45,ID);
  const opts={mode:'auto',tines:true,layerHeight:0.6,
    sway:{on:true,crossAbove:100,crossRise:0.5},tunables:{nozzle:0.8,wallLines:2,iface:'all'}};
  const worker=new Worker(new URL('../web/finworker.js',import.meta.url).href,{type:'module'});
  try {
    const wire={...topology};delete wire._insideGrid;
    const reply=await new Promise((resolve,reject)=>{
      worker.onmessage=({data})=>resolve(data);worker.onerror=e=>reject(new Error(e.message));
      worker.postMessage({id:1,topology:wire,result,rot:ID,opts});
    });
    assert(!reply.error,reply.error);
    const b=reply.built;
    assert(JSON.stringify(b.triangles)===JSON.stringify(fins.buildFins(topology,result,ID,opts).triangles));
    const sway=buildSwayBraces(topology,result,ID,{...opts.sway,tines:true,layerHeight:0.6});
    assert(sway.count>0 && sway.ribs.every(r=>r.cross===2 && r.arms.every(a=>a.th===r.th)),'worker lost cross gauge');
    const claims=new Uint8Array(b.triangles.length);
    for(const f of b.fins) for(const [lo,hi] of f.triRanges) {
      assert(isClosed(b.triangles.slice(lo,hi)),'removal splits a cross solid');
      for(let i=lo;i<hi;i++) claims[i]++;
    }
    assert(claims.every(n=>n===1),'unowned or multiply-owned cross geometry');
    const {body,iface}=prop.splitInterface(b.triangles);
    assert(isClosed(body) && isClosed(iface) && isOriented(body) && isOriented(iface));
    assert(iface.length/36===b.sway.tines,'contact tags lost');
    const stl=new Uint8Array(await writeBinarySTL(b.triangles).arrayBuffer());
    assert(readSTL(stl).length===b.triangles.length*3);
    const part=Array.from({length:topology.pos.length/3},(_,i)=>Array.from(topology.pos.slice(i*3,i*3+3)));
    const data=new Uint8Array(await (await writeThreeMF(part,body,'synthetic-post',{separate:true,iface})).arrayBuffer());
    const restored=await readThreeMF(data);
    assert(restored.objects[1].positions.length===b.triangles.length*3,'3MF loses cross geometry');
  } finally { worker.terminate();fins.applyTunables({iface:false,nozzle:0.4,wallLines:2}); }
});
