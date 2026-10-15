// surfaceZAt (web/prop/surface.js) stops scanning a cell once no triangle left in
// it can reach below the best height so far. It must still return EXACTLY the
// lowest height a full scan finds -- the bed pad, wall tops and wedge feet all
// stand on that number.
import { assert, loadModel, prop } from './_util.js';

const { surfaceZAt } = prop;

// zOn + the minimum over every triangle: the scan surfaceZAt used to do.
function scan(tris, x, y) {
  let best = Infinity;
  for (let i = 0; i < tris.length; i += 9) {
    const ax = tris[i], ay = tris[i + 1], az = tris[i + 2];
    const bx = tris[i + 3], by = tris[i + 4], bz = tris[i + 5];
    const cx = tris[i + 6], cy = tris[i + 7], cz = tris[i + 8];
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(den) < 1e-12) continue;
    const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / den;
    const l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / den;
    const l3 = 1 - l1 - l2;
    if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
    const z = l1 * az + l2 * bz + l3 * cz;
    if (z < best) best = z;
  }
  return best === Infinity ? null : best;
}

// surfaceZAt sorts a grid's lists only once the grid has been asked more than
// 2000 * (1 + triangles / 1000) times (LOW_FIRST_AFTER in surface.js), so a test
// that only probes a few hundred points never reaches the early exit. Ask at a
// vertex (a point off the grid isn't counted) until the grid has sorted.
function warm(tris) {
  const need = 2000 * (1 + tris.length / 9 / 1000) + 1;
  for (let k = 0; k < need; k++) surfaceZAt(tris, tris[0], tris[1]);
}

function seated(topo, ax, dz) {
  const c = Math.cos(ax), s = Math.sin(ax), p = topo.pos, out = new Float64Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    out[i] = p[i];
    out[i + 1] = c * p[i + 1] - s * p[i + 2];
    out[i + 2] = s * p[i + 1] + c * p[i + 2] + dz;
  }
  return out;
}

Deno.test('surfaceZAt returns exactly the full scan\'s lowest height', () => {
  let s = 99, hits = 0, n = 0;
  const r = () => ((s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9 >>> 0) / 2 ** 32);
  for (const name of ['torus', 'sphere', 'staircase', 'portal', 'tube', 'arch', 'plus', 'cone']) {
    const topo = loadModel(name);
    for (const [ax, dz] of [[0, 0], [0.7, 12], [2.1, -30]]) {   // tilted, raised, below the plate
      const tris = seated(topo, ax, dz);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let i = 0; i < tris.length; i += 3) {
        x0 = Math.min(x0, tris[i]); x1 = Math.max(x1, tris[i]);
        y0 = Math.min(y0, tris[i + 1]); y1 = Math.max(y1, tris[i + 1]);
      }
      const pts = [];
      for (let k = 0; k < 150; k++) pts.push([x0 + (x1 - x0) * (r() * 1.1 - 0.05), y0 + (y1 - y0) * (r() * 1.1 - 0.05)]);
      // on vertices and edge midpoints, where neighbouring triangles tie
      for (let k = 0; k < 40; k++) {
        const t = Math.floor(r() * (tris.length / 9)) * 9;
        pts.push([tris[t], tris[t + 1]], [(tris[t] + tris[t + 3]) / 2, (tris[t + 1] + tris[t + 4]) / 2]);
      }
      for (const path of ['plain', 'lowest-first']) {
        if (path === 'lowest-first') warm(tris);
        for (const [x, y] of pts) {
          const want = scan(tris, x, y), got = surfaceZAt(tris, x, y);
          assert(Object.is(got, want), `${name} ax ${ax} ${path}: (${x}, ${y}) gave ${got}, the scan ${want}`);
          n++;
          if (want !== null) hits++;
        }
      }
    }
  }
  assert(hits > n / 3, `too few probes over the part: ${hits} of ${n}`);
});

// A corrupt binary STL can carry NaN vertices. The plain scan skipped those
// triangles; on the lowest-first path a NaN floor made the sort's comparisons
// contradict each other (heights 5, NaN, 1: index order says 5 before NaN before 1,
// height order says 1 before 5), the lists came out unsorted, and the early exit
// stopped before the true lowest surface -- 2 here instead of 1.
Deno.test('surfaceZAt ignores NaN triangles on the lowest-first path', () => {
  const tris = [];
  for (const z of [5, NaN, 1, 4, NaN, 3, 2]) tris.push(-10, -10, z, 10, -10, z, 0, 10, z);
  const t = new Float64Array(tris);
  warm(t);
  for (const [x, y] of [[0, 0], [1, -3], [-2, 4]]) {
    const want = scan(t, x, y), got = surfaceZAt(t, x, y);
    assert(Object.is(got, want) && want === 1, `(${x}, ${y}) gave ${got}, the scan ${want}`);
  }
});
