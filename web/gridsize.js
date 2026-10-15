/**
 * How many cells a 2D bucket grid over a part gets, per axis.
 *
 * The surface (prop/surface.js) and inside (inside.js) grids were a fixed 64 x 64
 * over the part, so a cell's share of the mesh grew with the face count and every
 * query scanned it: a 250k-face figure put ~60 triangles in an average cell, and
 * with a big part's many stations those scans were ~80% of an Auto build (a
 * 768 mm figure, 197 s). Size the grid to the mesh instead: as many cells as
 * faces / FACES_PER_CELL, square cells in mm, never under 64 a side (the old grid, so a
 * small part is bucketed no coarser than before) or above MAX_SIDE.
 *
 * Cells also stay at least MIN_CELL_MM wide. The box queries (nearestPart,
 * solidClearance) walk every cell a 0.45 mm reach and a wall triangle's extent
 * touch, and a long wall triangle over sub-millimetre cells is thousands of
 * empty cells.
 */
const FACES_PER_CELL = 1;
const MAX_SIDE = 2048;
const MIN_SIDE = 64;
const MIN_CELL_MM = 0.5;

/** Cells along each of two axes spanning `ea` and `eb` mm, for `n` faces. */
export function gridDims(ea, eb, n) {
  ea = Math.max(ea, 1e-6); eb = Math.max(eb, 1e-6);
  // square cells of side h with about n / FACES_PER_CELL of them over ea x eb
  let h = Math.sqrt((ea * eb) / Math.max(1, n / FACES_PER_CELL));
  h = Math.max(h, MIN_CELL_MM);
  const side = (e) => Math.max(MIN_SIDE, Math.min(MAX_SIDE, Math.ceil(e / h)));
  return [side(ea), side(eb)];
}
