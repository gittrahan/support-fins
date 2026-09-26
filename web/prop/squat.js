/**
 * Squat walls: the near-bed band of an overhang, too low for the full T-wall,
 * gets a thin wall on a wide two-layer brim (`sweepSquat`), built over the low
 * stations the tall run leaves behind (`buildSquatBed`).
 *
 * Split out of prop.js, which re-exports the public names.
 */
import { solidClearance } from '../inside.js';
import { ribbon } from '../solids.js';
import { longestRun, stationCertified, stationIsClear } from './clearance.js';
import { PROP } from './config.js';
import { settleTop } from './contact.js';

/**
 * Sweep a SQUAT breakaway wall: a thin wall necking to the breakaway tip, on a
 * flat brim. The full T-flange (`sweep`) can't fit here -- baseH 1.0 alone is most
 * of the wall -- but a squat wall still has to hold to the plate, so it gets a
 * thin WIDE brim instead: two layers tall (snaps off, leaves no part mark since it
 * sits on the plate), wide enough to grip. Two overlapping solids the slicer
 * unions, exactly like `sweep`'s wall + flange.
 */
export function sweepSquat(line, zBed, out) {
  const wall = [], brim = [];
  const brimTop = zBed + PROP.squatBrimH;
  for (let i = 0; i < line.length; i++) {
    const p = line[i];
    const a = line[Math.max(0, i - 1)];
    const b = line[Math.min(line.length - 1, i + 1)];
    let rx = b[0] - a[0], ry = b[1] - a[1];
    const rn = Math.hypot(rx, ry);
    if (rn < 1e-9) return false;
    rx /= rn; ry /= rn;
    const sx = ry, sy = -rx;                 // horizontal, across the wall

    const top = p[2] - PROP.gap;
    const h = top - zBed;
    if (h < PROP.minHeightSquat) return false;
    // neck to the tip over whatever height is left above the brim
    const ztip = Math.max(top - PROP.tipH, brimTop + 0.05);
    const P = (o, z) => [p[0] + sx * o, p[1] + sy * o, z];

    // the stem: bed to breakaway tip, th-wide then necking to the contact tip
    wall.push([
      P(+PROP.th / 2, zBed), P(+PROP.th / 2, ztip), P(+PROP.tip / 2, top),
      P(-PROP.tip / 2, top), P(-PROP.th / 2, ztip), P(-PROP.th / 2, zBed),
    ]);
    // the brim: a thin flat slab overlapping the wall's base, for plate grip
    brim.push([
      P(+PROP.squatBrimW, zBed), P(+PROP.squatBrimW, brimTop),
      P(-PROP.squatBrimW, brimTop), P(-PROP.squatBrimW, zBed),
    ]);
  }
  ribbon(wall, out);
  ribbon(brim, out);
  return true;
}

/**
 * Build brimmed squat breakaway walls on the sub-minHeight bed stations of a
 * contoured overhang line -- the near-bed overhangs a full T-wall can't reach.
 *
 * A flanged wall needs ~minHeight of headroom to exist at all, so `sweep` and its
 * trim discard every station lower than that; on an organic part whose underside
 * ramps down to the plate, that abandons the whole low band and it prints into
 * air. Here the low band is built directly: the stations with minHeightSquat <=
 * height < minHeight (DISJOINT from the tall run the caller builds, so the two
 * never compete) are walked into maximal runs, and each is swept via `sweepSquat`
 * -- a thin wall on a thin WIDE brim. The full T-foot can't fit under a 1mm wall
 * (footMin 1.6 would splay into a sheet), but the wall still has to HOLD to the
 * plate, so the brim gives it the adhesion area a bare 0.6mm-wide tip never could.
 * Same weld guard as the plate path: a squat wall that would fuse is dropped,
 * never shipped ("no prop" is fixable, a fused prop is a ruined print).
 *
 * Operates on a private deep copy of the line so `settleTop` never mutates the
 * points the caller's tall path still reads. Appends triangles to `out` and
 * returns the placed prop descriptors (marked `squat: true`).
 *
 * `claimed` (optional, per station) marks stations a tall wall already covers
 * with its low TAIL (withLowTails); those are skipped so the two never stack.
 * Only stations the built wall really spans are claimed -- a low band next to a
 * BLOCKED tall station still gets its squat wall.
 */
export function buildSquatBed(line, regionTris, topo, rot, offset, out, claimed = null) {
  const zBed = 0;
  const placed = [];
  const heightOf = (p) => (p[2] - PROP.gap) - zBed;
  const usable = line.map((p, k) => {
    const h = heightOf(p);
    return h >= PROP.minHeightSquat && h < PROP.minHeight && !(claimed && claimed[k])
        && stationIsClear(line, k, topo, rot, offset);
  });

  let k = 0;
  while (k < usable.length) {
    if (!usable[k]) { k++; continue; }
    let j = k;
    while (j < usable.length && usable[j]) j++;
    const raw = line.slice(k, j).map((p) => [p[0], p[1], p[2]]);  // deep copy
    k = j;
    if (raw.length < PROP.minStations) continue;
    const spanRaw = Math.hypot(raw[raw.length - 1][0] - raw[0][0],
                               raw[raw.length - 1][1] - raw[0][1]);
    if (spanRaw < PROP.minSpanSquat) continue;

    // Put the closest approach on spec, then re-trim: settling can lift a station
    // into the tall band or drop one below the squat floor, exactly as it can for
    // a full wall. Keep only what is still squat-height and measurably clear.
    settleTop(raw, regionTris);
    const avail = raw.map((p, i) => {
      const h = heightOf(p);
      return h >= PROP.minHeightSquat && h < PROP.minHeight
          && stationCertified(raw, i, topo, rot, offset);
    });
    const run = longestRun(avail);
    if (!run || run[1] - run[0] < PROP.minStations) continue;
    const settled = raw.slice(run[0], run[1]);
    const span = Math.hypot(settled[settled.length - 1][0] - settled[0][0],
                            settled[settled.length - 1][1] - settled[0][1]);
    if (span < PROP.minSpanSquat) continue;

    const before = out.length;
    if (!sweepSquat(settled, zBed, out)) {
      out.length = before;
      continue;
    }

    // Same acceptance as the plate path: an approach from above is the breakaway
    // interface (must clear the gap), anything else is a flank weld.
    const hit = solidClearance(topo, rot, offset, out.slice(before), 0.25);
    if (hit && (hit.cosUp > 0.7 ? hit.d < PROP.gap - 0.065 : hit.d < 0.205)) {
      out.length = before;
      continue;
    }

    const top = Math.max(...settled.map((p) => p[2])) - PROP.gap;
    let vol = 0;
    for (let i = before; i < out.length; i += 3) {
      const a = out[i], b = out[i + 1], c = out[i + 2];
      vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2])
            + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    }
    placed.push({
      span, height: top - zBed, stations: settled.length, volume: Math.abs(vol),
      squat: true,
      line: settled.map((p) => [p[0], p[1], p[2] - PROP.gap]),
      // Triangle range of THIS wall in the caller's `out`. The caller emits the
      // tines separately (after every squat wall), so a fin's full geometry is
      // [this wall range] + [its tines range] -- two non-contiguous segments,
      // tracked as `triRanges` at the push site.
      triRange: [before, out.length],
    });
  }
  return placed;
}
