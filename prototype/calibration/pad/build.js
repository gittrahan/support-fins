/**
 * Pad coupon, step 2: the site's Auto build once per cube, Bed pad = Custom
 * (Light's thickness, grip and spread) with that cube's Pad gap; its pad kept.
 *
 *   deno run -A prototype/calibration/pad/build.js     # -> out/pad-coupon.3mf + .stl
 */
import { loadCoupon, finsWith, keep, writeCoupon } from '../coupon.js';

const c = loadCoupon(import.meta.url);
const sup = [];
console.log('cube  pad gap  pad style  pad tris  other supports');
for (const r of c.rungs) {
  const built = finsWith(c, { tunables: { padStyle: 'custom', padCustom: { h: 0.2, gap: r.padGap, grip: 0, margin: 4 } } });
  const pad = keep(c, built.padTriangles ?? [], r.box);
  const other = keep(c, built.triangles ?? [], r.box);
  console.log(`${r.id}     ${String(r.padGap).padEnd(7)}  ${built.pad?.style ?? '-'}     ${pad.length / 3}       ${other.length / 3}`);
  sup.push(...pad, ...other);
}
await writeCoupon(c, 'pad', 'Pad coupon', sup);
