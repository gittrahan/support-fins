// Support Fins -- engine entry point for the plugins.
//
// The one function a plugin needs from the web engine: take a posed part as
// triangle soup (exactly as it sits on the slicer's plate or in the CAD model, in
// mm, z up) and return the fin + bed-pad triangles to add under it.
//
// Nothing here re-implements geometry. It calls the SAME analyze()/buildFins()
// the website runs, with rot = identity because Orca has already applied the
// user's rotation (the user poses the part in the host app, e.g. Orca's rotate
// gizmo -- the "you pick the rotation" rule is kept, it just happens there).
//
// FRAME CONTRACT (plugins depend on this; e.g. Orca's slicing hook):
//   analyze() seats the part with offset = (-cx, -cy, -minZ), i.e. the posed
//   part's XY bounding-box centre moves to the origin and its lowest point to
//   z = 0. buildFins() emits in that same seated frame. We return the triangles
//   in that frame unchanged and report the offset we saw, so Python can map
//   them back onto the part: fin_world = fin_seated - offset.
import { buildTopology, analyze, DEFAULT_THRESHOLD, IDENTITY3 } from '../../../web/overhangs.js';
import { buildFins } from '../../../web/fins.js';

export const ENGINE_DEFAULTS = Object.freeze({
  mode: 'auto',        // the website's default fin mode
  bedPad: true,
  tines: true,
  tineDensity: 0,      // website slider default (0..1)
  coverage: 0.5,       // website slider default (0..1)
  layerHeight: 0.2,    // overridden with the active Orca preset's layer height
  threshold: DEFAULT_THRESHOLD,
});

/**
 * @param {Float64Array|Float32Array|number[]} positions  triangle soup, 9 per face, mm,
 *        posed, anywhere on the plate. Pass float64 when you have it: Orca poses in double
 *        precision, and rounding back to float32 can flip a borderline tine.
 * @param {object} [options]                 overrides for ENGINE_DEFAULTS
 * @returns {{ triangles: Float32Array, offset: {x:number,y:number,z:number},
 *            stats: object }}
 */
export function computeFins(positions, options = {}) {
  const opts = { ...ENGINE_DEFAULTS, ...options };
  const input = (positions instanceof Float32Array || positions instanceof Float64Array)
    ? positions : Float64Array.from(positions);
  if (input.length === 0 || input.length % 9 !== 0) {
    throw new Error(`positions must be a non-empty triangle soup (9 floats/face), got ${input.length}`);
  }
  // Seat the part at the origin OURSELVES, in float64, before the engine sees it.
  // The engine welds vertices on a 1-micron grid of ABSOLUTE coordinates, so the
  // same part parked at x=137 on Orca's plate welds differently than at x=0 and
  // can grow or lose a tine (measured on lbracket). Centring first makes the result
  // independent of where the part sits on the plate -- and identical to the website
  // for a part whose STL is centred.
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity;
  for (let i = 0; i < input.length; i += 3) {
    const x = input[i], y = input[i + 1], z = input[i + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (z < z0) z0 = z;
  }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  // ...then snap to a 1 nm grid. The engine's tine placement moves under ~1e-13 mm
  // of noise (ENGINE-SENSITIVITY.md), and the subtraction above leaves exactly that
  // much residue, so without the snap dragging a part across the plate could add or
  // drop tines. 1 nm is far below anything printable.
  const SNAP = 1e6;
  const pos = new Float64Array(input.length);
  for (let i = 0; i < input.length; i += 3) {
    pos[i] = Math.round((input[i] - cx) * SNAP) / SNAP;
    pos[i + 1] = Math.round((input[i + 1] - cy) * SNAP) / SNAP;
    pos[i + 2] = Math.round((input[i + 2] - z0) * SNAP) / SNAP;
  }
  const topo = buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
  const result = analyze(topo, opts.threshold, IDENTITY3);
  const built = buildFins(topo, result, IDENTITY3, {
    mode: opts.mode, bedPad: opts.bedPad, tines: opts.tines,
    tineDensity: opts.tineDensity, layerHeight: opts.layerHeight, coverage: opts.coverage,
  });
  const fin = flatten(built.triangles);
  const pad = flatten(built.padTriangles || []);
  const triangles = new Float32Array(fin.length + pad.length);
  triangles.set(fin, 0);
  triangles.set(pad, fin.length);
  return {
    triangles,
    // seated = input + offset  (so the caller maps fins back with input = seated - offset)
    offset: { x: result.offset.x - cx, y: result.offset.y - cy, z: result.offset.z - z0 },
    stats: {
      overhangRegions: result.regions.length,
      finTriangles: fin.length / 9,
      padTriangles: pad.length / 9,
      braces: built.braceCount ?? 0,
      tines: built.tines ?? 0,
      unserved: built.unserved ?? null,
      // pieces that start in mid-air (see overhangs.js floatingPieces), with the
      // drop of the first: the plugins' readouts say so, as the site's does
      floating: built.floating?.length ?? 0,
      floatingDrop: built.floating?.[0]?.drop ?? 0,
    },
  };
}

// buildFins hands back either a flat number array or an array of [x,y,z] triples
// depending on the path taken; normalise both to a flat Float32Array.
function flatten(tris) {
  if (!tris || tris.length === 0) return new Float32Array(0);
  if (typeof tris[0] === 'number') return Float32Array.from(tris);
  const out = new Float32Array(tris.length * 3);
  let i = 0;
  for (const p of tris) {
    if (Array.isArray(p) || ArrayBuffer.isView(p)) { out[i++] = p[0]; out[i++] = p[1]; out[i++] = p[2]; }
    else { out[i++] = p.x; out[i++] = p.y; out[i++] = p.z; }
  }
  return out.subarray(0, i);
}
