/**
 * Interface coupon, step 2: the site's Auto build once per ledge with Interface
 * material on Flat contacts at that ledge's crest width and gap (the rest at the
 * site's PLA defaults), walls under that ledge kept. The crest goes in the 3MF as a
 * part of the supports object, `<title> interface`: give it the second filament.
 *
 *   deno run -A prototype/calibration/interface/build.js   # -> out/interface-coupon.3mf + .stl
 */
import { loadCoupon, finsWith, finsIn, keep, supportOf, writeCoupon } from '../coupon.js';

const c = loadCoupon(import.meta.url);
const sup = [];
console.log('ledge  width  gap   walls  crest tris');
for (const r of c.rungs) {
  const built = finsWith(c, { tunables: { iface: 'flat', ifaceW: r.width, ifaceGap: r.gap } });
  const mine = keep(c, supportOf(built), r.box);
  const crest = mine.filter((v) => v[3] === 1).length / 3;
  console.log(`${r.id}      ${r.width.toFixed(1)}    ${r.gap.toFixed(1)}   ${finsIn(c, built, r.box).length}      ${crest}`);
  if (!crest) throw new Error(`ledge ${r.id}: no interface crest -- the ledge is not a flat contact?`);
  sup.push(...mine);
}
await writeCoupon(c, 'interface', 'Interface coupon', sup);
