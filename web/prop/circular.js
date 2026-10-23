/** Circular overhang measurements in the seated print frame.
 *
 * Recognise only complete, horizontal circular boundary loops with a common
 * centre. An ellipse, open arc, uneven rim or non-circular inner boundary keeps
 * the existing placement path. Work relative to a nearby point in double
 * precision; neither plate coordinates nor triangle order define the frame.
 */
import { PROP } from './config.js';
import { footFor } from './sweep.js';
import { surfaceZAt } from './surface.js';

const TAU = 2 * Math.PI;
const regionCache = new WeakMap();
const key = (p) => p.map((x) => Math.round(x * 1e5)).join(',');
const angle = (a) => ((a % TAU) + TAU) % TAU;

function circle(points) {
  if (points.length < 12) return null;
  const origin = points[0];
  let mx = 0, my = 0, z = 0;
  for (const p of points) { mx += p[0] - origin[0]; my += p[1] - origin[1]; z += p[2]; }
  mx /= points.length; my /= points.length; z /= points.length;
  let xx = 0, xy = 0, yy = 0, xr = 0, yr = 0;
  for (const p of points) {
    const x = p[0] - origin[0] - mx, y = p[1] - origin[1] - my, r2 = x * x + y * y;
    xx += x * x; xy += x * y; yy += y * y; xr += x * r2; yr += y * r2;
  }
  const det = xx * yy - xy * xy;
  if (det <= 1e-12) return null;
  const cx = origin[0] + mx + (yy * xr - xy * yr) / (2 * det);
  const cy = origin[1] + my + (xx * yr - xy * xr) / (2 * det);
  const radii = points.map((p) => Math.hypot(p[0] - cx, p[1] - cy));
  const radius = radii.reduce((a, b) => a + b, 0) / radii.length;
  const tolerance = Math.max(0.002, radius * 1e-4);
  if (radius < 1 || radii.some((r) => Math.abs(r - radius) > tolerance)
      || points.some((p) => Math.abs(p[2] - z) > tolerance)) return null;
  const angles = points.map((p) => angle(Math.atan2(p[1] - cy, p[0] - cx))).sort((a, b) => a - b);
  let maxGap = 0;
  for (let i = 0; i < angles.length; i++) maxGap = Math.max(maxGap, angle(angles[(i + 1) % angles.length] - angles[i]));
  if (maxGap > Math.PI / 6 + 1e-6) return null;
  return { centre: [cx, cy], radius, z, tolerance };
}

