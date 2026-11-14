// Optional, conservative post-processing for separate project support objects.
// A turn replaces an upper straight wall; it never repairs source geometry or
// adds foundations. Unsupported candidates retain their original triangles.
import { buildTurn, triangles as solidTriangles, turningRuntime } from './project-turning-geometry.js';
import { buildTopology } from '../../web/overhangs.js';
import { solidClearance } from '../../web/inside.js';

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const angle180 = (v) => (v % 180 + 180) % 180;
const delta = (to, from) => (to - from + 270) % 180 - 90;
const EPS = 1e-4; // float32 engine coordinates, not an input-repair allowance
const round = (v) => Math.round(v * 1e6) / 1e6;
const clearanceDistance = (...args) => solidClearance(...args)?.d ?? Infinity;
export function turningBounds(positions) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) { min[i % 3] = Math.min(min[i % 3], positions[i]); max[i % 3] = Math.max(max[i % 3], positions[i]); }
  return { min, max };
}
export function turningBoundsOverlap(a, b, gap) {
  return a.min.every((v, i) => v <= b.max[i] + gap && a.max[i] + gap >= b.min[i]);
}
const area = (ring) => Math.abs(ring.reduce((a, p, i) => {
  const q = ring[(i + 1) % ring.length]; return a + p[0] * q[1] - p[1] * q[0];
}, 0)) / 2;

/** An exact rectangular footprint, allowing collinear mesh-seam vertices. */
export function rectangle(ring) {
  if (ring.length < 4 || ring.some((p) => p.length !== 2 || p.some((v) => !Number.isFinite(v)))) return null;
  let best;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length], dx = q[0] - p[0], dy = q[1] - p[1];
    if (Math.hypot(dx, dy) < EPS) continue;
    const a = Math.atan2(dy, dx), u = [Math.cos(a), Math.sin(a)], v = [-u[1], u[0]];
    const x = ring.map((p) => p[0] * u[0] + p[1] * u[1]), y = ring.map((p) => p[0] * v[0] + p[1] * v[1]);
    const lo = [Math.min(...x), Math.min(...y)], hi = [Math.max(...x), Math.max(...y)];
    const size = [hi[0] - lo[0], hi[1] - lo[1]], boxArea = size[0] * size[1];
    if (!best || boxArea < best.boxArea) best = { a, u, v, lo, hi, size, boxArea };
  }
  if (!best || best.size.some((n) => n < EPS) || Math.abs(best.boxArea - area(ring)) > EPS * Math.max(...best.size)) return null;
  const { u, v, lo, hi, size } = best;
  return { center: [u[0] * (lo[0] + hi[0]) / 2 + v[0] * (lo[1] + hi[1]) / 2,
    u[1] * (lo[0] + hi[0]) / 2 + v[1] * (lo[1] + hi[1]) / 2],
    angle: angle180(best.a * 180 / Math.PI + (size[1] > size[0] ? 90 : 0)),
    length: Math.max(...size), width: Math.min(...size) };
}

export function topDirection(roof, originalAngle, override = null) {
  if (override !== null) return angle180(override);
  // Near-square roofs have no reliable preferred direction: avoid arbitrary
  // turns caused by triangulation or a tiny change in dimensions.
  if (roof.length < roof.width * 1.1) return angle180(originalAngle);
  return angle180(roof.angle + 90);
}

