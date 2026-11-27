import { assert, assertClose, buildTopology, isClosed, isOriented, block, loadModel, rotX, rotY, analyze } from './_util.js';
import { ledgeFixture, ledgeLine } from './_ledge.js';
import { PROP } from '../web/prop/config.js';
import { CUT } from '../web/cutout.js';
import { applyNozzle, nozzle } from '../web/nozzle.js';
import { moldLine } from '../web/prop/mold.js';
import { sweepBetween } from '../web/prop/sweep.js';
import { seatPartWall, footSeatFrame } from '../web/prop/foot-seat.js';
import { frameSweep } from '../web/prop/turn-frame.js';
import { drawnWall } from '../web/draw.js';
import { drawWall } from '../plugins/shared/engine/draw_entry.js';
import { buildPartAttached } from '../web/prop/attached.js';
import { sectionMesh, sectionAt, bounds, area, difference } from '../web/fins/sections.js';
import { closedTurningMesh as closedMesh } from '../web/prop/turn.js';
import { withLevels } from '../web/prop/levels.js';
import { crestPart } from '../web/prop/crest.js';
import { buildFins } from '../web/fins.js';

const ID = [1,0,0,0,1,0,0,0,1], ZERO = { x:0,y:0,z:0 };
const topo = array => buildTopology({ getAttribute: () => ({ array }) });
function test(name, run) {
  Deno.test(`part ledge: ${name}`, () => {
    const old = {...PROP}, cut = {...CUT}, n = nozzle;
    try { applyNozzle(.4); PROP.footGap=.2; PROP.gap=.2; PROP.iface=false; CUT.pattern='none'; run(); }
    finally { applyNozzle(n); Object.assign(PROP,old); Object.assign(CUT,cut); crestPart(null); }
  });
}
const build = (body, line=ledgeLine(), h=.2) => seatPartWall(moldLine(line,body),body,h);
function checked(r) {
  assert(r.ok && r.route,'missing corrected landing');
  assert(isClosed(r.triangles),'open wall');
  assert(isOriented(r.triangles),'inconsistent wall winding');
  return r;
}

test('closed fixture reproduces a clearance-only ledge and moves the actual footprint onto it',()=>{
  const body=ledgeFixture();assert(closedMesh(Array.from({length:body.length/3},(_,i)=>Array.from(body.slice(i*3,i*3+3)))));
  const mold=moldLine(ledgeLine(),body),original=[];sweepBetween(mold.top,mold.floor,original);
  const old=sectionAt(sectionMesh(original),5.3),r=checked(build(body));
  assert(bounds(old)[0]>0,'control already stands over the ledge');
  const foot=sectionAt(sectionMesh(r.triangles),5.3);
  assert(bounds(foot)[2]<=0,'foot still extends past the ledge');
  assertClose(Math.min(...r.triangles.map(p=>p[2])),5.2,1e-8);
  for(const z of [10,18.5,19.7]){
    const a=sectionAt(sectionMesh(original),z),b=sectionAt(sectionMesh(r.triangles),z);
    assert(area(difference(a,b))+area(difference(b,a))<1e-8,`upper geometry changed at ${z}`);
  }
});

test('extends to a lower landing and does not return through the intervening ledge',()=>{
  const body=ledgeFixture({lower:true}),r=checked(build(body));
  assert(r.route.delta>0,'lower extension chose the ledge side');
  assertClose(Math.min(...r.triangles.map(p=>p[2])),1.2,1e-8);
  assert(r.route.start>=5+PROP.sideClear,'returned before clearing the ledge');
});

test('already seated and welded walls retain exact ordinary geometry',()=>{
  for(const gap of [.2,0]){
    PROP.footGap=gap;
    const body=ledgeFixture(),line=ledgeLine(gap?-1:.6),mold=moldLine(line,body),out=[];
    sweepBetween(mold.top,mold.floor,out);
    const r=seatPartWall(mold,body);
    assert(r.ok&&!r.route&&JSON.stringify(out)===JSON.stringify(r.triangles));
  }
});

test('compound slopes retain the existing foot-tilt policy and their walls and tines',()=>{
  const a=rotY(60),b=rotX(30),rot=Array.from({length:9},(_,i)=>[0,1,2]
    .reduce((s,k)=>s+a[k*3+i%3]*b[Math.floor(i/3)*3+k],0));
  // These existing procedural scenes lost complete walls when mere vertical
  // separation was mistaken for a discrete ledge beyond the foot's reach.
  for(const [name,walls,tines,triangles]of [
    ['lbracket',5,42,3148],['plus',4,30,2140],['portal',8,58,4656],
    ['staircase',6,28,2816],['tshape',4,33,2484],
  ]){
    const topo=loadModel(name),r=buildFins(topo,analyze(topo,45,rot),rot,{mode:'auto',bedPad:true,tines:true,coverage:.5});
    assert(r.fins.length===walls&&r.tines===tines&&r.triangles.length/3===triangles,
      `${name}: existing sloped feet changed (${r.fins.length}, ${r.tines}, ${r.triangles.length/3})`);
  }
});

