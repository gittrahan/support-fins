/**
 * Closed-solid emitters shared by the wall builders (web/prop/) and the wall
 * cutouts (cutout.js). Pure mesh math: each takes cross-sections or a polygon
 * and pushes outward-wound triangles, as vertex triples, onto `out`.
 */

/** Inscribed corner arcs of a convex CCW polygon; radii may be per corner. */
export function roundedPolygon(poly, radius, steps = 8) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], a = poly[(i + poly.length - 1) % poly.length], b = poly[(i + 1) % poly.length];
    const da = Math.hypot(a[0] - p[0], a[1] - p[1]), db = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const r = Array.isArray(radius) ? radius[i] : radius;
    if (!(r > 0) || da < 1e-7 || db < 1e-7) { out.push([...p]); continue; }
    const u = [(a[0] - p[0]) / da, (a[1] - p[1]) / da], v = [(b[0] - p[0]) / db, (b[1] - p[1]) / db];
    const theta = Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1])));
    if (theta < 1e-6 || Math.PI - theta < 1e-6) { out.push([...p]); continue; }
    const d = Math.min(r / Math.tan(theta / 2), da * 0.49, db * 0.49);
    const rr = d * Math.tan(theta / 2), bis = Math.hypot(u[0] + v[0], u[1] + v[1]);
    const c = [p[0] + (u[0] + v[0]) / bis * rr / Math.sin(theta / 2),
      p[1] + (u[1] + v[1]) / bis * rr / Math.sin(theta / 2)];
    const start = Math.atan2(p[1] + u[1] * d - c[1], p[0] + u[0] * d - c[0]);
    const turn = Math.PI - theta;
    for (let j = 0; j <= steps; j++) {
      const ang = start + turn * j / steps;
      const q = [c[0] + rr * Math.cos(ang), c[1] + rr * Math.sin(ang)];
      if (!out.length || Math.hypot(q[0] - out.at(-1)[0], q[1] - out.at(-1)[1]) > 1e-8) out.push(q);
    }
  }
  return out;
}

/** Round only the ends of a swept flange, keeping the intervening contour. */
export function roundedFlange(sections, out) {
  const secs = [];
  for (const sec of sections) {
    secs.push(sec);
    while (secs.length > 2) {
      const [a, b, c] = secs.slice(-3);
      const d = c[0].map((v, k) => v - a[0][k]), len2 = d.reduce((s, v) => s + v * v, 0);
      const t = len2 ? d.reduce((s, v, k) => s + v * (b[0][k] - a[0][k]), 0) / len2 : -1;
      if (t <= 0 || t >= 1 || !b.every((p, j) => p.every((v, k) => Math.abs(v - (a[j][k] + t * (c[j][k] - a[j][k]))) < 1e-6))) break;
      secs.splice(secs.length - 2, 1);
    }
  }
  for (let i = 0; i < secs.length - 1; i++) {
    const inset = (sec, other) => {
      const len = Math.hypot(other[0][0] - sec[0][0], other[0][1] - sec[0][1]);
      const t = Math.min(0.005 / Math.max(len, 1e-8), 0.005);
      return sec.map((p, j) => p.map((v, k) => k === 2 ? v : v + (other[j][k] - v) * t));
    };
    // Pull internal caps apart; the longer joint below overlaps each side.
    // Thus hosts never receive two segment solids with coincident end faces.
    const a = i === 0 ? secs[i] : inset(secs[i], secs[i + 1]);
    const b = i === secs.length - 2 ? secs[i + 1] : inset(secs[i + 1], secs[i]);
    const w = Math.min(Math.hypot(a[0][0] - a[3][0], a[0][1] - a[3][1]),
      Math.hypot(b[0][0] - b[3][0], b[0][1] - b[3][1])) / 2;
    const poly = [a[0], b[0], b[3], a[3]].map((p) => p.slice(0, 2));
    const radii = [i === 0 ? w : 0, i === secs.length - 2 ? w : 0,
      i === secs.length - 2 ? w : 0, i === 0 ? w : 0];
    boxExtrude(roundedPolygon(poly, radii), a[0][2], Math.min(a[1][2], b[1][2]),
      (x, y, z) => [x, y, z], out);
  }
  // Short overlapping joint solids connect face-to-face segments without
  // expanding the checked contour. Follow the original sections on both sides
  // of each joint, staying below the lower of the adjoining flange roofs.
  for (let i = 1; i < secs.length - 1; i++) {
    const a = secs[i - 1], b = secs[i], c = secs[i + 1];
    const roof = Math.min(a[1][2], b[1][2], c[1][2]);
    const near = (other) => {
      const len = Math.hypot(other[0][0] - b[0][0], other[0][1] - b[0][1]);
      const t = Math.min(0.01 / Math.max(len, 1e-8), 0.01);
      return b.map((p, j) => p.map((v, k) => k === 2
        ? (j === 1 || j === 2 ? roof : b[0][2])
        : v + (other[j][k] - v) * t));
    };
    const joint = b.map((p, j) => [p[0], p[1], j === 1 || j === 2 ? roof : b[0][2]]);
    ribbon([near(a), joint, near(c)], out);
  }
}

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
 * of the old fins.js `extrude` (since removed): the winding
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

/** boxExtrude with a different (same-size) outline at the top: a tine whose end leans
 *  with the part's surface. Same vertex order and faces as boxExtrude, so a tine is
 *  still one 36-vertex block (tests/_util.js tineBoxes). */
export function loftExtrude(polyLo, polyHi, lo, hi, P, out) {
  const n = polyLo.length;
  const vlo = polyLo.map(([a, b]) => P(a, b, lo));
  const vhi = polyHi.map(([a, b]) => P(a, b, hi));
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
