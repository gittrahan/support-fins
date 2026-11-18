// Preserve a validated Boolean solid's coordinates and vertex identity through
// the float32 JS mesh binding. Only generated material parts use this path.
export class SupportMeshError extends Error {}

function collinear(a, b, c) {
  const u = b.map((v, k) => v - a[k]), v = c.map((v, k) => v - a[k]);
  for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) {
    const x = u[i] * v[j], y = u[j] * v[i];
    if (Math.abs(x - y) > 8 * Number.EPSILON * (Math.abs(x) + Math.abs(y))) return false;
  }
  // An exact predicate on the saved binary coordinates: never treat a thin
  // triangle as collinear merely because its area is below a chosen tolerance.
  const bytes = new DataView(new ArrayBuffer(8));
  const values = [...a, ...b, ...c].map((n) => {
    bytes.setFloat64(0, n);
    const bits = bytes.getBigUint64(0), exponent = Number((bits >> 52n) & 2047n);
    const fraction = bits & ((1n << 52n) - 1n);
    return { value: (bits >> 63n ? -1n : 1n) * (fraction + (exponent ? 1n << 52n : 0n)),
      exponent: exponent ? exponent - 1075 : -1074 };
  });
  const exponent = Math.min(...values.map((v) => v.exponent));
  const p = values.map((v) => v.value << BigInt(v.exponent - exponent));
  const x = [0, 1, 2].map((k) => p[k + 3] - p[k]), y = [0, 1, 2].map((k) => p[k + 6] - p[k]);
  return [[0, 1], [0, 2], [1, 2]].every(([i, j]) => x[i] * y[j] === x[j] * y[i]);
}

function triangulate(vertices, faces) {
  const edges = new Map(), incident = new Map(), key = (a, b) => a < b ? `${a}/${b}` : `${b}/${a}`;
  const visit = (face, fn) => { for (let k = 0; k < 3; k++) fn(key(face[k], face[(k + 1) % 3])); };
  const add = (face, index) => {
    visit(face, (k) => {
      if (!edges.has(k)) edges.set(k, new Set());
      edges.get(k).add(index);
    });
    for (const v of face) {
      if (!incident.has(v)) incident.set(v, new Set());
      incident.get(v).add(index);
    }
  };
  const remove = (face, index) => {
    visit(face, (k) => {
      edges.get(k).delete(index);
      if (!edges.get(k).size) edges.delete(k);
    });
    for (const v of face) incident.get(v).delete(index);
  };
  faces.forEach(add);
  for (let i = 0; i < faces.length; i++) {
    const f = faces[i];
    if (!f) continue;
    if (!collinear(...f.map((v) => vertices[v]))) continue;
    const same = (a, b) => vertices[a].every((n, k) => n === vertices[b][k]);
    const coincident = [[f[0], f[1]], [f[1], f[2]], [f[2], f[0]]].find(([a, b]) => same(a, b));
    if (coincident) {
      // A zero-length output edge can be contracted without moving any point.
      // Require the manifold link condition, so separate touching shells are
      // never welded together by a global coordinate merge.
      const [a, b] = coincident, neighbors = edges.get(key(a, b));
      const adjacent = (v) => new Set([...incident.get(v)].flatMap((t) => faces[t]).filter((x) => x !== v));
      const na = adjacent(a), nb = adjacent(b), common = [...na].filter((v) => nb.has(v));
      const opposite = neighbors && new Set([...neighbors].flatMap((t) => faces[t]).filter((v) => v !== a && v !== b));
      if (neighbors?.size !== 2 || opposite.size !== 2 || common.length !== 2 || common.some((v) => !opposite.has(v))) {
        throw new SupportMeshError('support material cannot preserve a collapsed edge');
      }
      const changed = [...new Set([...incident.get(a), ...incident.get(b)])];
      for (const t of changed) remove(faces[t], t);
      for (const t of changed) {
        const next = faces[t].map((v) => v === b ? a : v);
        faces[t] = new Set(next).size === 3 ? next : null;
        if (faces[t]) add(faces[t], t);
      }
      continue;
    }
    // Three distinct collinear vertices: flip the long edge against its one
    // neighboring triangle. The middle vertex splits the same planar face;
    // no vertex, boundary, material region or filled area moves. This is output
    // triangulation, not input repair or geometric simplification.
    const span = [0, 1, 2].map((k) => Math.max(...f.map((v) => vertices[v][k])) - Math.min(...f.map((v) => vertices[v][k])));
    const axis = span.indexOf(Math.max(...span)), sorted = [...f].sort((a, b) => vertices[a][axis] - vertices[b][axis]);
    const middle = sorted[1], at = f.indexOf(middle), b = f[(at + 1) % 3], c = f[(at + 2) % 3];
    if (!(vertices[sorted[0]][axis] < vertices[middle][axis] && vertices[middle][axis] < vertices[sorted[2]][axis])) {
      throw new SupportMeshError('support material contains a collapsed edge');
    }
    const neighbors = edges.get(key(b, c));
    if (neighbors?.size !== 2) throw new SupportMeshError('support material contains an open boundary');
    const j = [...neighbors].find((n) => n !== i), other = faces[j];
    const start = other.indexOf(c), d = other[(start + 2) % 3];
    if (start < 0 || other[(start + 1) % 3] !== b || edges.has(key(middle, d))) {
      throw new SupportMeshError('support material cannot preserve a collinear face');
    }
    const left = [middle, b, d], right = [middle, d, c];
    if (collinear(...left.map((v) => vertices[v])) || collinear(...right.map((v) => vertices[v]))) {
      throw new SupportMeshError('support material cannot preserve a collinear face');
    }
    remove(f, i); remove(other, j);
    faces[i] = left; faces[j] = right;
    add(left, i); add(right, j);
  }
  if ([...edges.values()].some((e) => e.size !== 2)) throw new SupportMeshError('support material contains an open boundary');
  return faces.filter(Boolean);
}

export function supportMaterialMesh(solid) {
  const points = [];
  const tagged = solid.setProperties(1, (props, position) => {
    props[0] = points.length;
    points.push(position);
  });
  try {
    if (points.length > 2 ** 24) throw new SupportMeshError('support material mesh exceeds exact vertex indexing');
    const { vertProperties: p, triVerts, numProp, mergeFromVert = [], mergeToVert = [] } = tagged.getMesh();
    const parent = new Map(Array.from(mergeFromVert, (v, i) => [v, mergeToVert[i]]));
    const root = (v) => { while (parent.has(v)) v = parent.get(v); return v; };
    const vertices = Array.from({ length: p.length / numProp }, (_, v) => {
      const id = p[v * numProp + 3];
      if (!Number.isInteger(id) || !points[id]?.every(Number.isFinite)) throw new SupportMeshError('support material vertex identity was lost');
      return points[id];
    });
    const faces = Array.from({ length: triVerts.length / 3 }, (_, t) => Array.from(triVerts.slice(t * 3, t * 3 + 3), root));
    const vertexIds = triangulate(vertices, faces).flat();
    return { triangles: vertexIds.map((id) => vertices[id].slice()), vertexIds };
  } finally { tagged.delete(); }
}
