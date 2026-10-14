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

const MANIFOLD = './vendor/manifold-3d-3.5.4/manifold.js';
let wasm = null;

async function manifold() {
  wasm ??= import(MANIFOLD).then(async (m) => {
    const w = await m.default();
    w.setup();
    return w;
  });
  return wasm;
}

/** A triangle soup -> Manifold's indexed mesh, exact-equal points welded. */
function meshOf(w, positions, faceID) {
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
  const mesh = new w.Mesh({ numProp: 3, vertProperties: new Float32Array(verts), triVerts: tri,
    ...(faceID ? { faceID } : {}) });
  mesh.merge();          // weld near-coincident points along open edges, best effort
  return mesh;
}

/** A closed solid, or null when the mesh is not one. */
function solidOf(w, positions, faceID) {
  try {
    const s = new w.Manifold(meshOf(w, positions, faceID));
    if (s.status() !== 'NoError' || s.isEmpty()) { s.delete(); return null; }
    return s;
  } catch { return null; }
}

/**
 * Cut an object's negative parts out of it.
 * @param obj  a readThreeMF object: { positions, colors, extras }
 * @returns { positions, colors, cut, failed }: the cut part (the input's own
 *   positions/colors when there is nothing to cut), how many negative parts were
 *   cut, and why the rest were not -- null, 'part' (the part is not a closed
 *   solid: nothing was cut) or 'negative' (some negative part is not one: it
 *   was skipped).
 */
export async function cutNegatives(obj) {
  const negs = (obj.extras ?? []).filter((e) => e.kind === 'negative');
  const same = { positions: obj.positions, colors: obj.colors ?? null, cut: 0, failed: null };
  if (!negs.length) return same;

  const w = await manifold();
  const nTri = obj.positions.length / 9;
  const part = solidOf(w, obj.positions, Uint32Array.from({ length: nTri }, (_, i) => i));
  if (!part) return { ...same, failed: 'part' };
  const partID = part.originalID();

  const tools = [];
  let failed = null;
  for (const n of negs) {
    const s = solidOf(w, n.positions, null);
    if (s) tools.push(s); else failed = 'negative';
  }
  if (!tools.length) { part.delete(); return { ...same, failed }; }

  const tool = tools.length === 1 ? tools[0] : w.Manifold.union(tools);
  const result = part.subtract(tool);
  const out = result.getMesh();
  for (const s of new Set([part, tool, result, ...tools])) s.delete();

  const { vertProperties: vp, triVerts: tv, numProp: np, faceID, runIndex, runOriginalID } = out;
  const positions = new Float32Array(tv.length * 3);
  for (let i = 0; i < tv.length; i++) {
    const o = tv[i] * np;
    positions[i * 3] = vp[o]; positions[i * 3 + 1] = vp[o + 1]; positions[i * 3 + 2] = vp[o + 2];
  }
  return { positions, colors: carryColors(obj, positions, faceID, runIndex, runOriginalID, partID),
    cut: tools.length, failed };
}

/**
 * The part's colours onto the cut triangles. A triangle from the part's own
 * surface (its run's original id is the part's) names its source triangle by
 * faceID: it keeps that triangle's rgb, and its paint only when it IS that
 * triangle, corner for corner -- paint subdivides the original's corners.
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
      if (same) col.paint[t] = src.paint[f];
    }
  }
  return col.paint.length || col.rgb.length ? col : null;
}
