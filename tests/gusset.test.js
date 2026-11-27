// Gussets (web/gusset.js): a hand-placed fin that stands off a SIDE of the part, not
// the plate. These pin, on an upside-down L: a gusset off the upright builds under the
// arm, never reaches the plate, is watertight, tines into the side and the overhang
// only with Tines on, keeps its underside at least 45 deg, and refuses a start that
// isn't a side and a reach past its limits.

import { WEB, block, buildTopology, isClosed, insideCount, assert, assertClose } from './_util.js';

const { gussetAt, gussetDir, GUSSET } = await import(`${WEB}gusset.js`);
const { boxGrid } = await import(`${WEB}fins/fill.js`);
const { PROP } = await import(`${WEB}prop.js`);
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const OFF = { x: 0, y: 0, z: 0 };

// The L in XZ, extruded 20 mm along Y: a 5 mm upright 30 mm tall, its 25 mm arm 5 mm
// thick on top. The face at x = 5 under the arm is the side a gusset stands off.
const L = [[0, 0], [5, 0], [5, 30], [25, 30], [25, 35], [0, 35]];
const DEPTH = 20;

function lTopo(poly = L) {
  const t = [];
  const P = (x, y, z) => [x, y, z];
  // caps: a fan from the last vertex (the L is fan-able from its top-left corner)
  const f = poly.length - 1;
  for (let i = 0; i < f - 1; i++) {
    const [a, b, c] = [poly[f], poly[i], poly[i + 1]];
    t.push(P(a[0], 0, a[1]), P(c[0], 0, c[1]), P(b[0], 0, b[1]));
    t.push(P(a[0], DEPTH, a[1]), P(b[0], DEPTH, b[1]), P(c[0], DEPTH, c[1]));
  }
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    t.push(P(a[0], 0, a[1]), P(b[0], 0, b[1]), P(b[0], DEPTH, b[1]));
    t.push(P(a[0], 0, a[1]), P(b[0], DEPTH, b[1]), P(a[0], DEPTH, a[1]));
  }
  // wind outward: flip all if the volume came out negative
  let V = 0;
  for (let i = 0; i < t.length; i += 3) {
    const [a, b, c] = [t[i], t[i + 1], t[i + 2]];
    V += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  }
  if (V < 0) for (let i = 0; i < t.length; i += 3) [t[i + 1], t[i + 2]] = [t[i + 2], t[i + 1]];
  const pos = new Float32Array(t.length * 3);
  t.forEach((p, i) => pos.set(p, i * 3));
  return buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
}

/** The face whose (unrotated) normal is closest to (nx, 0, 0) and that contains x = x0. */
function faceAt(topo, x0, nx) {
  for (let f = 0; f < topo.nFaces; f++) {
    const o = f * 9;
    if (Math.abs(topo.nrm[f * 3] - nx) > 1e-3) continue;
    if ([0, 3, 6].every((k) => Math.abs(topo.pos[o + k] - x0) < 1e-4)) return f;
  }
  return -1;
}

function build(opts = {}, w = [5, 10, 20], o = [15, 10, 30]) {
  const topo = lTopo();
  const face = faceAt(topo, 5, 1);
  assert(face >= 0, 'test setup: no face on the upright at x = 5');
  const r = gussetAt(w, o, face, topo.pos, { topo, rot: IDENTITY, offset: OFF, ...opts });
  return { topo, face, r };
}

const zs = (tris) => tris.map((v) => v[2]);

