// Full coverage (mode 'full', web/fins/fill.js): Auto, then Draw-built walls under
// the red Auto left bare. Pins that it only ADDS to Auto, that what it adds holds
// more red, stays out of the part and off Auto's supports, that the coverage slider
// sets how much it adds, that it says what it couldn't reach, and that it is
// deterministic (counts, not a clock, bound it).

import { loadModel, analyze, fins, insideCount, rotX, tiltedBlockTopo, assert } from './_util.js';

const { classify, reachOf, MUST, PLATE_Z } = await import('../web/fins/coverage.js');
const { fillReach, FILL } = await import('../web/fins/fill.js');

const OPTS = { bedPad: true, tines: true, tineDensity: 0, layerHeight: 0.2 };

/** MUST red area within 6 mm reach of a build's wall tops (the scoreboard's must held). */
function mustHeld(topo, res, rot, b) {
  const tops = [];
  for (const w of b.fins ?? []) for (const p of w.line ?? []) tops.push(p);
  const near = reachOf(tops, 6), cls = classify(topo, res, rot), off = res.offset, P = topo.pos;
  let held = 0, must = 0;
  for (let f = 0; f < topo.nFaces; f++) {
    if (!res.over[f] || cls[f] !== MUST) continue;
    const c = [0, 1, 2].map((k) => [0, 3, 6].reduce((s, o) => s + (rot[k] * P[f * 9 + o] + rot[3 + k] * P[f * 9 + o + 1]
      + rot[6 + k] * P[f * 9 + o + 2] + [off.x, off.y, off.z][k]) / 3, 0));
    must += topo.area[f];
    if (c[2] < PLATE_Z || near(c[0], c[1], c[2])) held += topo.area[f];
  }
  return { held, must };
}

// The cube at X40 (Matthew's site check): Auto's three walls sit at the thirds, so a
// 6.7 mm strip past each end wall is out of reach.
const topo = loadModel('cube');
const rot = rotX(40);
const res = analyze(topo, 45, rot);
const auto = fins.buildFins(topo, res, rot, { ...OPTS, mode: 'auto' });
const full = fins.buildFins(topo, res, rot, { ...OPTS, mode: 'full' });

Deno.test('fill: Full coverage keeps every Auto support, byte for byte, and only adds', () => {
  assert(full.triangles.length >= auto.triangles.length);
  for (let i = 0; i < auto.triangles.length; i++) {
    const a = auto.triangles[i], b = full.triangles[i];
    assert(a[0] === b[0] && a[1] === b[1] && a[2] === b[2], `Auto triangle vertex ${i} changed`);
  }
  assert(full.fins.slice(0, auto.fins.length).every((f, i) => f.id === auto.fins[i].id && !f.fill));
  assert(full.fins.slice(auto.fins.length).every((f) => f.fill), 'added fins are flagged fill');
});

Deno.test('fill: it holds more of the must-hold red than Auto, and reports the rest', () => {
  const a = mustHeld(topo, res, rot, auto), f = mustHeld(topo, res, rot, full);
  assert(full.fill, 'full mode reports its fill');
  assert(a.held < a.must - 1, 'precondition: Auto leaves the cube at X40 some red');
  assert(f.held > a.held, `no gain: ${a.held.toFixed(0)} -> ${f.held.toFixed(0)} of ${a.must.toFixed(0)}`);
  assert(Number.isFinite(full.fill.unservedArea) && Array.isArray(full.fill.unservedPts));
});

Deno.test('fill: no added wall is inside the part', () => {
  // tines off: a tine's end kisses the surface, so its vertices sit ON it (Auto's do too)
  const o = { ...OPTS, tines: false };
  const a = fins.buildFins(topo, res, rot, { ...o, mode: 'auto' }), f = fins.buildFins(topo, res, rot, { ...o, mode: 'full' });
  assert(f.fill.walls > 0, 'the cube at X40 gets fill walls');
  const n = insideCount(topo, rot, res.offset, f.triangles.slice(a.triangles.length));
  assert(n === 0, `${n} fill vertices inside the part`);
});

Deno.test('fill: added walls keep sideClear off every other support, Auto\'s and each other (fused walls do not break away)', () => {
  const box = (t, i) => [0, 1, 2].map((k) => Math.min(t[i][k], t[i + 1][k], t[i + 2][k]))
    .concat([0, 1, 2].map((k) => Math.max(t[i][k], t[i + 1][k], t[i + 2][k])));
  const pad = 0.3;   // a hair under PROP.sideClear (0.35)
  const touch = (b, o) => b[0] - pad <= o[3] && o[0] <= b[3] + pad && b[1] - pad <= o[4] && o[1] <= b[4] + pad
    && b[2] - pad <= o[5] && o[2] <= b[5] + pad;
  // every support as its own list of triangle boxes: Auto's as one, each fill wall apart
  const walls = [[]];
  for (let i = 0; i < auto.triangles.length; i += 3) walls[0].push(box(auto.triangles, i));
  for (const f of full.fins.filter((w) => w.fill)) {
    const [a, z] = f.triRanges[0], bs = [];
    for (let i = a; i < z; i += 3) bs.push(box(full.triangles, i));
    walls.push(bs);
  }
  assert(walls.length > 2, 'needs two fill walls to check them against each other');
  for (let w = 1; w < walls.length; w++) for (let v = 0; v < w; v++) {
    for (const b of walls[w]) for (const o of walls[v]) assert(!touch(b, o), `fill wall ${w} within ${pad} mm of support ${v}`);
  }
});

