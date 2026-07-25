/**
 * Overhang analysis, in print space (Z up, mm, bed plane at z = 0).
 *
 * Deliberately mirrors prototype/spike_overhangs.py constant-for-constant, so the
 * browser and the Python probes report the same numbers on the same file. If one
 * of these values changes, change it in both places.
 *
 * Two-stage by design: buildTopology() does the expensive vertex weld + edge
 * adjacency ONCE per loaded mesh, analyze() re-runs the cheap part every time the
 * threshold slider moves.
 */

export const BED_EPS = 0.35;          // mm; a face this close to the plate IS the bottom
export const MIN_REGION_AREA = 12.0;  // mm^2; ignore slivers
export const DEFAULT_THRESHOLD = 45;  // degrees from the plate

/**
 * A face sitting EXACTLY on the threshold is self-supporting and must not be
 * flagged. This matters far more than it sounds: 45 degrees is the canonical
 * designed-in chamfer angle, so real parts carry thousands of faces landing
 * exactly on the boundary, and the comparison must not decide them by float
 * noise. On one Voron part the difference was only 45 faces but 318 mm^2 -- a
 * 2.1x overstatement of overhang area, and fins on a part that needs none.
 */
export const ANGLE_EPS = 1e-4;        // ~0.008 degrees of slack

/** Quantise to 1e-3 mm so vertices shared between triangles weld together. */
const key3 = (x, y, z) =>
  `${Math.round(x * 1000)},${Math.round(y * 1000)},${Math.round(z * 1000)}`;

/**
 * Per-face geometry + face adjacency for a non-indexed STL BufferGeometry.
 * STL is triangle soup: every triangle carries its own copy of each vertex, so
 * adjacency only exists after welding.
 */
export function buildTopology(geometry) {
  const pos = geometry.getAttribute('position').array;
  const nFaces = pos.length / 9;

  // float64: nz is compared against a threshold that real parts land exactly on,
  // and float32 rounding alone is enough to flip a 45-degree chamfer either way.
  const nz = new Float64Array(nFaces);
  const area = new Float64Array(nFaces);
  const maxZ = new Float32Array(nFaces);

  const weld = new Map();
  const vid = new Int32Array(nFaces * 3);

  for (let f = 0; f < nFaces; f++) {
    const o = f * 9;
    const ax = pos[o], ay = pos[o + 1], az = pos[o + 2];
    const bx = pos[o + 3], by = pos[o + 4], bz = pos[o + 5];
    const cx = pos[o + 6], cy = pos[o + 7], cz = pos[o + 8];

    // Face normal from the winding, NOT from the STL's stored normal attribute --
    // exported normals are routinely zero-length or inconsistent, and a wrong
    // normal here silently mislabels an overhang.
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const px = uy * vz - uz * vy;
    const py = uz * vx - ux * vz;
    const pz = ux * vy - uy * vx;
    const len = Math.hypot(px, py, pz);

    nz[f] = len > 1e-12 ? pz / len : 0;
    area[f] = 0.5 * len;
    maxZ[f] = Math.max(az, bz, cz);

    for (let i = 0; i < 3; i++) {
      const k = key3(pos[o + i * 3], pos[o + i * 3 + 1], pos[o + i * 3 + 2]);
      let id = weld.get(k);
      if (id === undefined) weld.set(k, (id = weld.size));
      vid[f * 3 + i] = id;
    }
  }

  // face adjacency via shared welded edges
  const firstFace = new Map();
  const adjA = [], adjB = [];
  for (let f = 0; f < nFaces; f++) {
    for (let i = 0; i < 3; i++) {
      const a = vid[f * 3 + i], b = vid[f * 3 + ((i + 1) % 3)];
      const k = a < b ? `${a}_${b}` : `${b}_${a}`;
      const prev = firstFace.get(k);
      if (prev === undefined) firstFace.set(k, f);
      else { adjA.push(prev); adjB.push(f); }
    }
  }

  return {
    nFaces, nz, area, maxZ,
    adjA: Int32Array.from(adjA),
    adjB: Int32Array.from(adjB),
    vertexCount: weld.size,
    edgeCount: firstFace.size,
  };
}

/**
 * Flag overhang faces and cluster them into regions.
 * `thresholdDeg` is the surface angle from the plate below which a face needs
 * support -- 45 by default, the same test as the Python probe (n_z < -cos45).
 */
export function analyze(topo, thresholdDeg = DEFAULT_THRESHOLD) {
  const { nFaces, nz, area, maxZ, adjA, adjB } = topo;
  const cut = -(Math.cos((thresholdDeg * Math.PI) / 180) + ANGLE_EPS);

  const onBed = new Uint8Array(nFaces);
  const over = new Uint8Array(nFaces);
  let bedArea = 0, overArea = 0;

  for (let f = 0; f < nFaces; f++) {
    if (maxZ[f] < BED_EPS) { onBed[f] = 1; bedArea += area[f]; continue; }
    if (nz[f] < cut) { over[f] = 1; overArea += area[f]; }
  }

  // union-find over adjacent overhang faces
  const parent = new Int32Array(nFaces);
  for (let f = 0; f < nFaces; f++) parent[f] = f;
  const find = (x) => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]];
    return x;
  };
  for (let e = 0; e < adjA.length; e++) {
    const a = adjA[e], b = adjB[e];
    if (!over[a] || !over[b]) continue;
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  const byRoot = new Map();
  for (let f = 0; f < nFaces; f++) {
    if (!over[f]) continue;
    const r = find(f);
    const g = byRoot.get(r);
    if (g) { g.faces.push(f); g.area += area[f]; }
    else byRoot.set(r, { faces: [f], area: area[f] });
  }

  const raw = [...byRoot.values()];
  const regions = raw
    .filter((g) => g.area >= MIN_REGION_AREA)
    .sort((a, b) => b.area - a.area);

  // faces that survived the region-area filter, for shading
  const kept = new Uint8Array(nFaces);
  for (const g of regions) for (const f of g.faces) kept[f] = 1;

  return {
    over, kept, onBed, regions,
    rawRegionCount: raw.length,
    overArea, bedArea,
    overFaceCount: over.reduce((s, v) => s + v, 0),
  };
}
