/**
 * Uniform scale for the part (ui/scale.js). Pure: positions in, positions out, so
 * the part and a slicer's own parts (#104) scale by the same rule and a test can
 * pin it.
 */

/** `to + s * (p - from)` for every xyz in `src`: scale by `s` about `from`, then
 *  land that point on `to`. A new array; `src` is left alone. */
export function scaleAbout(src, s, from, to = from) {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    out[i] = to[0] + s * (src[i] - from[0]);
    out[i + 1] = to[1] + s * (src[i + 1] - from[1]);
    out[i + 2] = to[2] + s * (src[i + 2] - from[2]);
  }
  return out;
}

// Below 10 % a fine mesh's vertices land closer than the weld's 1 um grain
// (overhangs.js) and distinct vertices merge.
const MIN_PCT = 10, MAX_PCT = 1000;

/** The percent field's value as a factor: a positive number, clamped to 10-1000 %
 *  and rounded to the 2 decimals the field shows (so re-entering what it shows is
 *  no change), else null. */
export function scaleFromPercent(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(Math.min(MAX_PCT, Math.max(MIN_PCT, n)) * 100) / 10000;
}
