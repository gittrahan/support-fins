/**
 * Which stations of a line may carry a wall: `stationIsClear` (can it reach the
 * plate through open air), `stationCertified` (does the settled top measure
 * clean against the whole part), and the run/mask helpers that turn those
 * per-station verdicts into the span actually swept.
 *
 * Split out of prop.js, which re-exports the public names.
 */
import { insidePart, nearestPart } from '../inside.js';
import { PROP } from './config.js';
import { profileHalf } from './sweep.js';

/**
 * Can a wall under `line` actually reach the plate, or is the part in the way?
 *
 * The prop attaches to the BED and nothing else -- that is what makes it one
 * clean thing to remove rather than two welds to cut. An overhang tucked above
 * other geometry has no such path, and a wall driven down through the part is
 * worse than no wall at all. Sampled down the centreline of each station.
 */
export function stationIsClear(line, k, topo, rot, offset) {
  const p = line[k];
  const a = line[Math.max(0, k - 1)];
  const b = line[Math.min(line.length - 1, k + 1)];
  const rx = b[0] - a[0], ry = b[1] - a[1];
  const rn = Math.hypot(rx, ry);
  if (rn < 1e-9) return true;
  const sx = ry / rn, sy = -rx / rn;      // across the wall

  const top = p[2] - PROP.gap;

  // Probe the FULL height, and probe OUTSIDE the wall's own faces.
  //
  // Both halves of that were wrong and each cost a weld. The heights ran
  // `top * i / (clearProbes + 1)` for i = 1..6, so they stopped at 6/7 of the
  // way up and never looked at the top seventh of the wall -- which is where
  // both remaining welds were, at z = 47.5 and 45.3 on walls topping at 51.0
  // and 49.3. And the offsets were the wall's own half-width, which asks "is my
  // surface inside the part" rather than "is the part about to touch my
  // surface": a flank sitting 0.0002mm off the part is outside it, passes
  // containment, and fuses solid on the first layer.
  //
  // fins.js already learned this exact lesson -- "two fins came out 0.005mm from
  // a neighbouring feature: outside the part, so containment passed, and close
  // enough to weld" -- and grew `wallIsClear` for it. Prop never got the
  // equivalent, so it is here: probe at the wall's half-width PLUS a margin, and
  // if the part is inside THAT, the station cannot carry a wall.
  //
  // `clearProbes` is a FLOOR, not the count: a fixed 12 probes on a 70mm wall
  // is one per 6mm, scale-blind the same way `foot: 7.0` and `samples: 14`
  // were, and a rib arriving between two probes fused a wall on hub_corner.
  // Probe at least every 1.5mm of height. Offsets step through the clearance
  // corridor rather than testing only its far edge, because insidePart is a
  // parity test: a rib THINNER than the corridor can sit wholly between the
  // wall face and a single far-edge probe, containing neither. Stepping at
  // ~0.12mm resolves anything a nozzle can actually print.
  const nProbes = Math.max(PROP.clearProbes, Math.ceil(top / 1.5));
  for (let i = 1; i <= nProbes; i++) {
    const z = (top * i) / nProbes - 0.05;
    if (z <= 0) continue;
    const half = profileHalf(z, top);   // flange, wall, or tip taper at this z
    for (const m of [0.12, 0.24, PROP.sideClear]) {
      const w = half + m;
      if (insidePart(topo, rot, offset, p[0] + sx * w, p[1] + sy * w, z)) return false;
      if (insidePart(topo, rot, offset, p[0] - sx * w, p[1] - sy * w, z)) return false;
    }
    if (insidePart(topo, rot, offset, p[0], p[1], z)) return false;
  }
  return true;
}

