// A FREE edge (the overhang ends in air) gets a row at the end, flush
// (PROP.edgeInset): the old mid-strip rows left a lip of up to half a pitch past
// the last wall, and on the slenderness coupon a 4 mm lip curled on every ledge.
// An attached edge -- the part carries on -- gets no extra row.
import { buildTopology, analyze, fins, prop, block, assert } from './_util.js';

const { PROP } = prop;
const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const topoOf = (tris) => buildTopology({ getAttribute: (k) => (k === 'position' ? { array: tris } : null) });
// wall centre x's, back in the model's own frame (buildFins works seated)
const wallXs = (tris) => {
  const topo = topoOf(tris), res = analyze(topo, 45, I);
  const b = fins.buildFins(topo, res, I, { mode: 'auto', bedPad: true, tines: true, coverage: 0.5 });
  return b.props.map((q) => q.line.reduce((s, p) => s + p[0], 0) / q.line.length - res.offset.x).sort((a, c) => a - c);
};

Deno.test('free edge: a ledge off a spine gets a wall flush with its free edge, not the spine', () => {
  // spine x -2..2 up to z 30; ledge x 2..10 (8 mm deep), 40 mm long, underside at z 15
  const xs = wallXs(new Float32Array([...block(-2, 2, -20, 20, 0, 30), ...block(2, 10, -20, 20, 15, 17)]));
  assert(xs.length >= 1, 'no wall under the ledge');
  const outer = xs[xs.length - 1];
  assert(Math.abs(outer - (10 - PROP.edgeInset)) < 0.05, `outermost wall at x ${outer.toFixed(2)}, expected flush at ${10 - PROP.edgeInset}`);
  assert(xs[0] > 2 + PROP.th / 2 + PROP.sideClear - 1e-6, `a wall stands against the spine at x ${xs[0].toFixed(2)}`);
});

Deno.test('free edge: an overhang free on both sides gets a wall at each end', () => {
  // a T: a post up the middle, a 16 mm deck across it, underside at z 15
  const xs = wallXs(new Float32Array([...block(-2, 2, -20, 20, 0, 17), ...block(-8, 8, -20, 20, 15, 17)]));
  assert(xs.some((x) => Math.abs(x - (-8 + PROP.edgeInset)) < 0.05), `no flush wall at the -x edge: ${xs.map((x) => x.toFixed(2))}`);
  assert(xs.some((x) => Math.abs(x - (8 - PROP.edgeInset)) < 0.05), `no flush wall at the +x edge: ${xs.map((x) => x.toFixed(2))}`);
});
