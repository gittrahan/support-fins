/**
 * Contact lines: the polyline a wall's top follows under an overhang, and the
 * passes that bring it to exactly `gap` below the part -- `contactLine` (lowest
 * underside per bucket), `lowerSag` (spans that sag above the surface),
 * `contourTop` (the tip's full width, not just its centre), `settleTop` (the
 * true closest approach) -- plus the `straightness` gate a line must pass.
 *
 * Split out of prop.js, which re-exports the public names.
 */
import { PROP } from './config.js';
import { surfaceZAt } from './surface.js';

/**
 * How far the contact polyline strays from the straight line through it: RMS
 * perpendicular deviation from the best-fit axis, over the chord it spans.
 * 0 is a perfectly straight run; a ring reads ~0.2.
 *
 * THIS IS A PRECONDITION, NOT A QUALITY SCORE. `breakaway.py` says so in its own
 * docstring -- "the contact line is assumed ~straight (a linear overhang)" --
 * and the port inherited the sweep without inheriting the assumption. When the
 * overhang is a BOWL rather than a ledge (the underside of a ball hub, a cone, a
 * sphere) its lowest points form a ring, not a line. `contactLine` then fits a
 * principal axis to an isotropic point set, which is noise, and buckets along
 * it -- so the "line" alternates between the two sides of the ring and the swept
 * wall saws through the part.
 *
 * WHY NOT ARC LENGTH / CHORD, which is what this used to be. Arc length grows
 * without bound as you sample a curve more finely; the chord does not. So
 * "tortuosity" measured the SAMPLING, not the shape, and the 2.0 gate flipped on
 * a perfectly good region as soon as anyone densified the stations. Measured on
 * voron_drive_frame at 40 degrees, one region, varying only the station count:
 *
 *   stations      8      14     24     48     96
 *   arc/chord     1.14   1.44   1.59   2.08   3.16   <- crosses the gate
 *   THIS          0.081  0.069  0.062  0.065  0.065  <- flat
 *
 * That is why fixing this had to come BEFORE `stationStep`: densifying first
 * regressed the drive frame from one good wall to none.
 *
 * The 0.10 threshold sits in the measured gap between the two populations:
 * servable ledges land at 0.06-0.08, and hub_post_foot's ball-hub bowl -- the
 * case the gate exists for -- at 0.15-0.21. Note that a LOW score is not a
 * promise of a good wall: it is only the precondition for a swept wall meaning
 * anything at all.
 */
