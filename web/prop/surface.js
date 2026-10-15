/**
 * Reading the seated part: `seat` rotates a raw vertex into print space, and
 * `surfaceZAt` / `surfaceZsAt` answer "what part surface is directly above
 * (x, y)" -- the lowest one, or all of them -- through a cached XY bucket grid.
 *
 * Split out of prop.js, which re-exports the public names.
 */
import { gridDims } from '../gridsize.js';

/** Rotate + seat one raw vertex into print space. */
export function seat(pos, i, rot, off, out) {
  const x = pos[i], y = pos[i + 1], z = pos[i + 2];
  out[0] = rot[0] * x + rot[3] * y + rot[6] * z + off.x;
  out[1] = rot[1] * x + rot[4] * y + rot[7] * z + off.y;
  out[2] = rot[2] * x + rot[5] * y + rot[8] * z + off.z;
  return out;
}

/**
 * The lowest surface height of the region directly above (x, y), or null if the
 * region does not cover that point.
 *
 * This is what the wall's top has to clear, and it has to be asked about the
 * wall's OWN path. Taking the lowest point in a cross-slice of the region
 * instead -- which is what bucketing does -- answers about somewhere off to the
 * side, and produced walls sitting 13mm below the surface they were meant to
 * touch.
 *
 * CAUTION on that 13mm: the roadmap carried an OUTSTANDING "one wall still sits
 * 13mm under its region" bug attributed to this function, and it was not real.
 * `hub_corner.stl` is a two-body mesh and `check_stl.py` measured the prop
 * against the larger body only. Re-measured against the body it actually serves,
 * that wall is 0.2mm under it. Don't re-fix this on the strength of that number.
 */
// XY bucket grid over a `tris` array, so surfaceZAt scans only the triangles whose
// footprint covers the query column instead of the whole mesh. This is the twin of
// inside.js's YZ grid; it lives here because surfaceZAt takes a flat triangle array
// (a region, a patch, or the whole part), not a topo. The grid is cached on the array
// object, so the many queries a single build fires against the SAME array (the bed
// pad marches a grid of cells against the entire part; a region is probed once per
// station) pay the O(n) build once and then hit only a cell's worth of candidates.
// If a caller hands a fresh array each call the build is O(n) -- exactly the old
// linear cost, never worse. Same barycentric test + lowest-z semantics as before.
const _zGrids = new WeakMap();
function buildZGrid(tris) {
  let g = _zGrids.get(tris);
  if (g) return g;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < tris.length; i += 3) {
    const x = tris[i], y = tris[i + 1];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  // cells per axis sized to the mesh (gridsize.js), at least the old 64
  const [NX, NY] = gridDims(maxX - minX, maxY - minY, tris.length / 9);
  const sx = NX / Math.max(1e-6, maxX - minX);
  const sy = NY / Math.max(1e-6, maxY - minY);
  const cx = (x) => Math.min(NX - 1, Math.max(0, Math.floor((x - minX) * sx)));
  const cy = (y) => Math.min(NY - 1, Math.max(0, Math.floor((y - minY) * sy)));
  const span = (f) => {
    const ax = tris[f], ay = tris[f + 1], bx = tris[f + 3], by = tris[f + 4],
          dx = tris[f + 6], dy = tris[f + 7];
    return [cx(Math.min(ax, bx, dx)), cx(Math.max(ax, bx, dx)),
            cy(Math.min(ay, by, dy)), cy(Math.max(ay, by, dy))];
  };
  const counts = new Int32Array(NX * NY + 1);
  for (let f = 0; f < tris.length; f += 9) {
    const [a0, a1, b0, b1] = span(f);
    for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) counts[a * NY + b + 1]++;
  }
  for (let i = 0; i < NX * NY; i++) counts[i + 1] += counts[i];
  const items = new Int32Array(counts[NX * NY]);
  const cur = counts.slice(0, NX * NY);
  for (let f = 0; f < tris.length; f += 9) {
    const [a0, a1, b0, b1] = span(f);
    for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) items[cur[a * NY + b]++] = f;
  }
  g = { start: counts, items, minX, minY, maxX, maxY, sx, sy, NX, NY, asked: 0 };
  _zGrids.set(tris, g);
  return g;
}

// The grid cell's candidate triangles for column (x, y), or null outside the grid.
function cellOf(g, x, y) {
  const e = 1e-9;
  if (x < g.minX - e || x > g.maxX + e || y < g.minY - e || y > g.maxY + e) return null;
  const a = Math.min(g.NX - 1, Math.max(0, Math.floor((x - g.minX) * g.sx)));
  const b = Math.min(g.NY - 1, Math.max(0, Math.floor((y - g.minY) * g.sy)));
  return a * g.NY + b;
}

// Height of triangle `i` of `tris` at column (x, y), or null if the column misses it.
function zOn(tris, i, x, y) {
  const ax = tris[i], ay = tris[i + 1], az = tris[i + 2];
  const bx = tris[i + 3], by = tris[i + 4], bz = tris[i + 5];
  const cx = tris[i + 6], cy = tris[i + 7], cz = tris[i + 8];
  const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  if (Math.abs(den) < 1e-12) return null;
  const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / den;
  const l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / den;
  const l3 = 1 - l1 - l2;
  if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) return null;
  return l1 * az + l2 * bz + l3 * cz;
}

