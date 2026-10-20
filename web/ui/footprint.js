/**
 * Footprints on a plate (local issue 052): the 1 mm cells of the bed a model covers
 * at any height -- the part, its fins and its pad -- for the overlap warning and
 * Arrange (ui/arrange.js). Boxes would be too coarse: an L-shaped part, or long
 * fins on one side, would clash with a model standing clear in its corner.
 *
 * Every cell a triangle so much as touches is counted, so a footprint is never
 * smaller than what prints: two that share no cell cannot touch. A model off the
 * millimetre grid widens by one cell along that axis for the same reason.
 *
 * A grid is { x0, y0, w, h, bits }: cell (i, j) is [x0 + i, x0 + i + 1) x
 * [y0 + j, ...) in mm, set when bits[j * w + i] is 1. Pure, no DOM: tests import it.
 */

/** The cells `tris` (flat float x,y,z triples, three vertices a triangle) cover,
 *  each vertex put through `m` (a column-major 4x4, as THREE's Matrix4.elements)
 *  when given. Null when there are none. */
export function rasterize(tris, m = null) {
  const n = Math.floor(tris.length / 9);
  if (!n) return null;
  const xs = new Float64Array(n * 3), ys = new Float64Array(n * 3);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let v = 0; v < n * 3; v++) {
    let x = tris[v * 3], y = tris[v * 3 + 1];
    if (m) {
      const z = tris[v * 3 + 2];
      [x, y] = [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13]];
    }
    xs[v] = x; ys[v] = y;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const x0 = Math.floor(minX), y0 = Math.floor(minY);
  const w = Math.floor(maxX) - x0 + 1, h = Math.floor(maxY) - y0 + 1;
  const bits = new Uint8Array(w * h);
  for (let t = 0; t < n; t++) {
    const a = t * 3;
    const ax = xs[a], ay = ys[a], bx = xs[a + 1], by = ys[a + 1], cx = xs[a + 2], cy = ys[a + 2];
    const i0 = Math.floor(Math.min(ax, bx, cx)) - x0, i1 = Math.floor(Math.max(ax, bx, cx)) - x0;
    const j0 = Math.floor(Math.min(ay, by, cy)) - y0, j1 = Math.floor(Math.max(ay, by, cy)) - y0;
    // one row or column of cells: the box is the triangle's cover already
    if (i0 === i1 || j0 === j1) {
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) bits[j * w + i] = 1;
      continue;
    }
    // else a cell is touched unless one of the edges' lines leaves it wholly outside
    // (separating axes: the box's own two are the bounds above)
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const s = area >= 0 ? 1 : -1;
    const edges = [[ax, ay, bx, by], [bx, by, cx, cy], [cx, cy, ax, ay]];
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (bits[j * w + i]) continue;
        const qx = x0 + i, qy = y0 + j;
        let inside = true;
        for (const [px, py, rx, ry] of edges) {
          // the edge's inward side, at the cell corner furthest along it
          const nx = -(ry - py) * s, ny = (rx - px) * s;
          const cxm = qx + (nx > 0 ? 1 : 0), cym = qy + (ny > 0 ? 1 : 0);
          if ((cxm - px) * nx + (cym - py) * ny < 0) { inside = false; break; }
        }
        if (inside) bits[j * w + i] = 1;
      }
    }
  }
  return { x0, y0, w, h, bits };
}

/** The union of grids (nulls skipped); null when all are. */
export function union(...grids) {
  const gs = grids.filter(Boolean);
  if (!gs.length) return null;
  if (gs.length === 1) return gs[0];
  const x0 = Math.min(...gs.map((g) => g.x0)), y0 = Math.min(...gs.map((g) => g.y0));
  const w = Math.max(...gs.map((g) => g.x0 + g.w)) - x0, h = Math.max(...gs.map((g) => g.y0 + g.h)) - y0;
  const bits = new Uint8Array(w * h);
  for (const g of gs) {
    for (let j = 0; j < g.h; j++) {
      const row = (g.y0 - y0 + j) * w + g.x0 - x0;
      for (let i = 0; i < g.w; i++) if (g.bits[j * g.w + i]) bits[row + i] = 1;
    }
  }
  return { x0, y0, w, h, bits };
}

