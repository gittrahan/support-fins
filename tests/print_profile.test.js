import { printDimensions } from '../web/print-profile.js';
import { PERP } from '../web/fins/wedges.js';
import { sweep } from '../web/prop/sweep.js';
import { buildSwayBraces } from '../web/sway.js';
import { drawnWall } from '../web/draw.js';
import { writeThreeMF, readThreeMF } from '../web/threemf.js';
import { writeBinarySTL, readSTL } from '../web/stl.js';
import { block, blockTopo, tiltedBlockTopo, analyze, fins, prop, bbox, isClosed, assert, assertClose } from './_util.js';

const ID = [1, 0, 0, 0, 1, 0, 0, 0, 1];
function withProfile(nozzle, wallLines, fn) {
  const before = [fins.FIN, prop.PROP, PERP].map((o) => ({ ...o }));
  try {
    fins.applyTunables(structuredClone({ nozzle, wallLines }));
    return fn(printDimensions(nozzle, wallLines));
  } finally {
    [fins.FIN, prop.PROP, PERP].forEach((o, i) => Object.assign(o, before[i]));
  }
}

Deno.test('nozzle profile: upstream flat interface keeps the chosen wall gauge and Sway tags', async () => {
  const { splitInterface } = prop;
  let split;
  withProfile(1.6, 4, (p) => {
    prop.PROP.iface = 'flat';
    const r = drawnWall([-40, 0, 100], [40, 0, 100], block(-60, 60, -30, 30, 100, 110), 0,
      { tines: false, layerHeight: 0.6 });
    assert(r.ok, r.reason);
    split = splitInterface(r.tris);
    assert(split.iface.length && isClosed(split.iface), 'no closed interface crest');
    const top = Math.max(...split.iface.map((v) => v[2]));
    const edge = split.iface.filter((v) => Math.abs(v[2] - top) < 1e-6);
    assertClose(Math.max(...edge.map((v) => v[1])) - Math.min(...edge.map((v) => v[1])), p.wallThickness, 1e-6);
    const topo = blockTopo(-20, 20, -15, 15, 0, 150);
    const b = fins.buildFins(topo, analyze(topo, 45, ID), ID, { mode: 'auto', tines: true,
      tunables: { nozzle: 1.6, wallLines: 4, iface: 'all' }, sway: { on: true } });
    assert(b.sway.tines > 0 && b.triangles.filter((v) => v[3] === 1).length / 3 === b.sway.tines * 12,
      'profile sizing lost the Sway interface tags');
  });
  const blob = writeThreeMF([[0, 0, 0], [1, 0, 0], [0, 1, 0]], split.body, 'profile-interface',
    { separate: true, iface: split.iface });
  const loaded = await readThreeMF(new Uint8Array(await blob.arrayBuffer()));
  assert(loaded.objects[1].positions.length / 3 === split.body.length + split.iface.length,
    '3MF lost the profile-sized interface');
});

Deno.test('nozzle profile: measured wall bodies use 2/4/6/8 lines, contacts one line', () => {
  for (const nozzle of [0.4, 0.8, 1.6, 2.4]) for (const lines of [2, 4, 6, 8]) {
    withProfile(nozzle, lines, (p) => {
      const out = [];
      assert(sweep([[-25, 0, 100], [25, 0, 100]], 0, out), 'wall not built');
      const body = out.filter((v) => v[2] > prop.PROP.baseH && v[2] < 99);
      assertClose(bbox(body).hi[1] - bbox(body).lo[1], p.wallThickness, 1e-6, 'wall width');
      const tip = out.filter((v) => Math.abs(v[2] - 99.8) < 1e-6);
      assertClose(bbox(tip).hi[1] - bbox(tip).lo[1], p.lineWidth, 1e-6, 'contact width');
      assertClose(PERP.th, p.wallThickness, 1e-6, 'wedge width');
      assert(isClosed(out), 'wall has an open edge');
      assert(prop.PROP.footMin > p.wallThickness / 2, 'foot narrower than wall');
    });
  }
});

Deno.test('nozzle profile: invalid values cannot alter geometry settings', () => {
  const before = [prop.PROP.th, prop.PROP.tip, PERP.th, fins.FIN.nozzle];
  for (const [nozzle, wallLines] of [[NaN, 2], [0, 2], [4, 2], [1.6, 3], ['1.6', 4]]) {
    assert(printDimensions(nozzle, wallLines) === null, 'accepted invalid profile');
    fins.applyTunables({ nozzle, wallLines });
  }
  assert(before.every((v, i) => v === [prop.PROP.th, prop.PROP.tip, PERP.th, fins.FIN.nozzle][i]), 'invalid profile changed geometry');
});

Deno.test('nozzle profile: a 1m post gets selected thickness and unchanged depth limit through buildFins', () => {
  withProfile(1.6, 8, (p) => {
    const topo = blockTopo(-80, 80, -60, 60, 0, 1000), res = analyze(topo, 45, ID);
    const options = { tines: true, layerHeight: 0.6, sway: { on: true, reach: 0.15 },
      tunables: { nozzle: 1.6, wallLines: 8 } };
    const built = fins.buildFins(topo, res, ID, structuredClone(options));
    assert(built.sway.count >= 2, 'no braces for a meter-high post');
    for (const rib of built.sway.braces) {
      assertClose(rib.th, p.wallThickness, 1e-6, 'brace capped at legacy 2.4mm');
      assert(rib.height > 990, 'brace did not reach the top');
      assertClose(Math.hypot(rib.levels[0].b[0] - rib.levels[0].a[0],
        rib.levels[0].b[1] - rib.levels[0].a[1]), 60, 1e-6, 'nozzle sizing changed the existing depth limit');
    }
    assert(isClosed(built.triangles), 'meter-high supports have an open edge');
    const sw = buildSwayBraces(topo, res, ID, { ...p, layerHeight: 0.6 });
    assert(sw.ribs.every((r) => r.tines > 100), 'not tied along the full height');
  });
});

