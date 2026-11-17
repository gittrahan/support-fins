/** Exact surface material regions for contact matching. Boolean face IDs are
 * hints: generated faces must also lie within their claimed source triangle.
 * New cut faces and unprovable ownership remain explicitly unassigned.
 */
import { worldMaterialRegions } from './threemf/materials.js';

const sub = (a, b) => a.map((v, k) => v - b[k]);
const dot = (a, b) => a.reduce((s, v, k) => s + v * b[k], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const area = (p) =>
  p.reduce((s, a, i) => {
    const b = p[(i + 1) % p.length];
    return s + a[0] * b[1] - a[1] * b[0];
  }, 0) / 2;
const ccw = (p) => area(p) < 0 ? p.toReversed() : p;
function intersect(p, boundary) {
  for (let i = 0; i < boundary.length && p.length; i++) {
    const a = boundary[i],
      b = boundary[(i + 1) % boundary.length],
      side = (q) => (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]),
      out = [];
    for (let j = 0; j < p.length; j++) {
      const u = p[j], v = p[(j + 1) % p.length], du = side(u), dv = side(v);
      if (du >= 0) out.push(u);
      if ((du < 0) !== (dv < 0)) {
        const t = du / (du - dv);
        out.push(u.map((x, k) => x + t * (v[k] - x)));
      }
    }
    p = out;
  }
  return p.length >= 3 && area(p) > 0 ? p : [];
}
const soupFace = (p, f) => [0, 1, 2].map((k) => Array.from(p.subarray(f * 9 + k * 3, f * 9 + k * 3 + 3)));

export function sourceContactRegions(model, surface = null) {
  if (!model.components || !model.materials) throw new Error('source material metadata is missing');
  const source = [];
  model.components.forEach((c, i) => {
    if (c.kind !== 'model') return;
    const occurrence = model.materials.occurrences[i];
    for (let f = 0; f < c.sourceFaces.length; f++) {
      const face = occurrence?.faces[f];
      const regions = face
        ? worldMaterialRegions(c, f, face).map((r) => ({
          triangle: r.triangle,
          material: face.unresolved ? null : r.material,
          ...(r.inherited && !face.unresolved && !face.core
            ? {
              roleMaterials: {
                tine: face.roles.wall,
                interface: face.roles.bottomSurface ?? face.roles.solidInfill,
              },
            }
            : {}),
        }))
        : [];
      source[c.firstTriangle + f] = { triangle: soupFace(c.positions, f), regions };
    }
  });
  if (!surface) return source.flatMap((s) => s?.regions ?? []);
  const { positions, sourceFaces } = surface;
  if (!positions || positions.length % 9 || sourceFaces?.length !== positions.length / 9) {
    throw new Error('invalid source-face provenance');
  }
  const result = [];
  for (let f = 0; f < sourceFaces.length; f++) {
    const triangle = soupFace(positions, f),
      s = source[sourceFaces[f]],
      unknown = () => result.push({ triangle, material: null });
    if (!s) {
      unknown();
      continue;
    }
    const n = cross(sub(triangle[1], triangle[0]), sub(triangle[2], triangle[0])), length = Math.hypot(...n);
    if (!length) {
      unknown();
      continue;
    }
    const axis = [0, 1, 2].sort((a, b) => Math.abs(n[b]) - Math.abs(n[a]))[0],
      axes = [(axis + 1) % 3, (axis + 2) % 3];
    const project = (p) => axes.map((a) => p[a]);
    const world = (p) => {
      const v = [...triangle[0]];
      axes.forEach((a, k) => v[a] = p[k]);
      v[axis] -= (n[axes[0]] * (p[0] - triangle[0][axes[0]]) + n[axes[1]] * (p[1] - triangle[0][axes[1]])) /
        n[axis];
      return v;
    };
    // Bound float32 Boolean coordinate roundoff, not paint-region size.
    const tolerance = Math.min(.01, Math.max(1, ...s.triangle.flat().map(Math.abs)) * 2e-7);
    const planeOK = s.triangle.every((p) => Math.abs(dot(sub(p, triangle[0]), n)) / length <= tolerance);
    const target = ccw(triangle.map(project)), original = ccw(s.triangle.map(project));
    const coverage = intersect(target, original),
      roundoff = tolerance * Math.max(1, ...target.map((p, i) => Math.hypot(...sub(p, target[(i + 1) % 3]))));
    if (!planeOK || Math.abs(area(target) - area(coverage)) > roundoff) {
      unknown();
      continue;
    }
    let covered = 0;
    const faceRegions = [];
    for (const r of s.regions) {
      const p = intersect(target, ccw(r.triangle.map(project)));
      covered += area(p);
      for (let j = 1; j + 1 < p.length; j++) {
        faceRegions.push({ ...r, triangle: [p[0], p[j], p[j + 1]].map(world) });
      }
    }
    // Any arithmetic-width remainder is unassigned, rather than borrowing a
    // nearby colour. Contacts missing that region receive the explicit fallback.
    if (!s.regions.length || Math.abs(covered - area(target)) > roundoff) {
      // Invalid overlapping paint regions invalidate the entire source face.
      unknown();
    } else result.push(...faceRegions);
  }
  return result;
}
