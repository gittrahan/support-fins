/**
 * Tine coupon, step 2: the site's Auto build once per ledge with that ledge's tine
 * knobs (tunables.tinesPerWall, or Tines off), the rest at the
 * site's PLA defaults, walls and tines under that ledge kept. KISS ledges' supports
 * go to out/tine-kiss-raw.stl for kiss.py, which cuts them at the part's surface and
 * writes the final 3MF with them as their own object.
 *
 *   deno run -A prototype/calibration/tine/build.js
 */
import { loadCoupon, finsWith, keep, supportOf, writeCoupon, finsIn, assertClosed } from '../coupon.js';

const WEB = new URL('../../../web/', import.meta.url).pathname;
const { writeBinarySTL } = await import(`${WEB}stl.js`);

const c = loadCoupon(import.meta.url);
const sup = [], kiss = [];
let reach;   // the first ledge's wall reach; every other must match
console.log('ledge  walls  tines   (conditions stay in out/key.json: score first)');
for (const r of c.rungs) {
  const built = finsWith(c, { tines: r.tines ?? true, tunables: r.tunables });
  (r.kiss ? kiss : sup).push(...keep(c, supportOf(built), r.box));
  const walls = finsIn(c, built, r.box);
  const tines = walls.reduce((s, f) => s + (f.tines ?? 0), 0);
  console.log(`${String(r.id).padEnd(5)}  ${walls.length}      ${tines}`);
  // tinesPerWall can only undershoot (a tine that doesn't grip isn't re-placed): check it
  const want = r.tunables.tinesPerWall;
  if (want && walls.some((f) => f.tines !== want)) throw new Error(`ledge ${r.id}: asked ${want} tines a wall, got ${walls.map((f) => f.tines)}`);
  // every ledge's wall must reach the same far end, or the rungs aren't comparable
  // (at some ledge positions the engine stops a wall 0.9 mm short: local issue 023)
  for (const f of walls) {
    const far = Math.max(...f.line.map((p) => Math.abs(p[1] - c.off.y)));
    reach ??= far;
    if (Math.abs(far - reach) > 0.05) throw new Error(`ledge ${r.id}: wall reaches ${far.toFixed(2)}, not ${reach.toFixed(2)}`);
  }
  if (r.tines === false && tines) throw new Error(`ledge ${r.id}: tines off but ${tines} built`);
}
await writeCoupon(c, 'tine', 'Tine coupon', sup);
assertClosed(kiss, 'tine kiss supports');
Deno.writeFileSync(`${c.out}tine-kiss-raw.stl`, new Uint8Array(await writeBinarySTL(kiss, 'Tine coupon kiss supports').arrayBuffer()));
console.log(`wrote ${c.out}tine-kiss-raw.stl (kiss.py cuts it and rewrites the 3MF)`);
