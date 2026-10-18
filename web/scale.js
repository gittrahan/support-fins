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

/** The percent field's value as a factor: a positive number, 1-1000 %, else null. */
export function scaleFromPercent(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(1000, Math.max(1, n)) / 100;
}
