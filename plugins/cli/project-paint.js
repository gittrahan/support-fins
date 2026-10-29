// Project-only, exact categorical region remapping. The browser's inexpensive
// preview colour handling is deliberately independent of this export service.
import { decodePaint, encodePaintState } from './bambu-paint.js';
import { uniformPaintRegions } from './paint-regions.js';
import {
  bounds,
  boxIndex,
  clipPolygon,
  conformPolygons,
  dot,
  frame,
  polygonArea,
  sub,
  triangle,
} from './paint-geometry.js';

const CHANNELS = { paint_color: 'filament', paint_supports: 2, paint_seam: 2 };
const MATERIAL = new Set(['pid', 'p1', 'p2', 'p3']);
const natural = (s) => typeof s === 'string' && /^\d+$/.test(s) && Number.isSafeInteger(Number(s));

function material(attrs, source) {
  const pid = attrs.pid ?? source.attributes.pid;
  const index = attrs.p1 ?? source.attributes.pindex;
  if (pid === undefined && index === undefined && attrs.p2 === undefined && attrs.p3 === undefined) return;
  if (!natural(pid) || !natural(index)) throw new Error('ambiguous face material reference');
  const resources = source.properties.filter((r) => r.attributes.id === pid);
  if (resources.length !== 1) throw new Error('missing or ambiguous material resource');
  const resource = resources[0];
  // Interpolated per-corner materials require another representation; never
  // collapse them to a convenient colour. Discrete base materials retain IDs.
  if (resource.name.split(':').pop() !== 'basematerials') {
    throw new Error('unsupported material resource on converted part');
  }
  if (Number(index) >= resource.children.length) throw new Error('material index is out of range');
  if ([attrs.p2, attrs.p3].some((p) => p !== undefined && (!natural(p) || Number(p) !== Number(index)))) {
    throw new Error('per-corner material interpolation is not supported on converted parts');
  }
}

function attributes(component, filamentCount) {
  const { source } = component;
  const cache = new Map();
  material({}, source);
  // Validate even faces removed by the cutter: unsupported topology-dependent
  // data must not be silently discarded on a converted part.
  return Array.from({ length: source.indices.length / 3 }, (_, i) => {
    const attrs = source.triangleAttributes[i] ?? {}, channels = [], plain = {};
    const key = JSON.stringify(attrs, Object.keys(attrs).sort());
    if (cache.has(key)) return cache.get(key);
    for (const [key, value] of Object.entries(attrs)) {
      if (Object.hasOwn(CHANNELS, key)) {
        const limit = CHANNELS[key] === 'filament' ? filamentCount : CHANNELS[key];
        channels.push({ key, leaves: decodePaint(value, limit) });
      } else if (MATERIAL.has(key)) plain[key] = value;
      else throw new Error(`unsupported triangle attribute on converted part: ${key}`);
    }
    material(attrs, source);
    // Combine annotation channels in original barycentric coordinates before
    // transforming. Identical seam/support/colour boundaries are then literally
    // the same dyadic coordinates, not separately rounded world-space lines.
    let regions = [{ polygon: [[0, 0], [1, 0], [0, 1]], attrs: plain }];
    for (const { key, leaves } of channels) {
      const next = [];
      for (const region of regions) {
        for (const leaf of leaves) {
          const polygon = clipPolygon(region.polygon, leaf.triangle);
          if (polygon.length) {
            next.push({
              polygon,
              attrs: leaf.state === 0
                ? region.attrs
                : { ...region.attrs, [key]: encodePaintState(leaf.state) },
            });
          }
        }
      }
      regions = next;
    }
    const decoded = { channels, plain, regions };
    // Uniform brush states repeat across large meshes. Bound only this optional
    // memoization, never the number of valid paint states or regions accepted.
    if (cache.size < 256) cache.set(key, decoded);
    return decoded;
  });
}

const ccw = (p) => polygonArea(p) < 0 ? p.toReversed() : p;
const area = (p) => Math.abs(polygonArea(p));

