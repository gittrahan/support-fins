/**
 * Resin pins (GitHub #309): the 'vertical' tine direction. A resin print is peeled
 * off the vat floor every layer, so a support has to be ATTACHED to the part --
 * a resin slicer's contact tip sinks into the model -- and a wall stopping `gap`
 * under a flat span (the FDM wall) holds nothing. Instead of the horizontal comb
 * (tines.js), each station gets a thin square pin standing on the wall top, up
 * across the gap and PROP.pinDepth into the part above it.
 *
 * Every pin is checked, never assumed: its four top corners must be inside the
 * part (so it bites the underside, not its own edge), and a pin that would come
 * out the other side of a thin section sinks shallower or is skipped.
 *
 * Untested on a resin printer; the numbers are resin slicers' tip sizes.
 */
import { insidePart } from '../inside.js';
import { boxExtrude } from '../solids.js';
import { PROP } from './config.js';

const PROBE = 0.05;     // how finely a pin corner looks up for the part's surface
const LOOK = 2.0;       // and how far: a corner with no part this close above is off the part

/**
 * Same arguments as emitTines (tines.js) -- `line` is the wall's settled top contour
 * (each station's z is the part surface above it). Returns how many pins landed.
 */
export function emitPins(line, tris, topo, rot, offset, out, stepArg = PROP.tineStep,
                         minTop = PROP.baseH + 0.2, tineH, body = null, grip = null) {
  if (line.length < 2) return 0;
  const s = [0];
  for (let i = 1; i < line.length; i++) {
    s.push(s[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  }
  const S = s[s.length - 1];
  if (!(S > 0)) return 0;
  // the comb's spacing rules: the user's step, tightened to the grip floor on a short wall
  const step = PROP.tinesPerWall > 0 ? S / PROP.tinesPerWall : Math.min(stepArg, S / PROP.minGripTines);
  const half = PROP.pinW / 2, inside = (x, y, z) => insidePart(topo, rot, offset, x, y, z);

  // the lowest z at or above `z` where (x, y) is inside the part, or null
  const entry = (x, y, z) => {
    for (let h = 0; h <= LOOK; h += PROBE) if (inside(x, y, z + h)) return z + h;
    return null;
  };

  let count = 0;
  const place = (d) => {
    let k = 0;
    while (k < s.length - 2 && s[k + 1] < d) k++;
    const f = (d - s[k]) / Math.max(1e-9, s[k + 1] - s[k]);
    const x = line[k][0] + (line[k + 1][0] - line[k][0]) * f;
    const y = line[k][1] + (line[k + 1][1] - line[k][1]) * f;
    const z = line[k][2] + (line[k + 1][2] - line[k][2]) * f;   // surface z
    const wallTop = z - PROP.gap;
    if (wallTop < minTop) return;
    // the pin's square, squared to the run like the wall it stands on
    const rx = line[k + 1][0] - line[k][0], ry = line[k + 1][1] - line[k][1], rm = Math.hypot(rx, ry) || 1;
    const ux = rx / rm, uy = ry / rm, vx = -uy, vy = ux;
    const corners = [[-half, -half], [half, -half], [half, half], [-half, half]]
      .map(([a, b]) => [x + ux * a + vx * b, y + uy * a + vy * b]);
    // where each corner meets the part: the pin's top clears the HIGHEST, so all four bite
    let meet = -Infinity;
    for (const [cx, cy] of corners) {
      const e = entry(cx, cy, wallTop);
      if (e === null) return;               // a corner off the part's edge: no pin
      meet = Math.max(meet, e);
    }
    // sink pinDepth in, shallower where the part is thinner than that; a section too
    // thin for even a quarter of it gets no pin (it would print through)
    let top = null;
    for (let dep = PROP.pinDepth; dep >= PROP.pinDepth / 4 - 1e-9; dep /= 2) {
      if (corners.every(([cx, cy]) => inside(cx, cy, meet + dep) && inside(cx, cy, meet + dep / 2))) { top = meet + dep; break; }
    }
    if (top === null) return;
    // from inside the wall (tineOverlap down, so they union) up to `top`
    const bot = wallTop - PROP.tineOverlap;
    boxExtrude([[-half, -half], [half, -half], [half, half], [-half, half]], bot, top,
      (a, b, c) => [x + ux * a + vx * b, y + uy * a + vy * b, c], out);
    if (grip && bot < grip.z) grip.z = bot;
    if (globalThis.__TINECAP) globalThis.__TINECAP.push({ x, y, z: z - (tineH ?? PROP.tineH) / 2, biteX: 0, biteY: 0 });
    count++;
  };
  for (let d = step / 2; d < S; d += step) place(d);
  return count;
}
