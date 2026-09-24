// KEEL (issue #25, request 1): a region that is lowest along a LINE -- the overhang
// strip under a tilted cylinder -- gets its fin ON that line, where the overhang is
// greatest, instead of rows spread evenly across the strip that straddle it and
// leave it bare. The reporter's picture: one triangular fin from the plate to the
// top of a tipped cylinder. Walls are added outward only where the strip is too
// wide for the keel to reach, and a region the keel can't hold keeps its rows.

import { fins, prop, loadModel, analyze, rotX, readSTL, buildTopology, assert } from './_util.js';

// A surface z = f(x, y) over a grid, as keelLines takes it: flat triangles plus
// the points buildProps passes (vertices and centroids).
function surface(f, x0 = -20, x1 = 20, y0 = -30, y1 = 30, h = 2) {
  const tris = [], pts = [];
  const P = (x, y) => [x, y, f(x, y)];
  for (let x = x0; x < x1 - 1e-9; x += h) {
    for (let y = y0; y < y1 - 1e-9; y += h) {
      for (const t of [[P(x, y), P(x + h, y), P(x + h, y + h)], [P(x, y), P(x + h, y + h), P(x, y + h)]]) {
        for (const v of t) { tris.push(...v); pts.push(v); }
        pts.push([0, 1, 2].map((k) => (t[0][k] + t[1][k] + t[2][k]) / 3));
      }
    }
  }
  return { tris: new Float64Array(tris), pts };
}

Deno.test('keel: a straight trough gets one wall down its lowest line', () => {
  // lowest along x = 3, rising 0.5 per mm along y, climbing to both sides
  const { tris, pts } = surface((x, y) => 10 + 0.5 * y + 0.03 * (x - 3) ** 2, -8, 14);
  const lines = prop.keelLines(pts, tris);
  assert(lines && lines.length === 1, `want one keel wall, got ${lines?.length}`);
  const xs = lines[0].map((p) => p[0]);
  assert(xs.every((x) => Math.abs(x - 3) < 1.5), `keel off the lowest line: x ${Math.min(...xs).toFixed(1)}..${Math.max(...xs).toFixed(1)}`);
});

Deno.test('keel: a tilted FLAT face is no keel (its lowest line is an edge)', () => {
  const { tris, pts } = surface((x, y) => 10 + 0.8 * y);
  assert(prop.keelLines(pts, tris) === null, 'a flat face was given a keel');
});

Deno.test('keel: a BOWL is no keel (lowest at a point, not along a line)', () => {
  const { tris, pts } = surface((x, y) => 10 + 0.02 * (x * x + y * y));
  assert(prop.keelLines(pts, tris) === null, 'a bowl was given a keel');
});

Deno.test('keel: the tipped cylinder gets ONE fin on its lowest line (the issue\'s picture)', () => {
  const topo = loadModel('cylinder'), rot = rotX(55);
  const b = fins.buildFins(topo, analyze(topo, 45, rot), rot, { mode: 'auto', bedPad: true, tines: true });
  assert(b.props.length === 1, `want one fin, got ${b.props.length}`);
  const L = b.props[0].line, zs = L.map((p) => p[2]);
  assert(L.every((p) => Math.abs(p[0]) < 1.5), 'the fin is off the lowest line (x = 0)');
  assert(Math.min(...zs) < 3 && Math.max(...zs) > 30, `the fin doesn't run plate to top: z ${Math.min(...zs).toFixed(0)}..${Math.max(...zs).toFixed(0)}`);
  assert(b.unserved === 0, `${b.unserved} regions unserved`);
});

Deno.test('keel: a wider strip keeps the fin on the lowest line and adds one each side', () => {
  const topo = loadModel('cylinder'), rot = rotX(65);
  const b = fins.buildFins(topo, analyze(topo, 45, rot), rot, { mode: 'auto', bedPad: true, tines: true });
  const mid = b.props.map((q) => q.line.reduce((a, p) => a + p[0], 0) / q.line.length);
  assert(mid.some((x) => Math.abs(x) < 1.5), `no wall on the lowest line: ${mid.map((x) => x.toFixed(0))}`);
  assert(mid.some((x) => x < -5) && mid.some((x) => x > 5), `not held on both sides: ${mid.map((x) => x.toFixed(0))}`);
  assert(b.unserved === 0, `${b.unserved} regions unserved`);
});

Deno.test('keel: never in a pocket -- bore_bracket keeps the wedges that grip it low', () => {
  // A small curved region (a bore) is lowest along a line too; a keel there
  // displaced the wedges that gripped this part from 1.2mm up.
  const pos = readSTL(Deno.readFileSync(new URL('../web/dev-models/bore_bracket.stl', import.meta.url)));
  const topo = buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
  globalThis.__TINECAP = [];
  fins.buildFins(topo, analyze(topo, 45, rotX(45)), rotX(45), { mode: 'auto', bedPad: true, tines: true, coverage: 1 });
  const low = Math.min(...globalThis.__TINECAP.map((t) => t.z));
  globalThis.__TINECAP = undefined;
  assert(low < 2, `lowest tine at ${low.toFixed(1)}mm, want the wedges' 1.2mm`);
});
