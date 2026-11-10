import { buildSwayBraces, swayAtFace, swayClashesWall } from '../web/sway.js';
import { block, blockTopo, buildTopology, analyze, assert, assertClose, isClosed,
  isOriented, fins, prop, insideCount, readSTL } from './_util.js';
import { writeBinarySTL } from '../web/stl.js';
import { writeThreeMF, readThreeMF } from '../web/threemf.js';
const ID = [1,0,0,0,1,0,0,0,1];
const post = () => blockTopo(-80,80,-60,60,0,1000);
const opts = { tines:true, layerHeight:0.6, reach:0.15 };
const side = (topo, ny, y) => Array.from({length:topo.nFaces},(_,i)=>i)
  .find((i)=>topo.nrm[i*3+1]*ny > 0.9 && Math.abs(topo.pos[i*9+1]-y)<1e-6);

Deno.test('Sway depth: default/off is identical; opt-in reaches 5/15/50% with the original gauge and grip', () => {
  const topo=post(), result=analyze(topo,45,ID);
  const legacy=buildSwayBraces(topo,result,ID,opts);
  const off=buildSwayBraces(topo,result,ID,{...opts,uncappedDepth:false});
  assert(JSON.stringify(off)===JSON.stringify(legacy), 'off changes legacy geometry');
  for (const reach of [0.05,0.15,0.5]) {
    const b=buildSwayBraces(topo,result,ID,{...opts,reach,uncappedDepth:true});
    assert(b.count>=2 && isClosed(b.triangles) && isOriented(b.triangles));
    for (const r of b.ribs) {
      assertClose(r.depth,r.height*reach,1e-6);
      assert(r.tines>=3 && r.th===2.4, 'gauge or minimum grip changed');
    }
  }
  for (const r of legacy.ribs) assertClose(r.depth,60,1e-6);
  const short=blockTopo(-20,20,-15,15,0,150), res=analyze(short,45,ID);
  assert(JSON.stringify(buildSwayBraces(short,res,ID,opts))===
    JSON.stringify(buildSwayBraces(short,res,ID,{...opts,uncappedDepth:true})), 'short brace unnecessarily changes');
});

Deno.test('Sway depth: expanded Draw foot still refuses a wall beyond the old 60 mm footprint', () => {
  const topo=post(), result=analyze(topo,45,ID), face=side(topo,-1,-60);
  const normal=swayAtFace(topo,result,ID,face,[0,-60,1000],opts);
  const full=swayAtFace(topo,result,ID,face,[0,-60,1000],{...opts,uncappedDepth:true});
  assert(normal.ok && full.ok);
  const p=full.foot[0].map((v,i)=>v+0.85*(full.foot[1][i]-v));
  const wall=[[p[0]-10,p[1],0],[p[0]+10,p[1],0]];
  assert(!swayClashesWall(normal,[wall]) && swayClashesWall(full,[wall]));
  const blocked=swayAtFace(topo,result,ID,face,[0,-60,1000],{...opts,uncappedDepth:true},{walls:[wall]});
  assert(!blocked.ok && /would fuse/.test(blocked.reason), 'expanded foot ignores existing wall');
});

Deno.test('Sway depth: deeper braces facing across a channel still refuse overlapping supports', () => {
  const pos=Float32Array.from([...block(-40,40,-160,-100,0,1000),...block(-40,40,100,160,0,1000)]);
  const topo=buildTopology({getAttribute:()=>({array:pos})}), result=analyze(topo,45,ID);
  const a=side(topo,1,-100), b=side(topo,-1,100), full={...opts,uncappedDepth:true};
  const first=swayAtFace(topo,result,ID,a,[0,-100,1000],full);
  assert(first.ok, first.reason);
  const across=swayAtFace(topo,result,ID,b,[0,100,1000],full,[first]);
  assert(!across.ok && /another brace/.test(across.reason), 'opposing deeper braces overlap');
});

Deno.test('Sway depth: a model obstacle in the expanded footprint is still rejected', () => {
  const pos=Float32Array.from([...block(-80,80,-60,60,0,1000),...block(-5,5,-200,-170,0,50)]);
  const topo=buildTopology({getAttribute:()=>({array:pos})}), result=analyze(topo,45,ID), face=side(topo,-1,-60);
  assert(swayAtFace(topo,result,ID,face,[0,-60,1000],opts).ok, 'control brace is blocked');
  const full=swayAtFace(topo,result,ID,face,[0,-60,1000],{...opts,uncappedDepth:true});
  assert(!full.ok && typeof full.reason==='string', 'expanded brace passes through obstacle');
});

