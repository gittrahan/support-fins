import { roundedFlange, roundedPolygon } from '../web/solids.js';
import { insidePart } from '../web/inside.js';
import { assert, isClosed, isOriented, loadModel, analyze, fins, prop, rotX,
  insideCount, blockTopo, readSTL } from './_util.js';
import { writeBinarySTL } from '../web/stl.js';
import { writeThreeMF, readThreeMF } from '../web/threemf.js';
import { applyNozzle } from '../web/nozzle.js';
const ID = [1,0,0,0,1,0,0,0,1], ZERO = {x:0,y:0,z:0};
Deno.test('rounded feet: flange joints overlap inside the original contour without coplanar caps', () => {
  const section = (x, w, h) => [[x, -w, 0], [x, -w, h], [x, w, h], [x, w, 0]];
  const out = [];
  roundedFlange([section(-20, 3, 0.6), section(0, 4, 0.4), section(20, 3, 0.6)], out);
  // Two 20-vertex polygons (rounded only at the outside ends), then the joint.
  const segmentVertices = (4 * 20 - 4) * 3;
  const parts = [out.slice(0, segmentVertices), out.slice(segmentVertices, 2 * segmentVertices),
    out.slice(2 * segmentVertices)];
  assert(parts.every((p) => p.length && isClosed(p) && isOriented(p)), 'invalid joint or segment');
  const contains = (tris, x) => insidePart({ pos: new Float64Array(tris.flat()), nFaces: tris.length / 3 },
    ID, ZERO, x, 0.37, 0.17);
  assert(contains(parts[0], -0.0075) && contains(parts[2], -0.0075), 'joint merely touches first segment');
  assert(contains(parts[1], 0.0075) && contains(parts[2], 0.0075), 'joint merely touches second segment');
  assert(!contains(parts[0], 0) && !contains(parts[1], 0) && contains(parts[2], 0),
    'segment faces still meet coplanar or the connecting joint is missing');
  for (const [x, y, z] of out) {
    assert(x >= -20 && x <= 20 && z >= 0 && z <= 0.6);
    assert(Math.abs(y) <= 4 - Math.abs(x) / 20 + 1e-8, 'joint expands the original foot contour');
  }
});

Deno.test('rounded feet: corner arcs remain inside a convex foot, including skewed and short feet', () => {
  for (const poly of [ [[0,0],[30,0],[30,6],[0,6]], [[0,0],[0.02,0],[0.02,6],[0,6]],
    [[0,0],[30,2],[30,8],[0,6]] ]) {
    const rounded = roundedPolygon(poly, 3);
    assert(rounded.length > poly.length);
    for (const q of rounded) for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      assert((b[0]-a[0])*(q[1]-a[1]) - (b[1]-a[1])*(q[0]-a[0]) >= -1e-8,
        'rounding expands the checked polygon');
    }
  }
});

function build(topo, rot, roundFeet, iface = false, sway = false) {
  return fins.buildFins(topo, analyze(topo, 45, rot), rot, { mode: 'auto', bedPad: false,
    tines: true, layerHeight: 0.2, sway: sway ? { on: true } : undefined,
    tunables: { roundFeet, iface } });
}
function contacts(tris) {
  const out = [];
  for (let i=0; i<tris.length; i+=3) {
    const tri = tris.slice(i,i+3);
    if (tri.some((v) => v[3] === 1)) out.push(...tri);
  }
  return out;
}