Deno.test('gusset: off the L’s upright, it builds under the arm and runs square off the side', () => {
  const { topo, face, r } = build();
  assert(r.ok, `gusset failed: ${r.reason}`);
  assert(r.tris.length > 0, 'gusset produced no geometry');
  const d = gussetDir(topo, IDENTITY, face);
  assertClose(d[0], 1, 1e-6, 'runs along the side’s normal');
  assertClose(r.reach, 10, 1e-6, 'reach is the second click, measured out from the side');
  // the whole fin sits in x 5..15 (+ its tip), y about the click, under the arm
  const xs = r.tris.map((v) => v[0]);
  // (the side tines kiss the side 0.01 mm deep: kissEnds' default contact)
  assert(Math.min(...xs) > 5 - 0.05 && Math.max(...xs) < 15 + 0.6, `fin spills out of 5..15: ${Math.min(...xs)}..${Math.max(...xs)}`);
  assert(Math.max(...zs(r.tris)) <= 30 - PROP.gap + 1e-6, 'fin pokes up into the arm');
});

Deno.test('gusset: never reaches the plate — its lowest point is up the side', () => {
  const { r } = build();
  assert(r.ok, r.reason);
  const low = Math.min(...zs(r.tris));
  // 10 mm out at 50 deg climbs ~11.9 mm to the end's 2 mm: the inner end sits ~16 mm up
  assert(low > 10, `fin reaches down to z ${low.toFixed(2)}`);
  assert(r.floors.every((z) => z > 0), 'a station stood on the plate');
});

Deno.test('gusset: its underside climbs at the angle asked, never flatter than 45 deg', () => {
  for (const angle of [50, 60, 30]) {
    const { r } = build({ angle });
    assert(r.ok, `${angle} deg: ${r.reason}`);
    const f = r.floors, du = r.reach - PROP.sideClear;   // the inner station stands sideClear off the side
    const got = (Math.atan((f[f.length - 1] - f[0]) / du) * 180) / Math.PI;
    assertClose(got, Math.max(angle, GUSSET.minAngle), 0.01, `underside slope at ${angle} deg`);
  }
});

Deno.test('gusset: watertight, plain and tined', () => {
  for (const tines of [false, true]) {
    const { r } = build({ tines });
    assert(r.ok, r.reason);
    // tines are separate closed solids the slicer unions; each piece must close
    assert(isClosed(r.tris), `gusset (tines ${tines}) is not closed`);
  }
});

// The side tines are all that hold a gusset up until the overhang prints over it, so
// they come whatever the Tines box says; it only adds the top comb. That comb is
// emitTines', which leaves a FLAT underside to the gap contact (a drawn wall under
// this arm gets none either).
Deno.test('gusset: side tines always, Tines box or not; none on top of a flat arm', () => {
  for (const tines of [true, false]) {
    const { r } = build({ tines, tineDensity: 1, layerHeight: 0.2 });
    assert(r.ok, r.reason);
    assert(r.sideTines >= 3, `tines ${tines}: too few tines into the side (${r.sideTines})`);
    assert(r.tris.some((v) => v[0] < 5), `tines ${tines}: no tine reaches the side at x = 5`);
    assert(!r.tines, `tines ${tines}: a flat underside got top tines (${r.tines})`);
  }
});

Deno.test('gusset: with separate tine material, the side tines are tines and the fin is body', () => {
  const saved = { iface: PROP.iface, separateTines: PROP.separateTines };
  try {
    PROP.iface = 'tines';
    const { r } = build({ tines: false, layerHeight: 0.2 });
    assert(r.ok, r.reason);
    const roles = (pred) => new Set(r.tris.filter(pred).map((v) => v[4]?.role));
    const side = roles((v) => v[0] < 5);   // past the side: side tines only
    assert(side.size === 1 && side.has('tine'), `side tines exported as ${[...side]}`);
    assert(roles((v) => v[0] > 6).has('body'), 'the fin itself lost its body role');
  } finally { Object.assign(PROP, saved); }
});

/** The side tines' layer cells, as [bottom, top] z, read off the geometry: every
 *  vertex past the side (x < 5) belongs to one. */
