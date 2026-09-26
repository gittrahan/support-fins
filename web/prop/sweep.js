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
  const wall = [], flange = [], st = [];
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

    // the stem: a straight thin wall from the bed up to the breakaway tip
    wall.push([
      P(+PROP.th / 2, zBed), P(+PROP.th / 2, ztip), P(+PROP.tip / 2, top),
      P(-PROP.tip / 2, top), P(-PROP.th / 2, ztip), P(-PROP.th / 2, zBed),
    ]);
    // the foot: a flat slab, its own closed solid overlapping the wall's base
    flange.push([
      P(+foot, zBed), P(+foot, baseTop), P(-foot, baseTop), P(-foot, zBed),
    ]);
    st.push({ p, sx, sy, top, ztip, bot: zBed, botTip: baseTop, taperBot: false });
  }

  if (!cutWall(st, wall, out, PROP)) ribbon(wall, out);
  ribbon(flange, out);
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
 * smallest possible witness mark and snaps off cleanly. There is no `gap` at the
 * bottom on purpose: an air gap at both ends would make the support a floating
 * island the slicer cannot anchor, so the support grows UP from the floor (the
 * only printable topology) and the single scar it can leave is on an internal
 * surface you could not have oriented away.
 */
export function sweepBetween(topLine, botLine, out) {
  const wall = [], st = [];
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
    const bot = botLine[i][2];
    const h = top - bot;
    if (h < PROP.minHeight) return false;
    const taper = Math.min(PROP.tipH, h / 2); // tapers meet in the middle if short
    const zBotTip = bot + taper;
    const zTopTip = top - taper;
    const P = (o, z) => [p[0] + sx * o, p[1] + sy * o, z];

    // one closed 8-gon section: tip-wide at both ends, th-wide through the middle
    wall.push([
      P(+PROP.tip / 2, bot), P(+PROP.th / 2, zBotTip),
      P(+PROP.th / 2, zTopTip), P(+PROP.tip / 2, top),
      P(-PROP.tip / 2, top), P(-PROP.th / 2, zTopTip),
      P(-PROP.th / 2, zBotTip), P(-PROP.tip / 2, bot),
    ]);
    st.push({ p, sx, sy, top, ztip: zTopTip, bot, botTip: zBotTip, taperBot: true });
  }

  if (!cutWall(st, wall, out, PROP)) ribbon(wall, out);
  return true;
}