function withinFace(source, points, eps) {
  if (points.some((p) => Math.abs(source.plane.distance(p)) > eps)) return false;
  const boundary = ccw(source.points.map(source.plane.project));
  for (const p of points.map(source.plane.project)) {
    for (let k = 0; k < 3; k++) {
      const a = boundary[k], b = boundary[(k + 1) % 3];
      if (
        (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) <
          -eps * Math.hypot(b[0] - a[0], b[1] - a[1])
      ) return false;
    }
  }
  return true;
}

function uniformFace(source, points, eps) {
  if (source.attrs.channels.some((c) => c.leaves.length !== 1) || !withinFace(source, points, eps)) {
    return null;
  }
  return source.attrs.regions[0].attrs;
}

function onSourceFace(source, points, eps) {
  const [a, b, c] = source.points,
    u = sub(b, a),
    v = sub(c, a),
    uu = dot(u, u),
    uv = dot(u, v),
    vv = dot(v, v),
    denom = uu * vv - uv * uv;
  if (!Number.isFinite(denom) || denom <= 0) {
    throw new Error('source face exceeds conversion coordinate precision');
  }
  return points.map((p) => {
    const d = sub(p, a), du = dot(d, u), dv = dot(d, v);
    let s = Math.max(0, (du * vv - dv * uv) / denom), t = Math.max(0, (dv * uu - du * uv) / denom);
    if (s + t > 1) {
      const sum = s + t;
      s /= sum;
      t /= sum;
    }
    const q = a.map((x, i) => x + s * u[i] + t * v[i]);
    if (Math.hypot(...sub(p, q)) > eps * 2) {
      throw new Error('subtraction face exceeds source coordinate precision');
    }
    return q;
  });
}

// Clipping coordinates can be restored to the original painted face within
// boolean precision, but that must not move the actual exported mesh vertices.
// Map the resulting regions back to the original output triangle instead.
function outputCoordinates(reference, output) {
  const [a, b, c] = reference;
  const bx = b[0] - a[0], by = b[1] - a[1], cx = c[0] - a[0], cy = c[1] - a[1];
  const denominator = bx * cy - by * cx;
  if (!Number.isFinite(denominator) || denominator === 0) throw new Error('degenerate paint reference');
  return (p) => {
    const vertex = reference.findIndex((v) => v[0] === p[0] && v[1] === p[1]);
    if (vertex !== -1) return output[vertex];
    const x = p[0] - a[0], y = p[1] - a[1];
    const s = (x * cy - y * cx) / denominator, t = (bx * y - by * x) / denominator;
    return output[0].map((v, i) => v + s * (output[1][i] - v) + t * (output[2][i] - v));
  };
}

/** A source face ID is only a hint. A boolean can merge coplanar faces across
 * a paint boundary. Intersect the actual output with source regions and check
 * complete, unambiguous coverage before triangulating. Input corners are in
 * the reader's outward order; paint is in the original XML corner order. */
export function remapProjectPaint(
  component,
  cut,
  filamentCount,
  { precision = 'float32' } = {},
) {
  return remapPaint(
    component,
    cut,
    filamentCount,
    () => paintContext(component, filamentCount, precision),
  );
}

/** Reuse source-face analysis across pieces of one immutable component.
 * The caller owns this closure's lifetime; no project-wide mesh cache exists.
 * Cut geometry and provenance are validated on every call. */
export function prepareProjectPaint(
  component,
  filamentCount,
  { precision = 'float32' } = {},
) {
  let context;
  return (cut) =>
    remapPaint(
      component,
      cut,
      filamentCount,
      () => context ??= paintContext(component, filamentCount, precision),
    );
}

