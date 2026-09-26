/**
 * Part-attached walls: an overhang above another part of the part stands its
 * wall on that floor (`floorLine`) instead of stilting to the plate through it,
 * and refuses a column inside a bore or slot (`enclosedFloor`) or one a side
 * wall cuts through (`clearBetween`). `buildPartAttached` is the verdict the
 * auto-placer acts on.
 *
 * Split out of prop.js, which re-exports the public names.
 */
import { insidePart } from '../inside.js';
import { longestRun } from './clearance.js';
import { PROP } from './config.js';
import { contourTop, lowerSag, settleTop } from './contact.js';
import { surfaceZsAt } from './surface.js';
import { sweepBetween } from './sweep.js';

/**
 * The floor contour a PART-ATTACHED support stands on: for each station of
 * `topLine`, the HIGHEST part surface strictly below the overhang, or 0 (the
 * plate) where nothing intervenes.
 *
 * This is the exact mirror of `contourTop`. contourTop looks UP across the tip
 * and takes the LOWEST hit, so the tip stops `gap` under the overhang; floorLine
 * looks DOWN across the tip and takes the HIGHEST hit below the overhang, so the
 * support lands on the part instead of driving to z=0. Taking the highest hit
 * across the tip's width (not just the centre) means the bottom rests ON the
 * floor and never digs into it -- the same reasoning contourTop uses to keep the
 * top out of the part.
 *
 * `margin` keeps the overhang's OWN face from being read as its floor: only
 * surfaces at least `margin` below the contact line count. Stations with no
 * intervening surface fall through to 0, so a wall that is part over-part and
 * part over-bed degrades station-by-station to the plate with nothing special-
 * cased -- the current all-to-plate behaviour is just the everywhere-0 case.
 */
export function floorLine(topLine, tris, margin = 1.0) {
  const half = PROP.tip / 2;
  const bot = [];
  for (let i = 0; i < topLine.length; i++) {
    const a = topLine[Math.max(0, i - 1)];
    const b = topLine[Math.min(topLine.length - 1, i + 1)];
    let rx = b[0] - a[0], ry = b[1] - a[1];
    const rn = Math.hypot(rx, ry) || 1;
    const sx = ry / rn, sy = -rx / rn;      // across the wall
    const ceil = topLine[i][2] - margin;
    let z = 0;                               // plate fallback
    for (const o of [-half, 0, half]) {
      for (const zz of surfaceZsAt(tris, topLine[i][0] + sx * o, topLine[i][1] + sy * o)) {
        if (zz < ceil && zz > z) z = zz;     // highest surface below the overhang
      }
    }
    bot.push([topLine[i][0], topLine[i][1], z]);
  }
  return bot;
}

// How far below the clicked/probed overhang a settle pass may still pull the top
// down when looking for a part-attached support. Comfortably covers an overhang's
// own slope over a wall's length, and stays well under the smallest floor-to-
// overhang gap worth supporting -- so the top settles on the overhang, never its
// floor. Shared with draw.js so the two paths measure a part-attached wall alike.
export const PART_BAND = 3.0;

const BORE = {
  radius: 10,      // mm; a cavity narrower than ~2x this reads as a bore/slot
  dirs: 8,         // compass rays cast outward from the support column
  walledMin: 6,    // ...this many hitting part within `radius` = enclosed
  step: 0.5,       // mm along each ray
};

/**
 * Is the support column at station `k` enclosed by part walls -- i.e. standing
 * inside a bore or narrow slot? A support there SCARS an internal surface you
 * cannot clean (worse than a little sag), so [[project_support_fin_quality_first]]
 * says refuse it: a hole is an ORIENTATION problem, not a support one.
 *
 * Cast `dirs` horizontal rays out from the column's centreline at mid-height and
 * count how many strike part material within `radius`. An open ledge-over-base
 * has air on at least some sides (few walled); a blind bore is walled all round.
 */
function enclosedFloor(top, floor, k, topo, rot, offset) {
  const p = top[k];
  const zMid = (floor[k][2] + (top[k][2] - PROP.gap)) / 2;
  // A column whose own centreline is inside the part is buried, not standable.
  if (insidePart(topo, rot, offset, p[0], p[1], zMid)) return true;
  let walled = 0;
  for (let d = 0; d < BORE.dirs; d++) {
    const ang = (d / BORE.dirs) * 2 * Math.PI;
    const dx = Math.cos(ang), dy = Math.sin(ang);
    for (let r = BORE.step; r <= BORE.radius; r += BORE.step) {
      if (insidePart(topo, rot, offset, p[0] + dx * r, p[1] + dy * r, zMid)) {
        walled++;
        break;
      }
    }
  }
  return walled >= BORE.walledMin;
}