for (const [name, rot, sway] of [['cube', rotX(35), false], ['lowledge', rotX(0), false],
  ['plate', rotX(60), false], ['post', ID, true]]) {
  Deno.test(`rounded feet: ${name} keeps contacts, clearance and ownership; off restores legacy`, () => {
    const topo = name === 'post' ? blockTopo(-20,20,-15,15,0,1000) : loadModel(name);
    const ordinary = build(topo, rot, false, 'all', sway);
    const rounded = build(topo, rot, true, 'all', sway);
    assert(rounded.triangles.length > 0 && ordinary.triangles.length > 0);
    assert(JSON.stringify(rounded.triangles) !== JSON.stringify(ordinary.triangles), 'feet did not change');
    assert(JSON.stringify(contacts(rounded.triangles)) === JSON.stringify(contacts(ordinary.triangles)),
      'interface contacts changed');
    const { body, iface } = prop.splitInterface(rounded.triangles);
    assert(isClosed(body) && isClosed(iface), 'open body/interface');
    assert(isOriented(body) && isOriented(iface), 'inward mesh');
    const res = analyze(topo, 45, rot);
    // Probe just above the plate: ray parity on the coplanar z=0 model face is
    // ambiguous even for foot points many millimetres outside a rectangular post.
    const clearance = body.map((v) => [v[0], v[1], Math.max(v[2], 0.001)]);
    assert(insideCount(topo, rot, res.offset, clearance) === 0, 'rounded body enters the part');
    const claims = new Uint8Array(rounded.triangles.length);
    for (const fin of rounded.fins) for (const [a,b] of fin.triRanges) {
      for (let i=a; i<b; i++) claims[i]++;
      assert(isClosed(rounded.triangles.slice(a,b)), 'support removal would leave open geometry');
    }
    assert(claims.every((n) => n === 1), 'unowned or multiply-owned foot geometry');
    assert(JSON.stringify(build(topo, rot, false, 'all', sway).triangles) === JSON.stringify(ordinary.triangles));
    fins.applyTunables(null);
    assert(!fins.FIN.roundFeet && !prop.PROP.roundFeet, 'null settings retain rounded feet');
    fins.applyTunables({ iface: false });
  });
}

Deno.test('rounded feet: engine without tunables resets opt-in feet without resetting material', () => {
  const topo = loadModel('cube'), rot = rotX(35), res = analyze(topo, 45, rot);
  const opts = { mode: 'auto', bedPad: false, tines: true };
  fins.applyTunables({ iface: false, propGap: 0.3 });
  const ordinary = fins.buildFins(topo, res, rot, opts).triangles;
  build(topo, rot, true);
  const restored = fins.buildFins(topo, res, rot, opts).triangles;
  assert(JSON.stringify(restored) === JSON.stringify(ordinary), 'legacy engine changed after opt-in');
  assert(prop.PROP.gap === 0.3, 'material gap reset');
  fins.applyTunables({ propGap: 0.2 });
});

Deno.test('rounded feet: upstream nozzle scaling and full Sway depth preserve contacts and clearance', () => {
  const topo=blockTopo(-80,80,-60,60,0,1000), result=analyze(topo,45,ID);
  try {
    for (const nozzle of [0.2,0.4,0.8]) {
      const make=(roundFeet)=>fins.buildFins(topo,result,ID,{mode:'auto',tines:true,layerHeight:0.6,
        sway:{on:true,uncappedDepth:true},tunables:{nozzle,roundFeet,iface:'all'}});
      const ordinary=make(false), rounded=make(true);
      assert(rounded.sway.count>=2);
      assert(JSON.stringify(contacts(rounded.triangles))===JSON.stringify(contacts(ordinary.triangles)));
      const {body,iface}=prop.splitInterface(rounded.triangles);
      assert(isClosed(body) && isClosed(iface) && isOriented(body) && isOriented(iface));
      assert(insideCount(topo,ID,result.offset,body.map(v=>[v[0],v[1],Math.max(v[2],0.001)]))===0);
      for (const f of rounded.fins.filter(f=>f.kind==='sway')) assert(Math.abs(f.length-f.height*0.15)<1e-6);
    }
  } finally { applyNozzle(0.4); fins.applyTunables({iface:false}); }
});

Deno.test('rounded feet: metre-high supports round-trip STL and component 3MF with session setting', async () => {
  const topo = blockTopo(-20,20,-15,15,0,1000);
  const rounded = build(topo, ID, true, 'all', true);
  const bytes = new Uint8Array(await writeBinarySTL(rounded.triangles).arrayBuffer());
  assert(readSTL(bytes).length === rounded.triangles.length * 3, 'STL loses geometry');
  const part = Array.from({length: topo.pos.length/3}, (_,i) => Array.from(topo.pos.slice(i*3,i*3+3)));
  const { body, iface } = prop.splitInterface(rounded.triangles);
  const session = { v:1, form:{'rounded-feet':true} };
  const exported = new Uint8Array(await writeThreeMF(part, body, 'synthetic-post',
    { separate:true, iface, session }).arrayBuffer());
  const restored = await readThreeMF(exported);
  assert(restored.session?.form?.['rounded-feet'] === true, 'session loses rounded choice');
  assert(restored.objects[0].positions.length === topo.pos.length, 'support objects merged into editable part');
  assert(restored.objects[1].positions.length === rounded.triangles.length * 3, '3MF loses support geometry');
});
