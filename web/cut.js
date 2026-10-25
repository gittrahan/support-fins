/**
 * A slicer's negative parts, cut out of the part (GitHub #104).
 *
 * A negative part is a mesh the slicer subtracts from the object at slice time
 * (threemf.js reads them as an object's `extras`). Left in, the cut comes back
 * solid; left out, the part is uncut -- and either way the fins are built for a
 * shape that will not print: a wall under plastic the slicer removes, or none
 * under an overhang the cut opens. So the cut is made here, before the part
 * reaches the engine, and the fins are built for what actually prints.
 *
 * The boolean is Manifold (manifold-3d, vendored under vendor/manifold-3d-<v>,
 * Apache-2.0), loaded on first use: ~0.5 MB of WASM that only a file with a
 * negative part pays for. It needs closed meshes. A part that is not one (an
 * open or self-touching scan) cannot be cut, and comes back uncut with the
 * reason -- said, never hidden: its fins are for the uncut shape.
 *
 * Colours ride through on the faces the cut leaves alone (Manifold keeps each
 * triangle's source face as faceID); a painted face the cut splits loses its
 * paint, since the paint string subdivides the ORIGINAL triangle.
 */

import { isWhole } from './paintcode.js';

let wasm = null;
let wasmBinary = null;

/**
 * For a host that cannot fetch the vendor folder beside this file -- the CLI's
 * one-file bundle carries the WASM inside it (plugins/cli/build.py).
 */
export function setManifoldWasm(bytes) { wasmBinary = bytes; wasm = null; }

async function manifold() {
  // a literal path, so a bundler pulls the loader in
  wasm ??= import('./vendor/manifold-3d-3.5.4/manifold.js').then(async (m) => {
    const w = await m.default(wasmBinary ? { wasmBinary } : {});
    w.setup();
    return w;
  }).catch((e) => { wasm = null; throw e; });    // a failed download is retried next file
  return wasm;
}

/**
 * A triangle soup -> Manifold's indexed mesh, exact-equal points welded. `id`
 * (from Manifold.reserveIDs) marks every triangle as the part's, through any
 * union of its shells and the cut.
 */
function meshOf(w, positions, faceID, id, outward = false) {
  const index = new Map();
  const verts = [];
  const tri = new Uint32Array(positions.length / 3);
  for (let v = 0; v < tri.length; v++) {
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    const key = `${x},${y},${z}`;
    let i = index.get(key);
    if (i === undefined) { i = verts.length / 3; index.set(key, i); verts.push(x, y, z); }
    tri[v] = i;
  }
  // A shell wound inside out is, to Manifold, a hole: subtracting it ADDS its
  // volume. A slicer cuts by the shape, whichever way it is wound, so a negative
  // part is turned outward first (signed volume > 0).
  if (outward && signedVolume(positions) < 0) {
    for (let t = 0; t < tri.length; t += 3) { const a = tri[t + 1]; tri[t + 1] = tri[t + 2]; tri[t + 2] = a; }
  }
  const mesh = new w.Mesh({ numProp: 3, vertProperties: new Float32Array(verts), triVerts: tri,
    ...(faceID ? { faceID } : {}),
    ...(id != null ? { runIndex: new Uint32Array([0, tri.length]), runOriginalID: new Uint32Array([id]) } : {}) });
  mesh.merge();          // weld near-coincident points along open edges, best effort
  return mesh;
}

function signedVolume(p) {
  let v = 0;
  for (let i = 0; i < p.length; i += 9) {
    v += p[i] * (p[i + 4] * p[i + 8] - p[i + 5] * p[i + 7])
       - p[i + 1] * (p[i + 3] * p[i + 8] - p[i + 5] * p[i + 6])
       + p[i + 2] * (p[i + 3] * p[i + 7] - p[i + 4] * p[i + 6]);
  }
  return v / 6;
}

const tryManifold = (w, mesh) => {
  try {
    const s = new w.Manifold(mesh);
    if (s.status() === 'NoError' && !s.isEmpty()) return s;
    s.delete();
  } catch { /* not manifold */ }
  return null;
};

// A scanned negative (a candle for a mould) is typically several closed shells
// touching along a few edges, plus loose sliver triangles: me-candle's is 4
// shells of 576310 triangles and 52 stray ones. As one mesh it is not manifold;
// shell by shell it is. The slivers enclose nothing, so dropping them is safe
// while they are this small a share of the SURFACE -- area, not count: a missing
// face is few triangles but much area, a sliver many triangles and next to none.
// Only a NEGATIVE part gets this: dropping any of the part itself would change
// what prints without a word.
const MAX_STRAY = 0.01;

function area(positions, t) {
  const o = t * 9, p = positions;
  const ux = p[o + 3] - p[o], uy = p[o + 4] - p[o + 1], uz = p[o + 5] - p[o + 2];
  const vx = p[o + 6] - p[o], vy = p[o + 7] - p[o + 1], vz = p[o + 8] - p[o + 2];
  return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
}

/**
 * The mesh's closed shells, split where an edge is shared by other than two
 * triangles, as one solid -- or null when the open ones are more than
 * MAX_STRAY of the area (then it is not a solid with debris, it is open).
 */