function paintContext(component, filamentCount, precision) {
  const input = component.positions,
    faceAttributes = attributes(component, filamentCount);
  let magnitude = 1;
  for (const p of input) magnitude = Math.max(magnitude, Math.abs(p));
  // Accommodate the boolean's coordinate error, never an expansion of
  // categorical paint regions. Manifold's double kernel uses a 1e-12 scaled
  // precision bound; Number.EPSILON alone understates accumulated CSG error.
  if (precision !== 'float32' && precision !== 'float64') {
    throw new Error('unsupported paint coordinate precision');
  }
  const eps = precision === 'float64'
    ? Math.max(1e-12, magnitude * 1e-12)
    : Math.max(1e-7, magnitude * 2 ** -22);
  const source = Array.from({ length: input.length / 9 }, (_, face) => {
    const points = triangle(input, face), plane = frame(points);
    return {
      points,
      plane,
      box: bounds(points),
      attrs: faceAttributes[component.sourceFaces[face]],
    };
  });
  const index = boxIndex(source.map((_, i) => i), (i) => source[i].box);
  return { magnitude, eps, source, index, precision };
}

function remapPaint(component, cut, filamentCount, context) {
  if (!Number.isSafeInteger(filamentCount) || filamentCount < 1) {
    throw new Error('project filament count is required for paint conversion');
  }
  const output = cut.positions;
  if (cut.sourceFaces?.length !== output.length / 9) throw new Error('missing subtraction face provenance');
  if (cut.sourceFaces.some((f) => !Number.isInteger(f) || f < -1 || f >= component.sourceFaces.length)) {
    throw new Error('invalid subtraction face provenance');
  }
  // With no face-local state there is no paint boundary to reconstruct. Retain
  // the boolean's closed mesh exactly, including its tiny valid facets. Material
  // inheritance lives on the part, equally for old and newly exposed surfaces.
  material({}, component.source);
  if (component.source.triangleAttributes.every((a) => !a || !Object.keys(a).length)) {
    return {
      positions: new Float64Array(output),
      triangleAttributes: Array.from(cut.sourceFaces, () => ({})),
      sourceFaces: Int32Array.from(cut.sourceFaces, (f) => f < 0 ? -1 : component.sourceFaces[f]),
    };
  }
  const { magnitude, eps, source, index, precision } = context();
  const polygons = [];
  let subdivided = false;
  for (let face = 0; face < output.length / 9; face++) {
    let points = triangle(output, face), plane = frame(points), target = points.map(plane.project);
    let toOutput = plane.world;
    const hint = cut.sourceFaces[face];
    if (hint === -1) {
      // New surfaces inherit the owning part's normal material/settings.
      polygons.push({ points, attributes: {}, outputFace: face });
      continue;
    }
    if (hint < 0 || hint >= source.length) throw new Error('invalid subtraction face provenance');
    const uniform = uniformFace(source[hint], points, eps);
    // A nearly collinear float32 triangle can have an unstable normal. The
    // geometric plane/containment proof is what establishes its paint region.
    if (uniform) {
      polygons.push({
        points, attributes: uniform, sourceFace: component.sourceFaces[hint], outputFace: face,
      });
      continue;
    }
    const contained = withinFace(source[hint], points, eps);
    if (contained) {
      // Restore original face coordinates only within the boolean's float32
      // rounding bound. This prevents false micron-wide slivers at a shared
      // source edge; material choice still comes from intersected paint regions.
      const actualPoints = points;
      points = onSourceFace(source[hint], points, eps);
      plane = frame(points);
      target = points.map(plane.project);
      toOutput = outputCoordinates(target, actualPoints);
    }
    const candidates = contained ? [hint] : index.query(bounds(points), eps), pieces = [];
    let covered = 0;
    for (const { face: candidate, points: coverage } of uniformPaintRegions(candidates, source)) {
      const s = source[candidate];
      if (
        (!contained && dot(s.plane.normal, plane.normal) <= 0) ||
        points.some((p) => Math.abs(s.plane.distance(p)) > eps)
      ) {
        continue;
      }
      const region = clipPolygon(target, ccw(coverage.map(plane.project)));
      if (!region.length) continue;
      covered += area(region);
      const splits = [];
      const original = [0, 1, 2].map((k) => s.points[component.cornerOrder.indexOf(k)]);
      if (s.attrs.channels.every((channel) => channel.leaves.length === 1)) {
        // The region has already been clipped to this source triangle. A
        // whole-face brush adds no boundary; reconstructing and clipping that
        // same triangle again only introduces a second rounding operation.
        splits.push({ polygon: region, attrs: s.attrs.regions[0].attrs });
      } else for (const leaf of s.attrs.regions) {
        const boundary = ccw(
          leaf.polygon.map(([u, v]) =>
            plane.project(original[0].map((x, a) => x + u * (original[1][a] - x) + v * (original[2][a] - x)))
          ),
        );
        const polygon = clipPolygon(region, boundary);
        if (polygon.length) splits.push({ polygon, attrs: leaf.attrs });
      }
      const paintedArea = splits.reduce((sum, p) => sum + area(p.polygon), 0);
      // Squaring a float64 distance bound is not an area-arithmetic bound.
      // Account for the products and sums in shoelace area, without enlarging
      // a painted region or changing the source containment tolerance.
      const areaError = (poly) =>
        poly.reduce((sum, a, i) => {
          const b = poly[(i + 1) % poly.length];
          return sum + Math.abs(a[0] * b[1]) + Math.abs(a[1] * b[0]);
        }, 0) * 16 * Number.EPSILON;
      const areaRoundoff = precision === 'float64'
        ? areaError(region) + splits.reduce((sum, p) => sum + areaError(p.polygon), 0) +
          splits.length * Number.EPSILON * paintedArea
        : 0;
      if (
        Math.abs(paintedArea - area(region)) > Math.max(eps * eps, areaRoundoff)
      ) {
        throw new Error('paint subdivision did not cover its surviving face', {
          cause: precision === 'float64'
            ? { face, hint, candidate, points, region, splits, paintedArea,
              regionArea: area(region), eps, areaRoundoff }
            : undefined,
        });
      }
      for (const split of splits) {
        pieces.push({
          points: split.polygon.map(toOutput),
          attributes: split.attrs,
          sourceFace: component.sourceFaces[candidate],
          outputFace: face,
        });
      }
    }
    const perimeter = points.reduce((n, p, i) => n + Math.hypot(...sub(p, points[(i + 1) % 3])), 0);
    if (!pieces.length || Math.abs(covered - area(target)) > eps * perimeter) {
      throw new Error(
        'source faces do not unambiguously cover a converted face',
        {
          cause: precision === 'float64'
            ? {
              face,
              hint,
              points,
              eps,
              contained,
              covered,
              targetArea: area(target),
              perimeter,
              candidates: candidates.slice(0, 16).map((i) => ({
                face: i,
                points: source[i].points,
                distance: points.map(source[i].plane.distance),
              })),
            }
            : undefined,
        },
      );
    }
    const state = (attrs) => JSON.stringify(Object.entries(attrs).sort(([a], [b]) => a.localeCompare(b)));
    if (pieces.every((p) => state(p.attributes) === state(pieces[0].attributes))) {
      // Coverage was proved across every source face above. Where all covered
      // regions have identical state there is no paint boundary to construct.
      // Keep the Boolean triangle exactly; clipping it along invisible source
      // diagonals can introduce ill-conditioned microscopic subdivisions.
      polygons.push({ points: triangle(output, face), attributes: pieces[0].attributes,
        sourceFace: component.sourceFaces[hint], outputFace: face });
    } else {
      subdivided = true;
      polygons.push(...pieces);
    }
  }
  if (!subdivided) {
    return {
      positions: new Float64Array(output),
      triangleAttributes: polygons.map((p) => p.attributes),
      sourceFaces: Int32Array.from(polygons.map((p) => p.sourceFace ?? -1)),
    };
  }
  // Distinct, valid float32 mesh vertices may be much closer than the boolean's
  // provenance tolerance. Only merge arithmetic roundoff from subdivision here.
  return conformPolygons(polygons, magnitude * 64 * Number.EPSILON, output);
}
