/**
 * Short-wall coupon, step 2: stand one plate wall under each ledge of gen.py's
 * coupon with draw mode's own drawnWall (what a hand-drawn wall on the site runs),
 * along the line gen.py gives, so each wall is exactly the length under test. The
 * site's tines are on at its defaults; PROP.minSpan is lifted for the build only.
 *
 *   deno run -A prototype/calibration/short/build.js     # -> out/short-coupon.3mf + .stl
 */
import { loadCoupon, SITE, writeCoupon } from '../coupon.js';
const WEB = new URL('../../../web/', import.meta.url).pathname;
const { PROP } = await import(`${WEB}prop.js`);
const { drawnWall } = await import(`${WEB}draw.js`);

const c = loadCoupon(import.meta.url);
const tris = new Float64Array(c.part.length * 3);
c.part.forEach((v, i) => tris.set(v, i * 3));
PROP.minSpan = 0;
const opts = { tines: SITE.tines, tineDensity: SITE.tineDensity, layerHeight: SITE.layerHeight,
               topo: c.topo, rot: c.rot, offset: c.off };
const sup = [];
console.log('ledge  length  height  ratio   built height  tines');
for (const r of c.rungs) {
  const at = ([x, y]) => [x + c.off.x, y + c.off.y, r.z + c.off.z];
  const w = drawnWall(at(r.wall[0]), at(r.wall[1]), tris, 0, opts);
  if (!w.ok) throw new Error(`ledge ${r.id}: ${w.reason}`);
  if (w.partAttached) throw new Error(`ledge ${r.id}: stood on the part, not the plate`);
  console.log(`${String(r.id).padStart(5)}  ${r.length.toFixed(1).padStart(6)}  ${r.height.toFixed(1).padStart(6)}  ${String(r.ratio).padStart(5)}:1  ${w.height.toFixed(2).padStart(12)}  ${String(w.tines).padStart(5)}`);
  sup.push(...w.tris);
}
await writeCoupon(c, 'short', 'Short-wall coupon', sup);
