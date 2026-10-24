import { assert, assertClose, isClosed, block } from './_util.js';
import { recessedBody } from './_circular.js';
import { circularBore } from './_bore.js';
import { buildTopology, analyze, IDENTITY3 } from '../web/overhangs.js';
import { buildFins } from '../web/fins.js';
import { heldArea } from '../web/fins/downhill.js';
import { circularRegions, circularFootprint } from '../web/prop/circular.js';
import { seatSoup } from '../plugins/shared/engine/seat.js';
import { computeFins } from '../plugins/shared/engine/fins_entry.js';

function run(shape = {}, options = {}, reorder = false, positions = null) {
  let { pos } = seatSoup(positions ?? recessedBody(shape));
  if (reorder) {
    const ordered = pos.slice();
    for (let f = 0; f < pos.length / 9; f++) ordered.set(pos.subarray(f * 9, f * 9 + 9), pos.length - (f + 1) * 9);
    pos = ordered;
  }
  const topo = buildTopology({ getAttribute: () => ({ array: pos }) });
  const result = analyze(topo, 70, IDENTITY3);
  const previous = globalThis.__TINECAP;
  globalThis.__TINECAP = [];
  try {
    const built = buildFins(topo, result, IDENTITY3, { mode: 'auto', coverage: 1,
      tines: true, tineDensity: 1, bedPad: false, tunables: { propGap: 0.3 }, ...options });
    return { topo, result, built, count: built.braceCount + built.propCount,
      held: heldArea(topo, result, IDENTITY3, built),
      grip: Math.min(...globalThis.__TINECAP.map((t) => t.z)) };
  } finally { globalThis.__TINECAP = previous; }
}

Deno.test('circular: measurements recover the local radial profile and reject an ellipse', () => {
  const r = run();
  const frames = circularRegions(r.topo, r.result, IDENTITY3);
  assert(frames.size === 1);
  const frame = frames.values().next().value;
  assertClose(frame.innerRadius, 15, 1e-5);
  assertClose(frame.outerRadius, 25, 1e-5);
  assertClose(frame.radialProfile[0][1], 10, 1e-5);
  assertClose(frame.angularExtent[1], 2 * Math.PI, 1e-12);
  const faces = r.result.regions[0].faces;
  const tris = Float64Array.from(faces.flatMap((f) => Array.from(r.topo.pos.subarray(f * 9, f * 9 + 9))));
  for (let i = 0; i < tris.length; i += 3) tris[i] *= 1.1;
  assert(circularFootprint(tris) === null);
  assert(circularFootprint(tris.subarray(0, 90)) === null, 'partial arc must retain its old path');
});

Deno.test('circular: translation, yaw, body height and triangle order preserve counts and grip', () => {
  const base = run();
  assert(base.count > 0 && Number.isFinite(base.grip));
  for (const yaw of [0, 5, 15, 30, 90]) for (const height of [40, 80]) {
    const next = run({ yaw, height, translate: [137.231, -211.887, 4.5] }, {}, true);
    assert(next.count === base.count, `yaw ${yaw}, height ${height}: ${next.count} vs ${base.count}`);
    assert(next.built.tines === base.built.tines, `tines at ${yaw}`);
    assertClose(next.held, base.held, 0.01, 'held area');
    assertClose(next.grip, base.grip, 0.01, 'lowest grip');
  }
});

Deno.test('circular: representative tessellations retain counts and high coverage', () => {
  const base = run();
  for (const segments of [48, 96, 120, 240]) for (const yaw of [0, 5, 15, 30, 90]) {
    const next = run({ segments, yaw });
    assert(next.count === base.count, `${segments} faces at ${yaw}: ${next.count} vs ${base.count}`);
    const area = next.result.regions.reduce((a, r) => a + r.faces.reduce((b, f) => b + next.topo.area[f], 0), 0);
    assert(next.held >= area * 0.99, `coverage ${next.held / area}`);
  }
});

Deno.test('circular: counts follow coverage and a changed recess, not unrelated body height', () => {
  const counts = [0, 0.5, 1].map((coverage) => run({}, { coverage }).count);
  assert(counts[0] <= counts[1] && counts[1] < counts[2], `coverage counts ${counts}`);
  const changed = run({ bore: 10, depth: 15 });
  assert(changed.count !== counts[2], 'different radial geometry may need a different count');
});