/** Grid `g` (a model's own, about its spot) standing at `xy` on the plate. Off the
 *  millimetre grid it covers the cells both sides of each fractional shift. */
export function placed(g, [x, y]) {
  if (!g) return null;
  const fx = Math.floor(x + 1e-9), fy = Math.floor(y + 1e-9);
  const ex = x - fx > 1e-6 ? 1 : 0, ey = y - fy > 1e-6 ? 1 : 0;
  if (!ex && !ey) return { ...g, x0: g.x0 + fx, y0: g.y0 + fy };
  const w = g.w + ex, h = g.h + ey, bits = new Uint8Array(w * h);
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      if (!g.bits[j * g.w + i]) continue;
      for (let dj = 0; dj <= ey; dj++) for (let di = 0; di <= ex; di++) bits[(j + dj) * w + i + di] = 1;
    }
  }
  return { x0: g.x0 + fx, y0: g.y0 + fy, w, h, bits };
}

/** The cells two placed grids share, as plate cells [x, y] (mm, a cell's corner). */
export function shared(a, b) {
  const out = [];
  if (!a || !b) return out;
  const x0 = Math.max(a.x0, b.x0), x1 = Math.min(a.x0 + a.w, b.x0 + b.w);
  const y0 = Math.max(a.y0, b.y0), y1 = Math.min(a.y0 + a.h, b.y0 + b.h);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (a.bits[(y - a.y0) * a.w + x - a.x0] && b.bits[(y - b.y0) * b.w + x - b.x0]) out.push([x, y]);
    }
  }
  return out;
}

/** Grid `g` grown by `r` cells every way (a square reach: never less than `r` mm). */
export function dilate(g, r) {
  if (!g || r <= 0) return g;
  const w = g.w + 2 * r, h = g.h + 2 * r;
  const rows = new Uint8Array(w * g.h), bits = new Uint8Array(w * h);
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      if (!g.bits[j * g.w + i]) continue;
      rows.fill(1, j * w + i, j * w + i + 2 * r + 1);
    }
  }
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < w; i++) {
      if (!rows[j * w + i]) continue;
      for (let k = j; k <= j + 2 * r; k++) bits[k * w + i] = 1;
    }
  }
  return { x0: g.x0 - r, y0: g.y0 - r, w, h, bits };
}

/** A plate's taken cells: a bed of `bx` x `by` mm centred on 0, and the grids put on it. */
export function bedGrid(bx, by) {
  const x0 = -Math.ceil(bx / 2), y0 = -Math.ceil(by / 2);
  const w = Math.ceil(bx / 2) - x0, h = Math.ceil(by / 2) - y0;
  return { x0, y0, w, h, bits: new Uint8Array(w * h), bx, by };
}

/** Mark placed grid `g` taken on `bed` (cells off the bed are dropped). */
export function take(bed, g) {
  if (!g) return;
  for (let j = 0; j < g.h; j++) {
    const y = g.y0 + j - bed.y0;
    if (y < 0 || y >= bed.h) continue;
    for (let i = 0; i < g.w; i++) {
      const x = g.x0 + i - bed.x0;
      if (x >= 0 && x < bed.w && g.bits[j * g.w + i]) bed.bits[y * bed.w + x] = 1;
    }
  }
}

/**
 * Where on `bed` model grid `g` (about its own spot) can stand, on whole mm, with
 * `gap` mm to everything `bed` has taken: the free spot nearest the bed's centre
 * (its box's middle there), searched every `step` mm, then within a step of it
 * for a closer one. Null when the bed has no room.
 */
