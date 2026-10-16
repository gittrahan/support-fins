/**
 * Tall-wall coupon, step 2: stand one plate wall under each ledge of gen.py's coupon
 * with draw mode's own drawnWall (what a hand-drawn wall on the site runs), braced the
 * way the rung says (the site's Draw never passes brace: true today -- only the Full
 * fill pass braces; wiring tallH into Auto and Draw is local issue 046's next step): bare, or face ribs (BRACE.tallH lifted to 0) rising BRACE.rise.
 * The aspect rule's end ribs are switched off so only the face ribs are under test.
 *
 *   deno run -A prototype/calibration/tall/build.js     # -> out/tall-coupon.3mf + .stl
 */
import { loadCoupon, SITE, writeCoupon } from '../coupon.js';
const WEB = new URL('../../../web/', import.meta.url).pathname;
const { BRACE } = await import(`${WEB}prop.js`);
const { drawnWall } = await import(`${WEB}draw.js`);

const c = loadCoupon(import.meta.url);
const tris = new Float64Array(c.part.length * 3);
c.part.forEach((v, i) => tris.set(v, i * 3));
BRACE.aspect = Infinity;
const opts = { tines: SITE.tines, tineDensity: SITE.tineDensity, layerHeight: SITE.layerHeight,
               topo: c.topo, rot: c.rot, offset: c.off, brace: true };
const sup = [];
console.log('ledge  height  ribs     built height  ribs built');
for (const r of c.rungs) {
  BRACE.tallH = r.rise ? 0 : Infinity;
  BRACE.rise = r.rise || 0.5;
  const at = ([x, y]) => [x + c.off.x, y + c.off.y, r.z + c.off.z];
  const w = drawnWall(at(r.wall[0]), at(r.wall[1]), tris, 0, opts);
  if (!w.ok) throw new Error(`ledge ${r.id}: ${w.reason}`);
  if (w.partAttached) throw new Error(`ledge ${r.id}: stood on the part, not the plate`);
  if (w.braces !== (r.rise ? 2 : 0)) throw new Error(`ledge ${r.id}: ${w.braces} ribs built, wanted ${r.rise ? 2 : 0}`);
  console.log(`${String(r.id).padStart(5)}  ${r.height.toFixed(0).padStart(6)}  ${r.name.padEnd(4)}  ${w.height.toFixed(2).padStart(12)}  ${String(w.braces).padStart(10)}`);
  sup.push(...w.tris);
}
await writeCoupon(c, 'tall', 'Tall-wall coupon', sup);
