/**
 * Bore coupon, step 2: the site's Auto build, once, at the site's PLA defaults.
 * Prints what each bore got, so a bore the engine skipped shows up here.
 *
 *   deno run -A prototype/calibration/bore/build.js     # -> out/bore-coupon.3mf + .stl
 */
import { loadCoupon, finsWith, supportOf, writeCoupon, finsIn } from '../coupon.js';

const c = loadCoupon(import.meta.url);
const built = finsWith(c);
console.log('bore  diameter  walls  tines');
for (const r of c.rungs) {
  const walls = finsIn(c, built, r.box);
  console.log(`${r.id}     ${String(r.diameter).padEnd(8)}  ${walls.length}      ${walls.reduce((s, f) => s + (f.tines ?? 0), 0)}`);
}
console.log(`unserved overhangs: ${built.unserved}`);
await writeCoupon(c, 'bore', 'Bore coupon', supportOf(built));
