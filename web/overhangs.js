/**
 * Overhang analysis, in print space (Z up, mm, bed plane at z = 0).
 *
 * Deliberately mirrors prototype/spike_overhangs.py constant-for-constant, so the
 * browser and the Python probes report the same numbers on the same file. If one
 * of these values changes, change it in both places.
 *
 * Two-stage by design, and the split is what makes rotation cheap:
 *   buildTopology()  welds vertices and finds face adjacency. Expensive, but BOTH
 *                    are rotation-invariant -- turning a part cannot change which
 *                    triangles touch -- so this runs ONCE per loaded file.
 *   analyze()        applies an orientation, re-seats the part on the plate, and
 *                    re-classifies. Linear and allocation-free, so it can run on
 *                    every frame of a gizmo drag.
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

/** Column-major identity, matching THREE.Matrix3.elements. */
export const IDENTITY3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

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

  // float64: normals are compared against a threshold that real parts land
  // exactly on, and float32 rounding alone can flip a 45-degree chamfer.
  const nrm = new Float64Array(nFaces * 3);
  const area = new Float64Array(nFaces);

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

    if (len > 1e-12) {
      nrm[f * 3] = px / len;
      nrm[f * 3 + 1] = py / len;
      nrm[f * 3 + 2] = pz / len;
    }
    area[f] = 0.5 * len;

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
    pos, nFaces, nrm, area,
    adjA: Int32Array.from(adjA),
    adjB: Int32Array.from(adjB),
    vertexCount: weld.size,
    edgeCount: firstFace.size,
    // scratch, reused across analyze() calls so a gizmo drag allocates nothing
    _zr: new Float64Array(nFaces * 3),
    _parent: new Int32Array(nFaces),
    _over: new Uint8Array(nFaces),
    _kept: new Uint8Array(nFaces),
    _onBed: new Uint8Array(nFaces),
  };
}

/**
 * Flag overhang faces and cluster them into regions, for the part held in
 * orientation `rot`.
 *
 * @param rot  9-element COLUMN-major rotation, i.e. THREE.Matrix3.elements, so
 *             the rotated Z of a point is rot[2]*x + rot[5]*y + rot[8]*z.
 *
 * The part is re-seated on the plate as part of the same pass: bounds are taken
 * in the rotated frame and everything is measured relative to the lowest point,
 * so "bed contact" means contact after the rotation, not before it.
 */
export function analyze(topo, thresholdDeg = DEFAULT_THRESHOLD, rot = IDENTITY3) {
  const { pos, nFaces, nrm, area, adjA, adjB } = topo;
  const cut = -(Math.cos((thresholdDeg * Math.PI) / 180) + ANGLE_EPS);

  const zr = topo._zr;
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  for (let v = 0, p = 0; v < nFaces * 3; v++, p += 3) {
    const x = pos[p], y = pos[p + 1], z = pos[p + 2];
    const xr = rot[0] * x + rot[3] * y + rot[6] * z;
    const yr = rot[1] * x + rot[4] * y + rot[7] * z;
    const zz = rot[2] * x + rot[5] * y + rot[8] * z;
    zr[v] = zz;
    if (xr < minX) minX = xr; if (xr > maxX) maxX = xr;
    if (yr < minY) minY = yr; if (yr > maxY) maxY = yr;
    if (zz < minZ) minZ = zz; if (zz > maxZ) maxZ = zz;
  }

  const onBed = topo._onBed.fill(0);
  const over = topo._over.fill(0);
  let bedArea = 0, overArea = 0, overFaceCount = 0;

  for (let f = 0; f < nFaces; f++) {
    // face height above the plate, after re-seating on the lowest point
    const h = Math.max(zr[f * 3], zr[f * 3 + 1], zr[f * 3 + 2]) - minZ;
    if (h < BED_EPS) { onBed[f] = 1; bedArea += area[f]; continue; }

    const nzr = rot[2] * nrm[f * 3] + rot[5] * nrm[f * 3 + 1] + rot[8] * nrm[f * 3 + 2];
    if (nzr < cut) { over[f] = 1; overArea += area[f]; overFaceCount++; }
  }

  // union-find over adjacent overhang faces
  const parent = topo._parent;
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
  const kept = topo._kept.fill(0);
  for (const g of regions) for (const f of g.faces) kept[f] = 1;

  return {
    over, kept, onBed, regions,
    rawRegionCount: raw.length,
    overArea, bedArea, overFaceCount,
    // where the rotated part sits, so the caller can drop it onto the plate
    offset: { x: -(minX + maxX) / 2, y: -(minY + maxY) / 2, z: -minZ },
    size: { x: maxX - minX, y: maxY - minY, z: maxZ - minZ },
  };
}
