// Convex region clipping and conforming triangulation for baked facet painting.
// None of these triangles are used for support analysis.
import { exactlyCollinear } from './exact-geometry.js';
export const sub = (a, b) => a.map((x, i) => x - b[i]);
export const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
export const cross = (
  a,
  b,
) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const triangle = (positions, face) =>
  [0, 1, 2].map((k) => Array.from(positions.subarray(face * 9 + k * 3, face * 9 + k * 3 + 3)));
export const polygonArea = (p) =>
  p.reduce((s, a, i) => {
    const b = p[(i + 1) % p.length];
    return s + a[0] * b[1] - a[1] * b[0];
  }, 0) / 2;

export function frame(t) {
  const u = sub(t[1], t[0]), normal = cross(u, sub(t[2], t[0]));
  const length = Math.hypot(...u), height = Math.hypot(...normal);
  if (!length || !height) throw new Error('degenerate converted face');
  const n = normal.map((v) => v / height);
  // Drop the dominant normal coordinate instead of rotating into a normalized
  // edge basis. Rotation can turn an exactly shared paint boundary into a
  // fictitious positive-area sliver through roundoff. Axis projection retains
  // those coordinates and requires no paint-region expansion or area cutoff.
  const dropped = [0, 1, 2].sort((a, b) => Math.abs(n[b]) - Math.abs(n[a]))[0];
  const axes = [(dropped + 1) % 3, (dropped + 2) % 3];
  if (n[dropped] < 0) axes.reverse();
  return {
    normal: n,
    project: (p) => axes.map((a) => p[a] - t[0][a]),
    distance: (p) => dot(sub(p, t[0]), n),
    world: (p) => {
      const result = [...t[0]];
      for (let i = 0; i < 2; i++) result[axes[i]] += p[i];
      result[dropped] -= (n[axes[0]] * p[0] + n[axes[1]] * p[1]) / n[dropped];
      return result;
    },
  };
}

/** Intersect convex, counterclockwise polygons. No expansion of paint regions. */
export function clipPolygon(subject, boundary) {
  let polygon = subject;
  for (let i = 0; i < boundary.length && polygon.length; i++) {
    const a = boundary[i], b = boundary[(i + 1) % boundary.length];
    const side = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const next = [];
    for (let j = 0; j < polygon.length; j++) {
      const p = polygon[j], q = polygon[(j + 1) % polygon.length], dp = side(p), dq = side(q);
      if (dp >= 0) next.push(p);
      if ((dp < 0) !== (dq < 0)) {
        const t = dp / (dp - dq);
        next.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
    polygon = next.filter((p, j) => j === 0 || p[0] !== next[j - 1][0] || p[1] !== next[j - 1][1]);
    if (polygon.length > 1 && polygon[0][0] === polygon.at(-1)[0] && polygon[0][1] === polygon.at(-1)[1]) {
      polygon.pop();
    }
  }
  return polygon.length >= 3 && polygonArea(polygon) > 0 ? polygon : [];
}

export function bounds(points) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], p[a]);
      hi[a] = Math.max(hi[a], p[a]);
    }
  }
  return { lo, hi };
}
const overlap = (a, b, eps) => a.lo.every((v, i) => v <= b.hi[i] + eps && a.hi[i] >= b.lo[i] - eps);

/** Small AABB hierarchy shared by face lookup and edge subdivision. */
export function boxIndex(items, box) {
  if (!items.length) return { query: () => [] };
  const build = (ids) => {
    const b = bounds(ids.flatMap((i) => [box(i).lo, box(i).hi]));
    if (ids.length <= 12) return { ...b, ids };
    const axis = [0, 1, 2].sort((a, c) => (b.hi[c] - b.lo[c]) - (b.hi[a] - b.lo[a]))[0];
    ids.sort((a, c) => box(a).lo[axis] + box(a).hi[axis] - box(c).lo[axis] - box(c).hi[axis]);
    const half = ids.length >> 1;
    return { ...b, left: build(ids.slice(0, half)), right: build(ids.slice(half)) };
  };
  const root = build([...items]);
  return {
    query: (box_, eps = 0) => {
      const result = [], stack = [root];
      while (stack.length) {
        const node = stack.pop();
        if (!overlap(node, box_, eps)) continue;
        if (node.ids) { for (const i of node.ids) if (overlap(box(i), box_, eps)) result.push(i); }
        else stack.push(node.left, node.right);
      }
      return result;
    },
  };
}

