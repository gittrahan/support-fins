/**
 * Draw's shapes and what a click does in each, apart from the page (ui/walls.js) so a
 * test can walk them: Line is two clicks, Curve three (its ends, then a point it runs
 * through), Gusset two (a side of the part, then the overhang it reaches), Stabilizer
 * one (a side of the part, where its top goes -- walls.js stands it from the brace
 * preview, so clickStep only ever sees the clicks that missed a side). walls.js
 * drops whatever was half drawn when the shape changes, so a click never finishes a
 * wall begun as another shape.
 */
export const DRAW_SHAPES = ['line', 'curve', 'gusset', 'stabilizer'];

/** A remembered shape, or Line when there is none (or one this version doesn't know). */
export const shapeOr = (s) => (DRAW_SHAPES.includes(s) ? s : 'line');

/**
 * What a click on the part does for `shape`, with `wip` half drawn ({ start, end, side }:
 * a wall's first click, a curve's other end, a gusset's side face; null when not yet):
 * 'start' a wall's first point, 'end' a curve's other end, 'place' the wall, 'side' a
 * gusset's side, 'reach' the gusset, 'stand' a stabilizer.
 */
export function clickStep(shape, wip) {
  if (shape === 'stabilizer') return 'stand';
  if (shape === 'gusset') return wip.start && wip.side !== null ? 'reach' : 'side';
  if (!wip.start) return 'start';
  if (shape === 'curve' && !wip.end) return 'end';
  return 'place';
}
