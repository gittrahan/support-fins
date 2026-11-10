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
  // The widest open stretch between neighbouring rows. Rows are compared only with rows
  // running the same way, across their own direction: a shelf can carry rows along y plus
  // an edge wall along x, and the distance between those two is not a gap between rows.
  const across = { x: [], y: [] };
  for (const f of walls) {
    const a = f.line[0], b = f.line.at(-1);   // a polyline of stations: take its two ends
    const alongX = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]);
    if (alongX) across.y.push(a[1] - c.off.y); else across.x.push(a[0] - c.off.x);
  }
  const gaps = (v) => v.sort((p, q) => p - q).slice(1).map((t, i) => t - v[i]);
  const widest = Math.max(0, ...gaps(across.y), ...gaps(across.x));
  console.log(`${r.id}      ${String(r.coverage).padEnd(8)}  ${walls.length}      ${widest.toFixed(1)}`);
}
await writeCoupon(c, 'span', 'Span coupon', sup);
