/**
 * Curved walls (issue #25): the "Curved walls" checkbox. Downhill walls (downhill.js)
 * follow a curved overhang down to the plate, but they race the straight walls on
 * held area with a weight cap (DOWNHILL.maxGrow / race), and on a curved part the
 * arcs hold about what the straight walls do at more plastic -- so they lose and
 * the curve never shows (spiral ramp: arcs 1.5x the weight). With the box ticked,
 * downhill walls are tried under every region, and a region whose downhill walls
 * bend always swaps to them, at any weight and whatever they hold: the user has
 * chosen the curve. The normal walls that hold what the curve misses, or grip
 * lower, stay beside it (raster.js keepers), and any overhang still bare shows red.
 */

export const CURVED = {
  minBend: 10,   // deg: a wall that turns less than this in plan is straight. Straight
                 // downhill walls read 0 on real organic parts; real bends run 10-60
  chord: 3,      // mm: the heading is read over this much of the line, not one station
  trim: 0.1,     // the share of headings dropped at each extreme: one wandering chord
                 // (where the line starts off the climb) doesn't read as a bend
};

/**
 * How far a wall's top line turns in plan (deg): the spread of its headings, each
 * read over `chord` mm of line (stations needn't be evenly spaced), unwrapped along
 * the line, with `trim` of them dropped at each end of the range. 0 for a line
 * under two chords long: too short to tell a bend from a wobble.
 */
export function lineBend(line) {
  const { chord, trim } = CURVED;
  const heads = [];
  let j = 0, prev = null;
  for (let i = 0; i < line.length; i++) {
    if (j < i) j = i;
    while (j < line.length && Math.hypot(line[j][0] - line[i][0], line[j][1] - line[i][1]) < chord) j++;
    if (j === line.length) break;
    let h = Math.atan2(line[j][1] - line[i][1], line[j][0] - line[i][0]);
    if (prev !== null) h = prev + Math.atan2(Math.sin(h - prev), Math.cos(h - prev));   // unwrap
    heads.push(h);
    prev = h;
  }
  let run = 0;
  for (let i = 1; i < line.length; i++) run += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
  if (run < 2 * chord || !heads.length) return 0;
  heads.sort((a, b) => a - b);
  const cut = Math.floor(trim * heads.length);
  return ((heads[heads.length - 1 - cut] - heads[cut]) * 180) / Math.PI;
}

/** Does any of a region's walls bend past CURVED.minBend? raceAgainst's `lenient`. */
export const bends = (walls) => walls.some((q) => lineBend(q.line ?? []) > CURVED.minBend);
