/**
 * The floor a PART-ATTACHED wall stands on: `floorLine` reads it under each
 * station, and the bottom a lifted wall gets from it (see sweepBetween).
 *
 * Split out of attached.js, which uses it; prop.js re-exports `floorLine`.
 */
import { PROP } from './config.js';
import { surfaceZsAt } from './surface.js';

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
export function floorLine(topLine, tris, margin = 1.0, mold = false) {
  // Across the bottom's REAL width: the welded tip, or -- for a bottom lifted by
  // footGap (sweepBetween) -- the full th plus footGap past each side. Read across
  // the tip only, a th-wide bottom dug into a floor sloping across the wall; read
  // across th only, it cleared the slope by 0.2 straight down but ~0.05 sideways
  // on a steep one (lbracket X30Y60), close enough to fuse the first layer.
  // With `mold`, it also reads along the wall (below), so the bottom sits on the
  // floor offset by footGap in every direction -- the part, dilated.
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
    // molding (moldLine), also footGap ahead and behind along the wall: the
    // bottom keeps its gap from a floor rising along the wall too, not just
    // straight down. Only for the bottom's SHAPE -- the plain reading is what
    // buildPartAttached decides where walls go by (fed this one, it placed a
    // different wall in tube X30Y60, grazing the bore)
    const along = mold && g > 0 ? [-g, 0, g] : [0];
    const ax = rx / rn, ay = ry / rn;
    const f0 = [], fm = [];                  // straight down; and molded (with along)
    for (const o of offs) {
      let z0 = 0, zm = 0;                    // plate fallback
      for (const d of along) {
        const x = topLine[i][0] + sx * o + ax * d, y = topLine[i][1] + sy * o + ay * d;
        for (const zz of surfaceZsAt(tris, x, y)) {
          if (zz >= ceil) continue;          // highest surface below the overhang
          if (zz > zm) zm = zz;
          if (d === 0 && zz > z0) z0 = zz;
        }
      }
      f0.push(z0); fm.push(zm);
    }
    // [2] is the plain floor every decision (and sweepBetween's headroom) uses;
    // the molded reading only places the bottom's two sides
    const z = Math.max(...f0);
    if (!(g > 0)) { bot.push([topLine[i][0], topLine[i][1], z]); continue; }
    bot.push([topLine[i][0], topLine[i][1], z, ...sideFloors(fm, offs, Math.max(...fm), w)]);
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
 * then the high side pins there and only the low one tilts. The tilt reaches at most
 * MAX_DROP across th (~70deg), leaving that corner at most MAX_HANG over its floor; a
 * side whose floor is further down stays level, so a wall on the brink of a ledge
 * doesn't reach down its face into the air.
 * Returns [zNeg, zPos] for the -w and +w sides (the across-wall `sx` sign).
 */
const MAX_DROP = 2.75, MAX_HANG = 1.0;
function sideFloors(f, offs, z, w) {
  let zN = -Infinity, zP = -Infinity;
  offs.forEach((o, k) => {
    if (o <= -w) zN = Math.max(zN, f[k]);
    if (o >= w) zP = Math.max(zP, f[k]);
  });
  // The tilt stops at MAX_DROP. A side whose floor is only a little past that (a
  // steep slope: bore_bracket's bore) keeps the capped tilt, its corner just over
  // the slope; one whose floor is further -- open to the plate past a ledge edge, or
  // a step well down -- stays LEVEL at z: tilted, it reached into the air, a corner
  // the slicer starts mid-air (Auto built them on the lighthouse X90, gree,
  // artichoke, the #121 M4; local issue 032).
  zN = zN < z - MAX_DROP - MAX_HANG ? z : Math.max(zN, z - MAX_DROP);
  zP = zP < z - MAX_DROP - MAX_HANG ? z : Math.max(zP, z - MAX_DROP);
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

/**
 * MOLD a lifted wall's bottom to the part: the stations `floorLine` reads, plus
 * more wherever the floor changes fast between two of them, so the bottom traces
 * the part instead of cutting straight across it. Stations are stationStep
 * (1 mm) apart, and gree's leg rose 26 mm across two of them: the bottom ran
 * across the curve as one straight edge touching almost nowhere. Halves each
 * such gap until the floor (level, and under each side) steps at most MOLD_STEP,
 * down to MOLD_MIN apart (a sheer drop stops there). The new stations sit on the
 * straight line between their neighbours, top included, so only the bottom
 * changes. Welded (footGap 0), the floor is returned as floorLine reads it.
 *
 * @returns { top, floor } for sweepBetween
 */
const MOLD_STEP = 0.25, MOLD_MIN = 0.1;
export function moldLine(top, tris) {
  if (!(PROP.footGap > 0)) return { top, floor: floorLine(top, tris) };
  let floor = floorLine(top, tris, undefined, true);
  const jump = (a, b) => Math.max(...[2, 3, 4].map((k) => Math.abs(a[k] - b[k])));
  for (let pass = 0; pass < 8; pass++) {
    const next = [];
    let added = 0;
    for (let i = 0; i < top.length; i++) {
      next.push(top[i]);
      if (i + 1 === top.length) break;
      const p = top[i], q = top[i + 1];
      if (jump(floor[i], floor[i + 1]) <= MOLD_STEP) continue;
      if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 2 * MOLD_MIN) continue;
      next.push([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2]);
      added++;
    }
    if (!added) break;
    top = next;
    floor = floorLine(top, tris, undefined, true);
  }
  return { top, floor };
}