function sideCells(r) {
  const cells = new Map();
  for (const v of r.tris) {
    if (v[0] >= 5 - 1e-6) continue;
    const k = Math.round(v[2] * 1000);
    cells.set(k, v[2]);
  }
  const zs = [...cells.values()].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i + 1 < zs.length; i += 2) out.push([zs[i], zs[i + 1]]);
  return out;
}

Deno.test('gusset: a tine in the fin’s first layer and in its top layer, none further than the spacing apart', () => {
  for (const layerHeight of [0.2, 0.12, 0.28]) {
    const { r } = build({ layerHeight });
    assert(r.ok, r.reason);
    const cells = sideCells(r);
    const zLo = r.floors[0] + PROP.footGap, zHi = r.top[0][2] - PROP.gap;
    const [b0, t0] = cells[0];
    assert(b0 <= zLo + 1e-6 && t0 > zLo, `${layerHeight}: lowest tine ${b0.toFixed(2)}..${t0.toFixed(2)} misses the fin’s bottom at ${zLo.toFixed(2)}`);
    const [bn, tn] = cells[cells.length - 1];
    assert(tn <= zHi + 1e-6 && zHi - tn < layerHeight + 1e-6, `${layerHeight}: top tine ends ${tn.toFixed(2)}, the fin’s top is ${zHi.toFixed(2)}`);
    assert(bn > b0, 'one tine only');
    for (let i = 1; i < cells.length; i++) {
      const step = cells[i][0] - cells[i - 1][0];
      assert(step <= GUSSET.tineSpacing + 1e-6, `${layerHeight}: tines ${step.toFixed(2)}mm apart`);
      assertClose(cells[i][1] - cells[i][0], layerHeight, 1e-6, 'a tine is one layer tall');
    }
  }
});

Deno.test('gusset: under a SLOPED overhang the top gets the tine comb too', () => {
  // the arm's underside climbs 26.6 deg from the upright out: steep enough to bite
  const sloped = [[0, 0], [5, 0], [5, 26], [25, 36], [25, 41], [0, 41]];
  const topo = lTopo(sloped);
  const side = faceAt(topo, 5, 1);
  const opts = { topo, rot: IDENTITY, offset: OFF, tineDensity: 1, layerHeight: 0.2 };
  const on = gussetAt([5, 10, 18], [15, 10, 31], side, topo.pos, { ...opts, tines: true });
  const off = gussetAt([5, 10, 18], [15, 10, 31], side, topo.pos, { ...opts, tines: false });
  assert(on.ok && off.ok, `sloped arm: ${on.reason ?? off.reason}`);
  assert(on.tines > 0, `no top tines under a sloped overhang (${on.tines})`);
  assert(!off.tines && off.sideTines === on.sideTines, 'the Tines box should change only the top comb');
  assert(isClosed(on.tris), 'tined gusset under a sloped arm is not closed');
});

/** The fin without its side tines: every vertex out from the side (x > 5). */
const body = (tris, pose = (v) => v) => tris.filter((v) => pose(v)[0] > 5 - 1e-6);

Deno.test('gusset: only tines bite into the part, never the body', () => {
  const { topo, r } = build({ tines: false });
  assert(r.ok, r.reason);
  assert(insideCount(topo, IDENTITY, OFF, body(r.tris)) === 0, 'the body has vertices inside the part');
  // ...and every vertex that does is a side tine's end, in the side's skin
  for (const v of r.tris) if (v[0] < 5) assert(v[0] > 5 - 0.05, `a vertex ${(5 - v[0]).toFixed(2)}mm into the side`);
});