/** Insert all shared boundary vertices before triangulating. This also resolves
 * T junctions in uneven paint trees; no slicer mesh repair is relied upon.
 * eps bounds double-precision subdivision roundoff, never boolean uncertainty
 * or a paint brush size. Distinct boolean output vertices must stay distinct.
 * Features that collapse at that precision fail instead of losing their state. */
export function conformPolygons(polygons, eps, inputPositions) {
  const vertices = [], grid = new Map(), exact = new Map(), originalVertices = new Set();
  const insert = (p) => {
    const id = vertices.length, key = p.map((v) => Math.floor(v / eps)).join(',');
    vertices.push(p);
    exact.set(p.join(','), id);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(id);
    return id;
  };
  // Input vertices already define the Boolean topology. Never weld two of
  // them merely because they lie inside subdivision's arithmetic error bound.
  for (let i = 0; i < inputPositions.length; i += 3) {
    const p = Array.from(inputPositions.subarray(i, i + 3)), key = p.join(',');
    if (!exact.has(key)) originalVertices.add(insert(p));
  }
  const vertex = (p) => {
    const existing = exact.get(p.join(','));
    if (existing !== undefined) return existing;
    const cell = p.map((v) => Math.floor(v / eps));
    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let z = -1; z <= 1; z++) {
          const ids = grid.get(`${cell[0] + x},${cell[1] + y},${cell[2] + z}`) ?? [];
          for (const i of ids) if (Math.hypot(...sub(vertices[i], p)) <= eps) return i;
        }
      }
    }
    return insert(p);
  };
  const rings = polygons.map(({ points, attributes, sourceFace = -1, outputFace }) => {
    const ids = points.map(vertex).filter((v, i, a) => !i || v !== a[i - 1]);
    if (ids.length > 1 && ids[0] === ids.at(-1)) ids.pop();
    if (ids.length < 3) throw new Error('paint region is smaller than conversion precision');
    return { ids, attributes, sourceFace, outputFace };
  });
  const index = boxIndex(vertices.map((_, i) => i), (i) => ({ lo: vertices[i], hi: vertices[i] }));
  const onEdge = (id, p, q, d, t) => {
    // An existing vertex may belong to a distinct, extremely close edge. Only
    // exact collinearity permits inserting it into another original edge.
    if (originalVertices.has(id)) return exactlyCollinear(p, q, vertices[id]);
    return Math.hypot(...sub(vertices[id], p.map((v, k) => v + d[k] * t))) <= eps;
  };
  // Share subdivisions only within an original face or across its actual
  // edges. A global proximity search can split unrelated, unpainted faces at a
  // geometric contact and change their topology (even without moving a point).
  const allowed = new Map(), inputEdges = new Map();
  for (const { ids, outputFace } of rings) {
    if (
      !Number.isInteger(outputFace) || outputFace < 0 ||
      outputFace >= inputPositions.length / 9
    ) {
      throw new Error('missing paint polygon topology');
    }
    if (!allowed.has(outputFace)) allowed.set(outputFace, new Set());
    for (const id of ids) allowed.get(outputFace).add(id);
  }
  for (let face = 0; face < inputPositions.length / 9; face++) {
    const points = triangle(inputPositions, face);
    for (let i = 0; i < 3; i++) {
      const p = points[i], q = points[(i + 1) % 3];
      const key = [p.join(','), q.join(',')].sort().join(';');
      if (!inputEdges.has(key)) inputEdges.set(key, { p, q, faces: [] });
      inputEdges.get(key).faces.push(face);
    }
  }
  for (const { p, q, faces } of inputEdges.values()) {
    const d = sub(q, p), length = dot(d, d);
    const shared = [];
    for (const id of index.query(bounds([p, q]), eps)) {
      if (!faces.some((face) => allowed.get(face)?.has(id))) continue;
      const t = dot(sub(vertices[id], p), d) / length;
      if (t <= 0 || t >= 1) continue;
      if (onEdge(id, p, q, d, t)) shared.push(id);
    }
    for (const face of faces) {
      for (const id of shared) allowed.get(face).add(id);
    }
  }
  const positions = [], attributes = [], sources = [], edges = new Map();
  const emit = (a, b, c, attrs, sourceFace) => {
    if (
      new Set([a, b, c]).size !== 3 ||
      exactlyCollinear(vertices[a], vertices[b], vertices[c])
    ) {
      throw new Error('paint triangulation produced a degenerate face', {
        cause: { points: [vertices[a], vertices[b], vertices[c]], ids: [a, b, c], eps, sourceFace },
      });
    }
    positions.push(...vertices[a], ...vertices[b], ...vertices[c]);
    attributes.push(attrs);
    sources.push(sourceFace);
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const key = u < v ? `${u}:${v}` : `${v}:${u}`, e = edges.get(key) ?? { count: 0, balance: 0 };
      e.count++;
      e.balance += u < v ? 1 : -1;
      edges.set(key, e);
    }
  };
  for (const { ids, attributes: attrs, sourceFace, outputFace } of rings) {
    const ring = [];
    for (let i = 0; i < ids.length; i++) {
      const a = ids[i],
        b = ids[(i + 1) % ids.length],
        p = vertices[a],
        q = vertices[b],
        d = sub(q, p),
        length = dot(d, d);
      const on = [];
      for (const id of index.query(bounds([p, q]), eps)) {
        if (id === a || id === b || !allowed.get(outputFace).has(id)) continue;
        const t = dot(sub(vertices[id], p), d) / length;
        if (t <= 0 || t >= 1) continue;
        if (onEdge(id, p, q, d, t)) on.push([t, id]);
      }
      ring.push(a, ...on.sort((a, b) => a[0] - b[0]).map((v) => v[1]));
    }
    // A centroid can round onto the boundary of a very thin valid region.
    // Triangulate using its existing vertices; every collinear boundary vertex
    // must remain on an edge so the neighbouring face has the same topology.
    const original = frame(triangle(inputPositions, outputFace));
    const point = (id) => original.project(vertices[id]);
    const orient = (a, b, c) => {
      const p = point(a), q = point(b), r = point(c);
      return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    };
    if (ring.length > 3) {
      const centre = [0, 1, 2].map((a) => ring.reduce((s, i) => s + vertices[i][a], 0) / ring.length);
      const middle = original.project(centre);
      const interior = ring.every((id, i) => {
        const a = point(id), b = point(ring[(i + 1) % ring.length]);
        const distance = ((b[0] - a[0]) * (middle[1] - a[1]) - (b[1] - a[1]) * (middle[0] - a[0])) /
          Math.hypot(b[0] - a[0], b[1] - a[1]);
        return distance > eps;
      });
      if (interior) {
        const c = vertex(centre);
        for (let i = 0; i < ring.length; i++) emit(c, ring[i], ring[(i + 1) % ring.length], attrs, sourceFace);
        continue;
      }
    }
    const left = [...ring];
    while (left.length > 3) {
      let found = false;
      for (let i = 0; i < left.length; i++) {
        const a = left[(i + left.length - 1) % left.length], b = left[i], c = left[(i + 1) % left.length];
        if (orient(a, b, c) <= 0) continue;
        if (left.some((p) => p !== a && p !== b && p !== c &&
          orient(a, b, p) >= 0 && orient(b, c, p) >= 0 && orient(c, a, p) >= 0)) continue;
        emit(a, b, c, attrs, sourceFace);
        left.splice(i, 1);
        found = true;
        break;
      }
      if (!found) throw new Error('cannot triangulate paint boundary without losing a vertex', {
        cause: { ring: ring.map((i) => vertices[i]), left: left.map((i) => vertices[i]),
          original: triangle(inputPositions, outputFace), outputFace, sourceFace, eps },
      });
    }
    emit(...left, attrs, sourceFace);
  }
  for (const e of edges.values()) {
    if (e.count !== 2 || e.balance !== 0) {
      throw new Error('paint conversion is not a closed, consistently wound mesh', {
        cause: { edges: [...edges].filter(([, e]) => e.count !== 2 || e.balance !== 0).slice(0, 12)
          .map(([key, value]) => ({ ...value, points: key.split(':').map((id) => vertices[Number(id)]) })) },
      });
    }
  }
  return {
    positions: Float64Array.from(positions),
    triangleAttributes: attributes,
    sourceFaces: Int32Array.from(sources),
  };
}
