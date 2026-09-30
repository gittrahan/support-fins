/**
 * Part-attached walls: an overhang above another part of the part stands its
 * wall on that floor (`floorLine`) instead of stilting to the plate through it,
 * and refuses a buried column (`buriedColumn`) or one a side wall cuts through
 * (`clearBetween`). A wall inside a bore is built and flagged `inBore`.
 * `buildPartAttached` is the verdict the auto-placer acts on.
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
 * looks DOWN across the bottom and takes the HIGHEST hit below the overhang, so the
 * support lands on the part instead of driving to z=0. Taking the highest hit
 * across the bottom's width (not just the centre) means the bottom rests ON the
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
  // Across the bottom's REAL width: the welded tip, or -- for a bottom lifted by
  // footGap (sweepBetween) -- the full th plus footGap past each side. Read across
  // the tip only, a th-wide bottom dug into a floor sloping across the wall; read
  // across th only, it cleared the slope by 0.2 straight down but ~0.05 sideways
  // on a steep one (lbracket X30Y60), close enough to fuse the first layer.
  const g = PROP.footGap, w = PROP.th / 2, t = PROP.tip / 2;
  const offs = g > 0 ? [-w - g, -w, -t, 0, t, w, w + g] : [-t, 0, t];
  const bot = [];
  for (let i = 0; i < topLine.length; i++) {
    const a = topLine[Math.max(0, i - 1)];
    const b = topLine[Math.min(topLine.length - 1, i + 1)];
    let rx = b[0] - a[0], ry = b[1] - a[1];
    const rn = Math.hypot(rx, ry) || 1;
    const sx = ry / rn, sy = -rx / rn;      // across the wall
    const ceil = topLine[i][2] - margin;
    const f = offs.map((o) => {
      let z = 0;                             // plate fallback
      for (const zz of surfaceZsAt(tris, topLine[i][0] + sx * o, topLine[i][1] + sy * o)) {
        if (zz < ceil && zz > z) z = zz;     // highest surface below the overhang
      }
      return z;
    });
    const z = Math.max(...f);
    if (!(g > 0)) { bot.push([topLine[i][0], topLine[i][1], z]); continue; }
    bot.push([topLine[i][0], topLine[i][1], z, ...sideFloors(f, offs, z, w)]);
  }
  return bot;
}

/**
 * The floor under each side of a lifted bottom, so it can TILT with the part
 * instead of hanging level off the highest point: gree's body curves under its
 * walls, and a level bottom sat 0.2 off on the uphill side and up to 2.6 mm in
 * the air on the downhill one -- nothing to grip. Each side takes the floor
 * under it and footGap past it; if the part bulges up between them, both rise
 * until the straight bottom edge clears it -- but never past the highest floor:
 * then the high side pins there and only the low one tilts. The tilt is capped (MAX_DROP across
 * th, ~70deg), so a wall on the brink of a ledge doesn't reach down its face.
 * Returns [zNeg, zPos] for the -w and +w sides (the across-wall `sx` sign).
 */