Deno.test('gusset: refused off a face that isn’t a side, and past its reach limits', () => {
  const topo = lTopo();
  const opts = { topo, rot: IDENTITY, offset: OFF };
  // the arm's underside (normal -z) is a roof, not a side
  let under = -1;
  for (let f = 0; f < topo.nFaces; f++) if (topo.nrm[f * 3 + 2] < -0.99 && topo.pos[f * 9 + 2] > 29) { under = f; break; }
  assert(under >= 0, 'test setup: no underside face');
  assert(!gussetAt([10, 10, 30], [15, 10, 30], under, topo.pos, opts).ok, 'built off the underside');
  const side = faceAt(topo, 5, 1);
  const short = gussetAt([5, 10, 20], [6, 10, 30], side, topo.pos, opts);
  assert(!short.ok && /too short/.test(short.reason), `a 1 mm gusset: ${short.reason}`);
  const past = gussetAt([5, 10, 20], [27, 10, 30], side, topo.pos, opts);
  assert(!past.ok, 'built out past the end of the arm');
});

Deno.test('gusset: follows the part when it turns (the pose is rot + offset, not baked in)', () => {
  const topo = lTopo();
  const side = faceAt(topo, 5, 1);
  // 90 deg about Z (column-major, as rotM3.elements): x -> y, y -> -x; then shifted
  const rot = [0, 1, 0, -1, 0, 0, 0, 0, 1], off = { x: 40, y: -7, z: 0 };
  const pose = ([x, y, z]) => [-y + off.x, x + off.y, z + off.z];
  const tris = new Float64Array(topo.pos.length);
  for (let i = 0; i < tris.length; i += 3) tris.set(pose([topo.pos[i], topo.pos[i + 1], topo.pos[i + 2]]), i);
  const flat = gussetAt([5, 10, 20], [15, 10, 30], side, topo.pos, { topo, rot: IDENTITY, offset: OFF });
  const r = gussetAt(pose([5, 10, 20]), pose([15, 10, 30]), side, tris, { topo, rot, offset: off });
  assert(r.ok, `turned gusset failed: ${r.reason}`);
  assertClose(r.reach, flat.reach, 1e-6, 'reach');
  assertClose(r.height, flat.height, 1e-6, 'height');
  assert(r.tris.length === flat.tris.length, `turned gusset has ${r.tris.length} vertices, flat ${flat.tris.length}`);
  // back to the part's frame (x, y) -> (y - off.y, -(x - off.x)) to tell body from tines
  const unpose = ([x, y, z]) => [y - off.y, -(x - off.x), z];
  assert(insideCount(topo, rot, off, body(r.tris, unpose)) === 0, 'the turned body has vertices inside the part');
});

Deno.test('gusset: refused where the side stops short of the fin’s underside', () => {
  // the upright only runs 6 mm under the arm (a short boss hanging off it): a 15 mm
  // fin at 50 deg needs ~18 mm of side
  const boss = [[0, 24], [5, 24], [5, 30], [25, 30], [25, 35], [0, 35]];
  const topo = lTopo(boss);
  const side = faceAt(topo, 5, 1);
  const r = gussetAt([5, 10, 27], [20, 10, 30], side, topo.pos, { topo, rot: IDENTITY, offset: OFF });
  assert(!r.ok && /side doesn’t run far enough/.test(r.reason), `short side: ${r.reason}`);
  // ...and a short fin there fits
  const ok = gussetAt([5, 10, 27], [8, 10, 30], side, topo.pos, { topo, rot: IDENTITY, offset: OFF });
  assert(ok.ok, `3 mm fin on the boss: ${ok.reason}`);
});

Deno.test('gusset: a kept side normal builds the same gusset as the clicked face, even at the side’s top edge', () => {
  const topo = lTopo();
  const side = faceAt(topo, 5, 1);
  const opts = { topo, rot: IDENTITY, offset: OFF };
  const byFace = gussetAt([5, 10, 20], [15, 10, 30], side, topo.pos, opts);
  const byNormal = gussetAt([5, 10, 20], [15, 10, 30], [1, 0, 0], topo.pos, opts);
  assert(byFace.ok && byNormal.ok, 'built both ways');
  assert(JSON.stringify(byFace.tris) === JSON.stringify(byNormal.tris), 'the normal stands the same gusset');
  // a click a hair under the arm is as near the arm's underside as the side, once the
  // saved point is rounded: a reopened session looking the face up by nearest point
  // can take the underside and be refused, the kept normal still stands it off the side
  const under = topo.nrm.findIndex((v, i) => i % 3 === 2 && v < -0.99) / 3;
  assert(!gussetAt([5, 10, 29.99], [15, 10, 30], under, topo.pos, opts).ok, 'the underside is no side');
  assert(gussetAt([5, 10, 29.99], [15, 10, 30], [1, 0, 0], topo.pos, opts).ok, 'built from the kept normal');
});

