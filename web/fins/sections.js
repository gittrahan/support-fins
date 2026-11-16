// Layer sections for support diagnostics. Coordinates are millimetres in the
// seated print frame. This module measures geometry; it never repairs a mesh or
// supplies replacement geometry to the support engine.
import C from '../vendor/clipper-lib-6.4.2/clipper.js';

export const SECTION_SCALE = 1e6;
const S = SECTION_SCALE;
const key = (p) => `${p.X},${p.Y}`;
const equal = (a, b) => a.X === b.X && a.Y === b.Y;

// Clipper switches to big-integer predicates for large absolute coordinates.
// Translate by INTEGER grid units, with no scaling/precision change, so a small
// fin far from the origin costs the same as one at the origin. Wide polygons
// still get the library's full-range predicates when they actually need them.
function localFrame(...sets) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const paths of sets) for (const path of paths) for (const p of path) {
    x0 = Math.min(x0, p.X); x1 = Math.max(x1, p.X); y0 = Math.min(y0, p.Y); y1 = Math.max(y1, p.Y);
  }
  const x = Number.isFinite(x0) ? Math.round((x0 + x1) / 2) : 0;
  const y = Number.isFinite(y0) ? Math.round((y0 + y1) / 2) : 0;
  const move = (paths, sign) => paths.map((path) => path.map((p) => ({ X: p.X + sign * x, Y: p.Y + sign * y })));
  return { input: sets.map((paths) => move(paths, -1)), restore: (paths) => move(paths, 1) };
}

/** A union's connected filled components, each represented by outer + holes. */
export function components(paths) {
  if (!paths.length) return [];
  const frame = localFrame(paths);
  const c = new C.Clipper(), tree = new C.PolyTree();
  c.StrictlySimple = true;
  c.AddPaths(frame.input[0], C.PolyType.ptSubject, true);
  if (!c.Execute(C.ClipType.ctUnion, tree, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero)) {
    throw new Error('section union failed');
  }
  const out = [];
  const visit = (node) => {
    if (!node.IsHole() && node.Contour().length) {
      out.push(frame.restore([node.Contour(), ...node.Childs().filter((p) => p.IsHole()).map((p) => p.Contour())]));
    }
    for (const child of node.Childs()) visit(child);
  };
  visit(tree);
  return out;
}

export const union = (paths) => components(paths).flat();
export const area = (paths) => Math.abs(localFrame(paths).input[0].reduce((a, p) => a + C.Clipper.Area(p), 0)) / (S * S);

function boolean(a, b, operation) {
  if (!a.length) return [];
  if (!b.length) return operation === C.ClipType.ctDifference ? a : [];
  const frame = localFrame(a, b);
  const c = new C.Clipper(), out = [];
  c.AddPaths(frame.input[0], C.PolyType.ptSubject, true);
  c.AddPaths(frame.input[1], C.PolyType.ptClip, true);
  if (!c.Execute(operation, out, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero)) {
    throw new Error('section comparison failed');
  }
  return frame.restore(out);
}
export const intersection = (a, b) => boolean(a, b, C.ClipType.ctIntersection);
export const difference = (a, b) => boolean(a, b, C.ClipType.ctDifference);

/** Round offsets; 1 micrometre arc tolerance, independent of nozzle size. */
export function offset(paths, mm) {
  if (!paths.length) return [];
  if (!Number.isFinite(mm)) throw new Error('non-finite section offset');
  if (mm === 0) return paths;
  const frame = localFrame(paths);
  const c = new C.ClipperOffset(2, 0.001 * S), out = [];
  c.AddPaths(frame.input[0], C.JoinType.jtRound, C.EndType.etClosedPolygon);
  c.Execute(out, mm * S);
  return frame.restore(out);
}

export function bounds(paths) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const path of paths) for (const p of path) {
    b[0] = Math.min(b[0], p.X / S); b[1] = Math.min(b[1], p.Y / S);
    b[2] = Math.max(b[2], p.X / S); b[3] = Math.max(b[3], p.Y / S);
  }
  return b;
}