Deno.test('nozzle profile: hand-drawn walls use the same thickness as worker requests', () => {
  withProfile(1.6, 6, (p) => {
    const tris = block(-60, 60, -30, 30, 100, 110);
    const drawn = drawnWall([-40, 0, 100], [40, 0, 100], tris, 0, { tines: false });
    assert(drawn.ok, drawn.reason);
    const body = drawn.tris.filter((v) => v[2] > 1 && v[2] < 99);
    assertClose(bbox(body).hi[1] - bbox(body).lo[1], p.wallThickness, 1e-6, 'drawn wall width');
    assert(isClosed(drawn.tris), 'drawn wall has an open edge');
  });
});

Deno.test('nozzle profile: large-nozzle automatic fins build in Auto and Full coverage', () => {
  withProfile(1.6, 4, () => {
    const topo = tiltedBlockTopo(-80, 80, -60, 60, 0, 120, 40), res = analyze(topo, 45, ID);
    for (const mode of ['auto', 'full']) {
      const b = fins.buildFins(topo, res, ID, { mode, tines: true, layerHeight: 0.6,
        tunables: structuredClone({ nozzle: 1.6, wallLines: 4 }) });
      assert(b.triangles.length > 0, `${mode}: no supports`);
      assert(isClosed(b.triangles), `${mode}: open support mesh`);
      assert(b.triangles.every((v) => v.every(Number.isFinite)), `${mode}: invalid vertex`);
    }
  });
});

Deno.test('nozzle profile: meter-high geometry survives STL and separate-object 3MF export', async () => {
  const { partTris, supports } = withProfile(1.6, 8, () => {
    const topo = blockTopo(-80, 80, -60, 60, 0, 1000), res = analyze(topo, 45, ID);
    const built = fins.buildFins(topo, res, ID, { tines: true, layerHeight: 0.6,
      sway: { on: true }, tunables: { nozzle: 1.6, wallLines: 8 } });
    const partTris = [];
    for (let i = 0; i < topo.pos.length; i += 3) partTris.push([
      topo.pos[i] + res.offset.x, topo.pos[i + 1] + res.offset.y, topo.pos[i + 2] + res.offset.z]);
    return { partTris, supports: built.triangles };
  });
  const stl = writeBinarySTL([...partTris, ...supports]);
  const positions = readSTL(new Uint8Array(await stl.arrayBuffer()));
  assert(positions.length === 3 * (partTris.length + supports.length), 'STL lost triangles');
  const mf = writeThreeMF(partTris, supports, 'meter post', { separate: true });
  const loaded = await readThreeMF(new Uint8Array(await mf.arrayBuffer()));
  assert(loaded.objects.length === 2, '3MF did not keep part and supports separate');
  const finObj = loaded.objects.find((o) => o.name.endsWith(' supports'));
  assert(finObj.positions.length === supports.length * 3, '3MF lost support triangles');
  for (const axis of [0, 1, 2]) {
    const want = bbox(supports);
    const got = [];
    for (let i = axis; i < finObj.positions.length; i += 3) got.push(finObj.positions[i]);
    // 3MF translates both objects onto the plate; their extent must stay identical.
    let lo = Infinity, hi = -Infinity;
    for (const v of got) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    assertClose(hi - lo, want.hi[axis] - want.lo[axis], 1e-3, `export extent ${axis}`);
  }
});

Deno.test('nozzle profile: default profile preserves the print-tested Sway thickness floor', () => {
  for (const height of [50, 249, 1000]) withProfile(0.4, 2, (p) => {
    const topo = blockTopo(-60, 60, -30, 30, 0, height), result = analyze(topo, 45, ID);
    const built = buildSwayBraces(topo, result, ID, { ...p, tines: false });
    assert(built.ribs.length > 0);
    for (const r of built.ribs) assertClose(r.th, Math.max(p.wallThickness,
      Math.min(2.4, 1.2 + 0.004 * r.height)), 1e-8);
  });
});

Deno.test('nozzle profile: profile-to-legacy reuse restores geometry without resetting material', () => {
  const before = [fins.FIN, prop.PROP, PERP].map((o) => ({ ...o }));
  try {
    const topo = blockTopo(-60, 60, -30, 30, 0, 249), res = analyze(topo, 45, ID);
    const opts = { mode: 'auto', tines: true, sway: { on: true } };
    const expected = fins.buildFins(topo, res, ID, opts);
    fins.buildFins(topo, res, ID, { ...opts, tunables: { nozzle: 1.6, wallLines: 8 } });
    const actual = fins.buildFins(topo, res, ID, opts);
    assert(JSON.stringify(actual.triangles) === JSON.stringify(expected.triangles));
    assert(prop.PROP.th === 1 && PERP.th === 1.2 && fins.FIN.nozzle === null);
    fins.applyTunables({ nozzle: 1.6, wallLines: 8 });
    fins.applyTunables({ propGap: 0.3 });
    assert(prop.PROP.th === 1 && prop.PROP.gap === 0.3);
    fins.applyTunables({ nozzle: 1.6, wallLines: 8 });
    fins.applyTunables({ nozzle: null, wallLines: 2 });
    assert(prop.PROP.th === 1 && fins.FIN.nozzle === null);
  } finally {
    [fins.FIN, prop.PROP, PERP].forEach((o, i) => Object.assign(o, before[i]));
  }
});
