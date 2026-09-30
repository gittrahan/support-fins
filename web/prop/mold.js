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