Deno.test('fill: at every slider setting Full holds at least what Auto does, and adds a wall where Auto left red', () => {
  // the slider also sets Auto's own rows (1 wall at 0, 7 at 1 on this cube), so the
  // fill's count isn't monotonic -- what is: sparse still adds a wall where Auto left
  // red, and Full coverage at any setting holds at least what Auto does
  for (const coverage of [0, 0.5, 1]) {
    const a = fins.buildFins(topo, res, rot, { ...OPTS, mode: 'auto', coverage });
    const f = fins.buildFins(topo, res, rot, { ...OPTS, mode: 'full', coverage });
    const ha = mustHeld(topo, res, rot, a), hf = mustHeld(topo, res, rot, f);
    assert(hf.held >= ha.held - 1e-6, `coverage ${coverage}: Full holds less than Auto`);
    if (f.fill.bareBefore > 50) assert(f.fill.walls >= 1, `coverage ${coverage}: ${f.fill.bareBefore.toFixed(0)} mm2 bare, no fill wall`);
  }
  assert(fillReach(0.5) === 6 && fillReach(1) === FILL.denseReach && fillReach(0) === 6);
});

Deno.test('fill: deterministic -- the same build twice', () => {
  const again = fins.buildFins(topo, res, rot, { ...OPTS, mode: 'full' });
  assert(again.triangles.length === full.triangles.length && again.fill.walls === full.fill.walls);
  for (let i = 0; i < again.triangles.length; i++) {
    const a = again.triangles[i], b = full.triangles[i];
    assert(a[0] === b[0] && a[1] === b[1] && a[2] === b[2], `vertex ${i} differs between runs`);
  }
});

Deno.test('fill: a cap stops it and says so', () => {
  const keep = FILL.maxWalls;
  FILL.maxWalls = 1;
  try {
    const f = fins.buildFins(topo, res, rot, { ...OPTS, mode: 'full' });
    assert(f.fill.walls === 1 && f.fill.capped, `walls ${f.fill.walls}, capped ${f.fill.capped}`);
    assert(f.fill.unservedArea > 0, 'the red the cap left is reported');
  } finally { FILL.maxWalls = keep; }
  assert(!full.fill.capped, 'uncapped at the defaults');
});

Deno.test('fill: Auto mode never runs the fill', () => {
  assert(auto.fill === undefined);
});

// drawnLine's `under` (the fill's pick): a column through a thick slab tilted 50deg
// meets its underside AND its top face. With the line's height guess nearer the top
// face -- a leaning figure's curved back, where a straight guess between the ends
// strays toward the front -- Draw's own pick takes the top face; `under` keeps the
// underside, the red a wall is for.
Deno.test('fill: drawnLine under=true follows the underside where the plain pick takes the top face', async () => {
  const { drawnLine } = await import('../web/draw.js');
  const { seatedPartTris } = await import('../web/fins/seating.js');
  const slab = tiltedBlockTopo(-15, 15, -20, 20, -6, 6, 50);
  const id = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const tris = seatedPartTris(slab, id, { x: 0, y: 0, z: 0 });
  // along x at y = 0, height guess 3 mm under the top face's height there
  const zs = (await import('../web/prop.js')).surfaceHitsAt(tris, 0, 0).sort((p, q) => p[0] - q[0]);
  assert(zs.length === 2 && zs[0][1] < 0 && zs[1][1] > 0, `column: ${JSON.stringify(zs)}`);
  const hint = zs[1][0] - 3;
  assert(Math.abs(hint - zs[1][0]) < Math.abs(hint - zs[0][0]), 'precondition: the guess is nearer the top face');
  // PART_BAND, as drawnWall's part-attached probe runs it (an unbounded band settles
  // any line down to the lowest surface anyway)
  const { PART_BAND } = await import('../web/prop.js');
  const plain = drawnLine([-10, 0, hint], [10, 0, hint], tris, undefined, PART_BAND);
  const under = drawnLine([-10, 0, hint], [10, 0, hint], tris, undefined, PART_BAND, true);
  const mid = (l) => l[Math.floor(l.length / 2)][2];
  assert(Math.abs(mid(plain) - zs[1][0]) < 1, `plain pick: ${mid(plain).toFixed(2)}, top ${zs[1][0].toFixed(2)}`);
  assert(Math.abs(mid(under) - zs[0][0]) < 1, `under pick: ${mid(under).toFixed(2)}, underside ${zs[0][0].toFixed(2)}`);
});

Deno.test('fill: pass 2 walls a low ledge with a squat wall (stations under minHeight + gap used to be cut)', async () => {
  // a 4 x 3 mm tab 1.5 mm over the plate off a block's side (a figure's cleat sole):
  // under minHeight + gap (1.7), over the squat floor; Auto drops it as a sliver
  const { block, buildTopology } = await import('./_util.js');
  const pos = new Float32Array([...block(-10, 10, -10, 10, 0, 20), ...block(-2, 2, 9.99, 13, 1.5, 6)]);
  const tab = buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
  const id = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const r = analyze(tab, 45, id);
  const a = fins.buildFins(tab, r, id, { ...OPTS, mode: 'auto' });
  const f = fins.buildFins(tab, r, id, { ...OPTS, mode: 'full' });
  assert(a.props.length === 0, `precondition: Auto walls the tab (${a.props.length} walls)`);
  const fw = f.props.filter((q) => q.fill);
  assert(fw.length === 1 && fw[0].squat, `expected one squat fill wall, got ${fw.map((q) => `h${q.height.toFixed(1)}${q.squat ? ' squat' : ''}`).join(', ') || 'none'}`);
});
