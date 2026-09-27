/**
 * Pieces of a part: the closed shells a mesh is made of, and which of them start
 * in mid-air. Separate from overhangs.js, which classifies faces (and mirrors
 * prototype/spike_overhangs.py); this is about whole pieces, and has no Python
 * twin.
 */
import { BED_EPS, IDENTITY3 } from './overhangs.js';

/**
 * Pieces of the part that start in mid-air.
 *
 * A mesh can hold more than one closed piece: a multi-body export, a print-in-
 * place assembly, or a cut that went clean through (a bore wider than the wall
 * around it). A piece that neither touches the plate nor sits on another piece
 * stands on its supports alone -- and is nearly always a modelling slip (a
 * bore wider than the wall it cuts). The overhang pass cannot see this: a
 * severed piece's lowest surface can be a hole's ceiling, which it rightly
 * leaves to bridge, so the piece would hang in air. It is checked here, once,
 * for the readout to say out loud.
 *
 * A piece counts as resting when a ray straight down from its lowest point meets
 * another piece within RESTS_ON (a stacked print-in-place part), or when it
 * reaches the plate (BED_EPS).
 *
 * @returns [{ faces, lowest: [x, y, z], drop }] in the seated frame of `result`,
 *          `drop` = how far the lowest point hangs over whatever is below it
 *          (Infinity over the bare plate is reported as its height).
 */
export function floatingPieces(topo, result, rot = IDENTITY3) {
  const { pos, nFaces, adjA, adjB } = topo;
  const RESTS_ON = 0.3;
  const off = result.offset;
  const parent = new Int32Array(nFaces);
  for (let f = 0; f < nFaces; f++) parent[f] = f;
  const find = (x) => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]];
    return x;
  };
  for (let e = 0; e < adjA.length; e++) {
    const ra = find(adjA[e]), rb = find(adjB[e]);
    if (ra !== rb) parent[ra] = rb;
  }
  // Seat every vertex once: the lookup below reads each triangle many times.
  const P = new Float64Array(nFaces * 9);
  for (let p = 0; p < nFaces * 9; p += 3) {
    P[p] = rot[0] * pos[p] + rot[3] * pos[p + 1] + rot[6] * pos[p + 2] + off.x;
    P[p + 1] = rot[1] * pos[p] + rot[4] * pos[p + 1] + rot[7] * pos[p + 2] + off.y;
    P[p + 2] = rot[2] * pos[p] + rot[5] * pos[p + 1] + rot[8] * pos[p + 2] + off.z;
  }
  const root = new Int32Array(nFaces);
  const pieces = new Map();
  for (let f = 0; f < nFaces; f++) {
    const r = (root[f] = find(f));
    let g = pieces.get(r);
    if (!g) pieces.set(r, (g = { faces: 0, lowest: null, vol: 0 }));
    g.faces++;
    const t = f * 9;
    for (let i = 0; i < 9; i += 3) {
      if (!g.lowest || P[t + i + 2] < g.lowest[2]) g.lowest = [P[t + i], P[t + i + 1], P[t + i + 2]];
    }
    g.vol += P[t] * (P[t + 4] * P[t + 8] - P[t + 5] * P[t + 7])
           - P[t + 1] * (P[t + 3] * P[t + 8] - P[t + 5] * P[t + 6])
           + P[t + 2] * (P[t + 3] * P[t + 7] - P[t + 4] * P[t + 6]);
  }
  if (pieces.size < 2) return [];

  // Only an OUTWARD shell is a piece. An inward one (negative volume) is the
  // wall of a sealed cavity inside another piece -- a hollow part's void -- and
  // its lowest point is that void's floor, not something standing in air.
  const lifted = [];
  for (const [r, g] of pieces) {
    if (g.vol > 0 && g.lowest[2] >= BED_EPS) lifted.push([r, g]);
  }
  if (!lifted.length) return [];

  // Triangles bucketed by plan footprint, so each lifted piece tests only the
  // few under its lowest point instead of every triangle in the part (8 s at
  // 800 pieces the old way, on every rebuild).
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let p = 0; p < P.length; p += 3) {
    if (P[p] < x0) x0 = P[p]; if (P[p] > x1) x1 = P[p];
    if (P[p + 1] < y0) y0 = P[p + 1]; if (P[p + 1] > y1) y1 = P[p + 1];
  }
  const G = Math.max(1, Math.min(512, Math.round(Math.sqrt(nFaces / 4))));
  const cw = Math.max(1e-6, (x1 - x0) / G), ch = Math.max(1e-6, (y1 - y0) / G);
  const cx = (x) => Math.min(G - 1, Math.max(0, Math.floor((x - x0) / cw)));
  const cy = (y) => Math.min(G - 1, Math.max(0, Math.floor((y - y0) / ch)));
  const cells = new Map();
  for (let f = 0; f < nFaces; f++) {
    const t = f * 9;
    const i0 = cx(Math.min(P[t], P[t + 3], P[t + 6])), i1 = cx(Math.max(P[t], P[t + 3], P[t + 6]));
    const j0 = cy(Math.min(P[t + 1], P[t + 4], P[t + 7])), j1 = cy(Math.max(P[t + 1], P[t + 4], P[t + 7]));
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = i * G + j;
        let c = cells.get(k);
        if (!c) cells.set(k, (c = []));
        c.push(f);
      }
    }
  }

  const out = [];
  for (const [r, g] of lifted) {
    const [px, py, pz] = g.lowest;
    // highest surface of ANOTHER piece straight below the lowest point
    let below = -Infinity;
    for (const f of cells.get(cx(px) * G + cy(py)) ?? []) {
      if (root[f] === r) continue;
      const t = f * 9;
      const ax = P[t], ay = P[t + 1], bx = P[t + 3], by = P[t + 4], qx = P[t + 6], qy = P[t + 7];
      const d = (by - qy) * (ax - qx) + (qx - bx) * (ay - qy);
      if (Math.abs(d) < 1e-12) continue;
      const l1 = ((by - qy) * (px - qx) + (qx - bx) * (py - qy)) / d;
      const l2 = ((qy - ay) * (px - qx) + (ax - qx) * (py - qy)) / d;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
      const z = l1 * P[t + 2] + l2 * P[t + 5] + l3 * P[t + 8];
      if (z <= pz + 1e-6 && z > below) below = z;
    }
    const drop = below === -Infinity ? pz : pz - below;
    if (drop > RESTS_ON) out.push({ faces: g.faces, lowest: g.lowest, drop });
  }
  return out;
}