// Nearby geometry below the ceiling can break the circle's rotational symmetry
// (a rib or an adjacent wall). Its surface-area centroid fixes the candidate
// phase. Clip at the ceiling so changing a body above the recess does not move
// that landmark. All collision checks still use the complete original model.
function surroundingGeometry(topo, rot, off, frame) {
  const ceiling = Math.max(...frame.radialProfile.map((p) => p[1]));
  const reach = frame.outerRadius + PROP.footMax + PROP.sideClear;
  let area = 0, mx = 0, my = 0;
  for (let f = 0; f < topo.pos.length; f += 9) {
    const points = [];
    for (let j = 0; j < 9; j += 3) {
      const x = topo.pos[f + j], y = topo.pos[f + j + 1], z = topo.pos[f + j + 2];
      points.push([rot[0] * x + rot[3] * y + rot[6] * z + off.x - frame.centre[0],
        rot[1] * x + rot[4] * y + rot[7] * z + off.y - frame.centre[1],
        rot[2] * x + rot[5] * y + rot[8] * z + off.z]);
    }
    const clipped = [];
    for (let i = 0; i < 3; i++) {
      const a = points[i], b = points[(i + 1) % 3];
      if (a[2] <= ceiling) clipped.push(a);
      if ((a[2] < ceiling && b[2] > ceiling) || (b[2] < ceiling && a[2] > ceiling)) {
        const t = (ceiling - a[2]) / (b[2] - a[2]);
        clipped.push(a.map((v, k) => v + t * (b[k] - v)));
      }
    }
    for (let i = 1; i + 1 < clipped.length; i++) {
      const a = clipped[0], b = clipped[i], c = clipped[i + 1];
      const x = (a[0] + b[0] + c[0]) / 3, y = (a[1] + b[1] + c[1]) / 3;
      if (Math.hypot(x, y) > reach) continue;
      const u = b.map((v, k) => v - a[k]), v = c.map((v, k) => v - a[k]);
      const weight = Math.hypot(u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
      area += weight; mx += x * weight; my += y * weight;
    }
  }
  const centroid = area ? [mx / area, my / area] : [0, 0];
  return { ceiling, reach, area, centroid,
    phase: Math.hypot(...centroid) > 0.001 ? Math.atan2(centroid[1], centroid[0]) : null };
}

/** A region's complete circular loops, outer first; null means use the old path. */
export function circularFootprint(tris) {
  const vertices = new Map(), edges = new Map();
  for (let i = 0; i < tris.length; i += 9) {
    const ids = [];
    for (let j = 0; j < 9; j += 3) {
      const p = Array.from(tris.slice(i + j, i + j + 3)), id = key(p);
      vertices.set(id, p); ids.push(id);
    }
    for (let j = 0; j < 3; j++) {
      const a = ids[j], b = ids[(j + 1) % 3];
      if (a === b) return null;
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      const edge = edges.get(k);
      if (edge) edge.n++; else edges.set(k, { a, b, n: 1 });
    }
  }
  const adjacency = new Map();
  for (const { a, b, n } of edges.values()) {
    if (n > 2) return null;
    if (n !== 1) continue;
    for (const [p, q] of [[a, b], [b, a]]) {
      if (!adjacency.has(p)) adjacency.set(p, []);
      adjacency.get(p).push(q);
    }
  }
  if (!adjacency.size || [...adjacency.values()].some((ns) => ns.length !== 2)) return null;
  const remaining = new Set(adjacency.keys()), loops = [];
  while (remaining.size) {
    const start = remaining.values().next().value, ids = [];
    let current = start, previous = null;
    do {
      if (!remaining.delete(current)) return null;
      ids.push(current);
      const next = adjacency.get(current).find((n) => n !== previous);
      previous = current; current = next;
    } while (current !== start);
    const points = ids.map((id) => vertices.get(id));
    const fitted = circle(points);
    if (!fitted) return null;
    loops.push({ ...fitted, points });
  }
  if (loops.length > 2) return null;
  loops.sort((a, b) => b.radius - a.radius);
  const outer = loops[0], [cx, cy] = outer.centre;
  if (loops.some((l) => Math.hypot(l.centre[0] - cx, l.centre[1] - cy) > outer.tolerance)) return null;
  const innerRadius = loops[1]?.radius ?? 0;
  // For now a flat disk/annulus or straight radial slope. Other surfaces retain
  // their own path, even when their outline happens to be circular.
  const innerZ = loops[1]?.z ?? outer.z;
  const slope = (outer.z - innerZ) / (outer.radius - innerRadius);
  if (outer.radius - innerRadius < 0.1) return null;
  for (const p of vertices.values()) {
    const r = Math.hypot(p[0] - cx, p[1] - cy);
    if (r < innerRadius - outer.tolerance || r > outer.radius + outer.tolerance
        || Math.abs(p[2] - innerZ - slope * (r - innerRadius)) > 2 * outer.tolerance) return null;
  }
  // The longest rim chord is a geometric landmark on an uneven tessellation.
  // On a regular circle equivalent chords tie: choosing one changes only phase.
  const landmarks = outer.points.map((p, i) => {
    const q = outer.points[(i + 1) % outer.points.length];
    return { length: Math.hypot(p[0] - q[0], p[1] - q[1]),
      heading: angle(Math.atan2((p[1] + q[1]) / 2 - cy, (p[0] + q[0]) / 2 - cx)) };
  });
  const longest = landmarks.reduce((n, p) => Math.max(n, p.length), 0);
  const phase = landmarks.reduce((a, p) => longest - p.length < outer.tolerance ? Math.min(a, p.heading) : a, Infinity);
  return { centre: [cx, cy], innerRadius, outerRadius: outer.radius,
    radialProfile: [[innerRadius, innerZ], [outer.radius, outer.z]],
    angularExtent: [0, TAU], phase, axis: [Math.cos(phase), Math.sin(phase)] };
}

/** Collect once for the normal/raster/downhill races. */
export function circularRegions(topo, result, rot) {
  const cached = regionCache.get(result);
  if (cached?.topo === topo && cached.rot.every((v, i) => v === rot[i])
      && cached.footMax === PROP.footMax && cached.sideClear === PROP.sideClear) return cached.frames;
  const frames = new Map(), { pos } = topo, off = result.offset;
  result.regions.forEach((r, ri) => {
    if (r.faces.length < 12) return;
    const tris = new Float64Array(r.faces.length * 9);
    let at = 0;
    for (const f of r.faces) for (let i = 0; i < 9; i += 3) {
      const o = f * 9 + i, x = pos[o], y = pos[o + 1], z = pos[o + 2];
      tris[at++] = rot[0] * x + rot[3] * y + rot[6] * z + off.x;
      tris[at++] = rot[1] * x + rot[4] * y + rot[7] * z + off.y;
      tris[at++] = rot[2] * x + rot[5] * y + rot[8] * z + off.z;
    }
    const frame = circularFootprint(tris);
    if (frame) {
      frame.surrounding = surroundingGeometry(topo, rot, off, frame);
      if (frame.surrounding.phase !== null) {
        frame.phase = angle(frame.surrounding.phase);
        frame.axis = [Math.cos(frame.phase), Math.sin(frame.phase)];
      }
      frames.set(ri, frame);
    }
  });
  regionCache.set(result, { topo, rot: [...rot], frames, footMax: PROP.footMax, sideClear: PROP.sideClear });
  return frames;
}

/** Radial candidates for an annular slope. Counts come from the requested
 * circumferential pitch and the space available at the inner ends' feet.
 * The usual builder still settles, trims and validates each candidate against
 * the whole part. Accepted walls are never redistributed here.
 */
export function circularTracks(frame, tris, step, span) {
  const { innerRadius: ri, outerRadius: ro, radialProfile, centre, phase } = frame;
  if (ri < 1 || Math.abs(radialProfile[0][1] - radialProfile[1][1]) < 0.01) return null;
  const height = Math.max(...radialProfile.map((p) => p[1])) - PROP.gap;
  const clearance = 2 * footFor(height) + PROP.sideClear;
  const maxCount = clearance > 2 * ri ? 1 : Math.floor(Math.PI / Math.asin(clearance / (2 * ri)));
  const radius = Math.sqrt((ri * ri + ro * ro) / 2);
  // Sparse placement must not lose useful supports solely to make counts agree.
  // Keep the outer edge within the existing unsupported-span cap, then let the
  // coverage setting request more. Physical foot clearance still caps the count.
  const requested = Math.max(TAU * ro / PROP.maxUnsupportedSpan, TAU * radius / span);
  const count = Math.max(1, Math.min(maxCount, Math.ceil(requested - 1e-6)));
  const from = ri + PROP.edgeInset, to = ro - PROP.edgeInset;
  if (to - from < PROP.minSpan) return null;
  // Half steps keep a sloping wall's body from losing a full station at the
  // minHeight boundary. The existing settling and minimum-span gates still apply.
  const stations = Math.max(PROP.minStations - 1, Math.ceil((to - from) / (step / 2) - 1e-6));
  const lines = [];
  for (let i = 0; i < count; i++) {
    const a = phase + TAU * i / count, ux = Math.cos(a), uy = Math.sin(a), line = [];
    for (let j = 0; j <= stations; j++) {
      const r = from + (to - from) * j / stations;
      const x = centre[0] + r * ux, y = centre[1] + r * uy;
      const z = surfaceZAt(tris, x, y);
      if (z === null) { if (line.length >= PROP.minStations) lines.push(line.slice()); line.length = 0; }
      else line.push([x, y, z]);
    }
    if (line.length >= PROP.minStations) lines.push(line);
  }
  return lines;
}
