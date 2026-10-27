/**
 * The part triangles a Sway brace's cross ribs can see.
 *
 * braceCrossRib (prop/brace.js) shears the whole part into the brace's lean and
 * samples part surface under the rib's footprint; on a million-face part that copy
 * and its surface grid were ~100 ms of every click, for a footprint a few mm wide.
 * cropForRib hands it only the triangles whose sheared footprint can meet the square
 * of half-width `r` around the rib's base point `o`, so the shear, the grid and the
 * samples all run on a few thousand triangles. The samples only ever look at columns
 * inside that square, and a triangle whose sheared XY box misses the square covers none
 * of them, so the answers are the same as on the whole part.
 *
 * The scan is one allocation-free pass over the triangles (no grid: the shear moves
 * every vertex by the lean times its height, so an unsheared XY index can't answer it).
 */
const PAD = 1e-6;   // the column test accepts barycentrics a hair outside; this covers it

/** Copy of the triangles in `tris` (9 numbers each) whose XY box, sheared by `lean` per mm of height above `zBed`, meets o +- r
 *  and that reach below `zTop` (a surface height above it is never counted) and above the bed. */
export function cropForRib(tris, o, r, lean, zBed = 0, zTop = Infinity) {
  const xa = o[0] - r - PAD, xb = o[0] + r + PAD, ya = o[1] - r - PAD, yb = o[1] + r + PAD;
  const ztop = zTop - zBed + PAD, zlow = -0.05;   // rib samples count surface from zBed - 0.01 up
  const lx = lean[0], ly = lean[1];
  const keep = [];
  for (let i = 0; i < tris.length; i += 9) {
    const z0 = tris[i + 2] - zBed, z1 = tris[i + 5] - zBed, z2 = tris[i + 8] - zBed;
    if ((z0 > ztop && z1 > ztop && z2 > ztop) || (z0 < zlow && z1 < zlow && z2 < zlow)) continue;
    const x0 = tris[i] - lx * z0, x1 = tris[i + 3] - lx * z1, x2 = tris[i + 6] - lx * z2;
    if ((x0 < xa && x1 < xa && x2 < xa) || (x0 > xb && x1 > xb && x2 > xb)) continue;
    const y0 = tris[i + 1] - ly * z0, y1 = tris[i + 4] - ly * z1, y2 = tris[i + 7] - ly * z2;
    if ((y0 < ya && y1 < ya && y2 < ya) || (y0 > yb && y1 > yb && y2 > yb)) continue;
    keep.push(i);
  }
  const out = new Float64Array(keep.length * 9);
  for (let k = 0; k < keep.length; k++) out.set(tris.subarray(keep[k], keep[k] + 9), k * 9);
  return out;
}
