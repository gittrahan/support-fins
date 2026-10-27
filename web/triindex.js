/**
 * A uniform XY grid over a flat triangle array (9 numbers per triangle), for the
 * questions "which triangles could touch this box?" -- answered without walking
 * every triangle. Sway's lowestHit asks it once per rib iteration, and on a
 * million-face part the brute-force scan was most of the click.
 *
 * Built once per array (cached by identity) in O(n): triangles are binned by their
 * XY bounding box into a CSR layout (one Int32Array of cell starts, one of triangle
 * ids), so a 1M-face part costs two typed arrays rather than 16k JS arrays. Z is not
 * indexed: the boxes asked about are tall and thin.
 *
 * It only ever narrows the candidates. A triangle whose XY bounding box misses the
 * query box cannot touch the box, so skipping it changes nothing; callers still run
 * their exact test on every candidate, which is why the answers are identical to a
 * full scan (tests/triindex.test.js pins that).
 */
const RES = 128;   // cells per side; thin queries touch a few rows of them

const cache = new WeakMap();

export function triIndex(tris) {
  let g = cache.get(tris);
  if (!g) cache.set(tris, g = build(tris));
  return g;
}

function build(tris) {
  const n = tris.length / 9;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < tris.length; i += 3) {
    const x = tris[i], y = tris[i + 1];
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const g = {
    n, x0, y0, res: RES,
    inv: [RES / Math.max(x1 - x0, 1e-9), RES / Math.max(y1 - y0, 1e-9)],
    start: new Int32Array(RES * RES + 1), ids: null, stamp: new Int32Array(n), tick: 0,
  };
  const range = (i) => {
    const a = i * 9;
    const xa = Math.min(tris[a], tris[a + 3], tris[a + 6]), xb = Math.max(tris[a], tris[a + 3], tris[a + 6]);
    const ya = Math.min(tris[a + 1], tris[a + 4], tris[a + 7]), yb = Math.max(tris[a + 1], tris[a + 4], tris[a + 7]);
    return [cellOf(g, 0, xa), cellOf(g, 0, xb), cellOf(g, 1, ya), cellOf(g, 1, yb)];
  };
  for (let pass = 0; pass < 2; pass++) {
    let fill = null;
    if (pass === 1) {
      for (let c = 0; c < RES * RES; c++) g.start[c + 1] += g.start[c];
      g.ids = new Int32Array(g.start[RES * RES]);
      fill = g.start.slice(0, RES * RES);
    }
    for (let i = 0; i < n; i++) {
      const [ca, cb, ra, rb] = range(i);
      for (let r = ra; r <= rb; r++) {
        for (let c = ca; c <= cb; c++) {
          if (pass === 0) g.start[r * RES + c + 1]++;   // shifted by one: the prefix sum below makes it a start
          else g.ids[fill[r * RES + c]++] = i;
        }
      }
    }
  }
  return g;
}

function cellOf(g, axis, v) {
  const c = Math.floor((v - (axis ? g.y0 : g.x0)) * g.inv[axis]);
  return c < 0 ? 0 : c >= g.res ? g.res - 1 : c;
}

/** Call `visit(triangleIndex)` once for every triangle whose XY box may overlap the given XY box. */
export function eachCandidate(g, xa, xb, ya, yb, visit) {
  const ca = cellOf(g, 0, xa), cb = cellOf(g, 0, xb), ra = cellOf(g, 1, ya), rb = cellOf(g, 1, yb);
  const tick = ++g.tick;
  for (let r = ra; r <= rb; r++) {
    for (let c = ca; c <= cb; c++) {
      const cell = r * g.res + c;
      for (let k = g.start[cell]; k < g.start[cell + 1]; k++) {
        const id = g.ids[k];
        if (g.stamp[id] === tick) continue;
        g.stamp[id] = tick;
        visit(id);
      }
    }
  }
}
