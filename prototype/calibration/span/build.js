/**
 * Span coupon, step 2: the site's Auto build once per shelf, Coverage = that
 * shelf's dial value (the rest at the site's PLA defaults), walls under it kept.
 *
 *   deno run -A prototype/calibration/span/build.js     # -> out/span-coupon.3mf + .stl
 */
import { loadCoupon, finsWith, keep, supportOf, writeCoupon, finsIn } from '../coupon.js';

const c = loadCoupon(import.meta.url);
const sup = [];
console.log('shelf  coverage  walls  widest gap between walls (mm)');
for (const r of c.rungs) {
  const built = finsWith(c, { coverage: r.coverage / 100 });
  sup.push(...keep(c, supportOf(built), r.box));
  const walls = finsIn(c, built, r.box);
  // the rows run along x or y; the widest open stretch between neighbouring rows
  const ys = walls.map((f) => f.line[0][1] - c.off.y).sort((a, b) => a - b);
  const xs = walls.map((f) => f.line[0][0] - c.off.x).sort((a, b) => a - b);
  const gaps = (v) => v.slice(1).map((t, i) => t - v[i]);
  const widest = Math.max(0, ...gaps(ys), ...gaps(xs));
  console.log(`${r.id}      ${String(r.coverage).padEnd(8)}  ${walls.length}      ${widest.toFixed(1)}`);
}
await writeCoupon(c, 'span', 'Span coupon', sup);