// surfaceZAt wants only the LOWEST height, so it walks a second copy of the cell
// lists ordered by how low each triangle can reach and stops at the first that
// can't beat the best so far. A column through a tall part crosses every surface
// stacked above it, and scanning them all was most of a bed pad's cost (the pad
// asks nine columns per grid vertex): 45% of Suggest orientation on a figure.
//
// `lb` is a floor under any height zOn returns for the triangle: zOn accepts
// barycentrics down to -1e-9, which reaches below the lowest vertex by at most
// 2e-9 of the triangle's z-range, plus float rounding. Stopping only when a floor
// is ABOVE the best keeps the minimum exact. A NaN vertex (a corrupt binary STL)
// gets a floor of -Infinity: a NaN would make the sort inconsistent, and the plain
// scan never let such a triangle win anyway. Built on first use: surfaceHitsAt and
// surfaceZsAt keep the index-ordered lists, where order matters.
const LOW_FIRST_AFTER = 2000;   // a grid sorts after 2000 queries, plus 2000 per 1000 triangles
function lowFirst(g, tris) {
  if (g.low) return g.low;
  const n = tris.length / 9;
  const lb = new Float64Array(n);
  for (let t = 0; t < n; t++) {
    const o = t * 9, a = tris[o + 2], b = tris[o + 5], c = tris[o + 8];
    const lo = Math.min(a, b, c), hi = Math.max(a, b, c);
    lb[t] = lo - 3e-9 * (hi - lo) - 1e-12 * (1 + Math.abs(lo));
    if (!(lb[t] > -Infinity)) lb[t] = -Infinity;
  }
  // fill the cells in ascending-floor order, so each cell's list comes out sorted
  const order = new Int32Array(n);
  for (let t = 0; t < n; t++) order[t] = t;
  order.sort((p, q) => lb[p] - lb[q] || p - q);
  const { start, NX, NY, sx, sy, minX, minY } = g;
  const cx = (v) => Math.min(NX - 1, Math.max(0, Math.floor((v - minX) * sx)));
  const cy = (v) => Math.min(NY - 1, Math.max(0, Math.floor((v - minY) * sy)));
  const items = new Int32Array(g.items.length);
  const cur = start.slice(0, NX * NY);
  for (const t of order) {
    const f = t * 9;
    const a0 = cx(Math.min(tris[f], tris[f + 3], tris[f + 6])), a1 = cx(Math.max(tris[f], tris[f + 3], tris[f + 6]));
    const b0 = cy(Math.min(tris[f + 1], tris[f + 4], tris[f + 7])), b1 = cy(Math.max(tris[f + 1], tris[f + 4], tris[f + 7]));
    for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) items[cur[a * NY + b]++] = f;
  }
  return (g.low = { items, lb });
}

export function surfaceZAt(tris, x, y) {
  if (tris.length === 0) return null;
  const g = buildZGrid(tris);
  const c = cellOf(g, x, y);
  if (c === null) return null;
  let best = Infinity;
  // Sorting the lists costs about a full pass of queries, so only a grid asked
  // enough to repay it (the whole part under a bed pad) gets them; a region's or a
  // patch's few queries scan the plain lists, as before.
  if (g.low || ++g.asked > LOW_FIRST_AFTER * (1 + tris.length / 9 / 1000)) {
    const { items, lb } = lowFirst(g, tris);
    for (let k = g.start[c]; k < g.start[c + 1]; k++) {
      const f = items[k];
      if (lb[f / 9] > best) break;          // nothing further down this list reaches lower
      const z = zOn(tris, f, x, y);
      if (z !== null && z < best) best = z;
    }
  } else {
    for (let k = g.start[c]; k < g.start[c + 1]; k++) {
      const z = zOn(tris, g.items[k], x, y);
      if (z !== null && z < best) best = z;
    }
  }
  return best === Infinity ? null : best;
}

/**
 * ...and with each height, its triangle's unit normal z: [z, nz], in triangle-index
 * order (a grid cell lists its triangles by index) -- draw.js's nearest-hit picks
 * break ties on that order, as they did on the linear scan this replaced.
 * Which way a surface faces, through the same grid -- the fill pass (fins/fill.js)
 * asks whether a station is under the part, and on a thin shell (a chair cast as a
 * skin) parity inside-tests can't say.
 */
export function surfaceHitsAt(tris, x, y) {
  const hits = [];
  if (tris.length === 0) return hits;
  const g = buildZGrid(tris);
  const c = cellOf(g, x, y);
  if (c === null) return hits;
  for (let k = g.start[c]; k < g.start[c + 1]; k++) {
    const i = g.items[k], z = zOn(tris, i, x, y);
    if (z === null) continue;
    const ux = tris[i + 3] - tris[i], uy = tris[i + 4] - tris[i + 1], uz = tris[i + 5] - tris[i + 2];
    const vx = tris[i + 6] - tris[i], vy = tris[i + 7] - tris[i + 1], vz = tris[i + 8] - tris[i + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    hits.push([z, nz / (Math.hypot(nx, ny, nz) || 1)]);
  }
  return hits;
}

/**
 * Every part-surface height directly above (x, y), as a list.
 *
 * `surfaceZAt` returns only the LOWEST, which is what a bed-attached prop wants
 * (the underside it clears). A PART-ATTACHED support instead needs the surfaces
 * in BETWEEN -- the floor it stands on lives above the plate and below the
 * overhang -- so keep them all. The same ray test draw.js uses (through
 * surfaceHitsAt) to pick the height nearest the drawn line.
 */
export function surfaceZsAt(tris, x, y) {
  // Through the same XY grid as surfaceZAt: floorLine queries the WHOLE part
  // three times a station, and a linear scan there was 60% of a raster build
  // (gree X30). Only the order of the heights can differ from a full scan.
  const zs = [];
  if (tris.length === 0) return zs;
  const g = buildZGrid(tris);
  const c = cellOf(g, x, y);
  if (c === null) return zs;
  for (let k = g.start[c]; k < g.start[c + 1]; k++) {
    const z = zOn(tris, g.items[k], x, y);
    if (z !== null) zs.push(z);
  }
  return zs;
}
