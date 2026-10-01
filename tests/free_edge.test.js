// A FREE edge (the overhang ends in air) has its end row moved out flush
// (PROP.edgeInset): the old mid-strip rows left a lip of up to half a pitch past
// the last wall, and on the slenderness coupon a 4 mm lip curled on every ledge.
// Moved, not added: #143 added one and kept the old rows, so every free edge got
// two walls ~6 mm apart (a cube at X20-30 3 -> 5 walls). An attached edge -- the
// part carries on -- keeps its row where it was.
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

Deno.test('free edge: the end row moves out, it is not doubled -- a 40 mm deck keeps 3 walls', () => {
  // a deck 40 mm across x and 80 long in y, a post under each y end: the walls
  // run along y, both x edges free. Mid-strip it got 3 rows at -13.3, 0, 13.3;
  // #143 added flush rows beside the outer two (5 walls).
  const xs = wallXs(new Float32Array([...block(-20, 20, 40, 44, 0, 17), ...block(-20, 20, -44, -40, 0, 17),
                                      ...block(-20, 20, -40, 40, 15, 17)]));
  const gaps = xs.slice(1).map((x, i) => x - xs[i]);
  assert(Math.min(...gaps) > 9, `two walls ${Math.min(...gaps).toFixed(2)} mm apart: ${xs.map((x) => x.toFixed(2))}`);
  assert(Math.abs(xs[0] - (-20 + PROP.edgeInset)) < 0.05 && Math.abs(xs.at(-1) - (20 - PROP.edgeInset)) < 0.05,
    `end walls not flush: ${xs.map((x) => x.toFixed(2))}`);
});
