/**
 * The part faces nearest a point: `nearestFaces` returns every face tied for the
 * smallest distance, in face-index order -- the same answer as measuring every
 * face, through a cached 3D bucket grid over the seated part.
 *
 * Why a grid: tines.js aims each tine at the nearest face, and measuring every
 * face for every tine is tines x faces. A big part has many tines AND many faces,
 * so that one loop was 60% of an Auto build on a 512 mm figure (285 s).
 *
 * Exact, not approximate. A first pass over the cells around the point finds
 * some face and its distance; every face that could be as near (box within that
 * distance, plus a margin far above float rounding) is then measured with the
 * same ptTriDist2 on the same seated coordinates, so the minimum, the tie
 * tolerance and the face order all come out exactly as the full scan's did.
 *
 * Split out of tines.js, which uses it.
 */

/** Squared distance from point p to triangle (a,b,c). Ericson closest-point. */
export function ptTriDist2(p, a, b, c) {
  const sub = (u, v) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return dot(ap, ap);
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return dot(bp, bp);
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return dot(cp, cp);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); const q = [a[0] + v * ab[0], a[1] + v * ab[1], a[2] + v * ab[2]]; const w = sub(p, q); return dot(w, w); }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); const q = [a[0] + w * ac[0], a[1] + w * ac[1], a[2] + w * ac[2]]; const u = sub(p, q); return dot(u, u); }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); const q = [b[0] + w * (c[0] - b[0]), b[1] + w * (c[1] - b[1]), b[2] + w * (c[2] - b[2])]; const u = sub(p, q); return dot(u, u); }
  const denom = 1 / (va + vb + vc), v = vb * denom, w = vc * denom;
  const q = [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
  const u = sub(p, q); return dot(u, u);
}

// Cells: about one per face, capped so a huge mesh can't allocate without bound.
// A face is listed in every cell its box overlaps; long slivers across a dense
// mesh can blow that up, so the grid coarsens until the lists stay near n.
const MAX_CELLS = 1 << 21;
const MAX_LISTED = 8;          // listings per face, on average, before coarsening

// One index per topology, rebuilt when the pose changes (Suggest's finalists,
// a new rotation in the worker). Keyed on the topology object like surface.js's
// grids: a fresh topology (each worker request) builds its own.
const _index = new WeakMap();

/** The grid for this topology in this pose. */
function indexFor(topo, rot, offset) {
  const key = `${rot.join(',')}|${offset.x},${offset.y},${offset.z}`;
  const hit = _index.get(topo);
  if (hit && hit.key === key) return hit;
  const pos = topo.pos, nF = topo.nFaces;
  // The seated coordinates, computed exactly as tines.js's full scan seated them
  // (same expression, same order), so every distance below is bit-identical.
  const S = new Float64Array(nF * 9);
  for (let o = 0; o < nF * 9; o += 3) {
    const x = pos[o], y = pos[o + 1], z = pos[o + 2];
    S[o]     = rot[0] * x + rot[3] * y + rot[6] * z + offset.x;
    S[o + 1] = rot[1] * x + rot[4] * y + rot[7] * z + offset.y;
    S[o + 2] = rot[2] * x + rot[5] * y + rot[8] * z + offset.z;
  }
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let o = 0; o < S.length; o += 3) {
    for (let k = 0; k < 3; k++) {
      if (S[o + k] < lo[k]) lo[k] = S[o + k];
      if (S[o + k] > hi[k]) hi[k] = S[o + k];
    }
  }
  const ext = [0, 1, 2].map((k) => Math.max(hi[k] - lo[k], 1e-9));
  const dimsFor = (h) => ext.map((e) => Math.max(1, Math.min(1024, Math.ceil(e / h))));
  const cellsAt = (h) => dimsFor(h).reduce((p, d) => p * d, 1);
  // Cell edge h: the largest that still gives ~one cell per face (bisect on h,
  // since a flat part's thin axis makes a closed form overshoot).
  const target = Math.min(MAX_CELLS, Math.max(1, nF));
  let hLo = 1e-6, hHi = Math.max(...ext);
  for (let it = 0; it < 60; it++) {
    const h = Math.sqrt(hLo * hHi);
    if (cellsAt(h) > target) hLo = h; else hHi = h;
  }
  // Coarsen until the lists fit; at one cell every face is listed once, so it ends.
  let h = hHi, grid;
  while (!(grid = bucket(S, nF, lo, h, dimsFor(h)))) h *= 1.5;
  const idx = { key, S, lo, h, ...grid, stamp: new Uint32Array(nF), gen: 0, d2: new Float64Array(nF) };
  _index.set(topo, idx);
  return idx;
}

/** Bucket every face into the cells its box overlaps (CSR), or null when the
 *  lists run past MAX_LISTED per face. */
