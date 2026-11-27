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
import { applyTunables, buildFins } from '../../../web/fins.js';
import { bareArea, FILL } from '../../../web/fins/fill.js';
import { automaticTargets } from '../../../web/fins/coverage.js';
import { forgetSeated } from '../../../web/fins/seating.js';
import { seatSoup, clearances, flatten, interfaceMask } from './seat.js';
import SCHEMA from './options.json' with { type: 'json' };
import { nozzleSize } from './nozzle.js';
import { nominalContext, printabilityStats } from '../../../web/fins/printability.js';

// The dialog settings (options.json) are the one source of their defaults: every
// plugin's dialog is built from the same file, so the entry can't disagree with it.
const OPTION = Object.fromEntries(SCHEMA.options.map((o) => [o.key, o]));

export const ENGINE_DEFAULTS = Object.freeze({
  mode: OPTION.mode.default,                 // 'auto' | 'full' (Full coverage, web/fins/fill.js)
  longWalls: OPTION.longWalls.default,       // Full coverage's rows along the part (fins/rows.js)
  separateWalls: OPTION.separateWalls.default, // 'auto' (on for vertical resin tines, as the site ticks it) | 'on' | 'off'
  bedPad: true,        // older hosts' switch; padStyle 'off' turns the pad off too
  tines: OPTION.tines.default,
  tineDensity: OPTION.tineDensity.default,   // 0..1 (the site's slider / 100)
  coverage: OPTION.coverage.default,         // 0..1 (the site's slider / 100)
  plateOnly: OPTION.plateOnly.default,       // supports on the plate only, none on the part (#218)
  layerHeight: OPTION.layerHeight.default,   // a slicer host passes its own
  nozzle: OPTION.nozzle.default,
  threshold: DEFAULT_THRESHOLD,              // degrees; options.json's default is pinned to it
  gap: OPTION.gap.default,             // mm: the site's Support gap (PROP.gap)
  sideClearance: OPTION.sideClearance.default,
  bottomGap: OPTION.bottomGap.default,
  padStyle: OPTION.padStyle.default,   // one of PAD_STYLES
  cutout: OPTION.cutout.default,       // one of web/cutout.js CUTOUT_PATTERNS
  tineDir: OPTION.tineDir.default,     // 'horizontal' (FDM) | 'vertical' (resin pins, #309)
  pinDepth: OPTION.pinDepth.default,   // mm a resin pin sinks into the part
  // Sway braces (web/sway.js), off by default exactly as on the website. Pass
  // { on: true } to brace the tall sides, plus any of gripFrom / tineSpacing /
  // reach / gap to match the host's own settings. Without this a plugin
  // could not reach the feature at all: the options below are an explicit list,
  // so anything absent from it never arrives at buildFins.
  sway: null,
  // The print's layer boundaries (web/prop/levels.js): sorted z of every layer
  // boundary, from 0, in the seated frame (the part's lowest point at 0). A slicer
  // host passes its own, so tines land on the layers it really prints, whatever its
  // first layer or adaptive profile. null: the uniform layerHeight grid, as the site.
  levels: null,
  // The interface crest (web/prop/crest.js): false, 'flat' or 'all'. On, the top
  // layer of each wall is its own solid, tagged in the result's `iface`, so a host
  // can print it in a second material.
  iface: false,
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
    if (key === 'nozzle') {
      // A choice in a dialog, but a slicer supplies its own size (hostSupplied).
      out.nozzle = nozzleSize(raw);
      continue;
    }
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

// Separate walls, resolved: the site ticks its box when Vertical (resin) tines is
// picked (web/ui/settings.js), but a dialog stores whatever it holds, so the
// schema's 'auto' stands in for that. true/false are taken as on/off.
function separateWalls(opts) {
  const v = opts.separateWalls;
  if (v === true || v === 'on') return true;
  if (v === false || v === 'off') return false;
  if (v === 'auto' || v == null) return opts.tineDir === 'vertical';
  throw new Error(`separateWalls must be auto, on, off, true or false, got ${JSON.stringify(v)}`);
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
 * @returns {{ triangles: Float32Array, iface: Uint8Array, offset: {x:number,y:number,z:number},
 *            pieces: {id:string, kind:string, tines:number, line:number[][]|null, ranges:number[][]}[],
 *            overFaces: Int32Array, smallFaces: Int32Array, stats: object }}
 *   iface      one byte per triangle of `triangles`: 1 for the interface crest (and,
 *              under iface 'all', the tines), so a host can print it in a second
 *              material. All 0 while the `iface` option is off.
 *   pieces     what each run of `triangles` is, so a host can make one object per fin:
 *              kind 'prop' (a wall) | 'wedge' | 'sway' | ... as web/fins.js tags it, and
 *              'pad'; ranges are [first, end) TRIANGLE indices into `triangles`. Every
 *              triangle belongs to exactly one piece. ids are stable for the same part
 *              and options, not across edits. `tines` is the piece's tine count;
 *              `line` is the engine's line for the piece, seated ([x, y, z] points;
 *              null for the pad): a wall's or a wedge's contact line, but a sway
 *              brace's foot on the plate. bareOverhangs takes the pieces' kind and line.
 *   overFaces  indices of the INPUT faces in the overhang regions the engine supports:
 *              the site paints these red (web/ui/part.js paintOverhangs, res.kept)
 *   smallFaces faces past the threshold in area-based slivers or recognised
 *              small-hole ceilings left for bridging, painted amber on the site
 *              after generation: a host should show them too, not hide them
 */
export function computeFins(positions, options = {}) {
  const opts = { ...ENGINE_DEFAULTS, ...options };
  const { tunables } = clearances(opts);
  const { pos, shift } = seatSoup(positions);
  const topo = buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
  const result = analyze(topo, opts.threshold, IDENTITY3);
  const offset = { x: result.offset.x - shift.x, y: result.offset.y - shift.y, z: result.offset.z - shift.z };
  const built = buildFins(topo, result, IDENTITY3, {
    mode: opts.mode, bedPad: opts.bedPad && opts.padStyle !== 'off', tines: opts.tines,
    tineDensity: opts.tineDensity, layerHeight: opts.layerHeight, levels: opts.levels,
    // Full coverage aims at every reachable overhang: the slider is Auto's, so Full
    // builds at its default as the site does (ui/finbuild.js finOpts)
    coverage: opts.mode === 'full' ? OPTION.coverage.default : opts.coverage,
    plateOnly: opts.plateOnly, longWalls: opts.longWalls, separateWalls: separateWalls(opts),
    // `sway` is forwarded whole, so a host passes the same object the website's
    // options panel builds; buildFins ignores it unless `on` is set. Like the site
    // (ui/finbuild.js swayOpts), braces take the Support gap unless the
    // host sets its own. A null from the host (Python None) counts as unset, or it
    // would drop sway.js back to its own 0.2 under a wider gap.
    sway: opts.sway ? { gap: tunables.propGap,
                        ...Object.fromEntries(Object.entries(opts.sway).filter(([, v]) => v != null)) }
                    : undefined,
    tunables,
    turning: opts.turning ? { ...opts.turning, layerOffset: result.offset.z - shift.z } : null, // internal; no public control
    // Internal host context, not a public engine option. A saved project must
    // supply its actual slicing widths/schedule. Omission adds no inspection
    // cost; a host can explicitly request a labelled nozzle proxy with true.
    diagnostics: !opts.diagnostics ? null : opts.diagnostics?.frame === 'input'
      ? { ...opts.diagnostics, plateZ: offset.z }
      : opts.diagnostics === true ? nominalContext(opts.layerHeight, tunables.nozzle, tunables.bottomGap ?? 0.2) : opts.diagnostics,
  });
  // buildFins does not re-analyse the mesh. Its automatic exclusion mask moves
  // only exempt ceilings to amber, without changing the original analysis.
  const overFaces = [], smallFaces = [];
  for (let f = 0; f < result.over.length; f++) {
    if (result.kept[f] && !built.smallHoleMask?.[f]) overFaces.push(f);
    else if (result.over[f]) smallFaces.push(f);
  }
  const fin = flatten(built.triangles);
  const pad = flatten(built.padTriangles || []);
  const triangles = new Float32Array(fin.length + pad.length);
  triangles.set(fin, 0);
  triangles.set(pad, fin.length);
  const pieces = piecesOf(built, fin.length / 9, pad.length / 9);
  // which triangles are interface (the crest), so a host can give them their own
  // material; the pad is never interface
  const iface = new Uint8Array(triangles.length / 9);
  iface.set(interfaceMask(built.triangles).subarray(0, fin.length / 9), 0);
  // Sway braces are appended to the fin soup as one block (web/fins.js): count them
  // so a host can tell a brace from a fin.
  const swayTris = pieces.filter((p) => p.kind === 'sway')
    .reduce((n, p) => n + p.ranges.reduce((m, [a, b]) => m + b - a, 0), 0);
  return {
    triangles,
    // seated = input + offset  (so the caller maps fins back with input = seated - offset)
    offset,
    pieces,
    iface,
    overFaces: Int32Array.from(overFaces),
    smallFaces: Int32Array.from(smallFaces),
    diagnostics: built.printability ? { support: built.printability, coverage: built.coverage, offset } : null,
    stats: {
      ...(built.turning ?? {}),
      ...printabilityStats(built.printability),
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
      // the tines are resin pins (#309): the report names them so
      pins: tunables.tineDir === 'vertical',
      // Sway braces are counted apart from the fins: they hold a tall part's
      // sides rather than an overhang, so a readout that merged them would
      // claim overhangs were served that nothing is under. `swayReason` says
      // why none were placed, for a host that asked for them and got none.
      swayBraces: built.sway?.count ?? 0,
      swayTines: built.sway?.tines ?? 0,
      swaySkipped: built.sway?.skipped ?? 0,
      swayReason: built.sway?.reason ?? null,
      unserved: built.unserved ?? null,
      // Full coverage's red its fill walls left bare (mm², rounded here so every host
      // prints the same number), and whether the fill stopped at its wall cap: the
      // site's readout says both (web/ui/readout.js); `unserved` counts regions with no
      // wall at all, so a region the fill reached but didn't finish never shows in it
      fullBare: built.fill ? Math.round(built.fill.unservedArea ?? 0) : 0,
      fullCapped: !!built.fill?.capped,
      smallHoleRegions: built.smallHoleRegions ?? 0,
      // pieces that start in mid-air (see overhangs.js floatingPieces), with the
      // drop of the first: the plugins' readouts say so, as the site's does
      floating: built.floating?.length ?? 0,
      floatingDrop: built.floating?.[0]?.drop ?? 0,
    },
  };
}

// web/fins.js tags each fin with its runs of `built.triangles` (triRanges), counted
// in that array's elements: points ([x,y,z] triples) or, on a flat path, numbers.
// Turn them into triangle ranges of the flattened soup, then add the pad after them.
function piecesOf(built, finTris, padTris) {
  const per = typeof built.triangles?.[0] === 'number' ? 9 : 3;
  const pieces = (built.fins ?? []).map((f) => ({
    id: String(f.id), kind: f.kind, tines: f.tines ?? 0,
    // the wall's contact line, seated, as bareArea reads it (bareOverhangs)
    line: Array.isArray(f.line) ? f.line.map((q) => [q[0], q[1], q[2]]) : null,
    ranges: f.triRanges.map(([a, b]) => [a / per, b / per]),
  }));
  if (padTris) pieces.push({ id: 'pad', kind: 'pad', tines: 0, line: null, ranges: [[finTris, finTris + padTris]] });
  return pieces;
}

/**
 * How many overhangs a set of walls leaves bare: the overhang regions (the ones
 * computeFins targets: small-hole ceilings left for bridging are not counted) that
 * need support and that no wall serves -- the engine's `unserved`, recounted from
 * the walls a host keeps. A host that drops some of computeFins' walls, or draws its
 * own (drawWall), has no other count. A region needs support when it holds at least
 * FILL.minGain (mm2) of red (web/fins/fill.js bareArea, the measure the site's
 * readout uses for the red left bare); a wall serves it when it holds at least that
 * much of it, the gain the fill asks of a wall. A sway brace and the pad hold no red.
 * For computeFins' own walls this matches `unserved`, with one difference: `unserved`
 * also counts a region as served when a wedge's body comes near it
 * (web/fins/wedges.js bareAfterWedges), and a wall's line here reaches only as far
 * as the fill's reach. In the stress models, 2 of 176 builds differ: lowledge at
 * X120, a ledge under 1 mm high at the plate that only the wedge's foot is near.
 *
 * @param positions  the part, as for computeFins
 * @param walls      the kept walls, as `{ kind, line }`: computeFins' pieces, or a
 *                   drawn wall as `{ kind: 'drawn', line }`. `line` is the wall's
 *                   contact line ([x, y, z] points) in the frame of `positions`
 *                   (a piece's line less the result's offset); null holds nothing.
 * @param options    as for computeFins (mode, threshold, nozzle, gap, coverage)
 * @returns {number} the count of overhang regions no wall serves
 */
export function bareOverhangs(positions, walls, options = {}) {
  if (!Array.isArray(walls)) throw new Error('walls must be a list of { kind, line }');
  for (const w of walls) {
    const ok = w && typeof w.kind === 'string' && (w.line == null || (Array.isArray(w.line)
      && w.line.every((q) => Array.isArray(q) && q.length === 3 && q.every(Number.isFinite))));
    if (!ok) throw new Error(`walls must be { kind, line } with line [x, y, z] points or null, got ${JSON.stringify(w)?.slice(0, 80)}`);
  }
  const opts = { ...ENGINE_DEFAULTS, ...options };
  const { tunables } = clearances(opts);
  applyTunables(tunables);
  // Full builds at the default coverage whatever the host sends (computeFins)
  const coverage = opts.mode === 'full' ? OPTION.coverage.default : opts.coverage;
  const { pos, shift } = seatSoup(positions);
  const topo = buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
  const analysed = analyze(topo, opts.threshold, IDENTITY3);
  const off = { x: analysed.offset.x - shift.x, y: analysed.offset.y - shift.y, z: analysed.offset.z - shift.z };
  const seated = (line) => line.map((q) => [q[0] + off.x, q[1] + off.y, q[2] + off.z]);
  const holding = walls.filter((w) => w.kind !== 'sway' && w.kind !== 'pad' && w.line?.length);
  try {
    const result = automaticTargets(topo, analysed, IDENTITY3);
    const regionOf = new Int32Array(topo.nFaces).fill(-1);
    result.regions.forEach((r, i) => { for (const f of r.faces) regionOf[f] = i; });
    // the red of each region that the walls leave (each cell's area goes to every
    // region its faces belong to)
    const red = (lines) => {
      const fins = lines.map((line) => ({ kind: 'prop', line }));
      const { points, sourceFaces } = bareArea(topo, result, IDENTITY3, { coverage }, { fins }, true);
      const per = new Float64Array(result.regions.length);
      points.forEach((p, k) => {
        for (const r of new Set(sourceFaces[k].map((f) => regionOf[f]))) if (r >= 0) per[r] += p[3];
      });
      return per;
    };
    const lines = holding.map((w) => seated(w.line));
    const all = red([]);
    const left = lines.length ? red(lines) : all;
    let bare = 0;
    for (let r = 0; r < all.length; r++) {
      if (all[r] >= FILL.minGain && all[r] - left[r] < FILL.minGain) bare++;
    }
    return bare;
  } finally {
    forgetSeated(topo);
  }
}
