/**
 * Resin feet (GitHub #309): with Vertical (resin) pins, a wall's flat base flange (and
 * a squat wall's brim) gets windows cut through it. A resin print is cured onto the
 * build plate, and a user found our solid rectangular feet "really stuck on"; Elegoo's
 * slicer cuts a grid of holes in its support base so it flexes when a scraper goes
 * under it.
 *
 * So the flange is a narrow strip under the stem, unbroken (the wall stands on it all
 * the way along), plus full-width pads RESIN_FOOT.pad long with RESIN_FOOT.window of
 * plate between them, on both sides. Each pad is its own closed box overlapping the
 * strip (overlapping solids, never flush). A flange shorter than one pad + window
 * stays solid: there is nothing to flex. Each pad's outer edges are undercut at 45deg:
 * narrow on the plate, full width on top. A resin print hangs upside down, so the lip is
 * an ordinary 45deg overhang off the plate; the tester asked for this way round (the
 * first cut bevelled up from the plate instead), so a scraper's blade slides into the
 * gap under the lip and pries the pad up rather than cutting a thin edge off the plate.
 */
import { ribbon } from '../solids.js';

export const RESIN_FOOT = {
  pad: 1.5,       // mm: a full-width pad along the wall
  window: 2.0,    // mm: the plate left bare between two pads
  strip: 0.4,     // mm: the strip reaches this far past the stem on each side
  bevel: 1.0,     // the pad's outer edge undercuts this many mm per mm of height (45deg)
};

/**
 * `feet`: one per station along the wall, { p, sx, sy, foot, sh, zBed, baseTop } --
 * the station's point, its across-the-wall unit vector, the flange's and the stem's
 * half-widths, and the flange's bottom and top. Emits the windowed flange into `out`.
 * Returns false (nothing emitted) when the flange is too short to window.
 */
export function windowedFlange(feet, out) {
  const s = [0];
  for (let i = 1; i < feet.length; i++) {
    s.push(s[i - 1] + Math.hypot(feet[i].p[0] - feet[i - 1].p[0], feet[i].p[1] - feet[i - 1].p[1]));
  }
  const L = s[s.length - 1];
  const { pad, window, strip } = RESIN_FOOT;
  if (!(L >= pad + window + pad)) return false;
  // the strip under the stem, the whole length
  ribbon(feet.map((f) => sec(f, f.p, Math.min(f.foot, f.sh + strip))), out);
  // pads spread evenly, one at each end
  const n = Math.floor((L - pad) / (pad + window)) + 1;
  const pitch = n > 1 ? (L - pad) / (n - 1) : 0;
  for (let k = 0; k < n; k++) {
    const a = at(feet, s, k * pitch), b = at(feet, s, k * pitch + pad);
    ribbon([padSec(a.f, a.p), padSec(b.f, b.p)], out);
  }
  return true;
}

// the flange's cross-section at point p, the station f's frame, `half` wide each side
const sec = (f, p, half) => {
  const P = (o, z) => [p[0] + f.sx * o, p[1] + f.sy * o, z];
  return [P(+half, f.zBed), P(+half, f.baseTop), P(-half, f.baseTop), P(-half, f.zBed)];
};

// a pad's cross-section: full width on top, its outer edges undercut down to no
// narrower than the strip on the plate
const padSec = (f, p) => {
  const P = (o, z) => [p[0] + f.sx * o, p[1] + f.sy * o, z];
  const bed = Math.max(Math.min(f.foot, f.sh + RESIN_FOOT.strip),
                       f.foot - RESIN_FOOT.bevel * (f.baseTop - f.zBed));
  return [P(+bed, f.zBed), P(+f.foot, f.baseTop), P(-f.foot, f.baseTop), P(-bed, f.zBed)];
};

// the point `d` along the wall (clamped to it), with the nearer station's frame
function at(feet, s, d) {
  d = Math.max(0, Math.min(s[s.length - 1], d));
  let i = 1;
  while (i < s.length - 1 && s[i] < d) i++;
  const t = s[i] > s[i - 1] ? (d - s[i - 1]) / (s[i] - s[i - 1]) : 0;
  const a = feet[i - 1].p, b = feet[i].p;
  return { p: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])], f: t < 0.5 ? feet[i - 1] : feet[i] };
}
