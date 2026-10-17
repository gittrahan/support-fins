/**
 * Island starts (local issue 041, GitHub #18 #257): a feature whose first layer
 * prints in midair -- a boss end, a peg tip, an outside corner -- while every face
 * around its low point is steeper than the overhang angle, so none of them is red
 * and nothing else in the engine knows it needs holding up.
 *
 * Found on the mesh, not by slicing. A layer can only start in midair at a LOCAL
 * LOW POINT of the surface: a vertex, or a level run of vertices (a horizontal
 * edge pointing down), lower than everything joined to it. That is cheap and exact
 * for the mesh; the slicer's view is then checked around each one:
 *   - its faces point DOWN (a low point on a bowl's floor faces up: part under it)
 *   - none of them is red (red already counts, and is already held)
 *   - the surface climbing away from it doesn't join anything lower within one
 *     layer (a dimple in a steep wall prints on the layer below it)
 *   - no other part of the mesh is within GRACE in plan in the layer below
 *   - its cross-section one layer up is at least MIN_AREA
 * Checked against slicing the posed part every 0.2 mm and flagging each section
 * that touches nothing in the layer below: #18's bosses at X/Y +-45, #257's corners.
 *
 * Pure mesh math (no DOM), so the engine can use it too. In print space: the part
 * posed by `rot` and seated by `res.offset` (analyze()'s result).
 */

export const ISLAND = {
  layer: 0.2,      // mm; one layer: the band below a start a slicer prints it onto
  grace: 0.3,      // mm in plan; material this close in the layer below holds the start
  minArea: 0.03,   // mm^2; cross-section one layer up (Matthew 2026-10-17: hold anything real)
  plateZ: 0.6,     // mm; a start this low is on the plate (coverage.js PLATE_Z)
  merge: 2.0,      // mm in plan; starts this close are one island (both ends of a boss rim)
  mergeZ: 1.5,     // mm; ... and within a wall top's reach band of each other
  maxFaces: 4000,  // faces walked per start for its cross-section; past it, it's big
};

const EPS = 1e-6;

/** Vertex neighbours and incident faces (CSR), rotation-invariant, cached on topo. */
function vertexGraph(topo) {
  if (topo._vgraph) return topo._vgraph;
  const { vid, nFaces } = topo;
  const nV = topo.vertexCount;
  const corner = new Int32Array(nV).fill(-1);     // one face corner per vertex, for its position
  const fDeg = new Int32Array(nV + 1);
  for (let c = 0; c < nFaces * 3; c++) { fDeg[vid[c] + 1]++; if (corner[vid[c]] < 0) corner[vid[c]] = c; }
  for (let v = 0; v < nV; v++) fDeg[v + 1] += fDeg[v];
  const fAt = fDeg.slice(), vFaces = new Int32Array(nFaces * 3);
  for (let c = 0; c < nFaces * 3; c++) vFaces[fAt[vid[c]]++] = (c / 3) | 0;
  // neighbours: each face gives each corner its two others; duplicates are harmless
  const nbr = new Int32Array(nFaces * 6);
  const nAt = new Int32Array(nV);
  for (let v = 0; v < nV; v++) nAt[v] = fDeg[v] * 2;
  for (let f = 0; f < nFaces; f++) {
    const a = vid[f * 3], b = vid[f * 3 + 1], c = vid[f * 3 + 2];
    nbr[nAt[a]++] = b; nbr[nAt[a]++] = c;
    nbr[nAt[b]++] = a; nbr[nAt[b]++] = c;
    nbr[nAt[c]++] = a; nbr[nAt[c]++] = b;
  }
  return (topo._vgraph = { nV, corner, fStart: fDeg, vFaces, nbr });
}

/**
 * The island starts of the part in pose `rot` (seated by `res.offset`), lowest
 * first: [{ x, y, z, area, points: [[x, y, z], ...] }]. `points` are every low
 * vertex merged into it (ISLAND.merge; a level edge gives all of its run, so a
 * 40 mm knife edge is 40 mm of target, not its middle), (x, y) their centre, z the
 * lowest, `area` the biggest start's cross-section one layer up.
 */
