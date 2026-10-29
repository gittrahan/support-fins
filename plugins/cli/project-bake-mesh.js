// Validate the exact indexed surface that a 3MF reader will see. The boolean's
// float32 export can collapse a face onto a point or edge. Canonicalizing that
// face changes no surface or painted area; it is not repair of an input mesh.
// Edge subdivisions use existing, exactly collinear vertices only. No face is
// invented across a hole, no vertex is moved, and final closure is mandatory.
import { exactlyCollinear, orientation } from './exact-geometry.js';
const difference = (a, b) => a.map((v, i) => v - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const edgeKey = (a, b, count) => Math.min(a, b) * count + Math.max(a, b);

// Convex source triangle with extra points on its edges. Ears may not skip a
// boundary vertex, even one collinear with their diagonal: that would recreate
// the T junction that the zero-area boolean face used to represent.
function triangulate(ring, point) {
  const normal = cross(
    difference(point(ring[1]), point(ring[0])),
    difference(point(ring.at(-1)), point(ring[0])),
  );
  const axis = [0, 1, 2].sort((a, b) => Math.abs(normal[b]) - Math.abs(normal[a])).find((axis) => {
    const [x, y] = [0, 1, 2].filter((a) => a !== axis);
    return orientation(point(ring[0]), point(ring[1]), point(ring.at(-1)), x, y) !== 0;
  });
  if (axis === undefined) throw new Error('collapsed conversion polygon');
  const axes = [0, 1, 2].filter((a) => a !== axis);
  const orient = (a, b, c) => {
    const p = point(a), q = point(b), r = point(c), [x, y] = axes;
    return orientation(p, q, r, x, y);
  };
  let winding = 0;
  for (let i = 0; i < ring.length && !winding; i++) {
    winding = Math.sign(orient(ring[i], ring[(i + 1) % ring.length], ring[(i + 2) % ring.length]));
  }
  if (!winding) throw new Error('collapsed conversion polygon');
  const triangles = [], left = [...ring];
  while (left.length > 3) {
    let found = false;
    for (let i = 0; i < left.length; i++) {
      const a = left[(i + left.length - 1) % left.length], b = left[i], c = left[(i + 1) % left.length];
      if (orient(a, b, c) * winding <= 0) continue;
      if (
        left.some((p) =>
          p !== a && p !== b && p !== c && orient(a, b, p) * winding >= 0 && orient(b, c, p) * winding >= 0 &&
          orient(c, a, p) * winding >= 0
        )
      ) continue;
      triangles.push([a, b, c]);
      left.splice(i, 1);
      found = true;
      break;
    }
    if (!found) throw new Error('cannot preserve a collapsed boolean edge');
  }
  if (orient(...left) * winding <= 0) throw new Error('degenerate conversion triangulation');
  triangles.push(left);
  return triangles;
}

function vertexLinks(ids, kept, count) {
  const stride = ids.length;
  if (count * stride >= 2 ** 53) throw new Error('oversized converted mesh');
  const corners = new Float64Array(kept.length * 3);
  let at = 0;
  for (const f of kept) for (let k = 0; k < 3; k++) corners[at++] = ids[f * 3 + k] * stride + f * 3 + k;
  corners.sort();
  for (let i = 0; i < corners.length;) {
    const vertex = Math.floor(corners[i] / stride), parent = new Map();
    const find = (x) => {
      if (!parent.has(x)) parent.set(x, x);
      while (parent.get(x) !== x) {
        parent.set(x, parent.get(parent.get(x)));
        x = parent.get(x);
      }
      return x;
    };
    let end = i;
    while (end < corners.length && Math.floor(corners[end] / stride) === vertex) {
      const corner = corners[end++] % stride, f = Math.floor(corner / 3) * 3, k = corner % 3;
      parent.set(find(ids[f + (k + 1) % 3]), find(ids[f + (k + 2) % 3]));
    }
    if (new Set([...parent.keys()].map(find)).size !== 1) {
      throw new Error('converted mesh has a nonmanifold vertex');
    }
    i = end;
  }
}

// Optional per-corner vertex IDs retain the connectivity of an indexed Boolean
// surface. Distinct vertices may occupy the same point at a self-contact; welding
// them by coordinate creates a nonmanifold edge that was absent in the source.
// This is not a way to close a triangle soup: IDs must already describe a closed,
// consistently wound mesh, and each ID must have exactly one coordinate.
export function validateVertexIDs(positions, vertexIDs) {
  if (!(vertexIDs instanceof Uint32Array) || vertexIDs.length !== positions.length / 3) {
    throw new Error('invalid converted vertex identities');
  }
  const first = new Map();
  for (let v = 0; v < vertexIDs.length; v++) {
    const id = vertexIDs[v], previous = first.get(id);
    if (previous === undefined) first.set(id, v);
    else for (let k = 0; k < 3; k++) {
      if (positions[v * 3 + k] !== positions[previous * 3 + k]) {
        throw new Error('inconsistent converted vertex coordinates');
      }
    }
  }
}

// Generated material interfaces may contain an exactly reversed pair after
// edge subdivision. Cancel only that oriented zero surface, and only when the
// caller explicitly opts in for generated, same-part geometry. Ordinary input
// and subtraction validation retain their stricter behavior.
export function canonicalCutMesh(result, { cancelOppositeFaces = false } = {}) {
  const { positions, sourceFaces } = result;
  if (
    !positions?.length || positions.length % 9 || sourceFaces?.length !== positions.length / 9 ||
    !positions.every(Number.isFinite)
  ) {
    throw new Error('invalid converted mesh or provenance');
  }
  const vertexIDs = result.vertexIDs;
  if (vertexIDs !== undefined) validateVertexIDs(positions, vertexIDs);
  const vertices = new Map(),
    ids = new Uint32Array(positions.length / 3),
    kept = [],
    offsets = [],
    collinear = new Set();
  for (let v = 0; v < ids.length; v++) {
    const key = vertexIDs ? vertexIDs[v] : `${positions[v * 3]},${positions[v * 3 + 1]},${positions[v * 3 + 2]}`;
    let id = vertices.get(key);
    if (id === undefined) {
      id = vertices.size;
      vertices.set(key, id);
      offsets.push(v * 3);
    }
    ids[v] = id;
  }
  for (let f = 0; f < sourceFaces.length; f++) {
    const a = ids[f * 3], b = ids[f * 3 + 1], c = ids[f * 3 + 2];
    if (a === b || b === c || c === a) continue;
    const p = f * 9;
    if (exactlyCollinear(positions.subarray(p, p + 3), positions.subarray(p + 3, p + 6),
      positions.subarray(p + 6, p + 9))) {
      collinear.add(a);
      collinear.add(b);
      collinear.add(c);
      continue;
    }
    kept.push(f);
  }
  const collapsedFaces = sourceFaces.length - kept.length;
  let cancelledFaces = 0;
  if (cancelOppositeFaces) {
    const facets = new Map(), cancelled = new Set();
    for (const f of kept) {
      const t = ids.subarray(f * 3, f * 3 + 3);
      const k = t.indexOf(Math.min(...t)),
        a = t[k],
        b = t[(k + 1) % 3],
        c = t[(k + 2) % 3];
      const key = `${a}:${Math.min(b, c)}:${Math.max(b, c)}`;
      if (!facets.has(key)) facets.set(key, []);
      facets.get(key).push({ face: f, forward: b < c });
    }
    for (const group of facets.values()) {
      // More than two copies has ambiguous surviving provenance. Do not
      // select an arbitrary source face even if the net winding would be one.
      if (group.length === 2 && group[0].forward !== group[1].forward) {
        for (const { face } of group) cancelled.add(face);
      }
    }
    let at = 0;
    for (const f of kept) if (!cancelled.has(f)) kept[at++] = f;
    cancelledFaces = kept.length - at;
    kept.length = at;
  }
  const count = vertices.size;
  vertices.clear();
  if (!kept.length || count >= 2 ** 26) throw new Error('empty or oversized converted mesh');
  // Exact integer edge keys below 2^53; native typed-array sorting avoids a
  // project-sized collection of JS edge objects during large-model conversion.
  const edges = new Float64Array(kept.length * 3);
  let at = 0;
  for (const f of kept) {
    for (
      const [a, b] of [[ids[f * 3], ids[f * 3 + 1]], [ids[f * 3 + 1], ids[f * 3 + 2]], [
        ids[f * 3 + 2],
        ids[f * 3],
      ]]
    ) {
      edges[at++] = (Math.min(a, b) * count + Math.max(a, b)) * 2 + (a < b ? 0 : 1);
    }
  }
  edges.sort();
  const boundary = [];
  for (let e = 0; e < edges.length;) {
    const key = Math.floor(edges[e] / 2);
    let end = e + 1;
    while (end < edges.length && Math.floor(edges[end] / 2) === key) end++;
    if (end - e === 1) boundary.push(key);
    else if (end - e !== 2 || edges[e] % 2 !== 0 || edges[e + 1] !== edges[e] + 1) {
      throw new Error('converted mesh is not closed and consistently wound');
    }
    e = end;
  }
  if (boundary.length) {
    if (!collinear.size) throw new Error('converted mesh is not closed and consistently wound');
    const point = (id) => Array.from(positions.subarray(offsets[id], offsets[id] + 3)), splits = new Map();
    for (const key of boundary) {
      const a = Math.floor(key / count), b = key % count, p = point(a), q = point(b), d = difference(q, p);
      const axis = [0, 1, 2].sort((a, b) => Math.abs(d[b]) - Math.abs(d[a]))[0], inside = [];
      for (const id of collinear) {
        if (id === a || id === b) continue;
        const v = point(id), t = (v[axis] - p[axis]) / d[axis];
        if (v[axis] > Math.min(p[axis], q[axis]) && v[axis] < Math.max(p[axis], q[axis]) &&
          exactlyCollinear(p, q, v)) inside.push([t, id]);
      }
      if (inside.length) splits.set(key, inside.sort((a, b) => a[0] - b[0]).map((v) => v[1]));
    }
    if (!splits.size) throw new Error('converted mesh has an open boundary');
    const replacements = new Map();
    let countFaces = kept.length;
    for (const f of kept) {
      const vs = Array.from(ids.subarray(f * 3, f * 3 + 3)), ring = [];
      for (let k = 0; k < 3; k++) {
        const a = vs[k], b = vs[(k + 1) % 3], extra = splits.get(edgeKey(a, b, count)) ?? [];
        ring.push(a, ...(a < b ? extra : extra.toReversed()));
      }
      if (ring.length > 3) {
        const triangles = triangulate(ring, point);
        replacements.set(f, triangles);
        countFaces += triangles.length - 1;
      }
    }
    const refined = new positions.constructor(countFaces * 9), sources = new Int32Array(countFaces);
    const refinedIDs = vertexIDs ? new Uint32Array(countFaces * 3) : null;
    let face = 0;
    for (const f of kept) {
      const triangles = replacements.get(f);
      if (!triangles) {
        refined.set(positions.subarray(f * 9, f * 9 + 9), face * 9);
        if (refinedIDs) refinedIDs.set(vertexIDs.subarray(f * 3, f * 3 + 3), face * 3);
        sources[face++] = sourceFaces[f];
        continue;
      }
      for (const tri of triangles) {
        for (let k = 0; k < 3; k++) {
          refined.set(point(tri[k]), face * 9 + k * 3);
          if (refinedIDs) refinedIDs[face * 3 + k] = vertexIDs[offsets[tri[k]] / 3];
        }
        sources[face++] = sourceFaces[f];
      }
    }
    // Revalidate the complete surface. Edge subdivision cannot turn an actual
    // hole into a closed mesh, so an unrelated open boundary still fails here.
    const checked = canonicalCutMesh({
      ...result,
      positions: refined,
      sourceFaces: sources,
      ...(refinedIDs ? { vertexIDs: refinedIDs } : {}),
    }, { cancelOppositeFaces });
    return {
      ...checked,
      collapsedFaces: collapsedFaces + checked.collapsedFaces,
      ...(cancelOppositeFaces
        ? { cancelledFaces: cancelledFaces + checked.cancelledFaces }
        : {}),
    };
  }
  vertexLinks(ids, kept, count);
  const counts = {
    collapsedFaces,
    ...(cancelOppositeFaces ? { cancelledFaces } : {}),
  };
  if (!collapsedFaces && !cancelledFaces) return { ...result, ...counts };
  const compact = new positions.constructor(kept.length * 9);
  kept.forEach((f, i) => compact.set(positions.subarray(f * 9, f * 9 + 9), i * 9));
  const compactIDs = vertexIDs ? new Uint32Array(kept.length * 3) : null;
  if (compactIDs) kept.forEach((f, i) => compactIDs.set(vertexIDs.subarray(f * 3, f * 3 + 3), i * 3));
  return {
    ...result,
    positions: compact,
    ...(compactIDs ? { vertexIDs: compactIDs } : {}),
    sourceFaces: Int32Array.from(kept, (f) => sourceFaces[f]),
    ...counts,
  };
}
