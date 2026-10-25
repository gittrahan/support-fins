// Long walls (Full coverage, web/fins/rows.js + fins/field.js): rows of long walls
// along the model's length before the fill pass's patch lines. Pins that the rows
// build where they should, never leave more red bare than the patch lines alone
// (fillCoverage keeps whichever leaves less), stay out of the part and off each
// other, that Long walls off is the patch fill alone, and the length field's calls.

import { loadModel, analyze, fins, insideCount, rotX, assert } from './_util.js';

const { headingField } = await import('../web/fins/field.js');

const OPTS = { bedPad: true, tines: true, tineDensity: 0, layerHeight: 0.2, mode: 'full' };
const build = (name, rot, o = {}) => {
  const topo = loadModel(name), res = analyze(topo, 45, rot);
  return { topo, res, b: fins.buildFins(topo, res, rot, { ...OPTS, ...o }) };
};

// the sphere and the tube at X40: rows win there (measured 24.2 -> 17.5 and 14.8 -> 9.0 mm2
// bare; the L-bracket was the first, until Auto's flush end walls left it ~nothing, #269)
for (const name of ['sphere', 'tube']) {
  Deno.test(`rows: ${name} at X40 gets rows, and they leave less red bare than the patch lines alone`, () => {
    const on = build(name, rotX(40)).b, off = build(name, rotX(40), { longWalls: false }).b;
    assert(on.fill.rows > 0, `${name}: no rows`);
    assert(off.fill.rows === 0, `${name}: rows with Long walls off`);
    assert(on.fill.unservedArea < off.fill.unservedArea,
      `${name}: ${on.fill.unservedArea.toFixed(1)} mm2 bare with rows, ${off.fill.unservedArea.toFixed(1)} without`);
  });
}

// (true by construction of fillCoverage's race: this pins that the race is wired up)
Deno.test('rows: where the rows lose (wedge, ramp, torus, bar at X40) the build is the patch fill\'s, no more red bare', () => {
  for (const name of ['wedge', 'ramp', 'torus', 'bar']) {
    const on = build(name, rotX(40)).b, off = build(name, rotX(40), { longWalls: false }).b;
    assert(on.fill.unservedArea <= off.fill.unservedArea,
      `${name}: ${on.fill.unservedArea.toFixed(1)} mm2 bare with Long walls, ${off.fill.unservedArea.toFixed(1)} without`);
  }
});

Deno.test('rows: Plate only -- rows still build, none stands on the part', () => {
  const b = build('sphere', rotX(40), { plateOnly: true }).b;
  assert(b.fill.rows > 0, 'no rows with Plate only');
  assert(!b.props.some((q) => q.partAttached), 'a wall stands on the part');
});

Deno.test('rows: not under the sparse slider (one wall per group)', () => {
  const b = build('sphere', rotX(40), { coverage: 0.1 }).b;
  assert(b.fill.rows === 0 && b.fill.rowBuilds === 0, `rows ${b.fill.rows}, builds ${b.fill.rowBuilds}`);
});

Deno.test('rows: no row is inside the part, and rows keep sideClear off every other support', () => {
  // tines off: a tine's end kisses the surface, so its vertices sit ON it
  const rot = rotX(40);
  const { topo, res, b } = build('sphere', rot, { tines: false });
  const a = fins.buildFins(topo, res, rot, { ...OPTS, tines: false, mode: 'auto' });
  assert(b.fill.rows > 0);
  const n = insideCount(topo, rot, res.offset, b.triangles.slice(a.triangles.length));
  assert(n === 0, `${n} fill vertices inside the part`);
  const box = (t, i) => [0, 1, 2].map((k) => Math.min(t[i][k], t[i + 1][k], t[i + 2][k]))
    .concat([0, 1, 2].map((k) => Math.max(t[i][k], t[i + 1][k], t[i + 2][k])));
  const pad = 0.3, FL = 0.65;   // a hair under PROP.sideClear; flanges (baseH + 0.05) may join on the plate (#196)
  const touch = (p, o) => p[0] - pad <= o[3] && o[0] <= p[3] + pad && p[1] - pad <= o[4] && o[1] <= p[4] + pad
    && p[2] - pad <= o[5] && o[2] <= p[5] + pad && !(Math.max(p[2], o[2]) <= FL && Math.min(p[5], o[5]) <= FL);
  const walls = [[]], joined = [false];
  for (let i = 0; i < a.triangles.length; i += 3) walls[0].push(box(a.triangles, i));
  for (const f of b.fins.filter((w) => w.fill)) {
    const [s, z] = f.triRanges[0], bs = [];
    for (let i = s; i < z; i += 3) bs.push(box(b.triangles, i));
    walls.push(bs);
    joined.push(!!f.joined);
  }
  for (let w = 1; w < walls.length; w++) for (let v = 0; v < w; v++) {
    if (v > 0 && joined[w]) continue;
    for (const p of walls[w]) for (const o of walls[v]) assert(!touch(p, o), `fill wall ${w} within ${pad} mm of support ${v}`);
  }
});

Deno.test('rows: deterministic -- the same build twice', () => {
  const x = build('tube', rotX(40)).b, y = build('tube', rotX(40)).b;
  assert(x.triangles.length === y.triangles.length && x.fill.rows === y.fill.rows);
  for (let i = 0; i < x.triangles.length; i++) {
    const p = x.triangles[i], q = y.triangles[i];
    assert(p[0] === q[0] && p[1] === q[1] && p[2] === q[2], `vertex ${i} differs between runs`);
  }
});

Deno.test('field: a bar on its side runs along y; a cube or the bar upright (a square footprint) has none', () => {
  const at = (name, rot) => {
    const topo = loadModel(name), res = analyze(topo, 45, rot);
    let x = 0, y = 0, n = 0;
    const off = res.offset, P = topo.pos;
    for (let i = 0; i < P.length; i += 3) { x += rot[0] * P[i] + rot[3] * P[i + 1] + rot[6] * P[i + 2] + off.x;
      y += rot[1] * P[i] + rot[4] * P[i + 1] + rot[7] * P[i + 2] + off.y; n++; }
    return headingField(topo, res, rot)(x / n, y / n);
  };
  const side = at('bar', rotX(90));
  assert(side === Math.PI / 2, `bar on its side: heading ${side}`);
  assert(at('bar', rotX(0)) === null, 'the bar upright has no length in plan');
  assert(at('cube', rotX(0)) === null, 'a cube upright has no length');
});