function shellsOf(w, positions) {
  const nT = positions.length / 9;
  const index = new Map();
  const tv = new Uint32Array(nT * 3);
  for (let v = 0; v < tv.length; v++) {
    const key = `${positions[v * 3]},${positions[v * 3 + 1]},${positions[v * 3 + 2]}`;
    let i = index.get(key);
    if (i === undefined) index.set(key, i = index.size);
    tv[v] = i;
  }
  const edges = new Map();
  for (let t = 0; t < nT; t++) {
    for (let k = 0; k < 3; k++) {
      const a = tv[t * 3 + k], b = tv[t * 3 + (k + 1) % 3];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      const list = edges.get(key);
      if (list) list.push(t); else edges.set(key, [t]);
    }
  }
  const up = Int32Array.from({ length: nT }, (_, i) => i);
  const root = (x) => { while (up[x] !== x) x = up[x] = up[up[x]]; return x; };
  for (const ts of edges.values()) if (ts.length === 2) up[root(ts[0])] = root(ts[1]);
  const shells = new Map();
  for (let t = 0; t < nT; t++) {
    const r = root(t);
    const list = shells.get(r);
    if (list) list.push(t); else shells.set(r, [t]);
  }

  const solids = [];
  let stray = 0, total = 0;
  for (let t = 0; t < nT; t++) total += area(positions, t);
  for (const ts of shells.values()) {
    const p = new Float32Array(ts.length * 9);
    ts.forEach((t, j) => p.set(positions.subarray(t * 9, t * 9 + 9), j * 9));
    const s = tryManifold(w, meshOf(w, p, null, null, true));
    if (s) solids.push(s); else for (const t of ts) stray += area(positions, t);
  }
  if (!solids.length || stray > MAX_STRAY * total) { for (const s of solids) s.delete(); return null; }
  if (solids.length === 1) return solids[0];
  const all = w.Manifold.union(solids);
  for (const s of solids) s.delete();
  return all;
}

/** The part as a closed solid, or null when it is not one. */
const partSolid = (w, positions, faceID, id) => tryManifold(w, meshOf(w, positions, faceID, id));

/** A negative part as a closed solid, outward, even shell by shell; or null. */
const negativeSolid = (w, positions) => tryManifold(w, meshOf(w, positions, null, null, true)) ?? shellsOf(w, positions);

/**
 * Cut an object's negative parts out of it.
 * @param obj  a readThreeMF object: { positions, colors, extras }
 * @returns { positions, colors, cut, uncut, why }: the cut part (the input's
 *   own positions/colors when nothing was cut), how many negative parts were cut
 *   and how many were not, and why NONE was, when that is the whole object's
 *   reason: 'open' (the part is not a closed solid), 'whole' (the negatives
 *   remove all of it) or 'load' (the cutter would not load). With `why` null an
 *   uncut negative part is not a closed solid itself.
 */
export async function cutNegatives(obj) {
  const negs = (obj.extras ?? []).filter((e) => e.kind === 'negative');
  const same = { positions: obj.positions, colors: obj.colors ?? null, cut: 0, uncut: negs.length, why: null };
  if (!negs.length) return same;

  let w;
  try { w = await manifold(); } catch { return { ...same, why: 'load' }; }
  const nTri = obj.positions.length / 9;
  const partID = w.Manifold.reserveIDs(1);
  const part = partSolid(w, obj.positions, Uint32Array.from({ length: nTri }, (_, i) => i), partID);
  if (!part) return { ...same, why: 'open' };

  const tools = [];
  for (const n of negs) {
    const s = negativeSolid(w, n.positions);
    if (s) tools.push(s);
  }
  if (!tools.length) { part.delete(); return same; }

  const tool = tools.length === 1 ? tools[0] : w.Manifold.union(tools);
  const result = part.subtract(tool);
  const out = result.getMesh();
  for (const s of new Set([part, tool, result, ...tools])) s.delete();

  const { vertProperties: vp, triVerts: tv, numProp: np, faceID, runIndex, runOriginalID } = out;
  if (!tv.length) return { ...same, why: 'whole' };
  const positions = new Float32Array(tv.length * 3);
  for (let i = 0; i < tv.length; i++) {
    const o = tv[i] * np;
    positions[i * 3] = vp[o]; positions[i * 3 + 1] = vp[o + 1]; positions[i * 3 + 2] = vp[o + 2];
  }
  return { positions, colors: carryColors(obj, positions, faceID, runIndex, runOriginalID, partID),
    cut: tools.length, uncut: negs.length - tools.length, why: null };
}

/**
 * The part's colours onto the cut triangles. A triangle from the part's own
 * surface (its run's original id is the part's) names its source triangle by
 * faceID: it keeps that triangle's rgb, and its paint when it IS that triangle,
 * corner for corner -- paint subdivides the original's corners -- or when the
 * paint is one state over the whole of it (a part's filament, paintcode.js).
 * Triangles the negative part made (the cut's walls) stay uncoloured.
 */
function carryColors(obj, positions, faceID, runIndex, runOriginalID, partID) {
  const src = obj.colors;
  if (!src) return null;
  const col = { paint: [], rgb: [] };
  const P = obj.positions;
  for (let r = 0; r < runOriginalID.length; r++) {
    if (runOriginalID[r] !== partID) continue;
    for (let t = runIndex[r] / 3; t < runIndex[r + 1] / 3; t++) {
      const f = faceID[t];
      if (src.rgb[f]) col.rgb[t] = src.rgb[f];
      if (!src.paint[f]) continue;
      let same = true;
      for (let k = 0; k < 9 && same; k++) same = positions[t * 9 + k] === P[f * 9 + k];
      if (same || isWhole(src.paint[f].v)) col.paint[t] = src.paint[f];
    }
  }
  return col.paint.length || col.rgb.length ? col : null;
}