/**
 * Certify a SETTLED station by measuring, the way the checker will.
 *
 * `settleTop` puts the top exactly on spec against the region's own triangles
 * -- but the geometry nearest a wall can be a different region, a face too
 * steep to be an overhang, or a surface arriving tangent to the wall's flank,
 * and against those nothing was ever measured: walls shipped with welds of
 * 0.016, 0.005 and 0.0005mm that three rounds of ever-denser parity probing
 * never saw (see nearestPart). So sample the station's cross-section outline
 * and measure the actual distance to the part, classifying each approach the
 * way check_stl.py does: toward a surface ABOVE, this is the breakaway
 * interface and ~gap is correct (the floor sits just under the checker's
 * gap - 0.06 acceptance so a legitimate 0.2 x cos(slope) approach on a steep
 * underside is not trimmed); sideways, it is a flank and must clear by more
 * than the checker's FLANK_MIN. A station that fails is trimmed by the same
 * longestRun machinery as every other local problem -- including an end
 * station whose cap would stop nearly touching whatever blocked the trim,
 * because the cap's outline IS this station's outline and the measurement has
 * no preferred direction.
 *
 * Runs AFTER settling: before it, a proud top that settling was about to fix
 * would read as a false hit.
 */
export function stationCertified(line, k, topo, rot, offset) {
  const p = line[k];
  const a = line[Math.max(0, k - 1)];
  const b = line[Math.min(line.length - 1, k + 1)];
  const rx = b[0] - a[0], ry = b[1] - a[1];
  const rn = Math.hypot(rx, ry);
  if (rn < 1e-9) return true;
  const sx = ry / rn, sy = -rx / rn;

  const top = p[2] - PROP.gap;

  // The cross-section outline: the top flat, then both flanks every 2mm down
  // the full height, at the profile's own half-width for that height. A first
  // version probed the flank at one mid-height point and the welds simply sat
  // between the probes (z=11.2 on a 38.6mm wall probed at 2.5 and 19.7). 2mm
  // spacing is enough BECAUSE this is a distance measure with a 0.45mm reach:
  // any surface tall enough to matter is seen by some probe, tangent or not --
  // the thing parity probing could not promise at any density.
  const probes = [[0, top], [PROP.tip / 2, top], [-PROP.tip / 2, top]];
  for (let z = 0.4; z < top - 0.05; z += 2.0) {
    const half = profileHalf(z, top);
    probes.push([half, z], [-half, z]);
  }
  for (const [o, z] of probes) {
    if (z <= 0.05) continue;
    const hit = nearestPart(topo, rot, offset, p[0] + sx * o, p[1] + sy * o, z);
    if (!hit) continue;
    if (hit.cosUp > 0.7) {
      if (hit.d < PROP.gap - 0.065) return false;   // breakaway would weld
    } else if (hit.d < 0.205) {
      return false;                                 // flank would weld
    }
  }
  return true;
}

/** True when EVERY station can reach the plate. */
export function pathToPlateIsClear(line, topo, rot, offset) {
  for (let k = 0; k < line.length; k++) {
    if (!stationIsClear(line, k, topo, rot, offset)) return false;
  }
  return true;
}

/**
 * The longest contiguous run of stations that can carry a wall, as [a, b).
 *
 * THIS IS THE `t0/t1` TRIM, and automating it is most of what was missing.
 * `breakaway_wall(bm, contact, t0, t1, ...)` takes the span as an argument and
 * tells the caller to "pick t0 so contact(t0) has already cleared any solid the
 * wall must NOT weld to" -- a human eyeballing the part. The port inherited the
 * sweep and not the trim, so a single bad station discarded the whole region:
 * `sweep()` returned false the moment any station was too short.
 *
 * That single line is what lost the flagship part. voron_drive_frame at 25 and
 * 40 degrees has an otherwise perfect contact line -- 92-100mm of span, zero
 * blocked stations -- but its first station or two sit where the underside meets
 * the plate, at a height of -0.2mm. The region was reported `degenerate` and
 * nothing was built. Trimmed instead, the same line gives a 44.1 x 96.1mm wall
 * at 25 degrees and 66.6 x 78.4mm at 40.
 */
