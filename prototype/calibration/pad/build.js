/**
 * Pad coupon, step 2: one pad per foot. The engine lays ONE pad under all of a
 * part's bed contact, so each foot's pad comes from the site's Auto build on that
 * foot's post alone (out/foot_<k>.stl, cut above the pad), Bed pad = Custom (Light's
 * thickness 0.2, grip 0, spread 4) with that foot's Pad gap, moved back under the
 * whole bar. The whole bar is built too, to check the pads are its only support.
 *
 *   deno run -A prototype/calibration/pad/build.js     # -> out/pad-coupon.3mf + .stl
 */
import { loadCoupon, finsWith, writeCoupon } from '../coupon.js';

const custom = (gap) => ({ tunables: { padStyle: 'custom', padCustom: { h: 0.2, gap, grip: 0, margin: 4 } } });
const bar = loadCoupon(import.meta.url);
const whole = finsWith(bar, custom(0.12));
if ((whole.triangles ?? []).length) throw new Error(`the bar gets ${whole.triangles.length / 3} support triangles besides its pad`);

const sup = [], spans = [];
console.log('foot  pad gap  pad style  pad tris  pad x (mm)');
for (const r of bar.rungs) {
  const post = loadCoupon(import.meta.url, r.file);
  const built = finsWith(post, custom(r.padGap));
  const pad = built.padTriangles ?? [];
  if (!pad.length || (built.triangles ?? []).length) throw new Error(`foot ${r.id}: expected a pad and nothing else`);
  // the post's seated frame -> the bar's
  const d = ['x', 'y', 'z'].map((a) => bar.off[a] - post.off[a]);
  let lo = Infinity, hi = -Infinity;
  for (const v of pad) {
    const w = [v[0] + d[0], v[1] + d[1], v[2] + d[2]];
    sup.push(w);
    lo = Math.min(lo, w[0] - bar.off.x); hi = Math.max(hi, w[0] - bar.off.x);
  }
  spans.push([lo, hi]);
  console.log(`${r.id}     ${String(r.padGap).padEnd(7)}  ${built.pad?.style ?? '-'}     ${pad.length / 3}      ${lo.toFixed(1)} .. ${hi.toFixed(1)}`);
}
for (let k = 1; k < spans.length; k++) {
  const clear = spans[k][0] - spans[k - 1][1];
  if (clear < 2) throw new Error(`pads ${k} and ${k + 1} are only ${clear.toFixed(2)} mm apart`);
}
await writeCoupon(bar, 'pad', 'Pad coupon', sup);
