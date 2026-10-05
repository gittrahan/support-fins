// What the SolidWorks dialog does with a part, minus the DOM: pose it on the
// chosen print bed, run the printfins.com engine, and turn the fins back into
// SolidWorks' frame as one binary STL per piece (a wall, a sway brace, the pad).
//
// The engine is passed in, not imported: in the add-in it is the bundle's global
// SupportFinsEngine (plugins/shared/engine/bridge.js), in the tests the same
// module straight from plugins/shared. Pure functions, millimetres throughout.
//
// Frames. SolidWorks reads the part in its own model frame (Y up by default; the
// add-in converts metres to mm). The engine wants the print pose: z up, the bed
// below. frameFor(up) is the rotation R taking `up` to +z; posed = R p, and the
// fins come back as world = R^T (seated - offset), offset being computeFins' own.

const EPS = 1e-9;

/** Bed choices the dialog offers, before the shared engine settings. */
export const BEDS = [
  { value: 'top', label: 'Top Plane (Y up)' },
  { value: 'front', label: 'Front Plane (Z up)' },
  { value: 'face', label: 'Selected face' },
];

// The body names a run leaves behind, so the next run skips them and counts them.
export const PREFIX = 'Support Fins';
const KIND_NAMES = { prop: 'wall', sway: 'sway brace', pad: 'bed pad', wedge: 'wedge' };

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function unit(v) {
  const n = Math.hypot(v[0], v[1], v[2]);
  if (!(n > EPS)) throw new Error(`not a direction: ${JSON.stringify(v)}`);
  return [v[0] / n, v[1] / n, v[2] / n];
}

/**
 * The part's up direction in the model frame.
 * @param bed   'top' | 'front' | 'face'
 * @param soup  the part (model frame, mm), to tell which side of a face it is on
 * @param face  {normal, point} of the selected planar face (model frame, mm), for 'face'
 * @returns {number[] | {error: string}}
 */
export function upFor(bed, soup, face) {
  if (bed === 'top') return [0, 1, 0];
  if (bed === 'front') return [0, 0, 1];
  if (bed !== 'face') throw new Error(`unknown bed ${bed}`);
  if (!face) return { error: 'Select the flat face the part stands on, then press Read part.' };
  const n = unit(face.normal);
  // Up is whichever side the part is on, so a face normal's sign doesn't matter.
  let side = 0;
  for (let i = 0; i < soup.length; i += 3) {
    side += (soup[i] - face.point[0]) * n[0] + (soup[i + 1] - face.point[1]) * n[1]
      + (soup[i + 2] - face.point[2]) * n[2];
  }
  return side >= 0 ? n : [-n[0], -n[1], -n[2]];
}

/**
 * Rows of the rotation taking `up` to +z, right-handed (never a mirror). Its x row
 * is the model's X laid flat, so Y up gives (x, y, z) -> (x, -z, y) and Z up is the
 * identity.
 */
export function frameFor(up) {
  const u = unit(up);
  const seed = Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
  const d = dot(seed, u);
  const e1 = unit([seed[0] - d * u[0], seed[1] - d * u[1], seed[2] - d * u[2]]);
  return [e1, cross(u, e1), u];
}

/** The soup in the print pose: R p, float64 (computeFins asks for float64). */
export function pose(soup, R) {
  const out = new Float64Array(soup.length);
  for (let i = 0; i < soup.length; i += 3) {
    const p = [soup[i], soup[i + 1], soup[i + 2]];
    out[i] = dot(R[0], p); out[i + 1] = dot(R[1], p); out[i + 2] = dot(R[2], p);
  }
  return out;
}

/** The engine's seated triangles back in the model frame: R^T (t - offset). */
export function toModel(tris, offset, R) {
  const out = new Float64Array(tris.length);
  for (let i = 0; i < tris.length; i += 3) {
    const x = tris[i] - offset.x, y = tris[i + 1] - offset.y, z = tris[i + 2] - offset.z;
    for (let k = 0; k < 3; k++) out[i + k] = R[0][k] * x + R[1][k] * y + R[2][k] * z;
  }
  return out;
}

/** A binary STL of a triangle soup (mm), facet normals from the winding. */
export function stlBytes(tris, name = PREFIX) {
  const n = tris.length / 9;
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  const head = new TextEncoder().encode(name.slice(0, 80));
  new Uint8Array(buf, 0, head.length).set(head);
  dv.setUint32(80, n, true);
  for (let f = 0; f < n; f++) {
    const t = f * 9;
    const a = [tris[t + 3] - tris[t], tris[t + 4] - tris[t + 1], tris[t + 5] - tris[t + 2]];
    const b = [tris[t + 6] - tris[t], tris[t + 7] - tris[t + 1], tris[t + 8] - tris[t + 2]];
    let nv = cross(a, b);
    const len = Math.hypot(nv[0], nv[1], nv[2]);
    nv = len > EPS ? nv.map((c) => c / len) : [0, 0, 0];
    const o = 84 + f * 50;
    for (let k = 0; k < 3; k++) dv.setFloat32(o + k * 4, nv[k], true);
    for (let k = 0; k < 9; k++) dv.setFloat32(o + 12 + k * 4, tris[t + k], true);
  }
  return new Uint8Array(buf);
}

/** "Support Fins wall 3", "Support Fins bed pad": a body's name, numbered per kind. */
export function pieceNames(pieces) {
  const seen = {};
  const total = {};
  for (const p of pieces) total[p.kind] = (total[p.kind] || 0) + 1;
  return pieces.map((p) => {
    const label = KIND_NAMES[p.kind] ?? p.kind;
    seen[p.kind] = (seen[p.kind] || 0) + 1;
    return total[p.kind] === 1 && p.kind === 'pad' ? `${PREFIX} ${label}` : `${PREFIX} ${label} ${seen[p.kind]}`;
  });
}

/**
 * Fins for a part, in the model frame, one entry per piece.
 * @param engine  SupportFinsEngine (computeFins, optionsFromDialog, reportLine)
 * @param soup    Float64Array, the part in the model frame, mm
 * @param bed     'top' | 'front' | 'face'
 * @param face    the selected planar face, for 'face'
 * @param values  the dialog's {options.json key: value}, entry units
 * @returns {{error: string} | {pieces: {name, kind, triangles: Float64Array}[], stats, line: string}}
 */
export function finsFor(engine, soup, bed, face, values) {
  const up = upFor(bed, soup, face);
  if (up.error) return up;
  const R = frameFor(up);
  const res = engine.computeFins(pose(soup, R), engine.optionsFromDialog(values));
  const all = toModel(res.triangles, res.offset, R);
  const names = pieceNames(res.pieces);
  const pieces = res.pieces.map((p, i) => {
    const count = p.ranges.reduce((m, [a, b]) => m + b - a, 0);
    const triangles = new Float64Array(count * 9);
    let o = 0;
    for (const [a, b] of p.ranges) { triangles.set(all.subarray(a * 9, b * 9), o); o += (b - a) * 9; }
    return { name: names[i], kind: p.kind, triangles };
  });
  return { pieces, stats: res.stats, line: engine.reportLine(res.stats) };
}
