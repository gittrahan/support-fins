/**
 * INTERFACE CREST -- the band of a wall that touches the part, printed in a second
 * material (GitHub #21). A toolchanger can lay the last few layers under an overhang
 * in a material that will not bond to the part (PETG under PLA), so the wall holds
 * the part up and still comes away clean. With `PROP.iface` on, every wall is
 * split at `PROP.ifaceH` below its top: the BODY below, the CREST above, both
 * closed solids, the crest overlapping the body by CREST_OVERLAP (never flush). The tines are interface
 * too: emitTines tags its whole comb.
 *
 * THE TAG. Crest and tine triangles go into the same `out` as the wall, so every
 * range the engine and the UI keep over it (triRange(s), per-fin removal, Draw's
 * triStart/triEnd) still holds. What marks them is a 4th component on each vertex,
 * `v[3] === 1`: it rides through concatenation, slicing and the Worker's structured
 * clone, and everything that reads a vertex reads only [0..2]. Only crest and tine
 * solids are tagged, and their vertices are their own arrays, never shared with an
 * untagged solid. The export splits on it (splitInterface) into a third object.
 *
 * Off (the default) nothing here runs and every wall is what it was.
 *
 * Split out of prop.js, which re-exports the public names.
 */
import { ribbon } from '../solids.js';
import { PROP } from './config.js';

// how far the crest reaches down into the body, so the two overlap: a slicer
// samples each layer at mid-height, so 0.01 mm of double material never prints
const CREST_OVERLAP = 0.01;

/** Is the crest on? */
export const crestOn = () => PROP.iface && PROP.ifaceH > 0;

/** Tag out[from..] as interface (see the header). */
export function markInterface(out, from = 0) {
  for (let i = from; i < out.length; i++) out[i][3] = 1;
}

/** A wall's crest sections (crestCut's rings) as one tagged closed solid. */
export function emitCrest(sections, out) {
  if (!sections.length) return;
  const from = out.length;
  ribbon(sections, out);
  markInterface(out, from);
}

/** Split a triangle list into its body and interface triangles. */
export function splitInterface(tris) {
  const body = [], iface = [];
  for (let i = 0; i + 2 < tris.length; i += 3) {
    const dst = tris[i][3] === 1 ? iface : body;
    dst.push(tris[i], tris[i + 1], tris[i + 2]);
  }
  return { body, iface };
}

/**
 * Where a tapered wall top (th wide up to `ztip`, then necking to `tip` at `top`)
 * splits into body and crest. `floor` is the highest bottom vertex of the wall's
 * section: a wall shorter than twice the band keeps its lower half as body.
 * Returns null when the crest is off, else:
 *   cut    the body's new top
 *   zt     the body's taper start (ztip, or just under `cut` when the band reaches
 *          below the taper)
 *   wc     the body's half-width at `cut`
 *   ring   (P, o) => the crest section: 6 vertices from CREST_OVERLAP under `cut`
 *          to `top`, mirrored about the wall's centre (o = across offset). Six
 *          always, so a ribbon of them never changes vertex count: a short wall's
 *          kink at ztip, or a point on the taper line where the band sits inside it.
 */
export function crestCut(top, ztip, floor, th = PROP.th, tip = PROP.tip) {
  if (!crestOn()) return null;
  const cut = Math.max(top - PROP.ifaceH, (floor + top) / 2);
  const half = (z) => (z <= ztip ? th / 2
    : th / 2 - ((th - tip) / 2) * ((z - ztip) / Math.max(1e-6, top - ztip)));
  const zt = Math.min(ztip, cut - Math.min(0.05, (cut - floor) / 2));
  const cb = cut - CREST_OVERLAP;
  const zm = ztip > cb ? ztip : (cb + top) / 2;
  const wb = half(cb), wm = half(zm);
  return {
    cut, zt, wc: half(cut),
    ring: (P) => [P(+wb, cb), P(+wm, zm), P(+tip / 2, top),
                  P(-tip / 2, top), P(-wm, zm), P(-wb, cb)],
  };
}

/**
 * A flat-topped wall's crest (a wedge blade's): `flatCut` is where the body stops
 * (the same rule as crestCut, the bed as floor), `flatCrestRing` the band from
 * CREST_OVERLAP under that cut to `top`, `half` either side.
 */
export const flatCut = (top) => Math.max(top - PROP.ifaceH, top / 2);
export function flatCrestRing(P, top, half) {
  const cb = flatCut(top) - CREST_OVERLAP;
  return [P(+half, cb), P(+half, top), P(-half, top), P(-half, cb)];
}
