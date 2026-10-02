/**
 * Bite coupon, step 2: the site's Auto build once per ledge, Tine bite = that
 * ledge's number (tunables.wallBite, the field's path; the rest at the site's PLA
 * defaults), walls and tines under that ledge kept.
 *
 *   deno run -A prototype/calibration/bite/build.js     # -> out/bite-coupon.3mf + .stl
 */
import { loadCoupon, finsWith, keep, supportOf, writeCoupon, finsIn } from '../coupon.js';

const c = loadCoupon(import.meta.url);
const sup = [];
console.log('ledge  bite  walls  tines');
for (const r of c.rungs) {
  const built = finsWith(c, { tunables: { wallBite: r.bite } });
  sup.push(...keep(c, supportOf(built), r.box));
  const walls = finsIn(c, built, r.box);
  console.log(`${String(r.id).padEnd(5)}  ${r.bite.toFixed(2)}  ${walls.length}      ${walls.reduce((s, f) => s + (f.tines ?? 0), 0)}  (whole build: ${built.tines})`);
}
await writeCoupon(c, 'bite', 'Bite coupon', sup);