function mesh(w, flat) {
  if (!flat.length || flat.length % 9 || !flat.every(Number.isFinite)) throw Error('invalid triangle soup');
  const points = [], ids = new Map(), indices = [];
  for (let i = 0; i < flat.length; i += 3) {
    const p = Array.from(flat.slice(i, i + 3)), key = p.join(',');
    if (!ids.has(key)) { ids.set(key, points.length / 3); points.push(...p); }
    indices.push(ids.get(key));
  }
  let solid;
  try { solid = new w.Manifold(new w.Mesh({ numProp: 3,
    vertProperties: Float32Array.from(points), triVerts: Uint32Array.from(indices) })); }
  catch (cause) { throw new Error('mesh is not a closed solid', { cause }); }
  if (solid.status() !== 'NoError' || solid.isEmpty()) { solid.delete(); throw Error('mesh is not a closed solid'); }
  return solid;
}
const topoOf = (positions) => buildTopology({ getAttribute: (key) => key === 'position' ? { array: positions } : null });
function oneRectangle(solid, z) {
  const section = solid.slice(z);
  try { const rings = section.toPolygons(); return rings.length === 1 ? rectangle(rings[0]) : null; }
  finally { section.delete(); }
}
function roofAt(w, positions, indices, top, gap) {
  const rings = [];
  for (const f of indices) {
    const p = Array.from({ length: 3 }, (_, i) => Array.from(positions.slice(f * 9 + i * 3, f * 9 + i * 3 + 3)));
    if (p.some((v) => Math.abs(v[2] - top - gap) > EPS)) continue;
    const nz = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[1][1] - p[0][1]) * (p[2][0] - p[0][0]);
    if (nz >= 0) continue;
    rings.push(p.map((v) => v.slice(0, 2)).reverse());
  }
  if (!rings.length) return null;
  const section = new w.CrossSection(rings, 'Positive');
  const paths = section.toPolygons(), shape = paths.length === 1 ? rectangle(paths[0]) : null;
  if (!shape) { section.delete(); return null; }
  return { section, shape };
}
function insideRectangle(p, rect, margin = 0) {
  const a = rect.angle * Math.PI / 180, x = p[0] - rect.center[0], y = p[1] - rect.center[1];
  return Math.abs(x * Math.cos(a) + y * Math.sin(a)) <= rect.length / 2 - margin + EPS &&
    Math.abs(-x * Math.sin(a) + y * Math.cos(a)) <= rect.width / 2 - margin + EPS;
}

function roofReach(roof, strip) {
  const r = roof.angle * Math.PI / 180, a = strip.angle * Math.PI / 180;
  return Math.max(...[-1, 1].flatMap((sx) => [-1, 1].map((sy) => {
    const x = roof.center[0] + sx * roof.length / 2 * Math.cos(r) - sy * roof.width / 2 * Math.sin(r) - strip.center[0];
    const y = roof.center[1] + sx * roof.length / 2 * Math.sin(r) + sy * roof.width / 2 * Math.cos(r) - strip.center[1];
    return Math.hypot(Math.max(0, Math.abs(x * Math.cos(a) + y * Math.sin(a)) - strip.length / 2),
      Math.max(0, Math.abs(-x * Math.sin(a) + y * Math.cos(a)) - strip.width / 2));
  })));
}

/** Inspect one neighbor at a time. Disjoint bounds need no solid allocation;
 * overlapping bounds require closed geometry rather than an optimistic fallback. */
export async function validateTurningNeighbor(positions, neighbor, gap) {
  if (!neighbor.length) return;
  if (!turningBoundsOverlap(turningBounds(positions), turningBounds(neighbor), gap)) return;
  const w = await turningRuntime();
  let candidate, obstacle, hit;
  try {
    candidate = mesh(w, positions); obstacle = mesh(w, neighbor);
    hit = candidate.intersect(obstacle);
    if (!hit.isEmpty()) throw Error('turn intersects another plate object');
    const verts = Array.from({ length: positions.length / 3 }, (_, i) => Array.from(positions.slice(i * 3, i * 3 + 3)));
    if (clearanceDistance(topoOf(neighbor), IDENTITY, { x: 0, y: 0, z: 0 }, verts, gap, true) + EPS < gap) {
      throw Error('turn is too close to another plate object');
    }
  } finally { hit?.delete(); obstacle?.delete(); candidate?.delete(); }
}

/** `validate` checks new world-space geometry against other plate objects. It
 * must reject when those objects cannot be inspected; no optimistic fallback. */
