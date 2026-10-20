/**
 * The plates' row (ui/plateview.js) as numbers: plate i stands (i - active) * pitch
 * along X from the one being edited, whose own coordinates a dragged model's spot is
 * in (ui/move.js). Pure, no DOM: tests import it.
 */

/** The other plate a model dragged to `xy` (the edited plate's coordinates) stands
 *  on -- its middle over that plate's `bx` x `by` bed -- as { plate, xy (its spot on
 *  that plate) }; null over the edited plate itself, a gap or past the row's end. */
export function plateUnder([x, y], active, count, pitch, bx, by) {
  const i = active + Math.round(x / pitch);
  if (i === active || i < 0 || i >= count) return null;
  const lx = x - (i - active) * pitch;
  if (Math.abs(lx) > bx / 2 || Math.abs(y) > by / 2) return null;
  return { plate: i, xy: [Math.round(lx * 10) / 10, y] };
}