const MAX_DROP = 2.75;
function sideFloors(f, offs, z, w) {
  let zN = -Infinity, zP = -Infinity;
  offs.forEach((o, k) => {
    if (o <= -w) zN = Math.max(zN, f[k]);
    if (o >= w) zP = Math.max(zP, f[k]);
  });
  zN = Math.max(zN, z - MAX_DROP);
  zP = Math.max(zP, z - MAX_DROP);
  let lift = 0;
  offs.forEach((o, k) => {
    if (o <= -w || o >= w) return;
    lift = Math.max(lift, f[k] - (zN + (zP - zN) * (o + w) / (2 * w)));
  });
  // Never ABOVE the level bottom (z, the highest floor): that height is what
  // clearBetween judged, and a side lifted past it rose into the part above in a
  // tight corner (ushape X30Y60 came within 0.004 mm).
  zN += lift; zP += lift;
  if (zN <= z && zP <= z) return [zN, zP];
  // So pin the high side at z and tilt only the low one, as far down as the
  // bulge lets it: an interior sample f at t across (0 at the low side, 1 at the
  // pinned one) needs low * (1 - t) + z * t >= f.
  const pinP = zP > zN;
  let low = pinP ? zN - lift : zP - lift;
  offs.forEach((o, k) => {
    if (o <= -w || o >= w) return;
    const t = pinP ? (o + w) / (2 * w) : (w - o) / (2 * w);  // 1 at the pinned side
    low = Math.max(low, (f[k] - z * t) / (1 - t));
  });
  low = Math.min(low, z);
  return pinP ? [low, z] : [z, low];
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

const zMidAt = (top, floor, k) => (floor[k][2] + (top[k][2] - PROP.gap)) / 2;

/** A column whose own centreline is inside the part is buried, not standable. */
function buriedColumn(top, floor, k, topo, rot, offset) {
  return insidePart(topo, rot, offset, top[k][0], top[k][1], zMidAt(top, floor, k));
}

/**
 * Is the support column at station `k` enclosed by part walls -- standing inside
 * a bore or narrow slot? Cast `dirs` horizontal rays out from the column's
 * centreline at mid-height and count how many strike part within `radius`: an
 * open ledge-over-base has air on some sides, a bore is walled nearly all round.
 *
 * This USED to refuse the wall. Matthew's print tests (2026-09-27) reversed that:
 * a bore gets supported, and the wall runs along the bore (the contact line under
 * a bore's ceiling follows its axis) so it pulls out an open end. Now it only
 * labels the wall `inBore`, which Suggest orientation weighs as a mild preference
 * for poses that point the holes up.
 */
function enclosedColumn(top, floor, k, topo, rot, offset) {
  const p = top[k], zMid = zMidAt(top, floor, k);
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
 *   { floored: why }     -- there IS a floor here (an over-the-part overhang) but
 *                           no safe wall fits; the caller must NOT then stilt to
 *                           the plate through the part -- it counts this under
 *                           `why` (the plate path's own skip names: 'buried',
 *                           'blocked' = side walls in the way, 'stub' = too short
 *                           or too low, 'degenerate') and moves on.
 *   { }                  -- no floor beneath the overhang; an ordinary bed
 *                           overhang. The caller falls through to the plate path
 *                           UNCHANGED, so the flagship parts don't change.
 *
 * This is the auto-placer's version of what draw.js does by hand: settle a BANDED
 * top so the overhang isn't dragged onto its own floor, read the floor with
 * floorLine, and bridge the two with sweepBetween. It only claims a line when a
 * real floor sits under MOST of it, refuses a buried column (buriedColumn), and
 * refuses to pierce side walls (clearBetween). A wall inside a bore is built and
 * flagged `inBore` (enclosedColumn).
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

  // Why each station failed, so a refusal is counted under its real reason (the
  // one count used to be `bore` for all of them; most were short runs).
  const why = [];
  const ok = top.map((p, k) => {
    if (floor[k][2] <= PROP.gap + 0.5) return false;               // no real floor
    if ((p[2] - PROP.gap) - floor[k][2] < PROP.minHeight) { why.push('stub'); return false; }
    if (buriedColumn(top, floor, k, topo, rot, offset)) { why.push('buried'); return false; }
    if (clearBetween(top, floor, k, topo, rot, offset)) return true;
    why.push('blocked');
    return false;
  });
  const run = longestRun(ok);
  if (!run || run[1] - run[0] < PROP.minStations) {
    // Mostly-failing stations name the refusal; a clear run that is merely short is a stub.
    const n = {};
    for (const w of why) n[w] = (n[w] ?? 0) + 1;
    const worst = Object.keys(n).sort((a, b) => n[b] - n[a])[0];
    return { floored: why.length * 2 >= floor.length && worst ? worst : 'stub' };
  }

  const subTop = top.slice(run[0], run[1]);
  const subFloor = floor.slice(run[0], run[1]);
  const span = Math.hypot(subTop[subTop.length - 1][0] - subTop[0][0],
                          subTop[subTop.length - 1][1] - subTop[0][1]);
  if (span < PROP.minSpan) return { floored: 'stub' };

  const before = out.length;
  if (!sweepBetween(subTop, subFloor, out)) { out.length = before; return { floored: 'degenerate' }; }

  // In a bore when most of the kept run is walled all round.
  let walled = 0;
  for (let k = run[0]; k < run[1]; k++) if (enclosedColumn(top, floor, k, topo, rot, offset)) walled++;
  const inBore = walled * 2 > run[1] - run[0];

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
      partAttached: true, inBore,
      line: subTop.map((p) => [p[0], p[1], p[2] - PROP.gap]),
    },
  };
}