/** Index only face bounds; retain the caller's coordinates without rounding. */
export function sectionMesh(triangles, ranges = null) {
  const flat = typeof triangles[0] === 'number';
  const count = triangles.length / (flat ? 9 : 3);
  if (!Number.isInteger(count)) throw new Error('incomplete triangle soup');
  const vertex = flat ? (i) => [triangles[i * 3], triangles[i * 3 + 1], triangles[i * 3 + 2]] : (i) => triangles[i];
  const faces = [];
  let minZ = Infinity, maxZ = -Infinity;
  for (const [first, end] of ranges ?? [[0, count]]) {
    if (!Number.isInteger(first) || !Number.isInteger(end) || first < 0 || end > count || first > end) {
      throw new Error('invalid section triangle range');
    }
    for (let f = first; f < end; f++) {
      const a = vertex(f * 3), b = vertex(f * 3 + 1), c = vertex(f * 3 + 2);
      for (const p of [a, b, c]) if (p.length !== 3 || p.some((v) => !Number.isFinite(v) || Math.abs(v) > 1e6)) {
        throw new Error('section coordinate is non-finite or outside the supported range');
      }
      const lo = Math.min(a[2], b[2], c[2]), hi = Math.max(a[2], b[2], c[2]);
      minZ = Math.min(minZ, lo); maxZ = Math.max(maxZ, hi);
      if (lo !== hi) faces.push({ f, lo, hi });
    }
  }
  faces.sort((a, b) => a.lo - b.lo || a.f - b.f);
  return { vertex, faces, minZ, maxZ, active: new Set(), cursor: 0, lastZ: -Infinity };
}

/**
 * Exact plane/triangle intersections, rounded only at the polygon boundary to
 * 0.000001 mm. Shared edges are interpolated in the same direction, avoiding
 * different rounding of the same point on its two incident faces. Directed
 * closed trails preserve winding of cavities and overlapping shells. Open or
 * inconsistent contours are reported, never closed by connecting their ends.
 */
export function sectionAt(mesh, z) {
  if (!Number.isFinite(z)) throw new Error('non-finite section height');
  const edges = [], outgoing = new Map(), balance = new Map();
  // Layer scans are monotone. Retain only faces intersecting the current plane,
  // rather than revisiting every lower triangle on every higher layer. Arbitrary
  // callers may move down again; resetting the index must give the same section.
  if (z < mesh.lastZ) { mesh.active.clear(); mesh.cursor = 0; }
  mesh.lastZ = z;
  while (mesh.cursor < mesh.faces.length && mesh.faces[mesh.cursor].lo <= z) mesh.active.add(mesh.faces[mesh.cursor++]);
  for (const face of mesh.active) if (face.hi <= z) mesh.active.delete(face);
  for (const { f } of mesh.active) {
    const v = [mesh.vertex(f * 3), mesh.vertex(f * 3 + 1), mesh.vertex(f * 3 + 2)], points = [];
    for (let i = 0; i < 3; i++) {
      let a = v[i], b = v[(i + 1) % 3];
      if (a[2] > b[2]) [a, b] = [b, a];
      if (a[2] > z || b[2] <= z) continue;
      const t = (z - a[2]) / (b[2] - a[2]);
      points.push({ X: Math.round((a[0] + t * (b[0] - a[0])) * S),
        Y: Math.round((a[1] + t * (b[1] - a[1])) * S) });
    }
    if (points.length !== 2) throw new Error('invalid triangle-plane intersection');
    let [p, q] = points;
    if (equal(p, q)) continue;
    const [a, b, c] = v;
    const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    if ((q.X - p.X) * ny - (q.Y - p.Y) * nx > 0) [p, q] = [q, p];
    const from = key(p), to = key(q), edge = { p, q, to, used: false };
    if (!outgoing.has(from)) outgoing.set(from, []);
    outgoing.get(from).push(edge); edges.push(edge);
    balance.set(from, (balance.get(from) ?? 0) + 1);
    balance.set(to, (balance.get(to) ?? 0) - 1);
    if (edges.length > 100000) throw new Error('section segment limit exceeded');
  }
  if ([...balance.values()].some((n) => n !== 0)) throw new Error('open or inconsistently wound section');
  const paths = [];
  for (const first of edges) {
    if (first.used) continue;
    const path = [], start = key(first.p);
    let edge = first;
    do {
      edge.used = true; path.push(edge.p);
      if (edge.to === start) break;
      const list = outgoing.get(edge.to);
      while (list?.length && list[list.length - 1].used) list.pop();
      edge = list?.pop();
      if (!edge) throw new Error('unclosed section');
    } while (true);
    if (path.length >= 3) paths.push(path);
  }
  return union(paths);
}
