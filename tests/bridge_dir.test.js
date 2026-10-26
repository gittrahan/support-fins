// Walls under a flat overhang cross the slicer's bridge lines (local issue 038).
// A wall parallel to them holds one line and the rest sag ("junk" on the orient
// coupon); the old longer-run rule did that on every ledge off one edge. Each case
// is a shape PrusaSlicer was sliced on headless, with its measured bridge angle.
import { buildTopology, analyze, fins, block, assert, loadModel } from './_util.js';

const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const topoOf = (tris) => buildTopology({ getAttribute: (k) => (k === 'position' ? { array: tris } : null) });
// each wall's run direction: 'x' or 'y', whichever its line spans further. A rim
// wall (prop/rim.js, along a free outline) runs where the edge does: holding the
// edge beats crossing the bridge there (Matthew 2026-10-26), so only rows count.
const runs = (tris) => {
  const topo = topoOf(tris), res = analyze(topo, 45, I);
  const b = fins.buildFins(topo, res, I, { mode: 'auto', bedPad: true, tines: true, coverage: 0.5 });
  return b.props.filter((q) => !q.rimWall).map((q) => {
    const xs = q.line.map((p) => p[0]), ys = q.line.map((p) => p[1]);
    return Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys) ? 'x' : 'y';
  });
};
const all = (rs, axis, what) =>
  assert(rs.length > 0 && rs.every((r) => r === axis), `${what}: walls run ${rs.join(',') || 'nowhere'}, expected all along ${axis}`);

Deno.test('bridge direction: a wide ledge off one edge -- walls run out from the edge (Prusa bridges along it)', () => {
  // post y -10..0, ledge 28 wide (x) x 14 deep (y), underside z 25
  all(runs(new Float32Array([...block(0, 28, -10, 0, 0, 27), ...block(0, 28, 0, 14, 25, 27)])), 'y', 'wide cantilever');
});

Deno.test('bridge direction: a deep ledge off one edge -- walls run along the edge (Prusa bridges outward)', () => {
  all(runs(new Float32Array([...block(0, 14, -10, 0, 0, 27), ...block(0, 14, 0, 28, 25, 27)])), 'x', 'deep cantilever');
});

Deno.test('bridge direction: a span between two posts -- walls cross the post-to-post line, whatever the shape', () => {
  // posts at both y ends: Prusa and Cura bridge along y, so walls run along x
  all(runs(new Float32Array([...block(0, 28, -10, 0, 0, 27), ...block(0, 28, 14, 24, 0, 27),
                             ...block(0, 28, 0, 14, 25, 27)])), 'x', 'wide gap');
  all(runs(new Float32Array([...block(0, 14, -10, 0, 0, 27), ...block(0, 14, 28, 38, 0, 27),
                             ...block(0, 14, 0, 28, 25, 27)])), 'x', 'long gap');
});

Deno.test('bridge direction: a plate on a pillar -- the old walls win the race (the pillar blocks the turned middle row)', () => {
  // Prusa bridges the 28 x 14 plate the long way, so turned walls would run along y,
  // but the pillar under the middle cuts the turned rows: they hold 355 mm2 to the
  // old walls' 392, and the race keeps the old ones (along x, as on main).
  all(runs(new Float32Array([...block(12, 16, 5, 9, 0, 25.01), ...block(0, 28, 0, 14, 25, 27)])), 'x', 'pillar plate');
});

Deno.test('bridge direction: when the old walls win the race, their region still counts as served (lowledge, coverage 0)', () => {
  // the turned walls had served the region before the race undid them; the old
  // walls' build left it out, so a byte-identical build reported one unserved region
  const topo = loadModel('lowledge'), res = analyze(topo, 45, I);
  const b = fins.buildFins(topo, res, I, { mode: 'auto', bedPad: true, coverage: 0 });
  assert(b.unserved === 0, `${b.unserved} unserved regions`);
});

// closed cylinder along +Y, axis at (cx, cz): a peg small enough to be a small tube
const cylinderY = (cx, cz, r, y0, y1, n = 48) => {
  const ring = (y) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos(2 * Math.PI * i / n), y, cz + r * Math.sin(2 * Math.PI * i / n)]);
  const A = ring(y0), B = ring(y1), t = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    t.push(A[i], B[j], A[j], A[i], B[i], B[j], [cx, y0, cz], A[i], A[j], [cx, y1, cz], B[j], B[i]);
  }
  return t.flat();
};
// every wall's triangle ranges inside the build, none overlapping another's
const rangesValid = (b, what) => {
  const rs = b.props.flatMap((q) => q.triRanges).sort((a, c) => a[0] - c[0]);
  assert(b.triangles.every((t) => t !== undefined), `${what}: holes in the triangles`);
  for (let i = 0; i < rs.length; i++) {
    assert(rs[i][0] >= 0 && rs[i][1] <= b.triangles.length, `${what}: range ${rs[i]} past ${b.triangles.length}`);
    assert(i === 0 || rs[i][0] >= rs[i - 1][1], `${what}: ranges ${rs[i - 1]} and ${rs[i]} overlap`);
  }
};

Deno.test('bridge direction: a race settled at a small tube leaves the build whole (ledge, then a peg)', () => {
  // the tube's undo mark was taken before the race cut `out` back, so undoing it
  // padded `out` past its end: holes, and a crash in the short-wall pass
  for (const [dx, dy] of [[60, 0], [-60, 0], [0, 60], [0, -60]]) {
    const ledge = [...block(dx, 28 + dx, -10 + dy, dy, 0, 27), ...block(dx, 28 + dx, dy, 14 + dy, 25, 27)];
    const topo = topoOf(new Float32Array([...block(-15, 15, -10, 10, 0, 24), ...cylinderY(0, 14, 2.5, 9, 18), ...ledge]));
    for (const raster of [false, true]) {
      const b = fins.buildFins(topo, analyze(topo, 45, I), I, { mode: 'auto', bedPad: true, raster });
      rangesValid(b, `ledge at ${dx},${dy} raster ${raster}`);
    }
  }
});

Deno.test('bridge direction: the old walls winning the race leaves the build whole (pillar plate)', () => {
  const topo = topoOf(new Float32Array([...block(12, 16, 5, 9, 0, 25.01), ...block(0, 28, 0, 14, 25, 27)]));
  rangesValid(fins.buildFins(topo, analyze(topo, 45, I), I, { mode: 'auto', bedPad: true, coverage: 0.5 }), 'pillar plate');
});
