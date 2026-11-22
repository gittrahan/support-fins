/**
 * LAYER BOUNDARIES -- the print's own layer grid, when a host knows it.
 *
 * Without them the engine puts each tine on a uniform grid of the layer height from
 * the plate (prop/tines.js). A slicer with a first layer of another height, or with
 * adaptive or variable layer heights, slices on other boundaries, and a tine that
 * straddles one prints as two thin beads. `levels` is the sorted z of every layer
 * boundary of the print, in the seated frame (the part's lowest point at 0), from 0:
 * a 0.3 mm first layer under 0.2 mm layers is [0, 0.3, 0.5, 0.7, ...]. With it, each
 * tine fills exactly one layer of the print: its top on the boundary nearest the
 * underside (as the grid's Math.round), its bottom on the boundary before. A sway
 * brace's tines, the interface crest's cut (prop/crest.js) and the bed pad's first
 * layer (fins/pad.js) take the boundaries too. Past the last boundary the top layer's
 * height repeats, so a list that stops short of the part still answers.
 *
 * Module state, as PROP is: buildFins runs under withLevels, which sets it for that
 * one build and puts it back after, so a build without levels is exactly the uniform
 * grid.
 */
let LEVELS = null;

/** Check a host's boundaries: at least two, from 0, rising. A Float64Array copy. */
function checked(levels) {
  if (!(Array.isArray(levels) || ArrayBuffer.isView(levels)) || levels.length < 2) {
    throw new Error('levels must be a list of at least two layer boundaries');
  }
  const out = Float64Array.from(levels);
  if (out[0] !== 0) throw new Error(`levels must start at 0, got ${out[0]}`);
  for (let i = 1; i < out.length; i++) {
    if (!Number.isFinite(out[i]) || !(out[i] > out[i - 1])) {
      throw new Error(`levels must rise, got ${out[i - 1]} then ${out[i]}`);
    }
  }
  return out;
}

/**
 * Run fn with these boundaries set (null or undefined: the uniform grid), then put
 * back what was set before, also when fn throws.
 */
export function withLevels(levels, fn) {
  const before = LEVELS;
  LEVELS = levels == null ? null : checked(levels);
  try {
    return fn();
  } finally {
    LEVELS = before;
  }
}

/** Are boundaries set for this build? */
export const levelsOn = () => LEVELS !== null;

/** Boundary i; past either end the end layer's height repeats. */
function at(i) {
  const n = LEVELS.length;
  if (i < 0) return i * (LEVELS[1] - LEVELS[0]);
  if (i < n) return LEVELS[i];
  return LEVELS[n - 1] + (i - n + 1) * (LEVELS[n - 1] - LEVELS[n - 2]);
}

/** The index of the greatest boundary at or below z. */
function floorIndex(z) {
  const n = LEVELS.length;
  if (z < 0) return Math.floor(z / (LEVELS[1] - LEVELS[0]));
  if (z >= LEVELS[n - 1]) {
    return n - 1 + Math.floor((z - LEVELS[n - 1]) / (LEVELS[n - 1] - LEVELS[n - 2]) + 1e-9);
  }
  let lo = 0, hi = n - 1;   // LEVELS[lo] <= z < LEVELS[hi]
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (LEVELS[mid] <= z) lo = mid; else hi = mid;
  }
  return lo;
}

/** The index of the boundary nearest z; an exact tie goes up, as Math.round does (past
 * the last boundary, float noise can decide a tie, as on the grid). */
function nearestIndex(z) {
  const i = floorIndex(z);
  return z - at(i) >= at(i + 1) - z ? i + 1 : i;
}

/**
 * The one layer a tine under an underside at z fills: `top` is the boundary nearest
 * z, `bot` the boundary before it, and `below` the height of the layer under the
 * tine (the wall step's sampled layer). The grid's version is
 * top = Math.round(z / h) * h, bot = top - h.
 */
export function tineBand(z) {
  const t = Math.max(1, nearestIndex(z));
  const top = at(t), bot = at(t - 1);
  return { top, bot, below: t >= 2 ? bot - at(t - 2) : top - bot };
}

/**
 * The one layer a sway brace's tine at height z fills: its bottom on the boundary
 * nearest z, its top on the next. The grid's version is
 * bot = Math.round(z / h) * h, top = bot + h.
 */
export function levelCell(z) {
  const b = Math.max(0, nearestIndex(z));
  return { bot: at(b), top: at(b + 1) };
}

/**
 * Where a crest `layers` layers deep starts under a wall top at `top`: the bottom
 * boundary of the `layers`-th topmost layer the wall prints in. A slicer samples a
 * layer at its mid-height, so the wall's topmost printed layer is the highest one
 * whose middle is at or under `top`.
 */
export function levelCut(top, layers) {
  let i = floorIndex(top);              // the layer [at(i), at(i+1)] holds top
  if ((at(i) + at(i + 1)) / 2 > top) i--; // its middle is above the wall: not printed
  return at(i - Math.max(1, layers) + 1);
}

/** The first layer's height. */
export const firstLayerHeight = () => LEVELS[1] - LEVELS[0];
