/**
 * Orientation coupon, step 2: each ledge's walls from gen.py, stood with Draw's own
 * drawnWall (what a hand-drawn wall on the site runs) at the site's defaults.
 *
 *   deno run -A prototype/calibration/orient/build.js     # -> out/orient-coupon.3mf + .stl
 */
import { loadCoupon, SITE, writeCoupon } from '../coupon.js';
const WEB = new URL('../../../web/', import.meta.url).pathname;
const { drawnWall } = await import(`${WEB}draw.js`);

const c = loadCoupon(import.meta.url);
const tris = new Float64Array(c.part.length * 3);
c.part.forEach((v, i) => tris.set(v, i * 3));
const opts = { tines: SITE.tines, tineDensity: SITE.tineDensity, layerHeight: SITE.layerHeight,
               topo: c.topo, rot: c.rot, offset: c.off };
const sup = [];
console.log('ledge  side      spacing  walls  heights');
for (const r of c.rungs) {
  const at = ([x, y]) => [x + c.off.x, y + c.off.y, r.z + c.off.z];
  const hs = [];
  for (const [a, b] of r.walls) {
    const w = drawnWall(at(a), at(b), tris, 0, opts);
    if (!w.ok) throw new Error(`ledge ${r.id}: ${w.reason}`);
    if (w.partAttached) throw new Error(`ledge ${r.id}: a wall stood on the part, not the plate`);
    hs.push(w.height.toFixed(2));
    sup.push(...w.tris);
  }
  console.log(`${String(r.id).padStart(5)}  ${r.side.padEnd(8)}  ${String(r.span).padStart(4)}  ${String(r.walls.length).padStart(5)}  ${hs.join(' ')}`);
}
await writeCoupon(c, 'orient', 'Orientation coupon', sup);
