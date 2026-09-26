/**
 * Reading the seated part: `seat` rotates a raw vertex into print space, and
 * `surfaceZAt` / `surfaceZsAt` answer "what part surface is directly above
 * (x, y)" -- the lowest one, or all of them -- through a cached XY bucket grid.
 *
 * Split out of prop.js, which re-exports the public names.
 */

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
const ZGRID = 64;
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
  const sx = ZGRID / Math.max(1e-6, maxX - minX);
  const sy = ZGRID / Math.max(1e-6, maxY - minY);
  const cx = (x) => Math.min(ZGRID - 1, Math.max(0, Math.floor((x - minX) * sx)));
  const cy = (y) => Math.min(ZGRID - 1, Math.max(0, Math.floor((y - minY) * sy)));
  const span = (f) => {
    const ax = tris[f], ay = tris[f + 1], bx = tris[f + 3], by = tris[f + 4],
          dx = tris[f + 6], dy = tris[f + 7];
    return [cx(Math.min(ax, bx, dx)), cx(Math.max(ax, bx, dx)),
            cy(Math.min(ay, by, dy)), cy(Math.max(ay, by, dy))];
  };
  const counts = new Int32Array(ZGRID * ZGRID + 1);
  for (let f = 0; f < tris.length; f += 9) {
    const [a0, a1, b0, b1] = span(f);
    for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) counts[a * ZGRID + b + 1]++;
  }
  for (let i = 0; i < ZGRID * ZGRID; i++) counts[i + 1] += counts[i];
  const items = new Int32Array(counts[ZGRID * ZGRID]);
  const cur = counts.slice(0, ZGRID * ZGRID);
  for (let f = 0; f < tris.length; f += 9) {
    const [a0, a1, b0, b1] = span(f);
    for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) items[cur[a * ZGRID + b]++] = f;
  }
  g = { start: counts, items, minX, minY, maxX, maxY, sx, sy };
  _zGrids.set(tris, g);
  return g;
}

export function surfaceZAt(tris, x, y) {
  if (tris.length === 0) return null;
  const g = buildZGrid(tris);
  if (x < g.minX || x > g.maxX || y < g.minY || y > g.maxY) return null;
  const a = Math.min(ZGRID - 1, Math.max(0, Math.floor((x - g.minX) * g.sx)));
  const b = Math.min(ZGRID - 1, Math.max(0, Math.floor((y - g.minY) * g.sy)));
  const c = a * ZGRID + b;
  let best = Infinity;
  for (let k = g.start[c]; k < g.start[c + 1]; k++) {
    const i = g.items[k];
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

/**
 * Every part-surface height directly above (x, y), as a list.
 *
 * `surfaceZAt` returns only the LOWEST, which is what a bed-attached prop wants
 * (the underside it clears). A PART-ATTACHED support instead needs the surfaces
 * in BETWEEN -- the floor it stands on lives above the plate and below the
 * overhang -- so keep them all. Same ray test draw.js uses; shared here so
 * floorLine and the draw path measure the part identically.
 */
export function surfaceZsAt(tris, x, y) {
  const zs = [];
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
    zs.push(l1 * az + l2 * bz + l3 * cz);
  }
  return zs;
}
