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
// each wall's plan extent, model frame: { x0, x1, y0, y1 }
const wallBoxes = (tris) => {
  const topo = topoOf(tris), res = analyze(topo, 45, I);
  const b = fins.buildFins(topo, res, I, { mode: 'auto', bedPad: true, tines: true, coverage: 0.5 });
  return b.props.map((q) => {
    const xs = q.line.map((p) => p[0] - res.offset.x), ys = q.line.map((p) => p[1] - res.offset.y);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  });
};

Deno.test('free edge: a ledge off a spine -- walls run out to its free edge, end rows flush with its free ends', () => {
  // spine x -2..2 up to z 30; ledge x 2..10 (8 mm deep), 40 mm long, underside at z 15.
  // The walls cross the slicer's bridge lines (038: PrusaSlicer bridges this ledge
  // along its 40 mm length), so they run out from the spine: each reaches the free
  // edge, none stands against the spine, and the end rows sit flush at y = +-20.
  const ws = wallBoxes(new Float32Array([...block(-2, 2, -20, 20, 0, 30), ...block(2, 10, -20, 20, 15, 17)]));
  assert(ws.length >= 2, `${ws.length} walls under the ledge`);
  for (const w of ws) {
    assert(w.x1 > 10 - PROP.edgeInset - 1e-6, `a wall stops at x ${w.x1.toFixed(2)}, short of the free edge`);
    assert(w.x0 > 2 + PROP.th / 2 - 1e-6, `a wall runs into the spine at x ${w.x0.toFixed(2)}`);
  }
  const ys = ws.map((w) => (w.y0 + w.y1) / 2).sort((a, c) => a - c);
  assert(Math.abs(ys[0] + 20 - PROP.edgeInset) < 0.05 && Math.abs(ys.at(-1) - 20 + PROP.edgeInset) < 0.05,
    `end rows not flush with the ledge's free ends: ${ys.map((y) => y.toFixed(2))}`);
});

Deno.test('free edge: an overhang free on both sides gets a wall at each end', () => {
  // a T: a post up the middle, a 16 mm deck across it, underside at z 15
  const xs = wallXs(new Float32Array([...block(-2, 2, -20, 20, 0, 17), ...block(-8, 8, -20, 20, 15, 17)]));
  assert(xs.some((x) => Math.abs(x - (-8 + PROP.edgeInset)) < 0.05), `no flush wall at the -x edge: ${xs.map((x) => x.toFixed(2))}`);
  assert(xs.some((x) => Math.abs(x - (8 - PROP.edgeInset)) < 0.05), `no flush wall at the +x edge: ${xs.map((x) => x.toFixed(2))}`);
});

Deno.test('free edge: the end row moves out, it is not doubled -- a deck between two posts', () => {
  // a deck 40 mm across x and 80 long in y, a post beside each y end: the slicer
  // bridges post to post (along y), so the walls run along x, out to both free
  // x edges. The end rows sit by the posts; no row is doubled (#143 doubled them).
  const ws = wallBoxes(new Float32Array([...block(-20, 20, 40, 44, 0, 17), ...block(-20, 20, -44, -40, 0, 17),
                                         ...block(-20, 20, -40, 40, 15, 17)]));
  for (const w of ws) {
    assert(w.x1 - w.x0 > w.y1 - w.y0, `a wall runs along y (${w.y0.toFixed(1)}..${w.y1.toFixed(1)}), along the bridge lines`);
    assert(w.x0 < -20 + PROP.edgeInset + 1e-6 && w.x1 > 20 - PROP.edgeInset - 1e-6,
      `a wall stops short of a free edge: x ${w.x0.toFixed(2)}..${w.x1.toFixed(2)}`);
  }
  const ys = ws.map((w) => (w.y0 + w.y1) / 2).sort((a, c) => a - c);
  const gaps = ys.slice(1).map((y, i) => y - ys[i]);
  assert(Math.min(...gaps) > 9, `two walls ${Math.min(...gaps).toFixed(2)} mm apart: ${ys.map((y) => y.toFixed(2))}`);
  assert(Math.max(...gaps) < 80 / 6 + 1e-6, `a ${Math.max(...gaps).toFixed(2)} mm gap, wider than the pitch: ${ys.map((y) => y.toFixed(2))}`);
});

Deno.test('free edge: one free edge -- the walls cross the bridge out to it, the gaps stay within the pitch', () => {
  // spine x -2..2 up to z 30; ledge x 2..32 (30 deep), 60 long, underside at z 15.
  // PrusaSlicer bridges the ledge along its 60 mm length, so the walls run out from
  // the spine to the free x edge; the rows spread over the 60 mm with both y ends
  // free: end rows flush, evenly, never doubled, no gap wider than the 12 mm pitch.
  const ws = wallBoxes(new Float32Array([...block(-2, 2, -30, 30, 0, 30), ...block(2, 32, -30, 30, 15, 17)]));
  for (const w of ws) {
    assert(w.x1 - w.x0 > w.y1 - w.y0, `a wall runs along y (${w.y0.toFixed(1)}..${w.y1.toFixed(1)}), along the bridge lines`);
    assert(w.x1 > 32 - PROP.edgeInset - 1e-6, `a wall stops at x ${w.x1.toFixed(2)}, short of the free edge`);
  }
  const ys = ws.map((w) => (w.y0 + w.y1) / 2).sort((a, c) => a - c);
  const gaps = ys.slice(1).map((y, i) => y - ys[i]);
  assert(Math.abs(ys[0] + 30 - PROP.edgeInset) < 0.05 && Math.abs(ys.at(-1) - 30 + PROP.edgeInset) < 0.05,
    `end rows not flush with the ledge's free ends: ${ys.map((y) => y.toFixed(2))}`);
  assert(Math.max(...gaps) <= 12 + 1e-6, `a ${Math.max(...gaps).toFixed(2)} mm gap, wider than the 12 mm pitch: ${ys.map((y) => y.toFixed(2))}`);
  assert(Math.min(...gaps) > 9, `two walls ${Math.min(...gaps).toFixed(2)} mm apart (doubled): ${ys.map((y) => y.toFixed(2))}`);
});
