/**
 * Is a point inside the part? Ray-parity, with a grid so it is cheap enough to
 * call while dragging.
 *
 * WHY THIS EXISTS. Fin placement searches with a proximity test: does any part
 * surface cross the slab the fin sweeps (fins.js `chooseSpan`). That is cheap
 * and it is what lets the search consider thousands of windows. It is also not
 * quite the same question as "is this fin inside the part", and the gap between
 * the two showed up as a wall buried 2.6mm into a Voron housing that every
 * cheaper check called clear.
 *
 * So the search stays cheap and the ANSWER gets verified: once a fin's geometry
 * exists, its own vertices are tested for containment, and a fin that is inside
 * the part is thrown away. Broad search, exact confirmation.
 *
 * THE GRID IS BUILT IN THE MESH'S ORIGINAL FRAME, never the rotated one, for the
 * same reason overhangs.js welds only once: rotation cannot change which
 * triangles exist or how they relate, so an acceleration structure built once
 * per file stays valid for every orientation. Query points are rotated back into
 * that frame instead. Rebuilding this per drag frame would cost more than the
 * test saves.
 */

const GRID = 64;          // buckets per axis; 64^2 over a part is plenty
const EPS = 1e-9;

/**
 * Bucket every triangle by its (y, z) extent in the mesh's own frame, so a ray
 * cast along +x only has to consider the triangles in one column.
 */
function buildGrid(topo) {
  if (topo._insideGrid) return topo._insideGrid;
  const { pos, nFaces } = topo;

  let minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let v = 0; v < nFaces * 3; v++) {
    const y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const sy = GRID / Math.max(1e-6, maxY - minY);
  const sz = GRID / Math.max(1e-6, maxZ - minZ);
  const cell = (y, z) => {
    const a = Math.min(GRID - 1, Math.max(0, Math.floor((y - minY) * sy)));
    const b = Math.min(GRID - 1, Math.max(0, Math.floor((z - minZ) * sz)));
    return a * GRID + b;
  };

  // counting sort into CSR, so there is one flat Int32Array rather than 4096
  // little arrays
  const counts = new Int32Array(GRID * GRID + 1);
  const span = (f) => {
    const o = f * 9;
    const y0 = Math.min(pos[o + 1], pos[o + 4], pos[o + 7]);
    const y1 = Math.max(pos[o + 1], pos[o + 4], pos[o + 7]);
    const z0 = Math.min(pos[o + 2], pos[o + 5], pos[o + 8]);
    const z1 = Math.max(pos[o + 2], pos[o + 5], pos[o + 8]);
    return [Math.min(GRID - 1, Math.max(0, Math.floor((y0 - minY) * sy))),
            Math.min(GRID - 1, Math.max(0, Math.floor((y1 - minY) * sy))),
            Math.min(GRID - 1, Math.max(0, Math.floor((z0 - minZ) * sz))),
            Math.min(GRID - 1, Math.max(0, Math.floor((z1 - minZ) * sz)))];
  };

  for (let f = 0; f < nFaces; f++) {
    const [a0, a1, b0, b1] = span(f);
    for (let a = a0; a <= a1; a++) {
      for (let b = b0; b <= b1; b++) counts[a * GRID + b + 1]++;
    }
  }
  for (let i = 0; i < GRID * GRID; i++) counts[i + 1] += counts[i];
  const items = new Int32Array(counts[GRID * GRID]);
  const cur = counts.slice(0, GRID * GRID);
  for (let f = 0; f < nFaces; f++) {
    const [a0, a1, b0, b1] = span(f);
    for (let a = a0; a <= a1; a++) {
      for (let b = b0; b <= b1; b++) items[cur[a * GRID + b]++] = f;
    }
  }

  return (topo._insideGrid = { start: counts, items, cell });
}

/**
 * Containment by ray parity along +x, for a query point given in PRINT space.
 *
 * `rot` is the column-major orientation and `offset` the seating translation, so
 * the point is un-seated and un-rotated back into the mesh's own frame before
 * the test -- which is what lets the grid be orientation-independent.
 */
export function insidePart(topo, rot, offset, qx, qy, qz) {
  const { pos } = topo;
  const grid = buildGrid(topo);

  // inverse of an orthonormal rotation is its transpose
  const x = qx - offset.x, y = qy - offset.y, z = qz - offset.z;
  const ox = rot[0] * x + rot[1] * y + rot[2] * z;
  const oy = rot[3] * x + rot[4] * y + rot[5] * z;
  const oz = rot[6] * x + rot[7] * y + rot[8] * z;

  const c = grid.cell(oy, oz);
  let crossings = 0;
  for (let i = grid.start[c]; i < grid.start[c + 1]; i++) {
    const o = grid.items[i] * 9;
    const ay = pos[o + 1], az = pos[o + 2];
    const by = pos[o + 4], bz = pos[o + 5];
    const cy = pos[o + 7], cz = pos[o + 8];

    // barycentric of (oy, oz) within the triangle projected onto the y-z plane
    const d = (bz - cz) * (ay - cy) + (cy - by) * (az - cz);
    if (Math.abs(d) < EPS) continue;
    const l1 = ((bz - cz) * (oy - cy) + (cy - by) * (oz - cz)) / d;
    const l2 = ((cz - az) * (oy - cy) + (ay - cy) * (oz - cz)) / d;
    const l3 = 1 - l1 - l2;
    if (l1 < 0 || l2 < 0 || l3 < 0) continue;

    // x where the ray meets the triangle's plane; only forward hits count
    const hx = l1 * pos[o] + l2 * pos[o + 3] + l3 * pos[o + 6];
    if (hx > ox) crossings++;
  }
  return (crossings & 1) === 1;
}
