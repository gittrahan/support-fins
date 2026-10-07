/**
 * INTERFACE CREST -- the band of a wall that touches the part, printed in a second
 * material (GitHub #21). A toolchanger can lay the last few layers under an overhang
 * in a material that will not bond to the part (PETG under PLA), so the wall holds
 * the part up and still comes away clean.
 *
 * THE MODES (`PROP.iface`). 'flat' (the default when on): a wall station gets a
 * crest only where the part's underside above it is within `ifaceFlatDeg` of level.
 * That is where a PETG interface works -- a flat underside comes out like a top
 * surface -- and it costs a few layers of tool changes, not one every layer. On a
 * tilted underside the crest climbs with the wall top through every layer, and the
 * PETG, laid on a narrow tip, would not print on the PLA (a cube at 35deg, the first
 * print). 'all' crests every station anyway: the user's call per part. false: off.
 *
 * THE SPLIT. A crest station's wall is cut `PROP.ifaceH` below its top: the BODY
 * below, the CREST above, both closed solids, the crest reaching CREST_OVERLAP down
 * into the body (never flush). Under a flat contact the crest keeps the wall's full
 * `th` (two lines): the tip only narrows so fused PLA snaps off, and here it would
 * only take away the contact and the bond. On a slope ('all') it keeps the tip's
 * taper, or its edge would rise into the part. The tines are interface too:
 * emitTines tags its whole comb, as sway.js does its braces'.
 *
 * THE TAG. Crest and tine triangles go into the same `out` as the wall, so every
 * range the engine and the UI keep over it (triRange(s), per-fin removal, Draw's
 * triStart/triEnd) still holds. What marks them is a 4th component on each vertex,
 * `v[3] === 1`: it rides through concatenation, slicing and the Worker's structured
 * clone, and everything that reads a vertex reads only [0..2]. Only crest and tine
 * solids are tagged, and their vertices are their own arrays, never shared with an
 * untagged solid. The export splits on it (splitInterface).
 *
 * Off (the default) nothing here runs and every wall is what it was.
 *
 * Split out of prop.js, which re-exports the public names.
 */
import { ribbon } from '../solids.js';
import { PROP } from './config.js';
import { surfaceHitsAt } from './surface.js';

// how far the crest reaches down into the body, so the two overlap: a slicer
// samples each layer at mid-height, so 0.01 mm of double material never prints
const CREST_OVERLAP = 0.01;

/** Is the crest on (either mode)? */
export const crestOn = () => !!PROP.iface && PROP.ifaceH > 0;

// The seated part the 'flat' test reads the underside from: set at each build's
// entry (buildFins, drawnWall), which hold it in print space. A flat array of
// [x,y,z] x 3 per triangle, the form surfaceHitsAt takes.
let part = null;
export function crestPart(tris) { part = tris; }

/** Is the part's underside at contact point p (x, y, surface z) flat enough? */
function flatAt(p) {
  if (!part) return false;
  let best = null;
  for (const [z, nz] of surfaceHitsAt(part, p[0], p[1])) {
    if (!best || Math.abs(z - p[2]) < Math.abs(best[0] - p[2])) best = [z, nz];
  }
  // the face the wall stands under: down-facing, at the contact
  return !!best && Math.abs(best[0] - p[2]) < 0.5
    && -best[1] >= Math.cos((PROP.ifaceFlatDeg * Math.PI) / 180);
}

/**
 * What each station of a wall gets, from its contact points (x, y, surface z):
 * 'flat', 'slope' (only in the 'all' mode) or null. A lone crest station has no run
 * to sweep a crest along, so it gets none. Null when the crest is off.
 */
export function crestKinds(pts) {
  if (!crestOn()) return null;
  const k = pts.map((p) => (flatAt(p) ? 'flat' : PROP.iface === 'all' ? 'slope' : null));
  return k.map((c, i) => (c && (k[i - 1] || k[i + 1]) ? c : null));
}

/** Tag out[from..] as interface (see the header). */
export function markInterface(out, from = 0) {
  for (let i = from; i < out.length; i++) out[i][3] = 1;
}

/**
 * A wall's crest sections, one per station (null where it has none), as tagged
 * closed solids: one per run of consecutive crest stations.
 */
export function emitCrest(sections, out) {
  const from = out.length;
  for (let i = 0; i < sections.length; ) {
    let j = i;
    while (j < sections.length && sections[j]) j++;
    if (j - i >= 2) ribbon(sections.slice(i, j), out);
    i = j + 1;
  }
  markInterface(out, from);
}

/**
 * Drop out[from..]'s triangles with two corners on one point. A flat crest's body
 * section repeats a corner (its straight side meets the cut at full width), so its
 * ribbon makes zero-area triangles there; dropping them leaves the solid closed (a
 * zero-length edge pairs off the two others), unlike a collinear corner's.
 */
export function dropCollapsed(out, from) {
  const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  let w = from;
  for (let i = from; i + 2 < out.length; i += 3) {
    const a = out[i], b = out[i + 1], c = out[i + 2];
    if (same(a, b) || same(b, c) || same(a, c)) continue;
    out[w++] = a; out[w++] = b; out[w++] = c;
  }
  out.length = w;
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
 * splits into body and crest, for a station of crestKinds' `kind`. `floor` is the
 * highest bottom vertex of the wall's section: a wall shorter than twice the band
 * keeps its lower half as body. Returns null for no crest, else:
 *   cut    the body's new top
 *   zt     the body's taper start
 *   wc     the body's half-width at `cut`
 *   ring   (P) => the crest section, 4 corners from CREST_OVERLAP under `cut` to
 *          `top`, mirrored about the wall's centre.
 * 'flat': no taper at all -- the body runs full width up to `cut` (zt = cut, wc =
 *   th/2: a repeated corner, see dropCollapsed) and the crest is a th-wide block.
 * 'slope': the body keeps its taper up to `cut` (zt is ztip, or just under `cut`
 *   when the band reaches below the taper, so the cut lands ON it) and the crest is
 *   the trapezoid on the same taper line -- no corner repeated or collinear, which
 *   made zero-area triangles in each ribbon end cap.
 */
export function crestCut(top, ztip, floor, kind, th = PROP.th, tip = PROP.tip) {
  if (!kind) return null;
  const cut = Math.max(top - PROP.ifaceH, (floor + top) / 2);
  const cb = cut - CREST_OVERLAP;
  if (kind === 'flat') {
    return { cut, zt: cut, wc: th / 2,
             ring: (P) => [P(+th / 2, cb), P(+th / 2, top), P(-th / 2, top), P(-th / 2, cb)] };
  }
  const zt = Math.min(ztip, cut - Math.min(0.05, (cut - floor) / 2));
  const half = (z) => th / 2 - ((th - tip) / 2) * (Math.max(0, z - zt) / Math.max(1e-6, top - zt));
  const wb = half(cb);
  return {
    cut, zt, wc: half(cut),
    ring: (P) => [P(+wb, cb), P(+tip / 2, top), P(-tip / 2, top), P(-wb, cb)],
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
