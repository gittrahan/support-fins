/**
 * Tine ends that KISS the part's surface: shared by the wall tines (prop/tines.js)
 * and the sway braces' tines (sway.js). Takes the reach and widths as arguments, so
 * neither caller's settings leak into the other (sway.js reads no PROP/FIN).
 */
import { insidePart } from './inside.js';

/**
 * Where a tine meets the part, so it can KISS the surface instead of running on into
 * it: for each side edge of the tine (across = +-`half`) at its bottom and its top
 * (`zb`, `zt`, a hair inside the layer), the distance along the bite heading (dx, dy)
 * at which the part's solid begins, plus TRIM_KISS so the two still overlap (flush
 * faces weld into one non-manifold body in Fusion). The caller builds the tine's end
 * through those four corners, so on a sloped or curved underside the end leans with
 * the surface and no part of the tine sits inside the part.
 *
 * A wall tine used to run its full reach on into the part. A slicer unions that
 * buried stretch away (the site's 3MF and STL put part and supports in one object),
 * so the print is the same; the tine just stops poking through, and is ready for an
 * export that keeps the two apart (local issue 027). Placement is unchanged: the
 * tine still has to reach solid within `reach`.
 *
 * Per corner: no solid within reach on that line and height -> the full `reach`
 * (the old shape); solid already back over the wall end -> TRIM_MIN past it.
 * Distances are from (x, y): a wall tine's seed on the wall top, a sway tine's
 * point on the face (prop/tines.js, sway.js). `back` bounds how far behind that the
 * end may pull back. Returns { bot: [left, right], top: [...] }.
 */
const TRIM_KISS = 0.01, TRIM_MIN = 0.05, TRIM_Z = 0.01;
export function kissEnds(topo, rot, offset, x, y, dx, dy, zb, zt, { half, back, reach: R }) {
  // The end may lean out past `reach` at the bottom: on a 40 deg underside the
  // surface there is ~0.24 mm farther than at the top, and capping it at the reach cut
  // the tine short of the surface at mid-layer, where the slicer reads it.
  const lo0 = -back + TRIM_MIN, far = 2 * R;
  const reach = (s, z) => {
    const px = x - dy * s, py = y + dx * s;      // across = z x along, as emitTines
    const inside = (d) => insidePart(topo, rot, offset, px + dx * d, py + dy * d, z);
    // far probe first; a part thinner than that can put it in air past the part, so
    // fall back to `reach` itself before giving up
    let lo = lo0, hi = inside(far) ? far : inside(R) ? R : null;
    if (hi === null) return R;      // no solid within reach: the old length
    if (inside(lo)) return lo0;                 // the part already reaches back over the wall
    for (let i = 0; i < 14; i++) {              // ~0.0001 mm on a 1.25 span
      const mid = (lo + hi) / 2;
      if (inside(mid)) hi = mid; else lo = mid;
    }
    return hi + TRIM_KISS;
  };
  // measured a hair inside the layer (a part face can sit exactly on a layer line),
  // then carried out to the tine's real bottom and top along the same lean
  const k = TRIM_Z / (zt - zb - 2 * TRIM_Z);
  const side = (s) => {
    const b = reach(s, zb + TRIM_Z), t = reach(s, zt - TRIM_Z);
    const clamp = (e) => Math.min(far, Math.max(lo0, e));
    return [clamp(b + (b - t) * k), clamp(t + (t - b) * k)];
  };
  const [l, r] = [side(-half), side(half)];
  return { bot: [l[0], r[0]], top: [l[1], r[1]] };
}
