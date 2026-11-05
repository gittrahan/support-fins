/**
 * Scale for the part (ui/scale.js). Pure: positions in, positions out, so the part
 * and a slicer's own parts (#104) scale by the same rule and a test can pin it.
 *
 * A scale is a factor (uniform) or a 3x3 matrix, row-major, in the part's own
 * frame. The page edits it along the PLATE's axes, as the part sits (#440): a
 * stretch of D along the plate axes, for a part posed by R (part -> plate), is
 * R^T D R in the part's frame, so the box on the plate grows by exactly D.
 */

export const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** `to + M (p - from)` for every xyz in `src`, M a factor or a row-major 3x3: scale
 *  about `from`, then land that point on `to`. A new array; `src` is left alone. */
export function scaleAbout(src, s, from, to = from) {
  const m = typeof s === 'number' ? [s, 0, 0, 0, s, 0, 0, 0, s] : s;
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    const x = src[i] - from[0], y = src[i + 1] - from[1], z = src[i + 2] - from[2];
    out[i] = to[0] + m[0] * x + m[1] * y + m[2] * z;
    out[i + 1] = to[1] + m[3] * x + m[4] * y + m[5] * z;
    out[i + 2] = to[2] + m[6] * x + m[7] * y + m[8] * z;
  }
  return out;
}

/** a * b, row-major 3x3. */
export function mul3(a, b) {
  const o = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  }
  return o;
}

const T3 = (a) => [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]];

/** `m` stretched by `d` = [dx, dy, dz] along the plate axes of a part posed by `R`
 *  (row-major, part -> plate): R^T diag(d) R m. */
export function stretchOnPlate(m, d, R) {
  const D = [d[0], 0, 0, 0, d[1], 0, 0, 0, d[2]];
  return mul3(mul3(mul3(T3(R), D), R), m);
}

/** The factor when `m` scales every direction alike, else null. */
export function uniformOf(m) {
  const s = m[0], e = 1e-9 * Math.max(1, Math.abs(s));
  return [m[1], m[2], m[3], m[5], m[6], m[7]].every((v) => Math.abs(v) <= e)
    && Math.abs(m[4] - s) <= e && Math.abs(m[8] - s) <= e ? s : null;
}

/** The box of xyz `pos` on the plate, posed by `R` (row-major): [x, y, z] in mm. */
export function sizeOnPlate(pos, R) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    for (let k = 0; k < 3; k++) {
      const v = R[k * 3] * x + R[k * 3 + 1] * y + R[k * 3 + 2] * z;
      if (v < lo[k]) lo[k] = v;
      if (v > hi[k]) hi[k] = v;
    }
  }
  return pos.length ? hi.map((v, k) => v - lo[k]) : [0, 0, 0];
}

// Below 10 % a fine mesh's vertices land closer than the weld's 1 um grain
// (overhangs.js) and distinct vertices merge, so no axis goes below a tenth of its
// size as loaded. There is no top (#440): a part written in metres loads 1000
// times too small, and the size fields take its real size. Scaling up loses
// nothing -- the scale is taken from the raw positions and the weld runs again.
export const MIN_FACTOR = 0.1;

/** A field's value: a positive finite number, else null (junk, empty, 0, < 0). */
export function fieldValue(v) {
  if (typeof v === 'string' && !v.trim()) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The stretch along the plate axes for one edited field: [dx, dy, dz]. `axis` 0-2,
 * `mm` the size asked for on that axis, `cur` the part's size on the plate now,
 * `base` its size at 100 % in the same pose. Uniform moves all three by the same
 * factor; else only that axis moves. No axis ends below MIN_FACTOR of its size at
 * 100 %. An axis with no size (a flat sheet) can't be stretched: null.
 */
export function stretchFor(axis, mm, cur, base, uniform) {
  if (!(cur[axis] > 0)) return null;
  const floorOf = (k) => (cur[k] > 0 ? (base[k] * MIN_FACTOR) / cur[k] : 0);
  if (uniform) {
    const k = Math.max(mm / cur[axis], floorOf(0), floorOf(1), floorOf(2));
    return [k, k, k];
  }
  const d = [1, 1, 1];
  d[axis] = Math.max(mm / cur[axis], floorOf(axis));
  return d;
}