Deno.test('circular: shared adapter agrees with browser engine and output remains closed', () => {
  const browser = run();
  const shared = computeFins(recessedBody(), { threshold: 70, coverage: 1, gap: 0.3,
    bedPad: false, tines: true, tineDensity: 1 });
  assert(shared.stats.braces + shared.stats.props === browser.count);
  assert(shared.stats.tines === browser.built.tines);
  assert(isClosed(browser.built.triangles), 'support triangles must close');
});

Deno.test('circular: two separated instances keep each feature count', () => {
  const a = recessedBody(), b = recessedBody({ translate: [110, 0, 0] });
  const pair = new Float64Array(a.length + b.length);
  pair.set(a); pair.set(b, a.length);
  const together = run({}, {}, false, pair), single = run();
  assert(together.count === 2 * single.count);
  assert(together.built.tines === 2 * single.built.tines);
});

Deno.test('circular: recognised small holes stay exempt beside a circular recess', () => {
  const recess = recessedBody();
  const hole = circularBore({ diameter: 4 }).map((v, i) => v + (i % 3 === 0 ? 100 : 0));
  // Exercise both region orders: automaticTargets filters hole regions before
  // the circular placement race indexes the remaining ones.
  for (const mode of ['auto', 'full']) for (const parts of [[hole, recess], [recess, hole]]) {
    const options = { mode, threshold: 70, coverage: 1, gap: 0.3,
      bedPad: false, tines: true, tineDensity: 1 };
    const single = computeFins(recess, options);
    const mixed = computeFins(Float64Array.from(parts.flatMap((p) => Array.from(p))), options);
    assert(mixed.stats.smallHoleRegions === 1, 'the neighbouring bore must stay exempt');
    assert(mixed.stats.braces + mixed.stats.props === single.stats.braces + single.stats.props);
    assert(mixed.stats.tines === single.stats.tines);
    assert(mixed.overFaces.length > 0 && mixed.smallFaces.length > 0, 'red recess and amber hole');
    for (let i = 0; i < mixed.triangles.length; i += 3) {
      const x = mixed.triangles[i] - mixed.offset.x;
      const y = mixed.triangles[i + 1] - mixed.offset.y;
      const z = mixed.triangles[i + 2] - mixed.offset.z;
      assert(!(Math.abs(x - 100) < 14.9 && Math.hypot(y, z - 10) < 1.99), 'support inside exempt bore');
    }
  }
});

Deno.test('circular: Sparse, Default and Full preserve counts across rotations', () => {
  for (const options of [{ coverage: 0 }, { coverage: 0.5 }, { mode: 'full', coverage: 0.5 }]) {
    const base = run({}, options);
    for (const yaw of [5, 15, 30, 90]) {
      const next = run({ yaw }, options);
      assert(next.count === base.count, `${JSON.stringify(options)} at ${yaw}`);
      assertClose(next.held, base.held, 0.01);
      assertClose(next.grip, base.grip, 0.01);
    }
  }
});

Deno.test('circular: nearby obstruction fixes the phase in the feature frame', () => {
  const base = recessedBody(), obstacle = block(19, 21, -1, 1, 0, 2);
  const raw = new Float64Array(base.length + obstacle.length);
  raw.set(base); raw.set(obstacle, base.length);
  for (const yaw of [0, 5, 15, 30, 90]) {
    const a = yaw * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), pos = raw.slice();
    for (let i = 0; i < pos.length; i += 3) {
      pos[i] = c * raw[i] - s * raw[i + 1];
      pos[i + 1] = s * raw[i] + c * raw[i + 1];
    }
    const topo = buildTopology({ getAttribute: () => ({ array: pos }) });
    const result = analyze(topo, 70, IDENTITY3);
    const frame = circularRegions(topo, result, IDENTITY3).values().next().value;
    assert(frame.surrounding.phase !== null);
    assertClose(Math.cos(frame.phase), c, 1e-6);
    assertClose(Math.sin(frame.phase), s, 1e-6);
  }
});