/** The L with a block added (a separate closed solid touching it), as a topology. */
function lWith(...box) {
  const pos = new Float32Array([...lTopo().pos, ...block(...box)]);
  return buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
}
const triples = (flat) => { const o = []; for (let i = 0; i < flat.length; i += 3) o.push([flat[i], flat[i + 1], flat[i + 2]]); return o; };

Deno.test('gusset: a rib thinner than the station pitch, between two stations, refuses it', () => {
  // where the stations fall on the plain L, then a 0.25 mm rib hanging 4 mm off the arm
  // across the fin, halfway between the 4th and 5th: no station is near enough to see
  // it, only the swept body's own triangles (solidClearance)
  const { r: plain } = build();
  assert(plain.ok, plain.reason);
  const x = (plain.top[3][0] + plain.top[4][0]) / 2;
  assert(plain.top[4][0] - plain.top[3][0] > 0.6, 'test setup: stations closer than the rib needs');
  const topo = lWith(x - 0.125, x + 0.125, 7, 13, 26, 30);
  const side = faceAt(topo, 5, 1);
  const r = gussetAt([5, 10, 20], [15, 10, 30], side, topo.pos, { topo, rot: IDENTITY, offset: OFF });
  assert(!r.ok && /runs into the part/.test(r.reason), `built through the rib: ${r.reason ?? 'ok'}`);
});

Deno.test('gusset: a lip at the far end trims the reach, not the side; one it runs under refuses it', () => {
  const at = (topo) => gussetAt([5, 10, 20], [15, 10, 30], faceAt(topo, 5, 1), topo.pos,
                                { topo, rot: IDENTITY, offset: OFF });
  // a lip hanging off the arm 0.1 mm past the clicked reach: the last station would
  // stand flush against it, so the outer end comes in (trimmedEnds) and the inner end
  // stays on the side
  const r = at(lWith(15.1, 16, 0, 20, 25, 30));
  assert(r.ok, `refused: ${r.reason}`);
  assert(r.reach < 10 - 0.5, `reach ${r.reach.toFixed(2)} still runs to the lip`);
  assert(Math.max(...r.tris.map((v) => v[0])) < 15.1 - 0.205, 'the body ends within a flank of the lip');
  assert(r.top[0][0] - 5 < PROP.sideClear + 1e-6, 'the inner end moved off the side');
  assert(r.sideTines > 0, 'no side tines');
  // ...a lip across the middle of the fin: its top would step down under the lip with
  // no station on the step, and only the swept body's measure sees the corner
  const under = at(lWith(14, 15, 0, 20, 27, 30));
  assert(!under.ok && /runs into the part/.test(under.reason), `built under the lip: ${under.reason ?? 'ok'}`);
});

Deno.test('gusset: keeps clear of the supports standing, in 3D', () => {
  const { r: plain } = build();
  assert(plain.ok, plain.reason);
  const grid = (...box) => { const g = boxGrid(); g.add(triples(block(...box))); return g; };
  // an Auto wall standing from the plate up under the same arm, across the gusset
  const wall = build({ supports: grid(10, 11, 0, 20, 0, 29.8) }).r;
  assert(!wall.ok && /fuse/.test(wall.reason), `built into a wall: ${wall.reason ?? 'ok'}`);
  // ...one at the far end of the part is no clash
  assert(build({ supports: grid(10, 11, 18, 20, 0, 29.8) }).r.ok, 'refused for a wall 7 mm away');
  // ...nor the bed pad right under it: the gusset is up the side, not on the plate
  const pad = build({ supports: grid(5, 25, 0, 20, 0, 0.5) }).r;
  assert(pad.ok, `refused for the pad below: ${pad.reason}`);
  assert(JSON.stringify(pad.tris) === JSON.stringify(plain.tris), 'the pad changed the gusset');
});

