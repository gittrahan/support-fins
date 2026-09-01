// The "Tine grip" slider, and the regression it exists to make impossible.
//
// A day-plus was lost to commit c0fcf8e, which scaled tine spacing by a part's
// tip-over risk: a stable/squat part quietly fell to a sparse comb that read as a
// few nubs "laying on the face" instead of gripping (angle_bracket went 24 -> 6
// tines). The cure was to make the comb uniformly DENSE by default and expose any
// loosening as an explicit user control (opts.tineDensity / the slider), never an
// automatic downgrade. These tests pin both halves:
//   1. tineStepFor / emitTines: the knob moves spacing the way the UI promises,
//      and the per-wall grip FLOOR still holds at the sparsest setting;
//   2. through the whole buildFins pipeline: the slider changes tine count
//      monotonically, and -- the actual regression -- a STABLE, squat part still
//      gets a dense comb at the default setting (no silent tip-over sparsening).

import { tiltedBlockTopo, blockTopo, analyze, fins, prop, assert, assertClose } from './_util.js';

const { emitTines, surfaceZAt, tineStepFor, PROP } = prop;
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

// --- 1. the knob itself ----------------------------------------------------

Deno.test('tineStepFor: dense by default, sparse loosens, monotonic', () => {
  assertClose(tineStepFor(1), PROP.tineStep, 1e-9, 'density 1 should be the dense comb');
  assertClose(tineStepFor(0), PROP.tineStepSparse, 1e-9, 'density 0 should be the sparse comb');
  assertClose(tineStepFor(undefined), PROP.tineStep, 1e-9, 'DEFAULT must be dense, not sparse');
  assert(tineStepFor(0.5) > PROP.tineStep && tineStepFor(0.5) < PROP.tineStepSparse, 'mid should sit between');
  assert(tineStepFor(0) > tineStepFor(0.5) && tineStepFor(0.5) > tineStepFor(1), 'spacing must fall as density rises');
  // out-of-range is clamped, not extrapolated (a rogue input can't over-densify).
  assertClose(tineStepFor(9), PROP.tineStep, 1e-9, 'clamp above 1');
  assertClose(tineStepFor(-9), PROP.tineStepSparse, 1e-9, 'clamp below 0');
});

// A long straight contact line on a solid block: interior at y>=0, line along +Y.
function tinesAlongLine(step) {
  const topo = blockTopo(-20, 20, 0, 40, 0, 40);
  const line = [];
  for (let y = -18; y <= 18; y += 0.5) line.push([0, y, 20]);   // ~36mm run
  const out = [];
  const n = emitTines(line, null, topo, IDENTITY, { x: 0, y: 0, z: 0 }, out, step);
  return n;
}

Deno.test('emitTines: a sparser step yields fewer tines on the same long wall', () => {
  const dense = tinesAlongLine(tineStepFor(1));   // 2mm
  const sparse = tinesAlongLine(tineStepFor(0));  // 5mm
  assert(sparse < dense, `slider is inert on a long wall: dense ${dense} vs sparse ${sparse}`);
  assert(sparse >= 4, `sparse still has to be a comb, not a couple of nubs: ${sparse}`);
});

Deno.test('emitTines: the per-wall grip FLOOR survives the sparsest setting', () => {
  // A SHORT but fully-grippable wall at the sparsest spacing must still get
  // minGripTines -- the floor is what lets "sparse" thin marking without ever
  // letting a wall grip nothing. A tilted-ceiling block grips at every station.
  const topo = tiltedBlockTopo(-15, 15, -20, 20, 0, 30, 40);   // ceiling rises with +Y
  const line = [];
  for (let x = -2; x <= 2; x += 0.5) {                          // ~4mm run, < one sparse step
    const z = surfaceZAt(topo.pos, x, 0);
    if (z !== null) line.push([x, 0, z]);
  }
  const out = [];
  const n = emitTines(line, null, topo, IDENTITY, { x: 0, y: 0, z: 0 }, out, 999);
  assert(n >= PROP.minGripTines, `floor breached: short wall at max sparsity got ${n} tines (< ${PROP.minGripTines})`);
});

// --- 2. through the pipeline -----------------------------------------------

function capTines(topo, res, rot, opts) {
  globalThis.__TINECAP = [];
  fins.buildFins(topo, res, rot, { mode: 'auto', bedPad: true, tines: true, ...opts });
  const caps = globalThis.__TINECAP;
  globalThis.__TINECAP = undefined;
  return caps;
}

// median nearest-neighbour spacing across a tine cloud -- a comb reads small, a
// few scattered nubs read large. (Same measure tines_realparts.test.js uses.)
function medianNN(caps) {
  const nn = caps.map((a, i) => {
    let best = Infinity;
    caps.forEach((b, j) => { if (i !== j) best = Math.min(best, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)); });
    return best;
  }).sort((p, q) => p - q);
  return nn[nn.length >> 1];
}

Deno.test('buildFins: the slider moves tine count monotonically, dense > sparse', () => {
  const topo = tiltedBlockTopo(-40, 40, -45, 45, -6, 6, 55);   // broad tilted plate
  const res = analyze(topo, 60, IDENTITY);
  const dense = capTines(topo, res, IDENTITY, { tineDensity: 1 }).length;
  const mid = capTines(topo, res, IDENTITY, { tineDensity: 0.5 }).length;
  const sparse = capTines(topo, res, IDENTITY, { tineDensity: 0 }).length;
  assert(dense > sparse, `slider inert through the pipeline: dense ${dense} vs sparse ${sparse}`);
  assert(dense >= mid && mid >= sparse, `not monotonic: dense ${dense} -> mid ${mid} -> sparse ${sparse}`);
});

Deno.test('buildFins: the DEFAULT (no tineDensity) is the dense comb, not sparse', () => {
  const topo = tiltedBlockTopo(-40, 40, -45, 45, -6, 6, 55);
  const res = analyze(topo, 60, IDENTITY);
  const dflt = capTines(topo, res, IDENTITY, {}).length;          // omit tineDensity entirely
  const dense = capTines(topo, res, IDENTITY, { tineDensity: 1 }).length;
  assertClose(dflt, dense, 0, 'omitting the slider must equal the dense comb (default != sparse)');
});

Deno.test('REGRESSION c0fcf8e: a STABLE squat part still gets a dense comb by default', () => {
  // The exact class that regressed: a low, wide part (low tip-over risk) is where
  // the removed tip-risk scale handed out a sparse comb. At the default setting it
  // must still get a DENSE one -- grip is not conditional on a part being tippy.
  const squat = tiltedBlockTopo(-45, 45, -45, 45, -3, 3, 30);     // wide + shallow = stable
  const res = analyze(squat, 45, IDENTITY);
  const caps = capTines(squat, res, IDENTITY, {});               // default density
  assert(caps.length >= 12, `stable part starved of grip: only ${caps.length} tines (the c0fcf8e symptom)`);
  const median = medianNN(caps);
  assert(median <= 3.0, `stable part got a SPARSE comb by default (median tine spacing ${median.toFixed(1)}mm) -- tip-risk sparsening is back`);
});