export function longestRun(usable) {
  let best = null, start = -1;
  for (let i = 0; i <= usable.length; i++) {
    if (i < usable.length && usable[i]) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      if (!best || i - start > best[1] - best[0]) best = [start, i];
      start = -1;
    }
  }
  return best;
}

/**
 * The stations a plate wall may occupy: the longest run of TALL stations
 * (`tall[k]`, >= minHeight) extended at each end through the contiguous LOW ones
 * (`low[k]`, >= minHeightSquat) -- the wall's tail running on down the slope.
 *
 * Why: stations are 1mm apart and the wall used to begin at the first one tall
 * enough for a full T, so where an overhang slopes INTO the bed the wall stopped
 * ~2mm of height (~3mm of slope on a 35deg cube) short of the part's bottom edge.
 * The squat pass never caught that band either -- on a slope it is one station
 * long, under its minStations/minSpanSquat -- so it printed into air. A tail is
 * the same wall continuing down, not a separate prop, so it needs no span of its
 * own. A run with no tall station is never a wall (that band is the squat pass's).
 */
export function withLowTails(tall, low) {
  const run = longestRun(tall);
  const mask = tall.map(() => false);
  if (!run) return mask;
  let a = run[0], b = run[1];
  while (a > 0 && low[a - 1]) a--;
  while (b < low.length && low[b]) b++;
  for (let k = a; k < b; k++) mask[k] = true;
  return mask;
}

/**
 * Which stations of a run are its full-height BODY (top >= minHeight), as a mask.
 * Taken BEFORE settleTop: settling legitimately lowers the station next to a new
 * low tail by a hair, and re-reading heights afterwards demoted a 1.51mm body end
 * to "tail" -- the body then measured under minSpan and the whole wall was
 * dropped as a stub (sphere, X45Y30). Body membership is decided once.
 */
export function bodyMask(pts) {
  return pts.map((p) => p[2] - PROP.gap >= PROP.minHeight);
}

/** [first, last] body station of `mask`, or null when the body is < 2 stations. */
export function tallBody(mask) {
  const a = mask.indexOf(true), b = mask.lastIndexOf(true);
  return a < 0 || b <= a ? null : [a, b];
}

/**
 * XY span of a run's BODY, first to last body station. The minSpan gate measures
 * this, not the whole run: a low tail extends a wall that already earned its
 * place, it must not promote a stub into one.
 */
export function tallSpan(pts, mask) {
  const r = tallBody(mask);
  return r ? Math.hypot(pts[r[1]][0] - pts[r[0]][0], pts[r[1]][1] - pts[r[0]][1]) : 0;
}

/**
 * Where a line's END dips under the squat floor, insert one station exactly AT
 * the floor (top = minHeightSquat), linearly between the first station above it
 * and the last below (an edge row's track can run past the knife edge, so
 * several end stations may sit under the floor). Stations are 1mm apart, so without this the wall's low end
 * snaps to whichever station happens to clear the floor -- up to a full step
 * (0.7mm of height on a 35deg face) higher than it has to. Mutates `line`.
 */
export function insertFloorStations(line) {
  const floorZ = PROP.minHeightSquat + PROP.gap + 0.02;   // a hair over, so float noise can't drop it
  const cross = (i, j) => {                       // i below the floor, j above
    const zi = line[i][2], zj = line[j][2];
    if (!(zi < floorZ && zj > floorZ + 1e-3)) return null;
    const t = (floorZ - zi) / (zj - zi);
    return line[i].map((v, c) => v + (line[j][c] - v) * t);
  };
  // walk in from each end past every sub-floor station to the first crossing
  let j = line.length - 1;
  while (j > 0 && line[j][2] < floorZ) j--;
  const hiEnd = j < line.length - 1 ? cross(j + 1, j) : null;
  if (hiEnd) line.splice(j + 1, 0, hiEnd);
  let i = 0;
  while (i < line.length - 1 && line[i][2] < floorZ) i++;
  const loEnd = i > 0 ? cross(i - 1, i) : null;
  if (loEnd) line.splice(i, 0, loEnd);
  return line;
}
