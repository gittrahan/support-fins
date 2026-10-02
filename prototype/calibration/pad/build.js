/**
 * Pad coupon, step 2: the site's Auto build on each cube alone, Bed pad = Custom
 * (Light's thickness 0.2, grip 0, spread 4) with that cube's Pad gap; cube and pad
 * then moved to the cube's place in the row.
 *
 *   deno run -A prototype/calibration/pad/build.js     # -> out/pad-coupon.3mf + .stl
 */
import { loadCoupon, finsWith, supportOf, writeCoupon } from '../coupon.js';

const rungs = JSON.parse(Deno.readTextFileSync(new URL('./out/rungs.json', import.meta.url)));
const part = [], sup = [];
const shift = (verts, dx) => verts.map((v) => [v[0] + dx, v[1], v[2]]);
console.log('cube  pad gap  pad style  pad tris  other supports');
for (const r of rungs) {
  const c = loadCoupon(import.meta.url, r.file);
  const built = finsWith(c, { tunables: { padStyle: 'custom', padCustom: { h: 0.2, gap: r.padGap, grip: 0, margin: 4 } } });
  console.log(`${r.id}     ${String(r.padGap).padEnd(7)}  ${built.pad?.style ?? '-'}     ${(built.padTriangles ?? []).length / 3}       ${(built.triangles ?? []).length / 3}`);
  part.push(...shift(c.part, r.x));
  sup.push(...shift(supportOf(built), r.x));
}
await writeCoupon({ out: new URL('./out/', import.meta.url).pathname, part }, 'pad', 'Pad coupon', sup);
