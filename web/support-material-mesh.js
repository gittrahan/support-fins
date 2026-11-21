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
      // Validate the resulting local boundary; separate touching shells are
      // never welded together by a global coordinate merge.
      const [a, b] = coincident, neighbors = edges.get(key(a, b));
      const opposite = neighbors && new Set([...neighbors].flatMap((t) => faces[t]).filter((v) => v !== a && v !== b));
      if (neighbors?.size !== 2 || opposite.size !== 2) {
        throw new SupportMeshError('support material cannot preserve a collapsed edge');
      }
      const changed = [...new Set([...incident.get(a), ...incident.get(b)])];
      const replacement = new Map(), coincidentFaces = new Map();
      for (const t of changed) {
        const next = faces[t].map((v) => v === b ? a : v);
        if (new Set(next).size !== 3) { replacement.set(t, null); continue; }
        const k = [...next].sort((a, b) => a - b).join('/');
        const other = coincidentFaces.get(k);
        if (other !== undefined) {
          const previous = replacement.get(other), start = previous.indexOf(next[0]);
          if (previous[(start + 1) % 3] !== next[2] || previous[(start + 2) % 3] !== next[1]) {
            throw new SupportMeshError('support material contains duplicate oriented faces');
          }
          // Exactly coincident, opposite faces bound a zero-thickness generated
          // sheet. Their signed boundaries cancel; no point or filled region moves.
          replacement.set(other, null); replacement.set(t, null); coincidentFaces.delete(k);
        } else { replacement.set(t, next); coincidentFaces.set(k, t); }
      }
      const affected = new Set();
      for (const t of changed) { visit(faces[t], k => affected.add(k)); remove(faces[t], t); }
      for (const [t, next] of replacement) {
        faces[t] = next;
        if (next) { add(next, t); visit(next, k => affected.add(k)); }
      }
      if ([...affected].some(k => edges.has(k) && edges.get(k).size !== 2)) {
        throw new SupportMeshError('support material cannot preserve a collapsed edge');
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
    if (start < 0 || other[(start + 1) % 3] !== b) {
      throw new SupportMeshError('support material cannot preserve a collinear face');
    }
    const left = [middle, b, d], right = [middle, d, c];
    if (collinear(...left.map((v) => vertices[v])) || collinear(...right.map((v) => vertices[v]))) {
      throw new SupportMeshError('support material cannot preserve a collinear face');
    }
    let replacement = [left, right];
    if (edges.has(key(middle, d))) {
      // This diagonal already belongs to another surface patch. Subdivide the
      // new diagonal instead of welding two separate topological edges together.
      const point = vertices[middle].map((n, k) => n + (vertices[d][k] - n) / 2);
      const mid = vertices.length;
      vertices.push(point);
      replacement = [[middle, b, mid], [mid, b, d], [middle, mid, c], [mid, d, c]];
      if (replacement.some(t => collinear(...t.map(v => vertices[v])))) {
        throw new SupportMeshError('support material diagonal cannot be represented');
      }
    }
    remove(f, i); remove(other, j);
    for (const [n, face] of replacement.entries()) {
      const t = n === 0 ? i : n === 1 ? j : faces.length;
      faces[t] = face; add(face, t);
    }
  }
  for (const [edge, ts] of edges) {
    if (ts.size !== 2) throw new SupportMeshError('support material contains an open boundary');
    const [a, b] = edge.split('/').map(Number), [t, u] = [...ts];
    const direction = f => f[(f.indexOf(a) + 1) % 3] === b;
    if (direction(faces[t]) === direction(faces[u])) throw new SupportMeshError('support material winding is inconsistent');
  }
  const result = faces.filter(Boolean);
  if (result.some(f => collinear(...f.map(v => vertices[v])))) {
    throw new SupportMeshError('support material contains a degenerate face');
  }
  // A collapsed sheet can leave shells touching at one point. Give each
  // disconnected vertex fan its own identity, preserving identical coordinates.
  const around = new Map(), across = new Map();
  result.forEach((face, t) => face.forEach((v, i) => {
    if (!around.has(v)) around.set(v, []);
    around.get(v).push(t);
    const k = key(v, face[(i + 1) % 3]);
    if (!across.has(k)) across.set(k, []);
    across.get(k).push(t);
  }));
  const original = result.map(f => f.slice());
  for (const [v, ts] of around) {
    const remaining = new Set(ts); let first = true;
    while (remaining.size) {
      const pending = [remaining.values().next().value], fan = [];
      while (pending.length) {
        const t = pending.pop();
        if (!remaining.delete(t)) continue;
        fan.push(t);
        for (const n of original[t]) if (n !== v) pending.push(...across.get(key(v, n)));
      }
      if (!first) {
        const id = vertices.length; vertices.push(vertices[v].slice());
        for (const t of fan) result[t] = result[t].map(n => n === v ? id : n);
      }
      first = false;
    }
  }
  return result;
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
