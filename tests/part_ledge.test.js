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
import { buildPartAttached } from '../web/prop/attached.js';
import { sectionMesh, sectionAt, bounds, area, difference } from '../web/fins/sections.js';
import { closedTurningMesh as closedMesh } from '../web/prop/turn.js';
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

test('bounded search refuses a narrow landing; drawn walls cannot fall through the body',()=>{
  const body=ledgeFixture({narrow:true}),r=build(body);
  assert(!r.ok&&r.blocked,'unusable landing was accepted');
  const draw=drawnWall(ledgeLine()[0],ledgeLine().at(-1),body,0);
  assert(!draw.ok&&/landing/.test(draw.reason),'Draw silently used an unsafe fallback');
});

test('open source sections cannot certify a new lower route',()=>{
  const source=ledgeFixture(),broken=[];
  for(let i=0;i<source.length;i+=9) {
    if([1,4,7].every(k=>source[i+k]>24.9))continue;
    broken.push(...source.slice(i,i+9));
  }
  const r=build(Float64Array.from(broken));
  assert(!r.ok&&r.blocked,'open source certified a new route');
});

test('automatic keep-clear volumes cannot be used as a lower route',()=>{
  const body=ledgeFixture(),p=block(-5,8,-25,25,0,7);
  const keepClear=Array.from({length:p.length/3},(_,i)=>Array.from(p.slice(i*3,i*3+3)));
  const r=seatPartWall(moldLine(ledgeLine(),body),body,.2,PROP.minHeight,keepClear);
  assert(!r.ok&&r.blocked,'route entered a protected cavity');
  const out=[],auto=buildPartAttached(ledgeLine(),body,topo(body),ID,ZERO,out,false,.2,keepClear);
  assert(!auto.ok&&auto.floored==='blocked'&&out.length===0,'Auto published an excluded route');
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
