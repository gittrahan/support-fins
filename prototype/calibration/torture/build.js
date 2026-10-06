/**
 * Torture test, step 2: ONE build of the whole part the way the site makes it --
 * Full coverage (mode 'full') at every other default -- and every support kept.
 * Prints what got walls and what Full coverage says no wall can reach.
 *
 *   deno run -A prototype/calibration/torture/build.js
 */
import { loadCoupon, finsWith, supportOf, writeCoupon } from '../coupon.js';

const c = loadCoupon(import.meta.url);
const built = finsWith(c, { mode: 'full' });
const kinds = {};
for (const f of built.fins) { const k = f.kind + (f.short ? ' (short)' : ''); kinds[k] = (kinds[k] ?? 0) + 1; }
console.log('walls', kinds, 'fill walls', built.fill?.walls ?? built.fins.filter((f) => f.fill).length,
  'tines', built.tines, 'pad', !!built.pad);
console.log('fill', JSON.stringify(built.fill, (k, v) => (Array.isArray(v) && v.length > 8 ? `[${v.length}]` : v)));
await writeCoupon(c, 'torture', 'Torture test', supportOf(built));