export async function turnProjectFins(generated, { positions, dimensions, angle = null, gap, validate }) {
  if (typeof validate !== 'function') throw Error('turning fins require a plate-object clearance validator');
  const stats = { ...generated.stats, turnedFins: 0, turningSkipped: 0, turningReasons: [], turningDetails: [] };
  if (!generated.triangles.length) return { ...generated, stats };
  const w = await turningRuntime(), o = generated.offset, reasons = new Map();
  const reject = (why) => { stats.turningSkipped++; reasons.set(why, (reasons.get(why) ?? 0) + 1); };
  // Keep XY close to the engine origin, but use saved world Z for the slicer's
  // fixed schedule. Return to the engine frame only at the output boundary.
  const model = Float64Array.from(positions, (v, i) => v + (i % 3 === 0 ? o.x : i % 3 === 1 ? o.y : 0));
  const source = Float32Array.from(generated.triangles, (v, i) => v - (i % 3 === 2 ? o.z : 0));
  let body;
  try { body = mesh(w, model); } catch {
    stats.turningReasons = ['source is not a closed solid; original fins retained'];
    stats.turningSkipped = (generated.pieces ?? []).filter((p) => p.kind === 'prop').length;
    return { ...generated, stats };
  }
  const topology = topoOf(model), replacements = new Map();
  const pieces = generated.pieces ?? [];
  const owned = (p) => p.ranges.flatMap(([a, b]) => Array.from({ length: b - a }, (_, i) => a + i));
  const pieceData = (p) => Float32Array.from(owned(p).flatMap((t) => Array.from(source.slice(t * 9, t * 9 + 9))));
  try {
    for (const piece of pieces.filter((p) => p.kind === 'prop')) {
      let original, roof;
      try {
        original = mesh(w, pieceData(piece));
        const originalParts = original.decompose();
        let componentBounds;
        try { componentBounds = originalParts.map((s) => s.boundingBox()); }
        finally { for (const s of originalParts) s.delete(); }
        const bounds = original.boundingBox(), top = bounds.max[2];
        roof = roofAt(w, model, generated.overFaces ?? [], top, gap);
        if (!roof) throw Error('no isolated rectangular horizontal roof');
        const band = oneRectangle(original, top - Math.max(dimensions.nozzle * 2, dimensions.layerHeight * 2));
        if (!band || band.length < 3 * dimensions.lineWidth) throw Error('upper wall is not a straight strip');
        const target = topDirection(roof.shape, band.angle, angle), turn = delta(target, band.angle);
        if (Math.abs(turn) < 5) continue;
        // Bound the initial feature's roof size and reach. These are geometric
        // eligibility limits, not a material-specific sag prediction.
        if (roof.shape.length > 12 + 2 * dimensions.lineWidth) throw Error('roof exceeds the initial turning coverage bound');
        const sideFaces = [];
        for (let f = 0; f < model.length / 9; f++) {
          const face = model.subarray(f * 9, f * 9 + 9);
          // Only the intended horizontal roof may use the smaller top gap.
          if ([face[2], face[5], face[8]].every((z) => Math.abs(z - top - gap) <= EPS)) continue;
          sideFaces.push(...face);
        }
        const sides = sideFaces.length ? topoOf(Float64Array.from(sideFaces)) : null;
        const startLength = Math.min(band.length, Math.max(3 * dimensions.lineWidth, roof.shape.width * .7));
        let endLength = Math.min(roof.shape.length, band.length);
        const targetRadians = target * Math.PI / 180;
        const endpoint = (length, sign) => [band.center[0] + sign * length / 2 * Math.cos(targetRadians),
          band.center[1] + sign * length / 2 * Math.sin(targetRadians)];
        while (endLength >= 3 * dimensions.lineWidth && ![-1, 1].every((s) => insideRectangle(endpoint(endLength, s), roof.shape, dimensions.sideGap))) endLength -= dimensions.lineWidth / 2;
        if (endLength < 3 * dimensions.lineWidth) throw Error('no crosswise strip fits beneath the roof');
        const maximumRoofReach = roofReach(roof.shape, { center: band.center, angle: target, length: endLength, width: 2 * dimensions.lineWidth });
        if (maximumRoofReach > 6 + EPS) throw Error('turned top leaves excessive roof reach');
        const h = dimensions.layerHeight, first = dimensions.firstLayerHeight;
        const lastPrintZ = round(first + (Math.ceil((top + h / 2 - first) / h) - 1) * h);
        let replacement, lastReason = 'not enough clear height for a supported turn';
        const failedAttempts = new Set();
        const minimumFirst = Math.max(bounds.min[2] + 2 * h, first, lastPrintZ - 4096 * h);
        for (let firstPrintZ = round(lastPrintZ - h); firstPrintZ > minimumFirst; firstPrintZ = round(firstPrintZ - h)) {
          let turning, lower, joined;
          try {
            ({ solid: turning } = buildTurn(w, { ...dimensions, firstPrintZ, lastPrintZ, topZ: top,
              startLength, endLength, center: band.center, startAngle: band.angle, turnDegrees: turn }, [{ id: 'source body', solid: body }]));
            const joinZ = firstPrintZ - h / 2;
            if (componentBounds.filter((b) => b.max[2] > joinZ + EPS).length !== 1) throw Error('multiple upper components cannot share one turn');
            const firstSection = turning.slice(firstPrintZ - h / 2), oldSection = original.slice(joinZ - h / 4);
            let reach, missing, overlap;
            try {
              reach = oldSection.offset(h); missing = firstSection.subtract(reach);
              overlap = firstSection.intersect(oldSection);
              if (missing.area() > EPS || overlap.area() < 2 * dimensions.lineWidth ** 2) throw Error('lower attachment cannot carry the first turn layer');
            } finally { overlap?.delete(); missing?.delete(); reach?.delete(); firstSection.delete(); oldSection.delete(); }
            const projection = turning.project(), outside = projection.subtract(roof.section);
            try { if (outside.area() > EPS) throw Error('turn extends beyond the original roof footprint'); }
            finally { projection.delete(); outside.delete(); }
            const verts = solidTriangles(turning), clearance = clearanceDistance(topology, IDENTITY, { x: 0, y: 0, z: 0 }, verts, Math.max(dimensions.sideGap, gap), true);
            if (clearance + EPS < Math.min(dimensions.sideGap, gap)) throw Error('turn lacks model clearance');
            if (sides && clearanceDistance(sides, IDENTITY, { x: 0, y: 0, z: 0 }, verts, dimensions.sideGap, true) + EPS < dimensions.sideGap) {
              throw Error('turn lacks lateral model clearance');
            }
            // Existing exclusions reserve their full vertical column. This also
            // conservatively retains area-based slivers from the shared report.
            for (const f of generated.smallFaces ?? []) {
              const face = Array.from({ length: 3 }, (_, i) => Array.from(model.slice(f * 9 + i * 3, f * 9 + i * 3 + 3)));
              const height = Math.max(...face.map((p) => p[2]));
              if (height <= 0) continue;
              const xy = face.map((p) => p.slice(0, 2));
              if (area(xy) < EPS * EPS) continue;
              const cs = new w.CrossSection([xy], 'EvenOdd');
              let reserved, hit;
              try { reserved = cs.extrude(height); hit = turning.intersect(reserved); if (!hit.isEmpty()) throw Error('turn crosses an excluded overhang column'); }
              finally { hit?.delete(); reserved?.delete(); cs.delete(); }
            }
            for (const other of pieces) {
              if (other.id === piece.id) continue;
              let solid, hit;
              try {
                const data = replacements.has(other.id) ? Float64Array.from(replacements.get(other.id).flat()) : pieceData(other);
                solid = mesh(w, data); hit = turning.intersect(solid);
                if (!hit.isEmpty()) throw Error('turn intersects another support');
                if (clearanceDistance(topoOf(data), IDENTITY, { x: 0, y: 0, z: 0 }, verts,
                  dimensions.sideGap, true) + EPS < dimensions.sideGap) throw Error('turn is too close to another support');
              } finally { hit?.delete(); solid?.delete(); }
            }
            // Reject removal of a side contact/tine: the old upper band must be
            // wholly separated from the model, including its tips.
            const upper = original.trimByPlane([0, 0, 1], joinZ);
            try { if (clearanceDistance(topology, IDENTITY, { x: 0, y: 0, z: 0 }, solidTriangles(upper), gap, true) < Math.min(.1, gap) - EPS) throw Error('upper wall has model contacts that must be retained'); }
            finally { upper.delete(); }
            lower = original.trimByPlane([0, 0, -1], -joinZ);
            joined = w.Manifold.union([lower, turning]);
            const parts = joined.decompose();
            try {
              // Engine feet can be separate overlapping shells. Retain those
              // lower components; require exactly one upper component and never
              // introduce an additional disconnected component.
              if (parts.length > componentBounds.length || parts.filter((s) => s.boundingBox().max[2] > joinZ + EPS).length !== 1) {
                throw Error('replacement is disconnected');
              }
            } finally { for (const s of parts) s.delete(); }
            const worldTurn = Float64Array.from(verts.flat(), (v, i) => v - (i % 3 === 0 ? o.x : i % 3 === 1 ? o.y : 0));
            await validate(worldTurn);
            const candidate = solidTriangles(joined);
            // The cache uses float32 and the XML exporter uses six decimals.
            // Reject a turn whose topology cannot survive those representations.
            const serialized = Float64Array.from(Float32Array.from(candidate.flat()), round);
            const checked = mesh(w, serialized); checked.delete();
            replacement = candidate;
            stats.turningDetails.push({ piece: piece.id, topAngle: target, turnDegrees: turn,
              firstPrintZ, joinZ, lastPrintZ, topZ: top, roofReach: maximumRoofReach, bounds: turningBounds(worldTurn) });
            break;
          } catch (e) { lastReason = e.message; failedAttempts.add(e.message); }
          finally { turning?.delete(); lower?.delete(); joined?.delete(); }
        }
        if (!replacement) throw Error(`no valid turn: ${failedAttempts.size ? [...failedAttempts].join('; ') : lastReason}`);
        replacements.set(piece.id, replacement); stats.turnedFins++;
      } catch (e) { reject(e.message); }
      finally { original?.delete(); roof?.section.delete(); }
    }
  } finally { body.delete(); }
  stats.turningReasons = [...reasons].map(([reason, count]) => `${count}: ${reason}`);
  if (!replacements.size) return { ...generated, stats };
  const replaceAt = new Map(), remove = new Set(), remap = new Map(), newRanges = new Map();
  for (const piece of pieces) if (replacements.has(piece.id)) {
    const ids = owned(piece); replaceAt.set(ids.reduce((a, b) => Math.min(a, b), Infinity), piece); for (const id of ids) remove.add(id);
  }
  const out = [];
  for (let t = 0; t < generated.triangles.length / 9; t++) {
    if (replaceAt.has(t)) {
      const piece = replaceAt.get(t), start = out.length / 9;
      for (const p of replacements.get(piece.id)) out.push(p[0], p[1], p[2] + o.z);
      newRanges.set(piece.id, [[start, out.length / 9]]);
    }
    if (!remove.has(t)) { remap.set(t, out.length / 9); for (let i = 0; i < 9; i++) out.push(generated.triangles[t * 9 + i]); }
  }
  const mapped = pieces.map((piece) => {
    if (newRanges.has(piece.id)) return { ...piece, ranges: newRanges.get(piece.id) };
    const ranges = [];
    for (const t of owned(piece)) {
      const next = remap.get(t), last = ranges.at(-1);
      if (next == null) throw Error('overlapping support ownership prevents turning');
      if (last && last[1] === next) last[1]++; else ranges.push([next, next + 1]);
    }
    return { ...piece, ranges };
  });
  stats.finTriangles += out.length / 9 - generated.triangles.length / 9;
  return { ...generated, triangles: Float32Array.from(out), pieces: mapped, stats };
}