test('bounded search retains the ordinary wall when no landing fits, with an explicit note',()=>{
  const body=ledgeFixture({narrow:true}),r=build(body);
  assert(r.ok && !r.route && r.seatingSkipped === 1 && r.seatingReason === 'no-landing');
  const mold=moldLine(ledgeLine(),body),ordinary=[];sweepBetween(mold.top,mold.floor,ordinary);
  assert(JSON.stringify(r.triangles) === JSON.stringify(ordinary), 'fallback changed the old wall');
  const draw=drawnWall(ledgeLine()[0],ledgeLine().at(-1),body,0);
  assert(draw.ok && draw.seatingSkipped === 1, 'Draw did not retain and report the old wall');
  const drawMold=moldLine(draw.top,body),drawOrdinary=[];
  sweepBetween(drawMold.top,drawMold.floor,drawOrdinary);
  assert(JSON.stringify(draw.tris) === JSON.stringify(drawOrdinary), 'Draw fallback changed geometry');
  // Widen the recess enough to pass the adapter's existing side-wall check,
  // while keeping its 0.4 mm landing too narrow for this 1 mm wall.
  const wider=Float64Array.from(body,(v,i)=>i%3===0&&v===-.2?-.4:v);
  const shared=drawWall(wider,ledgeLine()[0],ledgeLine().at(-1),{nozzle:.4,tines:false,bottomGap:.2});
  assert(shared.ok && shared.stats.seatingSkipped===1,'shared Draw hid the uncorrected landing: '+JSON.stringify(shared.stats??shared));
});

test('open source sections cannot certify a new lower route',()=>{
  const source=ledgeFixture(),broken=[];
  for(let i=0;i<source.length;i+=9) {
    if([1,4,7].every(k=>source[i+k]>24.9))continue;
    broken.push(...source.slice(i,i+9));
  }
  const r=build(Float64Array.from(broken));
  assert(r.ok && !r.route && r.seatingSkipped === 1,'open source certified a new route');
});

test('automatic keep-clear volumes cannot be used as a lower route',()=>{
  const body=ledgeFixture(),p=block(-5,8,-25,25,0,7);
  const keepClear=Array.from({length:p.length/3},(_,i)=>Array.from(p.slice(i*3,i*3+3)));
  const r=seatPartWall(moldLine(ledgeLine(),body),body,.2,PROP.minHeight,keepClear);
  assert(r.ok && !r.route && r.seatingSkipped === 1,'route entered a protected cavity');
  const out=[],auto=buildPartAttached(ledgeLine(),body,topo(body),ID,ZERO,out,false,.2,keepClear);
  assert(auto.ok && auto.prop.seatingSkipped === 1 && !auto.prop.turnWall?.seating, 'Auto published an excluded route');
  assert(JSON.stringify(out)===JSON.stringify(r.triangles),'Auto changed the ordinary fallback');
});

test('translation, rotation, mirroring and repeat calls preserve local routing',()=>{
  const body=ledgeFixture(),original=checked(build(body));
  assert(JSON.stringify(original)===JSON.stringify(build(body)),'non-deterministic repeat');
  for(const [degrees,mirror] of [[37,false],[90,false],[183,false],[0,true]]){
    const a=degrees*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
    const at=([x,y,z])=>{x*=mirror?-1:1;return [c*x-s*y+30,s*x+c*y-17,z];};
    const points=Array.from({length:body.length/3},(_,i)=>at(Array.from(body.slice(3*i,3*i+3))));
    if(mirror)for(let i=0;i<points.length;i+=3)[points[i+1],points[i+2]]=[points[i+2],points[i+1]];
    const r=checked(build(Float64Array.from(points.flat()),ledgeLine().map(at)));
    assertClose(r.route.delta,original.route.delta*(mirror?-1:1),1e-8);
  }
});

test('nozzle and layer scaling retain a printable-width foot',()=>{
  for(const [n,h] of [[.2,.1],[.4,.2],[.6,.3],[.8,.4]]){
    applyNozzle(n);
    const body=ledgeFixture(),r=checked(build(body,ledgeLine(PROP.th/2+.1),h));
    const b=bounds(sectionAt(sectionMesh(r.triangles),5.2+h/2));
    assertClose(b[2]-b[0],PROP.th,1e-6,`${n} foot width`);
    assert(b[2]<=0,`${n} foot still past edge`);
  }
});

