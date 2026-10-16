/**
 * Export file names (GitHub #279). The fins are built for one nozzle and one layer
 * height, and the slicer has to be set to the same two: a wall built for a 0.4
 * nozzle is one 0.62 line at 0.6, and a tine one 0.2 layer tall falls between
 * 0.24 layers. So the name carries both, where the slicer's user sees it.
 * Everything else (gap, wall lines, pad) is in the geometry.
 */

/** "0.24", "0.6": at most two decimals, no trailing zeros, no float noise. */
const mm = (v) => String(+Number(v).toFixed(2));

/** `part-fins` + `-0.6nozzle-0.24layer` + `.3mf`. A setting that isn't a
 *  positive number is left out of the name. */
export function exportName(stem, ext, { nozzle, layerHeight } = {}) {
  const tags = [];
  if (Number(nozzle) > 0) tags.push(`${mm(nozzle)}nozzle`);
  if (Number(layerHeight) > 0) tags.push(`${mm(layerHeight)}layer`);
  return [stem, ...tags].join('-') + ext;
}