Deno.test('Sway depth: an overhead shoulder shortens the rib and recomputes depth from its actual height', () => {
  const pos=Float32Array.from([...block(-80,80,-60,60,0,1000),...block(-8,8,-150,-60,300,310)]);
  const topo=buildTopology({getAttribute:()=>({array:pos})}), result=analyze(topo,45,ID), face=side(topo,-1,-60);
  const r=swayAtFace(topo,result,ID,face,[0,-60,400],{...opts,reach:0.5,uncappedDepth:true});
  assert(r.ok, r.reason);
  assert(r.height<300 && r.height>200, 'shoulder did not shorten the rib');
  assertClose(r.depth,r.height*0.5,1e-6,'depth still uses original part height');
});

Deno.test('Sway depth: real Auto worker switches full depth on/off without retaining it', async () => {
  const topology=post(), result=analyze(topology,45,ID);
  const worker=new Worker(new URL('../web/finworker.js',import.meta.url).href,{type:'module'});
  try {
    let id=0;
    for (const uncappedDepth of [true,false,true]) {
      const requestOpts={mode:'auto',tines:true,layerHeight:0.6,
        sway:{on:true,reach:0.15,uncappedDepth},tunables:{iface:false}};
      const wireTopo={...topology};
      delete wireTopo._insideGrid; // The page omits its function-valued ray cache too.
      const reply=await new Promise((resolve,reject)=> {
        worker.onmessage=({data})=>resolve(data);worker.onerror=(e)=>reject(new Error(e.message));
        worker.postMessage({id:++id,topology:wireTopo,result,rot:ID,opts:requestOpts});
      });
      assert(!reply.error,reply.error);
      assert(reply.built.sway.count>=2);
      const records=reply.built.fins.filter(r=>r.kind==='sway');
      assert(records.length>=2);
      for (const r of records) {
        assert(Number.isFinite(r.length),'worker omitted measured brace depth');
        assertClose(r.length,uncappedDepth?r.height*0.15:60,1e-6);
      }
      assert(JSON.stringify(reply.built.triangles)===
        JSON.stringify(fins.buildFins(topology,result,ID,requestOpts).triangles), 'worker geometry differs');
    }
  } finally { worker.terminate(); }
});

Deno.test('Sway depth: metre-high ownership, interface clearance and STL/3MF export remain intact', async () => {
  const topo=post(), result=analyze(topo,45,ID);
  const b=fins.buildFins(topo,result,ID,{mode:'auto',tines:true,layerHeight:0.6,
    sway:{on:true,uncappedDepth:true},tunables:{iface:'all'}});
  const claims=new Uint8Array(b.triangles.length);
  for (const f of b.fins) for (const [lo,hi] of f.triRanges) {
    assert(isClosed(b.triangles.slice(lo,hi)), 'removal range loses part of the brace');
    for(let i=lo;i<hi;i++)claims[i]++;
  }
  assert(claims.every(n=>n===1),'unowned or multiply-owned geometry');
  const {body,iface}=prop.splitInterface(b.triangles);
  assert(isClosed(body) && isClosed(iface) && isOriented(body) && isOriented(iface));
  // Probe just above the coplanar plate face, where ray parity is unambiguous.
  assert(insideCount(topo,ID,result.offset,body.map(v=>[v[0],v[1],Math.max(v[2],0.001)]))===0,
    'brace body enters the post');
  assert(iface.length/36===b.sway.tines,'tine interface tags lost');
  const stl=new Uint8Array(await writeBinarySTL(b.triangles).arrayBuffer());
  assert(readSTL(stl).length===b.triangles.length*3);
  const part=Array.from({length:topo.pos.length/3},(_,i)=>Array.from(topo.pos.slice(i*3,i*3+3)));
  const data=new Uint8Array(await (await writeThreeMF(part,body,'synthetic-post',{separate:true,iface,
    session:{v:1,form:{'full-brace-depth':true}}})).arrayBuffer());
  const restored=await readThreeMF(data);
  assert(restored.session.form['full-brace-depth']===true);
  assert(restored.objects[1].positions.length===b.triangles.length*3,'3MF loses support geometry');
  fins.applyTunables({iface:false});
});