export function straightness(line) {
  const n = line.length;
  if (n < 3) return Infinity;

  let cx = 0, cy = 0;
  for (const p of line) { cx += p[0]; cy += p[1]; }
  cx /= n; cy /= n;

  let sxx = 0, sxy = 0, syy = 0;
  for (const p of line) {
    const dx = p[0] - cx, dy = p[1] - cy;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  const tr = sxx + syy, det = sxx * syy - sxy * sxy;
  const lam = tr / 2 + Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  let ax = sxy, ay = lam - sxx;
  if (Math.hypot(ax, ay) < 1e-9) { ax = 1; ay = 0; }
  const an = Math.hypot(ax, ay); ax /= an; ay /= an;

  let ss = 0, lo = Infinity, hi = -Infinity;
  for (const p of line) {
    const dx = p[0] - cx, dy = p[1] - cy;
    const t = dx * ax + dy * ay;
    const perp = -dx * ay + dy * ax;
    ss += perp * perp;
    if (t < lo) lo = t;
    if (t > hi) hi = t;
  }
  const chord = hi - lo;
  return chord < 1e-9 ? Infinity : Math.sqrt(ss / n) / chord;
}

/**
 * The lowest-surface polyline under a region: principal horizontal axis, then
 * the minimum-z sample in each bucket along it.
 *
 * It must follow the part's true UNDERSIDE, not its centreline. For a tilted
 * round tube the lowest point is offset sideways from, and higher than,
 * `centreline - R`; propping the centreline mis-places the wall and can drop it
 * straight into whatever the tube emerges from. `breakaway.py` learned this the
 * same way and says so in its docstring.
 */
export function contactLine(pts, tris, nSamples) {
  if (pts.length < 3) return null;

  let cx = 0, cy = 0;
  for (const p of pts) { cx += p[0]; cy += p[1]; }
  cx /= pts.length; cy /= pts.length;

  // principal horizontal direction, via the 2x2 covariance of the XY spread
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of pts) {
    const dx = p[0] - cx, dy = p[1] - cy;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  const tr = sxx + syy, det = sxx * syy - sxy * sxy;
  const lam = tr / 2 + Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  let ax = sxy, ay = lam - sxx;
  if (Math.hypot(ax, ay) < 1e-9) { ax = 1; ay = 0; }
  const an = Math.hypot(ax, ay); ax /= an; ay /= an;

  let lo = Infinity, hi = -Infinity;
  for (const p of pts) {
    const t = (p[0] - cx) * ax + (p[1] - cy) * ay;
    if (t < lo) lo = t;
    if (t > hi) hi = t;
  }
  if (hi - lo < 1e-6) return null;

  const buckets = new Array(nSamples).fill(null);
  for (const p of pts) {
    const t = (p[0] - cx) * ax + (p[1] - cy) * ay;
    let k = Math.floor(((t - lo) / (hi - lo)) * nSamples);
    if (k >= nSamples) k = nSamples - 1;
    if (!buckets[k] || p[2] < buckets[k][2]) buckets[k] = p;
  }
  const line = buckets.filter(Boolean);
  if (line.length < 3) return null;

  // Re-fit each station's height to the surface directly above its OWN xy. The
  // bucket only chose where the wall should stand; the z it happened to carry
  // belongs to whichever point in that cross-slice was lowest, which is usually
  // somewhere else entirely.
  for (let i = 0; i < line.length; i++) {
    const zz = surfaceZAt(tris, line[i][0], line[i][1]);
    if (zz !== null) line[i] = [line[i][0], line[i][1], zz];
  }

  contourTop(line, tris);
  lowerSag(line, tris);
  return line;
}

/**
 * Lower the ends of any segment that would pass above the surface between them.
 * The wall's top runs STRAIGHT between stations while the underside curves, so a
 * midpoint can end up proud of the part -- measured at 0.005mm of clearance
 * where 0.2mm was intended, which welds. Checking the midpoints and pulling the
 * span down is what turns the gap into a floor.
 */
export function lowerSag(line, tris, band = Infinity) {
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (let i = 0; i < line.length - 1; i++) {
      const mx = (line[i][0] + line[i + 1][0]) / 2;
      const my = (line[i][1] + line[i + 1][1]) / 2;
      const zz = surfaceZAt(tris, mx, my);
      if (zz === null) continue;
      const midWall = (line[i][2] + line[i + 1][2]) / 2;
      const over = midWall - zz;
      // `band` caps how far below the wall a surface can be and still pull it
      // down: a PART-ATTACHED top must settle against the OVERHANG, not the floor
      // metres beneath it that surfaceZAt (lowest hit) would otherwise return.
      if (over > band) continue;
      if (over > 1e-4) {
        line[i] = [line[i][0], line[i][1], line[i][2] - over];
        line[i + 1] = [line[i + 1][0], line[i + 1][1], line[i + 1][2] - over];
        moved = true;
      }
    }
    if (!moved) break;
  }
  return line;
}

/**
 * Lower each station until the wall's whole TOP FACE clears the part, not just
 * its centreline.
 *
 * The top is a `tip`-wide flat, and the gap used to be set at the centre of it.
 * On a sloped underside the up-slope corner therefore rises by
 * `half_tip x slope` INTO the gap -- and past a slope of `gap / half_tip`, which
 * is only `atan(0.2 / 0.3)` = 33.7 degrees from horizontal, straight into the
 * part. Most overhang surfaces are steeper than that.
 *
 * This was on record as an imprecision to tidy up later ("0.11-0.19mm where 0.2
 * was intended", one wall measuring 0.009mm, which is a weld). It is not a
 * precision problem, it is the main reason walls were being discarded outright:
 * `insidePart` sees the buried corner and `buildProps` throws the whole solid
 * away as `buried`. Measured across four failing cases, the buried vertices at
 * foot height numbered 0 of 5, 0 of 10, 0 of 23 and 0 of 29 -- every one of them
 * was at the wall's top.
 *
 * So evaluate the surface at BOTH TIP CORNERS as well as the centre, and take
 * the lowest. That makes `gap` a floor instead of an average.
 *
 * ACROSS the tip only, never ALONG the run. Sampling along the run as well was
 * tried and is wrong twice over: the top edge already interpolates linearly
 * between stations, and the sag that creates is already pulled down by the
 * midpoint pass in `contactLine`. Taking an along-run minimum on top of that
 * double-counts the slope -- measured, it opened gaps to 0.32-0.34mm on sloped
 * undersides and 2.4mm where the underside has a step, which is a wall the part
 * never lands on. The tip is 0.6mm wide; that is the only distance this pass is
 * responsible for.
 */
