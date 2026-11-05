/**
 * Depth check for the Full coverage sweep: how many walls have a vertex more than
 * `depth` mm inside the part (a wall inside the part can fuse to it). This reads
 * the part's raw triangles and the built mesh and nothing else, on purpose: it
 * shares no code with web/prop/bodycut.js, so a bug there can't hide here.
 *
 * Inside = odd ray parity along +X, confirmed by at least one of two skew rays
 * (one ray can graze an edge). Vertices only, and a +X ray that grazes an edge reads
 * as outside: both only under-report, so this is a cross-check on the engine, not a proof.
 */
const SKEW = [[0.3, 0.5, 0.8], [-0.6, 0.2, 0.77]];
const GRID = 96;

function oddHits(pos, p, d, faces) {               // Moller-Trumbore, faces = indices
  let c = 0;
  for (const f of faces) {
    const o = f * 9, ax = pos[o], ay = pos[o + 1], az = pos[o + 2];
    const e1 = [pos[o + 3] - ax, pos[o + 4] - ay, pos[o + 5] - az];
    const e2 = [pos[o + 6] - ax, pos[o + 7] - ay, pos[o + 8] - az];
    const h = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
    const a = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2];
    if (Math.abs(a) < 1e-12) continue;
    const s = [p[0] - ax, p[1] - ay, p[2] - az];
    const u = (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]) / a;
    if (u < 0 || u > 1) continue;
    const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
    const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) / a;
    if (v < 0 || u + v > 1) continue;
    if ((e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / a > 1e-9) c++;
  }
  return c % 2 === 1;
}

function distToTri(p, a, b, c) {                    // closest point, Ericson's regions
  const sub = (x, y) => [x[0] - y[0], x[1] - y[1], x[2] - y[2]];
  const dot = (x, y) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
  const to = (q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  const along = (o, e, t) => [o[0] + e[0] * t, o[1] + e[1] * t, o[2] + e[2] * t];
  const ab = sub(b, a), ac = sub(c, a), bc = sub(c, b);
  const ap = sub(p, a), d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return to(a);
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return to(b);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return to(along(a, ab, d1 / (d1 - d3)));
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return to(c);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return to(along(a, ac, d2 / (d2 - d6)));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return to(along(b, bc, (d4 - d3) / (d4 - d3 + d5 - d6)));
  const den = 1 / (va + vb + vc);
  return to(along(along(a, ab, vb * den), ac, vc * den));
}

function distToPart(pos, p) {
  let best = Infinity;
  for (let o = 0; o < pos.length; o += 9) {
    let near = true;
    for (let k = 0; k < 3 && near; k++) {
      const v0 = pos[o + k], v1 = pos[o + 3 + k], v2 = pos[o + 6 + k];
      near = p[k] >= Math.min(v0, v1, v2) - best && p[k] <= Math.max(v0, v1, v2) + best;
    }
    if (!near) continue;
    const d = distToTri(p, [pos[o], pos[o + 1], pos[o + 2]], [pos[o + 3], pos[o + 4], pos[o + 5]], [pos[o + 6], pos[o + 7], pos[o + 8]]);
    if (d < best) best = d;
  }
  return best;
}

/** pos: the part's raw triangles (flat floats, part frame). rot, offset: as
 *  analyze gives them, world = rot * part + offset. fins, tris: as buildFins gives
 *  them (each fin's triRanges index tris). Returns { walls, max }: the walls with a
 *  vertex past `depth`, and the deepest such vertex in mm (0 if none). */
export function deepWalls(pos, rot, offset, fins, tris, depth = 0.2) {
  const n = pos.length / 9;
  let y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    y0 = Math.min(y0, pos[i + 1]); y1 = Math.max(y1, pos[i + 1]);
    z0 = Math.min(z0, pos[i + 2]); z1 = Math.max(z1, pos[i + 2]);
  }
  const sy = GRID / (y1 - y0 + 1e-6), sz = GRID / (z1 - z0 + 1e-6);
  const cells = Array.from({ length: GRID * GRID }, () => []);
  for (let f = 0; f < n; f++) {
    const o = f * 9;
    const ys = [pos[o + 1], pos[o + 4], pos[o + 7]], zs = [pos[o + 2], pos[o + 5], pos[o + 8]];
    const a0 = Math.max(0, Math.floor((Math.min(...ys) - y0) * sy)), a1 = Math.min(GRID - 1, Math.floor((Math.max(...ys) - y0) * sy));
    const b0 = Math.max(0, Math.floor((Math.min(...zs) - z0) * sz)), b1 = Math.min(GRID - 1, Math.floor((Math.max(...zs) - z0) * sz));
    for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) cells[a * GRID + b].push(f);
  }
  const all = Array.from({ length: n }, (_, f) => f);
  let walls = 0, max = 0;
  for (const fin of fins) {
    const seen = new Set();
    let deepest = 0;
    for (const [lo, hi] of fin.triRanges ?? []) {
      for (let i = lo; i < hi && i < tris.length; i++) {
        const v = tris[i];
        const key = `${v[0].toFixed(3)},${v[1].toFixed(3)},${v[2].toFixed(3)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const x = v[0] - offset.x, y = v[1] - offset.y, z = v[2] - offset.z;
        const p = [rot[0] * x + rot[1] * y + rot[2] * z, rot[3] * x + rot[4] * y + rot[5] * z, rot[6] * x + rot[7] * y + rot[8] * z];
        if (p[1] < y0 || p[1] > y1 || p[2] < z0 || p[2] > z1) continue;
        const cell = cells[Math.floor((p[1] - y0) * sy) * GRID + Math.floor((p[2] - z0) * sz)];
        if (!oddHits(pos, p, [1, 0, 0], cell)) continue;
        if (!SKEW.some((d) => oddHits(pos, p, d, all))) continue;
        const d = distToPart(pos, p);
        if (d > depth && d > deepest) deepest = d;
      }
    }
    if (deepest) { walls++; max = Math.max(max, deepest); }
  }
  return { walls, max: Math.round(max * 100) / 100 };
}
