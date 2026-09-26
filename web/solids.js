/**
 * Closed-solid emitters shared by the wall builders (web/prop/) and the wall
 * cutouts (cutout.js). Pure mesh math: each takes cross-sections or a polygon
 * and pushes outward-wound triangles, as vertex triples, onto `out`.
 */

/**
 * Bridge a run of cross-sections into one closed solid and push its triangles.
 * Each section is a ring of `k` vertices in the same order; consecutive rings
 * are joined with quads and the two ends are fan-capped. Caps assume the
 * section is convex, which both sections below are (a rectangle, and a
 * rectangle with a tapered top).
 *
 * Wound OUTWARD. Inherited from M3, where this emitted every triangle backwards:
 * the shell was closed and consistent -- euler 2, no boundary edges -- but its
 * volume came out NEGATIVE, so every normal faced into the solid. M3's own check
 * only asked whether the mesh was watertight, which it was, so this survived
 * being called validated. A slicer would read it as a hole rather than a wall.
 */
export function ribbon(secs, out) {
  const k = secs[0].length;
  const tri = (a, b, c) => out.push(a, c, b);
  for (let i = 0; i < secs.length - 1; i++) {
    for (let j = 0; j < k; j++) {
      const j2 = (j + 1) % k;
      tri(secs[i][j], secs[i][j2], secs[i + 1][j2]);
      tri(secs[i][j], secs[i + 1][j2], secs[i + 1][j]);
    }
  }
  for (let j = 1; j < k - 1; j++) {                        // end caps
    tri(secs[0][0], secs[0][j + 1], secs[0][j]);
    const e = secs[secs.length - 1];
    tri(e[0], e[j], e[j + 1]);
  }
}

/**
 * Extrude a CCW polygon (in the a,b plane of the right-handed frame a,b,c) from
 * c = lo to c = hi, emitting outward-wound triangles as vertex triples. The twin
 * of fins.js's `extrude`: the winding
 * only comes out consistently outward when (a,b,c) is right-handed, which every
 * caller below guarantees by construction.
 */
export function boxExtrude(poly, lo, hi, P, out) {
  const n = poly.length;
  const vlo = poly.map(([a, b]) => P(a, b, lo));
  const vhi = poly.map(([a, b]) => P(a, b, hi));
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    out.push(vlo[i], vlo[j], vhi[j]);
    out.push(vlo[i], vhi[j], vhi[i]);
  }
  for (let i = 1; i < n - 1; i++) {
    out.push(vhi[0], vhi[i], vhi[i + 1]);
    out.push(vlo[0], vlo[i + 1], vlo[i]);
  }
}