export function contourTop(line, tris, band = Infinity) {
  const half = PROP.tip / 2;
  for (let i = 0; i < line.length; i++) {
    const a = line[Math.max(0, i - 1)];
    const b = line[Math.min(line.length - 1, i + 1)];
    const rx = b[0] - a[0], ry = b[1] - a[1];
    const rn = Math.hypot(rx, ry);
    if (rn < 1e-9) continue;
    const sx = ry / rn, sy = -rx / rn;     // across the wall

    const z0 = line[i][2];
    let z = z0;
    for (const o of [-half, half]) {
      const zz = surfaceZAt(tris, line[i][0] + sx * o, line[i][1] + sy * o);
      // Within `band` of the overhang only: past that, the lowest hit is the
      // floor a part-attached wall means to land on, not the overhang it clears.
      if (zz !== null && zz < z && z0 - zz <= band) z = zz;
    }
    line[i] = [line[i][0], line[i][1], z];
  }
  return line;
}

/**
 * Shift a finished contact line so its CLOSEST approach to the part is exactly
 * `gap` -- no more, no less.
 *
 * Everything upstream works on stations: `contactLine` picks their z from the
 * surface, `contourTop` lowers them for the tip's width, the midpoint pass pulls
 * down spans that sag. All of it is sampled AT stations, and the wall's top edge
 * is the straight line BETWEEN them. So the real minimum clearance lives
 * somewhere those samples never looked, and it came out at 0.10-0.19mm against a
 * 0.2 spec -- the family of "unexplained imprecision" the roadmap had been
 * carrying for two milestones.
 *
 * Chasing it with denser probes is the wrong shape of fix: the generator checks
 * with sampled points and the checker measures exact surface-to-surface
 * distance, so tightening the sampling narrows the disagreement without ever
 * closing it. Measure the built edge instead, then move it. Sampling every
 * 0.25mm along the top at both tip corners, the minimum is what the checker will
 * report, and shifting every station by `gap - min` puts it exactly on spec
 * while preserving the contour.
 *
 * This is the repo's "cheap search, exact confirmation" pattern with the last
 * step made corrective rather than merely fatal: the wall is not discarded for
 * being 0.07mm high, it is lowered 0.07mm.
 */
export function settleTop(line, tris, step = 0.25, band = Infinity) {
  const half = PROP.tip / 2;

  // PER STATION, not one shift for the whole wall. A single global drop was
  // tried and it is too blunt: one low triangle anywhere under the run lowers
  // every station by that much, and the wall then stops 0.42-0.48mm under the
  // surface along its whole length -- too far for the part to land on, which the
  // checker reports as a gap that is too LARGE. Correcting each station against
  // the span it owns keeps the contour and confines a local dip to the place it
  // actually happens.
  //
  // Iterated, because lowering a station changes the interpolated top of both
  // segments touching it, and therefore what its neighbours measure.
  for (let pass = 0; pass < 3; pass++) {
    const drop = new Float64Array(line.length);
    let moved = false;

    for (let i = 0; i < line.length - 1; i++) {
      const p = line[i], q = line[i + 1];
      const dx = q[0] - p[0], dy = q[1] - p[1];
      const seg = Math.hypot(dx, dy);
      if (seg < 1e-9) continue;
      const sx = dy / seg, sy = -dx / seg;
      const n = Math.max(1, Math.ceil(seg / step));

      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const x = p[0] + dx * t, y = p[1] + dy * t;
        const topZ = (p[2] + (q[2] - p[2]) * t) - PROP.gap;
        for (const o of [-half, 0, half]) {
          const zz = surfaceZAt(tris, x + sx * o, y + sy * o);
          if (zz === null) continue;
          // LOWER ONLY, never raise. `surfaceZAt` sees this region's triangles
          // and nothing else, so a clearance LARGER than `gap` does not mean the
          // wall is too low -- usually the thing it is closest to belongs to
          // another part of the mesh, which this pass cannot see. Raising on
          // that evidence welds it to what it could not measure: tried, and it
          // took the matrix from 6 clean to 0, with gaps of 0.002-0.015mm.
          // A surface more than `band` below the wall top is the floor, not the
          // overhang -- settling to it is exactly the collapse a part-attached
          // top must avoid, so leave it to floorLine/sweepBetween.
          if (topZ - zz > band) continue;
          const need = PROP.gap - (zz - topZ);
          if (need <= 1e-4) continue;
          // charge the deficit to whichever end of the span owns this sample
          const j = t < 0.5 ? i : i + 1;
          if (need > drop[j]) { drop[j] = need; moved = true; }
        }
      }
    }

    if (!moved) break;
    for (let i = 0; i < line.length; i++) {
      if (drop[i] > 0) line[i] = [line[i][0], line[i][1], line[i][2] - drop[i]];
    }
  }
  return line;
}