function bucket(S, nF, lo, h, dims) {
  const [nx, ny, nz] = dims;
  const ci = (v, k) => Math.min(dims[k] - 1, Math.max(0, Math.floor((v - lo[k]) / h)));
  const spans = new Int32Array(nF * 6);
  let listed = 0;
  for (let f = 0; f < nF; f++) {
    const o = f * 9;
    for (let k = 0; k < 3; k++) {
      const a = S[o + k], b = S[o + 3 + k], c = S[o + 6 + k];
      spans[f * 6 + k * 2] = ci(Math.min(a, b, c), k);
      spans[f * 6 + k * 2 + 1] = ci(Math.max(a, b, c), k);
    }
    listed += (spans[f * 6 + 1] - spans[f * 6] + 1) * (spans[f * 6 + 3] - spans[f * 6 + 2] + 1)
      * (spans[f * 6 + 5] - spans[f * 6 + 4] + 1);
    if (listed > MAX_LISTED * nF + (1 << 20)) return null;
  }
  const nCells = nx * ny * nz;
  const start = new Int32Array(nCells + 1);
  const each = (f, fn) => {
    const s = f * 6;
    for (let a = spans[s]; a <= spans[s + 1]; a++)
      for (let b = spans[s + 2]; b <= spans[s + 3]; b++)
        for (let c = spans[s + 4]; c <= spans[s + 5]; c++) fn((a * ny + b) * nz + c);
  };
  for (let f = 0; f < nF; f++) each(f, (cell) => start[cell + 1]++);
  for (let i = 0; i < nCells; i++) start[i + 1] += start[i];
  const items = new Int32Array(start[nCells]);
  const cur = start.slice(0, nCells);
  for (let f = 0; f < nF; f++) each(f, (cell) => { items[cur[cell]++] = f; });   // ascending f per cell
  return { dims, start, items };
}

/** Squared distance from (px,py,pz) to face f's bounding box: never more than
 *  the distance to the face itself. */
function boxDist2(S, f, px, py, pz) {
  const o = f * 9;
  let s = 0;
  const p = [px, py, pz];
  for (let k = 0; k < 3; k++) {
    const a = S[o + k], b = S[o + 3 + k], c = S[o + 6 + k];
    const mn = Math.min(a, b, c), mx = Math.max(a, b, c);
    const d = p[k] < mn ? mn - p[k] : p[k] > mx ? p[k] - mx : 0;
    s += d * d;
  }
  return s;
}

/**
 * Every face of the seated part tied for nearest to (px, py, pz), ascending by
 * face index, with the full scan's tie rule (within best * 1e-9 + 1e-12 of the
 * minimum squared distance). Empty when no distance is finite.
 */
export function nearestFaces(topo, rot, offset, px, py, pz) {
  const nF = topo.nFaces;
  if (!nF) return [];
  const g = indexFor(topo, rot, offset);
  const { S, lo, h, dims, start, items, stamp, d2 } = g;
  const [nx, ny, nz] = dims;
  // A fresh stamp per query marks the faces already measured (wraps after 4e9).
  if (++g.gen === 0xffffffff) { stamp.fill(0); g.gen = 1; }
  const gen = g.gen;
  const P = [px, py, pz];
  const seen = [];
  const measure = (f) => {
    if (stamp[f] === gen) return;
    stamp[f] = gen;
    const o = f * 9;
    d2[f] = ptTriDist2(P, [S[o], S[o + 1], S[o + 2]], [S[o + 3], S[o + 4], S[o + 5]],
                       [S[o + 6], S[o + 7], S[o + 8]]);
    seen.push(f);
  };
  const ci = (v, k) => Math.min(dims[k] - 1, Math.max(0, Math.floor((v - lo[k]) / h)));
  const scanCell = (a, b, c, fn) => {
    const cell = (a * ny + b) * nz + c;
    for (let k = start[cell]; k < start[cell + 1]; k++) fn(items[k]);
  };

  // Pass 1: an upper bound. Rings of cells out from the point's cell (clamped
  // into the grid) until one holds a face.
  const c0 = [ci(px, 0), ci(py, 1), ci(pz, 2)];
  const rMax = Math.max(nx, ny, nz);
  for (let r = 0; r <= rMax && !seen.length; r++) {
    for (let a = Math.max(0, c0[0] - r); a <= Math.min(nx - 1, c0[0] + r); a++)
      for (let b = Math.max(0, c0[1] - r); b <= Math.min(ny - 1, c0[1] + r); b++) {
        // only the ring's shell: a full column on its sides, just the two caps inside
        const side = Math.abs(a - c0[0]) === r || Math.abs(b - c0[1]) === r;
        if (side) {
          for (let c = Math.max(0, c0[2] - r); c <= Math.min(nz - 1, c0[2] + r); c++) scanCell(a, b, c, measure);
        } else {
          if (c0[2] - r >= 0) scanCell(a, b, c0[2] - r, measure);
          if (c0[2] + r < nz) scanCell(a, b, c0[2] + r, measure);
        }
      }
  }
  let ub = Infinity;
  for (const f of seen) if (d2[f] < ub) ub = d2[f];
  if (!(ub < Infinity)) {
    // Nothing finite near the point (degenerate coordinates): fall back to the scan.
    for (let f = 0; f < nF; f++) measure(f);
  } else {
    // Pass 2: every face whose box is within the bound (plus its tie tolerance and
    // a margin that dwarfs rounding) could be the nearest or tied with it.
    const bound = (ub + ub * 1e-9 + 1e-12) * (1 + 1e-6) + 1e-9;
    const r = Math.sqrt(bound);
    const a0 = ci(px - r, 0), a1 = ci(px + r, 0);
    const b0 = ci(py - r, 1), b1 = ci(py + r, 1);
    const k0 = ci(pz - r, 2), k1 = ci(pz + r, 2);
    for (let a = a0; a <= a1; a++)
      for (let b = b0; b <= b1; b++)
        for (let c = k0; c <= k1; c++)
          scanCell(a, b, c, (f) => {
            if (stamp[f] !== gen && boxDist2(S, f, px, py, pz) <= bound) measure(f);
          });
  }
  let best = Infinity;
  for (const f of seen) if (d2[f] < best) best = d2[f];
  if (!(best < Infinity)) return [];
  const tol = best * 1e-9 + 1e-12;
  const out = [];
  for (const f of seen) if (d2[f] <= best + tol) out.push(f);
  return out.sort((x, y) => x - y);
}
