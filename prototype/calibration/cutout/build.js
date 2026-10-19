/**
 * Cutout coupon, step 2: the site's Auto build once per ledge, Cutouts = that
 * ledge's style (the rest at the site's PLA defaults), walls under that ledge kept.
 * Prints each ledge's support volume, so the plastic each style saves shows here.
 *
 *   deno run -A prototype/calibration/cutout/build.js     # -> out/cutout-coupon.3mf + .stl
 *
 * After `gen.py honeycomb` the same run builds the honeycomb print gate instead
 * (-> out/honeycomb-coupon.3mf): its HEX30 ledge is the honeycomb with regular
 * hexagons, CUT.hexSlope 1/sqrt(3), which nothing on the site can set.
 */
import { loadCoupon, finsWith, keep, supportOf, writeCoupon, finsIn } from '../coupon.js';
const { CUT } = await import(new URL('../../../web/cutout.js', import.meta.url).href);

// the volume of a closed triangle soup, mm3 (divergence theorem)
function volume(v) {
  let s = 0;
  for (let i = 0; i < v.length; i += 3) {
    const [a, b, c] = [v[i], v[i + 1], v[i + 2]];
    s += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  }
  return s / 6;
}

const c = loadCoupon(import.meta.url);
const sup = [];
let solid = null;
console.log(`ledge  style      walls  support mm3  vs ${c.rungs[0].style}`);
const honey = c.rungs.some((r) => r.style === 'hex30');
const shipped = CUT.hexSlope;
try {
  for (const r of c.rungs) {
    CUT.hexSlope = r.style === 'hex30' ? 1 / Math.sqrt(3) : shipped;
    const built = finsWith(c, { tunables: { cutout: r.style === 'hex30' ? 'honeycomb' : r.style } });
    const mine = keep(c, supportOf(built), r.box);
    // a cut wall is overlapping solids, so this sums their overlaps twice: it reads a
    // little high next to the printed plastic (the slicer's estimate is the real number)
    const vol = volume(mine);
    solid ??= vol;
    console.log(`${r.id}      ${r.style.padEnd(8)}  ${finsIn(c, built, r.box).length}      ${vol.toFixed(0).padStart(7)}      ${(100 * vol / solid).toFixed(0)} %`);
    sup.push(...mine);
  }
} finally { CUT.hexSlope = shipped; }
if (honey) await writeCoupon(c, 'honeycomb', 'Honeycomb cutout coupon', sup);
else await writeCoupon(c, 'cutout', 'Cutout coupon', sup);