export function findIslands(topo, res, rot, opts = {}) {
  const P = { ...ISLAND, ...opts };
  if (!topo.vid) return [];
  const { pos, nFaces, nrm, area, vid } = topo;
  const g = vertexGraph(topo);
  const { nV, corner, fStart, vFaces, nbr } = g;
  const off = res.offset;

  const X = new Float64Array(nV), Y = new Float64Array(nV), Z = new Float64Array(nV);
  for (let v = 0; v < nV; v++) {
    const o = corner[v] * 3, x = pos[o], y = pos[o + 1], z = pos[o + 2];
    X[v] = rot[0] * x + rot[3] * y + rot[6] * z + off.x;
    Y[v] = rot[1] * x + rot[4] * y + rot[7] * z + off.y;
    Z[v] = rot[2] * x + rot[5] * y + rot[8] * z + off.z;
  }
  const nb = (v, fn) => { for (let k = fStart[v] * 2, e = fStart[v + 1] * 2; k < e; k++) fn(nbr[k]); };

  // low points: no neighbour lower; a level run of them is one (union-find)
  const lower = new Uint8Array(nV);
  const parent = new Int32Array(nV);
  for (let v = 0; v < nV; v++) parent[v] = v;
  const find = (i) => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  for (let v = 0; v < nV; v++) {
    if (Z[v] < P.plateZ) { lower[v] = 1; continue; }
    nb(v, (u) => {
      const dz = Z[u] - Z[v];
      if (dz < -EPS) lower[v] = 1;
      else if (dz <= EPS) parent[find(u)] = find(v);
    });
  }
  const runs = new Map();
  for (let v = 0; v < nV; v++) {
    const r = find(v);
    let run = runs.get(r);
    if (!run) runs.set(r, (run = { verts: [], lower: false }));
    run.verts.push(v);
    if (lower[v]) run.lower = true;
  }

  const fz = (f) => [Z[vid[f * 3]], Z[vid[f * 3 + 1]], Z[vid[f * 3 + 2]]];
  const nzOf = (f) => rot[2] * nrm[f * 3] + rot[5] * nrm[f * 3 + 1] + rot[8] * nrm[f * 3 + 2];

  const cands = [];
  for (const run of runs.values()) {
    if (run.lower) continue;
    const z0 = Z[run.verts[0]];
    const star = new Set();
    for (const v of run.verts) for (let k = fStart[v]; k < fStart[v + 1]; k++) star.add(vFaces[k]);
    let red = false, down = 0;
    for (const f of star) { if (res.over[f]) red = true; down += area[f] * nzOf(f); }
    if (red || down >= 0) continue;
    cands.push({ run, z0, star });
  }
  if (!cands.length) return [];

  // the layer below, gridded in plan: only faces in reach of some start's band
  let zLo = Infinity, zHi = -Infinity;
  for (const c of cands) { zLo = Math.min(zLo, c.z0 - P.layer); zHi = Math.max(zHi, c.z0); }
  const CELL = 1;
  const grid = new Map(), big = [];
  const key = (i, j) => i * 1000003 + j;
  for (let f = 0; f < nFaces; f++) {
    const [a, b, c] = fz(f);
    if (Math.min(a, b, c) >= zHi || Math.max(a, b, c) <= zLo) continue;
    const xs = [X[vid[f * 3]], X[vid[f * 3 + 1]], X[vid[f * 3 + 2]]];
    const ys = [Y[vid[f * 3]], Y[vid[f * 3 + 1]], Y[vid[f * 3 + 2]]];
    const i0 = Math.floor(Math.min(...xs) / CELL), i1 = Math.floor(Math.max(...xs) / CELL);
    const j0 = Math.floor(Math.min(...ys) / CELL), j1 = Math.floor(Math.max(...ys) / CELL);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 256) { big.push(f); continue; }
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = key(i, j);
      let a2 = grid.get(k); if (!a2) grid.set(k, (a2 = [])); a2.push(f);
    }
  }
  // face f clipped to z in [lo, hi], projected: within `r` of (px, py)?
  const near = (f, px, py, lo, hi, r) => {
    let poly = [0, 1, 2].map((i) => { const v = vid[f * 3 + i]; return [X[v], Y[v], Z[v]]; });
    for (const [lim, sg] of [[lo, 1], [hi, -1]]) {
      const out = [];
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i], q = poly[(i + 1) % poly.length];
        const dp = sg * (p[2] - lim), dq = sg * (q[2] - lim);
        if (dp >= 0) out.push(p);
        if ((dp >= 0) !== (dq >= 0)) {
          const t = dp / (dp - dq);
          out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1]), lim]);
        }
      }
      poly = out;
      if (!poly.length) return false;
    }
    // point in the projected polygon, or within r of an edge
    let inside = false, d2 = Infinity;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
      const ex = xj - xi, ey = yj - yi, L = ex * ex + ey * ey;
      const t = L > 0 ? Math.max(0, Math.min(1, ((px - xi) * ex + (py - yi) * ey) / L)) : 0;
      d2 = Math.min(d2, (xi + t * ex - px) ** 2 + (yi + t * ey - py) ** 2);
    }
    return inside || d2 <= r * r;
  };
  const heldBelow = (px, py, z0) => {
    const lo = z0 - P.layer, hi = z0 - EPS;
    const test = (f) => {
      const [a, b, c] = fz(f);
      return Math.min(a, b, c) < hi && Math.max(a, b, c) > lo && near(f, px, py, lo, hi, P.grace);
    };
    const r = Math.ceil(P.grace / CELL);
    const gi = Math.floor(px / CELL), gj = Math.floor(py / CELL);
    for (let i = gi - r; i <= gi + r; i++) for (let j = gj - r; j <= gj + r; j++) {
      for (const f of grid.get(key(i, j)) || []) if (test(f)) return true;
    }
    for (const f of big) if (test(f)) return true;
    return false;
  };

  // the cross-section one layer up: walk the faces under that height out from the
  // start; reaching a vertex lower than the start means it joins lower material
  // within the layer (not an island). Segments are oriented by the face's outward
  // normal, so the shoelace sum is the enclosed area.
  const section = (c) => {
    const zh = c.z0 + P.layer;
    const seen = new Set(c.star), queue = [...c.star];
    let a2 = 0;
    for (let qi = 0; qi < queue.length; qi++) {
      if (queue.length > P.maxFaces) return Infinity;
      const f = queue[qi];
      const zs = fz(f);
      if (Math.min(...zs) < c.z0 - EPS) return -1;
      if (Math.max(...zs) > zh) {
        const pts = [];
        for (let i = 0; i < 3; i++) {
          const u = vid[f * 3 + i], w = vid[f * 3 + (i + 1) % 3];
          if ((Z[u] - zh) * (Z[w] - zh) < 0 || (Z[u] === zh && Z[w] !== zh)) {
            const t = (zh - Z[u]) / (Z[w] - Z[u]);
            pts.push([X[u] + t * (X[w] - X[u]), Y[u] + t * (Y[w] - Y[u])]);
          }
        }
        if (pts.length === 2) {
          // the outward normal's plan part on the right of the segment p -> q
          const nx = rot[0] * nrm[f * 3] + rot[3] * nrm[f * 3 + 1] + rot[6] * nrm[f * 3 + 2];
          const ny = rot[1] * nrm[f * 3] + rot[4] * nrm[f * 3 + 1] + rot[7] * nrm[f * 3 + 2];
          let [p, q] = pts;
          if ((q[0] - p[0]) * ny - (q[1] - p[1]) * nx > 0) [p, q] = [q, p];
          a2 += p[0] * q[1] - q[0] * p[1];
        }
      }
      if (Math.min(...zs) >= zh) continue;
      for (let i = 0; i < 3; i++) {
        const v = vid[f * 3 + i];
        if (Z[v] >= zh) continue;
        for (let k = fStart[v]; k < fStart[v + 1]; k++) {
          const h = vFaces[k];
          if (!seen.has(h)) { seen.add(h); queue.push(h); }
        }
      }
    }
    return Math.abs(a2) / 2;
  };

  const found = [];
  for (const c of cands) {
    const vs = c.run.verts;
    let held = false;
    for (const v of vs) if (heldBelow(X[v], Y[v], c.z0)) { held = true; break; }
    if (held) continue;
    const a = section(c);
    if (a < P.minArea) continue;
    found.push({ z: c.z0, area: a, points: vs.map((v) => [X[v], Y[v], Z[v]]) });
  }

  // merge starts a boss rim or a corner shares into one island, lowest first
  found.sort((p, q) => p.z - q.z);
  const out = [];
  const close = (o, s) => o.points.some((p) => s.points.some((q) =>
    Math.hypot(p[0] - q[0], p[1] - q[1]) <= P.merge && Math.abs(p[2] - q[2]) <= P.mergeZ));
  for (const s of found) {
    const hit = out.find((o) => close(o, s));
    if (hit) { hit.points.push(...s.points); hit.area = Math.max(hit.area, s.area); }
    else out.push({ z: s.z, area: s.area, points: s.points });
  }
  for (const o of out) {
    o.x = o.points.reduce((t, p) => t + p[0], 0) / o.points.length;
    o.y = o.points.reduce((t, p) => t + p[1], 0) / o.points.length;
  }
  return out;
}
