// Nozzle size: every support width was tuned for a 0.4 mm nozzle -- a 1.0 mm wall
// (two 0.5 mm lines), a 0.6 mm contact tip, 0.5 mm tines (one line). On a 0.6 or
// 0.8 nozzle the slicer drops a tine that thin or lays a wall as one weak line, so
// the widths scale by nozzle / 0.4. Heights don't: tine height, the gaps and the
// pad follow the layer height, which has its own field.
//
// Two rules. The one-line features (tines, contact tip) scale both ways: a finer
// nozzle prints a finer tine and leaves a smaller mark. The STRUCTURAL widths (the
// wall, the wedge, the sway brace rib) only grow: a 0.2 nozzle doesn't make a
// free-standing wall any stiffer, so they never go below their 0.4 numbers.
//
// Wall lines (2 / 4 / 6 / 8) thicken the structural widths again, for a tall part
// or a big printer: 4 lines is twice the wall. The tip and tines stay one line, so
// the contact breaks off the same. A thicker wall keeps its foot's margin past its
// face and necks into the tip no flatter than 55deg. Based on Per Hjort's
// nozzle profiles (GitHub #210).
//
// The page sets these once per change; the Worker gets them in opts.tunables.nozzle
// and .wallLines (fins.js applyTunables), like the gap. 0.4 at 2 lines leaves every
// number as it was.
import { PROP } from './prop/config.js';
import { SWAY } from './sway.js';
import { PERP } from './fins/wedges.js';

export const NOZZLE_REF = 0.4;
export const NOZZLE_MAX = 2.0;
// The widest wall: under half the row spacing (PROP.maxUnsupportedSpan, 12 mm), so a
// row's walls and their feet keep air between them. A 2.5 nozzle's two-line wall
// (6.25) or a 2.0 at four lines (10) would fuse the rows into one block.
export const TH_MAX = 6;
export const WALL_LINES = Object.freeze([2, 4, 6, 8]);

// The 0.4 numbers, captured before anything scales them.
const BASE = Object.freeze({
  th: PROP.th, tip: PROP.tip, tineW: PROP.tineW, tipH: PROP.tipH,
  footMin: PROP.footMin, footMax: PROP.footMax, squatBrimW: PROP.squatBrimW, edgeInset: PROP.edgeInset,
  perpTh: PERP.th,
  swayTineW: SWAY.tineW, swayThMin: SWAY.thMin, swayThMax: SWAY.thMax, swayThPerMm: SWAY.thPerMm,
  wallHalf: SWAY.wallHalf,
});

export let nozzle = NOZZLE_REF;
export let wallLines = 2;

/** Scale the support widths for this nozzle diameter (mm). Junk is ignored. */
export function applyNozzle(d) {
  if (!Number.isFinite(d) || d < 0.1 || d > NOZZLE_MAX) return;
  nozzle = d;
  rescale();
}

/** Does an `n`-line wall fit under TH_MAX at nozzle `d`? The page offers only these. */
export const wallLinesFit = (n, d = nozzle) => BASE.th * Math.max(1, d / NOZZLE_REF) * n / 2 <= TH_MAX + 1e-9;

/** Lines across a wall: 2 (the tuned wall), 4, 6 or 8. Anything else is ignored. */
export function applyWallLines(n) {
  if (!WALL_LINES.includes(n)) return;
  wallLines = n;
  rescale();
}

function rescale() {
  const k = nozzle / NOZZLE_REF, grow = Math.max(1, k), thick = grow * wallLines / 2;
  PROP.tip = BASE.tip * k;
  PROP.tineW = BASE.tineW * k;
  SWAY.tineW = BASE.swayTineW * k;
  PROP.th = Math.min(BASE.th * thick, TH_MAX);
  PERP.th = Math.min(BASE.perpTh * thick, TH_MAX);
  // A brace rib is never thinner than the wall; its height rule is the 0.4 one, grown.
  SWAY.thMin = Math.max(BASE.swayThMin * grow, PROP.th);
  SWAY.thMax = Math.max(BASE.swayThMax * grow, PROP.th);
  SWAY.thPerMm = BASE.swayThPerMm * grow;   // same height to reach thMax
  // The braces' keep-clear half-width assumes the widest wall's half (PERP's):
  // a wider wedge needs the braces that much further off.
  SWAY.wallHalf = BASE.wallHalf + (PERP.th - BASE.perpTh) / 2;
  // The feet are half-widths from the wall's centre: a wider wall would swallow them,
  // so they move out with its face.
  const wider = (PROP.th - BASE.th) / 2;
  PROP.footMin = BASE.footMin + wider;
  PROP.footMax = BASE.footMax + wider;
  // ...but a brim stays under half the row spacing, or neighbouring rows' brims fuse.
  PROP.squatBrimW = Math.min(BASE.squatBrimW + wider, (PROP.maxUnsupportedSpan - 1) / 2);
  // The neck into the tip: a 4 mm wall necking to 0.6 over the 1.5 mm taper would
  // overhang. A neck that would lean flatter than 55deg gets the height to stand at 55.
  const neck = (PROP.th - PROP.tip) / 2;
  PROP.tipH = Math.max(BASE.tipH, neck * Math.tan(55 * Math.PI / 180));
  // A tine looks for the part from the wall's centre, past the contact tip: a tip wider
  // than the 0.4 nozzle's (0.6) would swallow the 0.5 reach, and on a curved underside
  // the probe stops finding the part (a sphere at 45deg: 30 tines at 0.4, 6 at 2.0).
  // The extra half-tip is added to the reach (prop/tines.js); 0.4 and finer add nothing.
  PROP.tineReachTip = Math.max(0, (PROP.tip - BASE.tip) / 2);
  // A free edge's outermost row stands in from the edge by the 0.4 tip's half and a
  // bit: at 2.0 the 3 mm tip and its 2.5 mm tines hung 1.2 mm past a cube's edge,
  // tabs out of the side instead of under the part. It steps in as the tip widens.
  PROP.edgeInset = BASE.edgeInset + PROP.tineReachTip;
}
