import assert from 'node:assert/strict';
const test = Deno.test;
import Module from '../../../web/vendor/manifold-3d-3.5.4/manifold.js';
import { planTurn, buildTurn, triangles } from '../project-turning-geometry.js';
const w = await Module(); w.setup();
const reference = Object.freeze({ nozzle: .8, lineWidth: .82, firstLayerHeight: .4, layerHeight: .4,
  firstPrintZ: 18, lastPrintZ: 33.6, topZ: 33.7, startLength: 8, endLength: 11.6,
  center: [0, 0], startAngle: 0, turnDegrees: 90 });
function validateMesh(tri) {
  const edges = new Map(); let volume = 0;
  for (let i = 0; i < tri.length; i += 3) {
    const [a, b, c] = tri.slice(i, i + 3);
    assert([...a, ...b, ...c].every(Number.isFinite));
    const u = b.map((x, j) => x - a[j]), v = c.map((x, j) => x - a[j]);
    const cross = [u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    assert(Math.hypot(...cross) > 0, 'zero-area serialized triangle');
    volume += (a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;
    for (const [x,y] of [[a,b],[b,c],[c,a]]) {
      const aa=x.join(','),bb=y.join(','),key=[aa,bb].sort().join('|');
      const row=edges.get(key)??{count:0,balance:0};row.count++;row.balance+=aa<bb?1:-1;edges.set(key,row);
    }
  }
  assert(volume>0);assert([...edges.values()].every(e=>e.count===2&&e.balance===0));
  return volume;
}
test('reference turn has the expected layer volume and endpoint width', () => {
  const {solid,plan}=buildTurn(w,reference);
  try {
    const expected=plan.steps.reduce((v,s)=>v+2*s.halfLength*s.width*(s.top-s.bottom),0);
    assert(Math.abs(solid.volume()-expected)<.001);
    validateMesh(triangles(solid));
  } finally {solid.delete();}
});
const cases = [-90,-60,-30,0,30,60,90].map(turnDegrees=>({id:`turn-${turnDegrees}`,p:{...reference,turnDegrees}}));
cases.push({id:'rotated-translated',p:{...reference,startAngle:37,center:[31,-22]}},
  {id:'different-first-layer',p:{...reference,firstLayerHeight:.28,layerHeight:.2,firstPrintZ:18.08,lastPrintZ:33.68,topZ:33.75}},
  {id:'nozzle-0.4',p:{...reference,nozzle:.4,lineWidth:.42,firstLayerHeight:.2,layerHeight:.2,
    firstPrintZ:9,lastPrintZ:16.8,topZ:16.85,startLength:4,endLength:5.8}},
  {id:'nozzle-0.6',p:{...reference,nozzle:.6,lineWidth:.62,firstLayerHeight:.3,layerHeight:.3,
    firstPrintZ:13.5,lastPrintZ:25.2,topZ:25.275,startLength:6,endLength:8.7}});
for (const {id,p} of cases) test(`${id}: connected, closed, single top and bounded growth`,()=>{
  const {solid,plan}=buildTurn(w,p);
  try {
    const tri=triangles(solid),volume=validateMesh(tri);
    assert(plan.maximumCornerStep<=p.layerHeight+1e-7);
    const top=solid.slice(p.topZ-Math.min(.2,p.layerHeight/2));
    try {
      const polygons=top.toPolygons();assert.equal(polygons.length,1);
      assert(Math.abs(top.area()-2*p.lineWidth*p.endLength)<1e-4);
    } finally {top.delete();}
  } finally {solid.delete();}
});
test('clockwise and counterclockwise turns are geometric mirrors',()=>{
  const a=buildTurn(w,reference).solid,b=buildTurn(w,{...reference,turnDegrees:-90}).solid;
  const mirror=a.scale([1,-1,1]),ab=mirror.subtract(b),ba=b.subtract(mirror);
  try{assert(Math.abs(ab.volume())+Math.abs(ba.volume())<1e-5);}finally{a.delete();b.delete();mirror.delete();ab.delete();ba.delete();}
});
test('translation and rotation preserve the local construction',()=>{
  const a=buildTurn(w,reference).solid,b=buildTurn(w,{...reference,startAngle:37,center:[31,-22]}).solid;
  const rotated=a.rotate([0,0,37]),placed=rotated.translate([31,-22,0]);
  const ab=placed.subtract(b),ba=b.subtract(placed);
  try{assert(Math.abs(ab.volume())+Math.abs(ba.volume())<.001);}finally{for(const s of [a,b,rotated,placed,ab,ba])s.delete();}
});
test('abrupt, ambiguous, malformed and mismatched schedules reject',()=>{
  for(const patch of [{turnDegrees:91},{turnDegrees:NaN},{lineWidth:0},{center:[1]},
    {firstPrintZ:18.1},{lastPrintZ:18.4},{topZ:34},{layerHeight:1},{startLength:1},{nozzle:undefined}]) {
    assert.throws(()=>planTurn({...reference,...patch}),undefined,JSON.stringify(patch));
  }
  assert.throws(()=>planTurn({...reference,lastPrintZ:18.4,topZ:18.5}),/45-degree/);
});
test('body, neighbor and protected-volume collisions reject; separated obstacle passes',()=>{
  const block=w.Manifold.cube([4,4,4]),hit=block.translate([-2,-2,24]),clear=block.translate([20,20,24]);block.delete();
  try {
    for(const id of ['source-body','neighbor','protected-hole'])assert.throws(()=>buildTurn(w,reference,[{id,solid:hit}]),new RegExp(id));
    const good=buildTurn(w,reference,[{id:'neighbor',solid:clear}]);good.solid.delete();
  } finally {hit.delete();clear.delete();}
});
test('repeated success/failure contexts do not corrupt later deterministic output',()=>{
  const original=buildTurn(w,reference).solid,expected=triangles(original);original.delete();
  for(let i=0;i<20;i++){
    const box=w.Manifold.cube([2,2,2]),hit=box.translate([-1,-1,24]);box.delete();
    try{assert.throws(()=>buildTurn(w,reference,[{id:'blocked',solid:hit}]));}finally{hit.delete();}
    const {solid}=buildTurn(w,reference);try{assert.deepEqual(triangles(solid),expected);}finally{solid.delete();}
  }
});
