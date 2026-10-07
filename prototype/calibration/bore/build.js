/**
 * Bore coupon, step 2. The A bores (along) keep the site's Auto build at the PLA
 * defaults: one wall along each bore's axis. The X bores (across) get three walls
 * each from Draw's own drawnWall (what a hand-drawn wall on the site runs), drawn
 * across the bore at gen.py's cross_y. Prints what each bore got, so a bore the
 * engine skipped or a wall Draw refused shows up here.
 *
 *   deno run -A prototype/calibration/bore/build.js     # -> out/bore-coupon.3mf + .stl
 */
import { loadCoupon, finsWith, supportOf, writeCoupon, finsIn, keep, SITE } from '../coupon.js';
const WEB = new URL('../../../web/', import.meta.url).pathname;
const { drawnWall } = await import(`${WEB}draw.js`);

const c = loadCoupon(import.meta.url);
const built = finsWith(c);
const auto = supportOf(built);
const tris = new Float64Array(c.part.length * 3);
c.part.forEach((v, i) => tris.set(v, i * 3));
const opts = { tines: SITE.tines, tineDensity: SITE.tineDensity, layerHeight: SITE.layerHeight,
               topo: c.topo, rot: c.rot, offset: c.off };
// a cross wall spans this much of the bore's width: its ends stop short of where the
// round ceiling meets the floor, where there is no height left for a wall
const SPAN = 0.8;

const sup = [];
console.log('bore  set  diameter  walls  heights');
for (const r of c.rungs) {
  if (r.set === 'A') {
    const walls = finsIn(c, built, r.box);
    sup.push(...keep(c, auto, r.box));
    console.log(`${r.id}     A    ${String(r.diameter).padEnd(8)}  ${walls.length}      (Auto, along)`);
    continue;
  }
  const half = (r.diameter / 2) * SPAN;
  const top = r.zc + r.diameter / 2;          // the ceiling's crown: the line settles onto the arc
  const at = (x, y) => [x + c.off.x, y + c.off.y, top + c.off.z];
  const hs = [];
  for (const y of r.cross_y) {
    const w = drawnWall(at(r.xc - half, y), at(r.xc + half, y), tris, 0, opts);
    if (!w.ok) throw new Error(`bore ${r.id} (${r.diameter} mm) y ${y}: ${w.reason}`);
    hs.push(`${w.length.toFixed(1)}x${w.height.toFixed(1)}`);
    sup.push(...w.tris);
  }
  console.log(`${r.id}     X    ${String(r.diameter).padEnd(8)}  ${r.cross_y.length}      ${hs.join(' ')} (length x height, mm)`);
}
console.log(`unserved overhangs (Auto, whole block): ${built.unserved}`);
await writeCoupon(c, 'bore', 'Bore coupon', sup);