Deno.test('gusset: a turned pose turns the kept normal with it', () => {
  // 90 deg about z: the side's +x normal faces +y in print space
  const rot = [0, 1, 0, -1, 0, 0, 0, 0, 1];
  const d = gussetDir(null, rot, [1, 0, 0]);
  assertClose(d[0], 0, 1e-9, 'x');
  assertClose(d[1], 1, 1e-9, 'y');
  assert(gussetDir(null, IDENTITY, [0, 0, -1]) === null, 'a downward normal is no side');
});

Deno.test('gusset: Line anchors retain gap-only geometry when no contacts fit, without leaked settings', () => {
  const saved = {...PROP};
  try {
    PROP.bottomAnchors = false;
    const before = build().r;
    assert(before.ok);
    PROP.bottomAnchors = true;
    const fallback = build().r;
    assert(fallback.ok && fallback.anchorsSkipped === 1, fallback.reason);
    assert(JSON.stringify(fallback.tris) === JSON.stringify(before.tris), 'fallback changed the wall');
    PROP.bottomAnchors = false;
    assert(JSON.stringify(build().r.tris) === JSON.stringify(before.tris), 'off geometry changed');
    PROP.footGap = 0;
    const zero = build().r;
    PROP.bottomAnchors = true;
    assert(JSON.stringify(build().r.tris) === JSON.stringify(zero.tris), 'zero-gap gusset changed');
  } finally { Object.assign(PROP, saved); }
});

Deno.test('gusset: validated floor contacts survive body clearance while real collisions still fail', () => {
  const saved = {...PROP};
  try {
    // A 45-degree seat below the gusset. Its virtual underside is not a
    // measured floor contour; this supported gap leaves 0.35 mm to the actual seat.
    PROP.footGap = 0.4;
    PROP.tip = 0.3; // 0.2 mm nozzle: a contact fits within one sloping station
    PROP.bottomAnchors = false;
    const base = lTopo();
    const zEnd = 30 - PROP.gap - Math.max(GUSSET.endDepth, PROP.minHeight + PROP.footGap + 0.1);
    const seat = block(5, 16, 0, 20, 0, 1).map((v,i,a) => i%3 === 2 && v === 1 ? zEnd - (15-a[i-2]) + 0.05 : v);
    const pos = new Float32Array([...base.pos, ...seat]);
    const topo = buildTopology({getAttribute:k => k === 'position' ? {array:pos} : null});
    const options = {topo,rot:IDENTITY,offset:OFF,angle:45};
    const run = () => gussetAt([5,10,20],[15,10,30],faceAt(topo,5,1),pos,options);
    const plain = run();
    PROP.bottomAnchors = true;
    const anchored = run();
    assert(plain.ok && anchored.ok, plain.reason ?? anchored.reason);
    assert(anchored.anchorsSkipped === 0 && anchored.tris.length > plain.tris.length, 'no validated anchors were added');
    assert(isClosed(anchored.tris), 'open anchored gusset');
    const clash = lWith(14,15,0,20,27,30);
    const rejected = gussetAt([5,10,20],[15,10,30],faceAt(clash,5,1),clash.pos,
      {topo:clash,rot:IDENTITY,offset:OFF});
    assert(!rejected.ok && /runs into the part/.test(rejected.reason), 'anchor mode bypassed a real collision');
  } finally {Object.assign(PROP,saved);}
});