test('cutout patterns use closed lower frames and preserve holes',()=>{
  const body=ledgeFixture({lower:true});
  for(const pattern of ['diamond','honeycomb','lattice']){
    CUT.pattern=pattern;
    const r=checked(build(body));
    assertClose(area(sectionAt(sectionMesh(r.triangles), (r.route.start+r.route.end)/2)),30,1e-5,
      `${pattern} cuts through the sideways bend`);
    const solid=(()=>{CUT.pattern='none';return checked(build(body));})();
    assert(r.triangles.length!==solid.triangles.length,`${pattern} was silently made solid`);
  }
});

test('interface tags and tine attachments stay in the unchanged upper run',()=>{
  const body=ledgeFixture({slope:1}),line=ledgeLine().map(([x,y,z])=>[x,y,z+x]),t=topo(body);
  const ordinary=drawnWall(line[0],line.at(-1),body,0,{topo:t,rot:ID,offset:ZERO,tines:true});
  assert(ordinary.ok&&ordinary.tines>0,'fixture produced no tines');
  PROP.iface='all';crestPart(body,.2);
  const r=checked(build(body,line));
  assert(r.triangles.some(p=>p[3]===1),'interface tags lost');
  const tags=r.triangles.filter(p=>p[3]===1);
  assert(tags.every(p=>p[2]>r.route.end),'interface moved into lower bend');
});

test('Auto recipe replay retains the corrected lower wall for turning',()=>{
  const body=ledgeFixture(),line=ledgeLine(),out=[];
  const r=buildPartAttached(line,body,topo(body),ID,ZERO,out,true,.2);
  assert(r.ok&&r.prop.turnWall.seating,'Auto lost lower route metadata');
  const recipe=r.prop.turnWall,plain=[];sweepBetween(recipe.top,recipe.floor,plain,PROP.minHeight,null,recipe.seating.end);
  const replay=frameSweep(plain,footSeatFrame(recipe.seating));
  assert(JSON.stringify(replay)===JSON.stringify(out),'turning rebuild changed the base');
});


test('station limit keeps long walls without falsely certifying a landing',()=>{
  const body=Float64Array.from(ledgeFixture(),(v,i)=>i%3===1?v*40:v);
  const line=ledgeLine().map(([x,y,z])=>[x,y*40,z]);
  const mold=moldLine(line,body),ordinary=[];sweepBetween(mold.top,mold.floor,ordinary);
  const r=seatPartWall(mold,body,.2);
  assert(r.ok && !r.route && r.seatingSkipped===1 && r.seatingReason==='station-limit');
  assert(JSON.stringify(r.triangles)===JSON.stringify(ordinary),'station cap removed or changed the wall');
});

Deno.test('part ledge: fallback notices have translations and all plural placeholders',async()=>{
  const keys=['Landing unchanged on {n} wall; no verified correction. Inspect support starts in the slicer.',
    'Landing unchanged on {n} walls; no verified correction. Inspect support starts in the slicer.'];
  for(const lang of ['nl','de','pt','zh','ar']){
    const {default:dict}=await import(`../web/i18n/${lang}.js`);
    for(const key of keys){
      const v=dict[key];assert(v && v!==key,lang);
      for(const form of typeof v==='string'?[v]:Object.values(v))assert(form.includes('{n}'),lang);
      if(lang==='ar')assert(['zero','one','two','few','many','other'].every(k=>v[k]),'Arabic plurals');
    }
  }
});


test('a different first layer and supplied boundaries retain a checked landing',()=>{
  const body=ledgeFixture();
  for(const levels of [[0,.3,.5],[0,.1,.3],[0,.2,.4,.7,.9]]){
    const r=withLevels(levels,()=>checked(build(body)));
    assert(Math.max(...r.floor.map(f=>f[2]))<=5+1e-8,'incorrect floor');
  }
  const a=checked(build(body)),b=checked(build(body));
  assert(JSON.stringify(a)===JSON.stringify(b),'layer context leaked');
});


test('Draw braces use the new plate landing instead of the old part floor',()=>{
  const body=Float64Array.from(ledgeFixture(),(v,i)=>i%3===2&&v>=20?v+20:v);
  const line=Array.from({length:5},(_,i)=>[.6,i-2,40]);
  const p=block(-8,0,-40,40,0,7);
  const keepClear=Array.from({length:p.length/3},(_,i)=>Array.from(p.slice(3*i,3*i+3)));
  const r=drawnWall(line[0],line.at(-1),body,0,{brace:true,keepClear});
  assert(r.ok && r.braces>0,'new plate landing did not receive its brace');
  assert(r.floors.every(z=>z===0) && r.floors.length===r.top.length,'floors lost their station mapping');
  assert(isClosed(r.tris),'open braced wall');
});