/**
 * Can a PART-ATTACHED wall at station `k` stand between its floor and the overhang
 * without piercing a side wall? Mirror of stationIsClear, but bounded to the
 * (floor, top) span the wall actually occupies -- it probes STRICTLY between the
 * ends, since the bottom is meant to weld to the floor and the top to break away
 * under the overhang, and probing those would read the intended contacts as welds.
 */
function clearBetween(top, floor, k, topo, rot, offset) {
  const p = top[k];
  const a = top[Math.max(0, k - 1)];
  const b = top[Math.min(top.length - 1, k + 1)];
  const rx = b[0] - a[0], ry = b[1] - a[1];
  const rn = Math.hypot(rx, ry);
  if (rn < 1e-9) return true;
  const sx = ry / rn, sy = -rx / rn;
  const zTop = p[2] - PROP.gap, zBot = floor[k][2];
  const nP = Math.max(3, Math.ceil((zTop - zBot) / 1.5));
  for (let i = 1; i < nP; i++) {                 // strictly interior heights
    const z = zBot + ((zTop - zBot) * i) / nP;
    for (const m of [0.12, 0.24, PROP.sideClear]) {
      const w = PROP.th / 2 + m;
      if (insidePart(topo, rot, offset, p[0] + sx * w, p[1] + sy * w, z)) return false;
      if (insidePart(topo, rot, offset, p[0] - sx * w, p[1] - sy * w, z)) return false;
    }
  }
  return true;
}

/**
 * Try to stand a PART-ATTACHED wall under `line` (the overhang contact polyline,
 * seated). Returns one of three verdicts:
 *   { ok: true, prop }   -- a part-attached wall was built into `out`.
 *   { floored: true }    -- there IS a floor here (an over-the-part overhang) but
 *                           no safe wall fits (a bore, or side walls in the way);
 *                           the caller must NOT then stilt to the plate through
 *                           the part -- it counts this and moves on.
 *   { }                  -- no floor beneath the overhang; an ordinary bed
 *                           overhang. The caller falls through to the plate path
 *                           UNCHANGED, so the flagship parts don't change.
 *
 * This is the auto-placer's version of what draw.js does by hand: settle a BANDED
 * top so the overhang isn't dragged onto its own floor, read the floor with
 * floorLine, and bridge the two with sweepBetween. It only claims a line when a
 * real floor sits under MOST of it, refuses bores (enclosedFloor), and refuses to
 * pierce side walls (clearBetween).
 */
export function buildPartAttached(line, partTris, topo, rot, offset, out) {
  const top = line.map((p) => [p[0], p[1], p[2]]);
  contourTop(top, partTris, PART_BAND);
  lowerSag(top, partTris, PART_BAND);
  settleTop(top, partTris, 0.25, PART_BAND);
  const floor = floorLine(top, partTris);

  // A real floor under a majority of stations, or this is a bed overhang -- let
  // the plate path have it. floorLine returns ~0 with clear air to the plate, so
  // this declines on every ordinary overhang and the flagship parts don't change.
  let real = 0;
  for (const f of floor) if (f[2] > PROP.gap + 0.5) real++;
  if (real < Math.max(PROP.minStations, Math.ceil(floor.length * 0.5))) return {};

  const ok = top.map((p, k) => {
    if (floor[k][2] <= PROP.gap + 0.5) return false;               // no real floor
    if ((p[2] - PROP.gap) - floor[k][2] < PROP.minHeight) return false;
    if (enclosedFloor(top, floor, k, topo, rot, offset)) return false;
    return clearBetween(top, floor, k, topo, rot, offset);
  });
  const run = longestRun(ok);
  if (!run || run[1] - run[0] < PROP.minStations) return { floored: true };

  const subTop = top.slice(run[0], run[1]);
  const subFloor = floor.slice(run[0], run[1]);
  const span = Math.hypot(subTop[subTop.length - 1][0] - subTop[0][0],
                          subTop[subTop.length - 1][1] - subTop[0][1]);
  if (span < PROP.minSpan) return { floored: true };

  const before = out.length;
  if (!sweepBetween(subTop, subFloor, out)) { out.length = before; return { floored: true }; }

  let height = 0, vol = 0;
  for (let i = 0; i < subTop.length; i++) {
    height = Math.max(height, (subTop[i][2] - PROP.gap) - subFloor[i][2]);
  }
  for (let i = before; i < out.length; i += 3) {
    const a = out[i], b = out[i + 1], c = out[i + 2];
    vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2])
          + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return {
    ok: true,
    prop: {
      span, height, stations: subTop.length, volume: Math.abs(vol),
      partAttached: true,
      line: subTop.map((p) => [p[0], p[1], p[2] - PROP.gap]),
    },
  };
}
