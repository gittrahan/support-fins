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
import { MATERIAL } from '../../../web/materials.js';
import { CUTOUT_PATTERNS } from '../../../web/cutout.js';
import SCHEMA from './options.json' with { type: 'json' };

// The dialog settings (options.json) are the one source of their defaults: every
// plugin's dialog is built from the same file, so the entry can't disagree with it.
const OPTION = Object.fromEntries(SCHEMA.options.map((o) => [o.key, o]));
// The site's Bed pad choices minus Custom (a plugin dialog shows presets, not the
// four custom numbers). 'off' is the site's Off, the same as bedPad: false.
const PAD_STYLES = ['off', 'auto', 'light', 'sure'];

export const ENGINE_DEFAULTS = Object.freeze({
  mode: 'auto',        // the website's default fin mode
  bedPad: true,        // older hosts' switch; padStyle 'off' turns the pad off too
  tines: OPTION.tines.default,
  tineDensity: OPTION.tineDensity.default,   // 0..1 (the site's slider / 100)
  coverage: OPTION.coverage.default,         // 0..1 (the site's slider / 100)
  layerHeight: OPTION.layerHeight.default,   // a slicer host passes its own
  threshold: DEFAULT_THRESHOLD,              // degrees; options.json's default is pinned to it
  material: OPTION.material.default,   // key of web/materials.js MATERIAL
  padStyle: OPTION.padStyle.default,   // one of PAD_STYLES
  cutout: OPTION.cutout.default,       // one of web/cutout.js CUTOUT_PATTERNS
  // Sway braces (web/sway.js), off by default exactly as on the website. Pass
  // { on: true } to brace the tall sides, plus any of gripFrom / tineSpacing /
  // reach / gap / bite to match the host's own settings. Without this a plugin
  // could not reach the feature at all: the options below are an explicit list,
  // so anything absent from it never arrives at buildFins.
  sway: null,
});

/**
 * A plugin dialog's values -> computeFins options. Every host goes through this
 * instead of assembling the object itself, so a dotted key, a percent or a bad
 * value can't go wrong differently per host. Strict on purpose: a dialog built from
 * options.json can't produce a bad value, so one means a host bug, and guessing
 * (clamping 50 to 1 when the host forgot the /100) would print the wrong fins.
 *
 * @param {object} values  {options.json key: value}, in the ENTRY's units: a percent
 *        control's value / 100. A key left out, null or '' takes the engine default.
 *        Bools may be true/false or "true"/"false" (settings stores hand back strings).
 * @returns {object} options for computeFins; sway only when sway.on is set
 */
export function optionsFromDialog(values = {}) {
  const out = {};
  for (const [key, raw] of Object.entries(values)) {
    const o = option(key);
    if (raw === null || raw === undefined || raw === '') continue;
    const bad = (why) => new Error(`${key} ${why}, got ${JSON.stringify(raw)}`);
    let v = raw;
    if (o.type === 'bool') {
      v = asBool(raw);
      if (v === undefined) throw bad('must be true or false');
    } else if (o.type === 'number') {
      v = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
      if (!Number.isFinite(v)) throw bad('must be a number');
      if (o.hostSupplied) {
        // The host's own setting (a slicer's layer height): used as is, like the site
        // does, since a clamped value would size the tines for the wrong layer.
        if (!(v > 0)) throw bad('must be positive');
      } else if (v < o.min || v > o.max) {
        throw bad(`must be ${o.min}..${o.max}${o.percent ? ' (a percent control\'s value / 100)' : ''}`);
      }
    } else if (!o.choices.some((c) => c.value === raw)) {
      throw bad(`must be one of ${o.choices.map((c) => c.value).join(', ')}`);
    }
    const [head, sub] = key.split('.');
    if (sub) (out[head] ??= {})[sub] = v; else out[head] = v;
  }
  if (out.sway && !out.sway.on) delete out.sway;
  return out;
}

/**
 * Whether a dialog shows the control for `key`, given the current values (keys left
 * out, null or '' read as their defaults) -- options.json's showIf, evaluated once
 * for every host. Takes values the way optionsFromDialog does.
 */
