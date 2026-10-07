/**
 * The wall solid: `sweep` emits the upside-down T (thin wall on a flat flange)
 * along a contact line down to the plate, `sweepBetween` a part-attached wall
 * between an overhang and the floor under it. `footFor` / `profileHalf` give the
 * cross-section the clearance probes test against.
 *
 * Split out of prop.js, which re-exports the public names.
 */
import { cutWall } from '../cutout.js';
import { ribbon } from '../solids.js';
import { PROP } from './config.js';
import { crestCut, crestKinds, dropCollapsed, emitCrest } from './crest.js';

/**
 * Foot half-width for a wall of height `h`.
 *
 * The spike used a fixed 7mm foot, which assumes the overhang sits well above
 * the plate. Real parts' overhangs are low -- median wall height 2.5mm -- so 22
 * of 36 walls degenerated into 14mm-wide splayed sheets. The foot has to scale
 * with how tall the wall actually is: `footRatio * h`, floored and capped.
 *
 * The cap is the load-bearing part. A row of walls is spaced maxUnsupportedSpan
 * apart, so the foot MUST stay under half that spacing or adjacent feet overlap
 * and the whole row merges into a solid buttress (the flagship's "thick feet",
 * measured 2026-07-30: 65mm-tall walls maxed the old 7mm foot -> 14mm feet on a
 * 12mm pitch). `footMax` is set below that line, and this clamp enforces it even
 * if the span is later dialled down -- leave ~1mm of air between neighbours.
 */
export const footFor = (h) => {
  const spanCap = Math.max(PROP.footMin, (PROP.maxUnsupportedSpan - 1) / 2);
  return Math.max(PROP.footMin,
                  Math.min(PROP.footMax, spanCap, h * PROP.footRatio));
};

/**
 * Half-width of the ⊥ cross-section at height `z` above the bed, for a wall
 * whose contact tips out at `top`: a flat base flange (the foot of the T), a
 * straight thin wall, then the breakaway tip taper. ONE definition, shared by
 * the geometry in sweep() and the two measurement passes -- they used to carry
 * three separate copies of a cone formula, which is exactly how a shape change
 * silently disagrees with the checker that is supposed to catch it.
 */
export function profileHalf(z, top) {
  const ztip = Math.max(top - PROP.tipH, PROP.baseH + 0.1);
  if (z < PROP.baseH) return footFor(top);      // flat flange (the T's foot)
  if (z < ztip) return PROP.th / 2;             // straight wall (the T's stem)
  return PROP.th / 2                            // neck into the contact tip
       - ((PROP.th - PROP.tip) / 2) * ((z - ztip) / Math.max(1e-6, top - ztip));
}

/**
 * Sweep the prop along `line`, emitting an upside-down T: a straight thin wall
 * standing on a flat base flange. They are TWO overlapping closed solids, not
 * one -- the slicer unions them, the same overlap approach the rest of the repo
 * uses -- which keeps each section convex and sidesteps capping a T's concave
 * outline. Replaces the single cone-footed solid that read as a golf tee.
 */
export function sweep(line, zBed, out, minH = PROP.minHeight) {
  const wall = [], flange = [], st = [], crest = [];
  const kinds = crestKinds(line);          // the interface crest's plan, null when off
  for (let i = 0; i < line.length; i++) {
    const p = line[i];
    const a = line[Math.max(0, i - 1)];
    const b = line[Math.min(line.length - 1, i + 1)];
    let rx = b[0] - a[0], ry = b[1] - a[1];
    const rn = Math.hypot(rx, ry);
    if (rn < 1e-9) return false;
    rx /= rn; ry /= rn;
    const sx = ry, sy = -rx;              // horizontal, across the wall

    const top = p[2] - PROP.gap;
    const h = top - zBed;
    if (h < minH) return false;
    const foot = footFor(h);
    // A low TAIL station (see withLowTails) has less headroom than the flange +
    // tip taper assume, so both shrink with it. Identical to before for h >= 1.2.
    const flangeH = Math.min(PROP.baseH, h / 2);
    const ztip = Math.max(top - PROP.tipH, zBed + flangeH + 0.1);
    const baseTop = zBed + flangeH;
    const P = (o, z) => [p[0] + sx * o, p[1] + sy * o, z];
    // where the interface crest runs, the stem stops at the crest's cut
    const c = crestCut(top, ztip, zBed, kinds?.[i]);
    crest.push(c?.ring(P) ?? null);
    const [zt, zTop, wTop] = c ? [c.zt, c.cut, c.wc] : [ztip, top, PROP.tip / 2];

    // the stem: a straight thin wall from the bed up to the breakaway tip
    wall.push([
      P(+PROP.th / 2, zBed), P(+PROP.th / 2, zt), P(+wTop, zTop),
      P(-wTop, zTop), P(-PROP.th / 2, zt), P(-PROP.th / 2, zBed),
    ]);
    // the foot: a flat slab, its own closed solid overlapping the wall's base
    flange.push([
      P(+foot, zBed), P(+foot, baseTop), P(-foot, baseTop), P(-foot, zBed),
    ]);
    st.push({ p, sx, sy, top: zTop, ztip: zt, tipHalf: wTop, bot: zBed, botTip: baseTop, taperBot: false });
  }

  const from = out.length;
  if (!cutWall(st, wall, out, PROP)) ribbon(wall, out);
  ribbon(flange, out);
  if (kinds) { dropCollapsed(out, from); emitCrest(crest, out); }
  return true;
}


