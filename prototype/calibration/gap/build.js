/**
 * Gap coupon, step 2: the site's Auto build once per ledge, Gap = that ledge's
 * number (the rest at the site's PLA defaults), walls under that ledge kept.
 *
 *   deno run -A prototype/calibration/gap/build.js     # -> out/gap-coupon.3mf + .stl
 */
import { loadCoupon, finsWith, keep, supportOf, writeCoupon } from '../coupon.js';

const c = loadCoupon(import.meta.url);
const sup = [];
console.log('ledge  gap    walls  tines  unserved');
for (const r of c.rungs) {
  const built = finsWith(c, { tunables: { propGap: r.gap } });
  const mine = keep(c, supportOf(built), r.box);
  const walls = (built.fins ?? []).filter((f) => {
    const p = f.line?.[0];
    return p && p[0] - c.off.x >= r.box[0] && p[0] - c.off.x <= r.box[1] && p[1] - c.off.y >= r.box[2] && p[1] - c.off.y <= r.box[3];
  });
  console.log(`${r.id}      ${String(r.gap).padEnd(5)}  ${walls.length}      ${walls.reduce((s, f) => s + (f.tines ?? 0), 0)}      ${built.unserved}`);
  sup.push(...mine);
}
await writeCoupon(c, 'gap', 'Gap coupon', sup);
