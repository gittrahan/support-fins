/** Nozzle-aware support dimensions. The wall count is the maker's choice.
 * Inspired by oliveiracelso/support-fins' Dowell profile, generalized here to
 * nozzle × 1.1 × 2/4/6/8 rather than a fixed printer and nozzle.
 */
export const WALL_LINES = Object.freeze([2, 4, 6, 8]);

export function printDimensions(nozzle, wallLines) {
  if (!Number.isFinite(nozzle) || nozzle < 0.2 || nozzle > 3
      || !WALL_LINES.includes(wallLines)) return null;
  const lineWidth = nozzle * 1.1;
  const wallThickness = lineWidth * wallLines;
  const footHalf = Math.max(3, 2 * lineWidth);
  return { nozzle, wallLines, lineWidth, wallThickness, footHalf,
    wallHalf: wallThickness / 2 + footHalf };
}