/**
 * Sweep a PART-ATTACHED wall between two contours: its top stops `gap` below the
 * overhang (`topLine`, exactly as `sweep` does) and its bottom rests ON the floor
 * contour (`botLine` from `floorLine`) instead of a flat `zBed`.
 *
 * The bottom is a per-station contour, so it conforms to a sloped or curved floor
 * for free -- no flat foot ellipse, which would only touch a level surface at one
 * edge. The wall tapers to the `tip` width at BOTH ends: the top tip breaks away
 * under the overhang (the part bridges the `gap`), and the bottom tip is the only
 * thing that welds to the part below, kept as narrow as the top so it leaves the
 * smallest possible witness mark and snaps off cleanly.
 *
 * The bottom stops PROP.footGap above the floor -- the same clearance as the top,
 * a slicer's "bottom Z distance". It used to weld on purpose, on the worry that
 * a gap at both ends makes a floating island the slicer can't anchor; the foot
 * coupon (prototype/calibration/foot/) printed the gap clean, and the welded tip
 * was the only one that scarred the part (local issue 009). The first layer
 * sags across the gap, so the bottom keeps the full wall thickness -- two lines
 * over air, not one 0.6 mm tip line that could peel. footGap 0 welds as before.
 * Over open plate (a floor of 0) there is no part to scar, so no gap: the bottom
 * stands on the plate.
 *
 * `minH` is the least headroom a station needs (Draw mode passes minHeightSquat
 * for a squat wall the user asked for by hand; Auto keeps minHeight).
 */
export function sweepBetween(topLine, botLine, out, minH = PROP.minHeight) {
  const welded = PROP.footGap <= 0;
  // only the PART gets the gap: a station whose floor is open plate all across
  // (floorLine's 0, the highest surface under the wall's width) stands on it --
  // lifted, a wall over the plate floated 0.2 mm in the air with nothing for the
  // slicer to start it on (a figure's hand over the plate). Decided per STATION,
  // both sides together: sideFloors' tilt assumes one gap added to both, and a
  // plate side left down under a chamfer's toe ran 0.07 mm off the part
  const wall = [], st = [], crest = [];
  const kinds = crestKinds(topLine);       // the interface crest's plan, null when off
  for (let i = 0; i < topLine.length; i++) {
    const p = topLine[i];
    const a = topLine[Math.max(0, i - 1)];
    const b = topLine[Math.min(topLine.length - 1, i + 1)];
    let rx = b[0] - a[0], ry = b[1] - a[1];
    const rn = Math.hypot(rx, ry);
    if (rn < 1e-9) return false;
    rx /= rn; ry /= rn;
    const sx = ry, sy = -rx;                 // horizontal, across the wall

    const top = p[2] - PROP.gap;
    const g = botLine[i][2] > 0 ? PROP.footGap : 0;
    const bot = botLine[i][2] + g;
    // judged on the headroom, not the lifted wall: the gap must not change
    // WHICH walls exist (hub_corner X60 lost a 31 mm wall to a 1.6 mm station)
    if (top - botLine[i][2] < minH) return false;
    // a lifted bottom tilts with the floor under each side (floorLine's
    // sideFloors); welded, or with no side floors, it is level at `bot`
    // (a molded side can sit above `bot`: never within 0.5 of the top, which the
    // headroom check above keeps >= minH - footGap over the plain floor + gap --
    // 1.3 at minHeight, 0.4 for Draw's squat minH)
    const side = (k) => (welded || botLine[i].length < 5 ? bot
      : Math.min(botLine[i][k] + g, top - 0.5));
    const bN = side(3), bP = side(4);
    const bHi = Math.max(bN, bP);
    const h = top - bHi;
    // tapers meet in the middle if short; lifted, the top taper stops 0.1 above
    // the bottom's high side -- ending ON it collapsed a section edge into
    // zero-area slivers (ssdMounts X30Y60: short part walls, 4 per wall)
    const taper = Math.min(PROP.tipH, welded ? h / 2 : h - 0.1);
    const zBotTip = welded ? bot + taper : bHi;
    const P = (o, z) => [p[0] + sx * o, p[1] + sy * o, z];
    // where the interface crest runs, the wall stops at the crest's cut
    const c = crestCut(top, top - taper, zBotTip, kinds?.[i]);
    crest.push(c?.ring(P) ?? null);
    const [zTopTip, zTop, wTop] = c ? [c.zt, c.cut, c.wc] : [top - taper, top, PROP.tip / 2];

    // one closed section: th-wide through the middle, tip-wide at the top and,
    // when welded, at the bottom too
    wall.push(welded ? [
      P(+PROP.tip / 2, bot), P(+PROP.th / 2, zBotTip),
      P(+PROP.th / 2, zTopTip), P(+wTop, zTop),
      P(-wTop, zTop), P(-PROP.th / 2, zTopTip),
      P(-PROP.th / 2, zBotTip), P(-PROP.tip / 2, bot),
    ] : [
      P(+PROP.th / 2, bP), P(+PROP.th / 2, zTopTip), P(+wTop, zTop),
      P(-wTop, zTop), P(-PROP.th / 2, zTopTip), P(-PROP.th / 2, bN),
    ]);
    st.push({ p, sx, sy, top: zTop, ztip: zTopTip, tipHalf: wTop, bot: bHi, botTip: zBotTip, taperBot: welded, botN: bN, botP: bP });
  }

  const from = out.length;
  if (!cutWall(st, wall, out, PROP)) ribbon(wall, out);
  if (kinds) { dropCollapsed(out, from); emitCrest(crest, out); }
  return true;
}

