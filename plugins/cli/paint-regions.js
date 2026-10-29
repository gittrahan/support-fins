// Dissolve invisible source diagonals before clipping categorical paint. Doing
// this after projection can leave two differently rounded versions of the same
// diagonal and create an unrepresentable sliver. Work on the original coordinates
// and exact shared edges instead. Only convex, exactly coplanar unions qualify.
import { exactlyCoplanar, orientation } from './exact-geometry.js';

const key = (point) => point.join(',');

function merge(a, b) {
  if (!b.points.every((p) => exactlyCoplanar(...a.basis, p))) return null;
  const edges = new Map();
  for (const points of [a.points, b.points]) {
    for (let i = 0; i < points.length; i++) {
      const p = points[i], q = points[(i + 1) % points.length], u = key(p), v = key(q);
      if (edges.has(`${v};${u}`)) edges.delete(`${v};${u}`);
      else if (edges.has(`${u};${v}`)) return null;
      else edges.set(`${u};${v}`, { u, v, p });
    }
  }
  const next = new Map();
  for (const edge of edges.values()) {
    if (next.has(edge.u)) return null;
    next.set(edge.u, edge);
  }
  if (!next.size) return null;
  const start = next.keys().next().value, points = [];
  let current = start;
  do {
    const edge = next.get(current);
    if (!edge) return null;
    points.push(edge.p);
    next.delete(current);
    current = edge.v;
  } while (current !== start);
  if (next.size || points.length < 3) return null;
  const axes = [[0, 1], [1, 2], [2, 0]].find(([x, y]) => orientation(...a.basis, x, y) !== 0);
  if (!axes) return null;
  const winding = orientation(...a.basis, ...axes);
  for (let i = 0; i < points.length; i++) {
    if (orientation(points[i], points[(i + 1) % points.length], points[(i + 2) % points.length], ...axes) * winding < 0) {
      return null;
    }
  }
  return points;
}

/** Group the local source candidates only; no component-wide adjacency cache.
 * Different materials, seam/support states and recursive paint remain separate.
 * The returned face is a metadata/provenance hint, not a containment shortcut. */
export function uniformPaintRegions(candidates, source) {
  const entries = candidates.map((face) => {
    const s = source[face], uniform = s.attrs.channels.every((c) => c.leaves.length === 1);
    return {
      face,
      points: s.points,
      basis: s.points,
      state: uniform ? JSON.stringify(Object.entries(s.attrs.regions[0].attrs).sort(([a], [b]) => a.localeCompare(b))) : null,
    };
  });
  const parent = entries.map((_, i) => i), edges = new Map(), adjacent = [];
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].state === null) continue;
    const points = entries[i].points;
    for (let k = 0; k < points.length; k++) {
      const u = key(points[k]), v = key(points[(k + 1) % points.length]);
      if (!edges.has(`${v};${u}`)) {
        edges.set(`${u};${v}`, i);
        continue;
      }
      adjacent.push([edges.get(`${v};${u}`), i]);
    }
  }
  // A previously concave union can become convex after either neighbor grows.
  // Reconsider local adjacencies; each successful pass reduces the group count.
  let changed;
  do {
    changed = false;
    for (const [left, right] of adjacent) {
      const a = find(left), b = find(right);
      if (a === b || entries[a].state !== entries[b].state) continue;
      const joined = merge(entries[a], entries[b]);
      if (joined) {
        entries[a] = { ...entries[a], points: joined };
        parent[b] = a;
        changed = true;
      }
    }
  } while (changed);
  return entries.filter((_, i) => find(i) === i);
}