export function findSpot(bed, g, gap, step = 5) {
  const grown = dilate(g, gap);
  const cx = g.x0 + g.w / 2, cy = g.y0 + g.h / 2;
  const hx = bed.bx / 2, hy = bed.by / 2;
  // the whole-mm shifts that keep it on the bed
  const dx0 = Math.ceil(-hx - g.x0), dx1 = Math.floor(hx - g.x0 - g.w);
  const dy0 = Math.ceil(-hy - g.y0), dy1 = Math.floor(hy - g.y0 - g.h);
  if (dx0 > dx1 || dy0 > dy1) return null;
  const clear = (dx, dy) => free(bed, grown, dx, dy);
  const ix = Math.round(-cx), iy = Math.round(-cy);
  const cand = [];
  for (let dy = iy - Math.ceil((iy - dy0) / step) * step; dy <= dy1; dy += step) {
    for (let dx = ix - Math.ceil((ix - dx0) / step) * step; dx <= dx1; dx += step) {
      if (dx >= dx0 && dy >= dy0) cand.push([dx, dy, (dx + cx) ** 2 + (dy + cy) ** 2]);
    }
  }
  cand.sort((a, b) => a[2] - b[2]);
  const first = cand.find(([dx, dy]) => clear(dx, dy));
  if (!first) return null;
  // the grid found it; one step around, a nearer spot may be free too
  let best = first;
  for (let dy = first[1] - step + 1; dy < first[1] + step; dy++) {
    for (let dx = first[0] - step + 1; dx < first[0] + step; dx++) {
      if (dx < dx0 || dx > dx1 || dy < dy0 || dy > dy1) continue;
      const d = (dx + cx) ** 2 + (dy + cy) ** 2;
      if (d < best[2] && clear(dx, dy)) best = [dx, dy, d];
    }
  }
  return [best[0], best[1]];
}

/** No cell of `g` moved by (dx, dy) is one `bed` took (cells off the bed are free). */
function free(bed, g, dx, dy) {
  for (let j = 0; j < g.h; j++) {
    const y = g.y0 + j + dy - bed.y0;
    if (y < 0 || y >= bed.h) continue;
    for (let i = 0; i < g.w; i++) {
      const x = g.x0 + i + dx - bed.x0;
      if (x >= 0 && x < bed.w && g.bits[j * g.w + i] && bed.bits[y * bed.w + x]) return false;
    }
  }
  return true;
}

/** How many cells a grid has set (its area in mm²). */
export const area = (g) => (g ? g.bits.reduce((s, b) => s + b, 0) : 0);

/**
 * Arrange: a spot for each of `grids` (models' own, about their spots) on a bed of
 * `bx` x `by` mm, `gap` mm apart -- the biggest first, each at the free spot nearest
 * the centre. A model the bed has no room left for gets null.
 */
export function pack(grids, bx, by, gap) {
  const bed = bedGrid(bx, by);
  const order = grids.map((g, k) => k).sort((a, b) => area(grids[b]) - area(grids[a]));
  const out = grids.map(() => null);
  for (const k of order) {
    const g = grids[k];
    if (!g) { out[k] = [0, 0]; continue; }
    const at = findSpot(bed, g, gap);
    if (!at) continue;
    out[k] = at;
    take(bed, placed(g, at));
  }
  return out;
}

/**
 * A drag's step (ui/move.js): where a model at `at` goes when the pointer asks for
 * `to`, given `clash(xy)`, the cells it would share with the others there. The
 * whole step when it clashes no more than where it is (clear, or no worse while it
 * is dragged out of a clash); else the step along x alone, then y alone, so it
 * slides along the other's edge; else it stays. Returns the spot.
 */
export function dragStep(at, to, clash) {
  const now = clash(at);
  for (const xy of [to, [to[0], at[1]], [at[0], to[1]]]) {
    if (xy[0] === at[0] && xy[1] === at[1]) continue;
    if (clash(xy) <= now) return xy;
  }
  return at;
}
