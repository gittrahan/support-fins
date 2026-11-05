/** Procedural native-Orca inputs; no Support Fins generation is used.
 * Curved columns follow the bent-arm idea in tests/sway_curved.test.js
 * (Support Fins contributors, MIT), rebuilt as indexed closed shells.
 */
export { REFERENCE } from "./reference.js";
export const PROFILE_NAMES = Object.freeze({
  machine: "Bambu Lab H2C 0.4 nozzle",
  process: "0.20mm Standard @BBL H2C",
  filament: "Bambu PETG Basic @BBL H2C 0.4 nozzle",
});
export const OVERRIDES = Object.freeze({
  enable_support: "1",
  support_type: "fin",
  fin_support_style: "painted_shape",
  print_sequence: "by layer",
  layer_height: "0.2",
  initial_layer_print_height: "0.2",
  raft_layers: "0",
});
export const CASES = Object.freeze([
  {
    id: "flat",
    description: "Vertical side: contacts, body and plate attachment.",
  },
  {
    id: "convex",
    description: "Outward-curving side: contact following and connectivity.",
  },
  {
    id: "concave",
    description: "Inward-curving side: recess clearance and connectivity.",
  },
  {
    id: "leaning",
    description: "Narrow-base column leaning 30 degrees: plate connection.",
  },
  {
    id: "crease",
    description: "Three-millimetre painted strip crossing a 90-degree crease.",
  },
  {
    id: "opposing",
    description:
      "Opposing painted sides and a nearby unpainted obstacle: clipping and merged feet.",
  },
]);

// Counterclockwise perimeter, with explicit vertices at paint-strip boundaries.
const RING = [[-5, -10], [5, -10], [5, -1.5], [5, 1.5], [5, 10], [-5, 10], [
  -5,
  1.5,
], [-5, -1.5]];
function column(
  id,
  { shift = () => 0, height = 60, width = 1, x = 0, paint = () => false } = {},
) {
  const vertices = [], faces = [], painted = [];
  const n = RING.length, levels = height / 2;
  for (let k = 0; k <= levels; k++) {
    for (const [u, v] of RING) {
      vertices.push([x + width * u + shift(2 * k), v, 2 * k]);
    }
  }
  const add = (a, b, c, yes = false) => {
    faces.push([a, b, c]);
    if (yes) painted.push(faces.length - 1);
  };
  for (let k = 0; k < levels; k++) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n,
        a = k * n + i,
        b = k * n + j,
        c = (k + 1) * n + j,
        d = (k + 1) * n + i;
      const yes = paint(i, 2 * k + 1);
      add(a, b, c, yes);
      add(a, c, d, yes);
    }
  }
  for (const [k, top] of [[0, false], [levels, true]]) {
    const center = vertices.length;
    vertices.push([x + shift(k * 2), 0, k * 2]);
    for (let i = 0; i < n; i++) {
      const a = k * n + i, b = k * n + (i + 1) % n;
      if (top) add(center, a, b);
      else add(center, b, a);
    }
  }
  return {
    name: id,
    vertices,
    faces,
    painted,
    transform: [1, 0, 0, 0, 1, 0, 0, 0, 1, 150, 150, 0],
  };
}
export function fixture(id, { unpainted = false, transformed = false } = {}) {
  const spec = CASES.find((c) => c.id === id);
  if (!spec) throw new Error(`unknown case: ${id}`);
  const band = (z) => z >= 40 && z < 56;
  const opt = { paint: (side, z) => side === 2 && band(z) };
  // On the painted +X side, a convex surface bulges outward from its chord.
  if (id === "convex") opt.shift = (z) => 40 * (z / 60) - 20 * (z / 60) ** 2;
  if (id === "concave") opt.shift = (z) => 20 * (z / 60) ** 2;
  if (id === "leaning") opt.shift = (z) => Math.tan(Math.PI / 6) * z;
  if (id === "crease") {
    // Adjacent side strips share the (5,10,z) crease. Alter the ring locally
    // below rather than painting the whole long face.
    opt.paint = (side, z) => (side === 3 || side === 4) && band(z);
  }
  if (id === "opposing") {
    opt.paint = (side, z) => (side === 2 || side === 6) && band(z);
  }
  const objects = [column(id, opt)];
  if (id === "crease") {
    // The last 1.5 mm on either side of the corner is a connected 3 mm strip.
    for (const v of objects[0].vertices) {
      if (v[0] === -5) v[0] = 3.5;
      if (v[1] === 1.5) v[1] = 8.5;
      if (v[1] === -1.5) v[1] = 0;
    }
    // Cap centres must remain interior after changing the cross-section.
    for (const v of objects[0].vertices) if (v[0] === 0) v[0] = 4.25;
  }
  if (id === "opposing") {
    objects.push(column("obstacle", { x: 10, height: 30, width: 0.4 }));
  }
  if (unpainted) { for (const o of objects) o.painted = []; }
  if (transformed) {
    for (const o of objects) {
      o.transform = [0, 1, 0, -1, 0, 0, 0, 0, 1, 175, 125, 0];
    }
  }
  const result = {
    ...spec,
    id: `${id}${unpainted ? "-unpainted" : ""}${transformed ? "-rotated" : ""}`,
    objects,
    expectation: unpainted
      ? "No fins: no side-paint intent."
      : "Inspect native contacts, plate reachability and clearance; fin count is not prescribed.",
  };
  for (const object of objects) validateMesh(object);
  return result;
}

/** Reject invalid fixtures; this validator never repairs geometry. */
export function validateMesh({ vertices, faces, painted, transform }) {
  if (
    !vertices.length || !faces.length ||
    vertices.some((v) => v.length !== 3 || v.some((x) => !Number.isFinite(x)))
  ) {
    throw new Error("invalid vertices");
  }
  if (transform.length !== 12 || transform.some((x) => !Number.isFinite(x))) {
    throw new Error("invalid transform");
  }
  const edges = new Map();
  let volume6 = 0;
  for (const f of faces) {
    if (
      f.length !== 3 || new Set(f).size !== 3 ||
      f.some((i) => !Number.isInteger(i) || i < 0 || i >= vertices.length)
    ) throw new Error("invalid face");
    const [a, b, c] = f.map((i) => vertices[i]);
    const ab = b.map((x, i) => x - a[i]), ac = c.map((x, i) => x - a[i]);
    const cross = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    if (Math.hypot(...cross) < 1e-10) throw new Error("degenerate face");
    volume6 += a[0] * (b[1] * c[2] - b[2] * c[1]) +
      a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
    for (let k = 0; k < 3; k++) {
      const a = f[k],
        b = f[(k + 1) % 3],
        key = `${Math.min(a, b)},${Math.max(a, b)}`;
      const e = edges.get(key) || [0, 0];
      e[0]++;
      e[1] += a < b ? 1 : -1;
      edges.set(key, e);
    }
  }
  if ([...edges.values()].some(([n, d]) => n !== 2 || d !== 0)) {
    throw new Error("open or inconsistently wound mesh");
  }
  if (!(volume6 > 0)) throw new Error("nonpositive volume");
  if (
    new Set(painted).size !== painted.length ||
    painted.some((i) => !Number.isInteger(i) || i < 0 || i >= faces.length)
  ) throw new Error("invalid paint face");
  return {
    vertices: vertices.length,
    triangles: faces.length,
    paintedTriangles: painted.length,
    volume: volume6 / 6,
    bounds: [0, 1, 2].map(
      (i) => [
        Math.min(...vertices.map((v) => v[i])),
        Math.max(...vertices.map((v) => v[i])),
      ],
    ),
  };
}
