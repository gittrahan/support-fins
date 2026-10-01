// What every plugin entry does to a part before the engine sees it, in one place,
// so computeFins (fins_entry.js) and drawWall (draw_entry.js) can't seat a part or
// pick its clearances differently.
import { MATERIAL } from '../../../web/materials.js';
import { CUTOUT_PATTERNS } from '../../../web/cutout.js';

// The site's Bed pad choices minus Custom (a plugin dialog shows presets, not the
// four custom numbers). 'off' is the site's Off, the same as bedPad: false.
export const PAD_STYLES = ['off', 'auto', 'light', 'sure'];

export function pick(name, value, allowed) {
  if (!allowed.includes(value)) throw new Error(`${name} must be one of ${allowed.join(', ')}, got ${JSON.stringify(value)}`);
  return value;
}

/**
 * The material's numbers and the clearances buildFins / applyTunables take, exactly
 * as the site's build request sends them (ui/finbuild.js). ALWAYS the full set:
 * they land in module state, and a plugin's V8 context lives across calls, so a
 * partial set would let a PETG run's clearances leak into the next PLA run.
 * `opts` is ENGINE_DEFAULTS merged with the host's options.
 */
export function clearances(opts) {
  const mat = MATERIAL[pick('material', opts.material, Object.keys(MATERIAL))];
  const tunables = {
    tineBite: mat.tineBite, padH: mat.padH, padGrab: mat.padGrab, propGap: mat.propGap,
    // Off builds no pad, so which style it carries doesn't matter; Auto keeps it valid.
    padStyle: pick('padStyle', opts.padStyle, PAD_STYLES) === 'off' ? 'auto' : opts.padStyle,
    cutout: pick('cutout', opts.cutout, CUTOUT_PATTERNS),
  };
  return { mat, tunables };
}

/**
 * Seat the part at the origin OURSELVES, in float64, before the engine sees it.
 * The engine welds vertices on a 1-micron grid of ABSOLUTE coordinates, so the
 * same part parked at x=137 on Orca's plate welds differently than at x=0 and
 * can grow or lose a tine (measured on lbracket). Centring first makes the result
 * independent of where the part sits on the plate -- and identical to the website
 * for a part whose STL is centred.
 *
 * Returns { pos, shift }: pos = input - shift, on a 1 nm grid.
 */
export function seatSoup(positions) {
  const input = (positions instanceof Float32Array || positions instanceof Float64Array)
    ? positions : Float64Array.from(positions);
  if (input.length === 0 || input.length % 9 !== 0) {
    throw new Error(`positions must be a non-empty triangle soup (9 floats/face), got ${input.length}`);
  }
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
  const pos = new Float64Array(input.length);
  for (let i = 0; i < input.length; i += 3) {
    pos[i] = snap(input[i] - cx);
    pos[i + 1] = snap(input[i + 1] - cy);
    pos[i + 2] = snap(input[i + 2] - z0);
  }
  return { pos, shift: { x: cx, y: cy, z: z0 } };
}

const SNAP = 1e6;
export const snap = (v) => Math.round(v * SNAP) / SNAP;

// buildFins hands back either a flat number array or an array of [x,y,z] triples
// depending on the path taken; normalise both to a flat Float32Array.
export function flatten(tris) {
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