export function optionVisible(key, values = {}) {
  const get = (k) => {
    const v = Object.hasOwn(values, k) ? values[k] : null;
    if (v === null || v === undefined || v === '') return option(k).default;
    return option(k).type === 'bool' ? asBool(v) : v;
  };
  const holds = (c) => (typeof c === 'string' ? get(c) === true
    : c.any ? c.any.some(holds)
    : c.in.includes(get(c.key)));
  return (option(key).showIf || []).every(holds);
}

function option(key) {
  if (!Object.hasOwn(OPTION, key)) throw new Error(`unknown dialog option ${key}`);
  return OPTION[key];
}
function asBool(v) {
  if (v === true || v === false) return v;
  if (typeof v === 'string' && /^(true|false)$/i.test(v)) return v.toLowerCase() === 'true';
  return undefined;
}

export { SCHEMA as OPTIONS_SCHEMA };

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
  const pick = (name, value, allowed) => {
    if (!allowed.includes(value)) throw new Error(`${name} must be one of ${allowed.join(', ')}, got ${JSON.stringify(value)}`);
    return value;
  };
  const mat = MATERIAL[pick('material', opts.material, Object.keys(MATERIAL))];
  // The clearances, exactly as the site's build request sends them (ui/finbuild.js).
  // ALWAYS the full set: buildFins applies them to module state, and a plugin's V8
  // context lives across calls, so a partial set would let a PETG run's clearances
  // leak into the next PLA run.
  const tunables = {
    tineBite: mat.tineBite, padH: mat.padH, padGrab: mat.padGrab, propGap: mat.propGap,
    // Off builds no pad, so which style it carries doesn't matter; Auto keeps it valid.
    padStyle: pick('padStyle', opts.padStyle, PAD_STYLES) === 'off' ? 'auto' : opts.padStyle,
    cutout: pick('cutout', opts.cutout, CUTOUT_PATTERNS),
  };
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
    mode: opts.mode, bedPad: opts.bedPad && opts.padStyle !== 'off', tines: opts.tines,
    tineDensity: opts.tineDensity, layerHeight: opts.layerHeight, coverage: opts.coverage,
    // `sway` is forwarded whole, so a host passes the same object the website's
    // options panel builds; buildFins ignores it unless `on` is set. Like the site
    // (ui/finbuild.js swayOpts), braces take the material's gap and bite unless the
    // host sets its own. A null from the host (Python None) counts as unset, or it
    // would drop sway.js back to PLA's numbers under PETG.
    sway: opts.sway ? { gap: mat.propGap, bite: mat.tineBite,
                        ...Object.fromEntries(Object.entries(opts.sway).filter(([, v]) => v != null)) }
                    : undefined,
    tunables,
  });
  const fin = flatten(built.triangles);
  // Sway braces are appended to the fin soup as one block (web/fins.js), each with
  // its range in points: count them so a host can tell a brace from a fin.
  const swayPoints = (built.fins ?? []).filter((f) => f.kind === 'sway')
    .reduce((n, f) => n + f.triRanges.reduce((m, [a, b]) => m + b - a, 0), 0);
  const swayTris = typeof built.triangles?.[0] === 'number' ? swayPoints / 9 : swayPoints / 3;
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
      // The soup is fins | sway braces | pad, in these counts.
      finTriangles: fin.length / 9 - swayTris,
      swayTriangles: swayTris,
      padTriangles: pad.length / 9,
      // Tined fins (walls with tines); plain walls are `props`. Sway braces are neither.
      braces: built.braceCount ?? 0,
      // plain walls (no tines): every wall when Tines is off. walls = braces + props,
      // as the site's readout counts them
      props: built.propCount ?? 0,
      tines: built.tines ?? 0,
      // Sway braces are counted apart from the fins: they hold a tall part's
      // sides rather than an overhang, so a readout that merged them would
      // claim overhangs were served that nothing is under. `swayReason` says
      // why none were placed, for a host that asked for them and got none.
      swayBraces: built.sway?.count ?? 0,
      swayTines: built.sway?.tines ?? 0,
      swaySkipped: built.sway?.skipped ?? 0,
      swayReason: built.sway?.reason ?? null,
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
