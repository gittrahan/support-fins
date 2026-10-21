/**
 * Tie coupon, step 2: the site's Auto build of gen.py's part twice -- with Tie walls
 * together and without -- keeping each build's supports under its own shelf.
 *
 *   deno run -A prototype/calibration/ties/build.js     # -> out/ties-coupon.3mf + .stl
 */
import { finsIn, finsWith, keep, loadCoupon, supportOf, writeCoupon } from '../coupon.js';

const c = loadCoupon(import.meta.url);
const sup = [];
console.log('shelf  walls  ties');
for (const r of c.rungs) {
  const built = finsWith(c, { tieWalls: r.tie });
  const walls = finsIn(c, built, r.box).filter((f) => f.kind === 'prop');
  const ties = walls.reduce((n, f) => n + (f.ties ?? 0), 0) / 2;   // each tie counts on both walls
  if (r.tie && !(ties >= walls.length - 1)) throw new Error(`${r.name}: ${ties} ties on ${walls.length} walls`);
  console.log(`${r.name.padEnd(5)}  ${String(walls.length).padStart(5)}  ${String(ties).padStart(4)}`);
  sup.push(...keep(c, supportOf(built), r.box));
}
await writeCoupon(c, 'ties', 'Tie coupon', sup);
