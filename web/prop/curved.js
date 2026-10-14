/**
 * Curved walls (issue #25): the "Curved walls" checkbox. Downhill walls (downhill.js)
 * follow a curved overhang down to the plate, but they race the straight walls on
 * held area with a weight cap (DOWNHILL.maxGrow / race), and on a curved part the
 * arcs hold about what the straight walls do at more plastic -- so they lose and
 * the curve never shows (spiral ramp: arcs 1.5x the weight). With the box ticked,
 * a region whose downhill walls really bend swaps when they hold AT LEAST as much,
 * at any weight: the user has chosen plastic for the curve. The whole-build check
 * (fins/downhill.js) still keeps the build without them if they hold less overall.
 */

export const CURVED = {
  minBend: 20,   // deg: a wall that turns less than this in plan is straight (a starting
                 // value, not print-tested: the spiral ramp's arcs turn far more)
  chord: 3,      // stations (1 mm apart): the heading is read over this many, not one,
                 // so a wobbling station doesn't read as a bend
};

/**
 * How far a wall's top line turns in plan (deg): the most any later heading swings
 * from its first. Both measured over `chord` stations. 0 for a line too short to tell.
 */
export function lineBend(line) {
  const k = CURVED.chord;
  if (line.length < 2 * k) return 0;
  const head = (i) => Math.atan2(line[i + k][1] - line[i][1], line[i + k][0] - line[i][0]);
  const h0 = head(0);
  let most = 0;
  for (let i = 1; i + k < line.length; i++) {
    let d = Math.abs(head(i) - h0);
    if (d > Math.PI) d = 2 * Math.PI - d;
    if (d > most) most = d;
  }
  return (most * 180) / Math.PI;
}

/** Does any of a region's walls bend past CURVED.minBend? raceAgainst's `lenient`. */
export const bends = (walls) => walls.some((q) => lineBend(q.line ?? []) > CURVED.minBend);
