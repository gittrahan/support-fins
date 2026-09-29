/**
 * Combined support -- the entry point the app, the Worker and the plugins call.
 * `buildFins` builds the tined breakaway walls (prop.js) under the overhangs,
 * adds angled wedges under the broad downward faces no wall reached, lays a bed
 * pad under a part that barely touches the plate, and runs sway braces last.
 * docs/FIN-SPEC.md is where every number comes from.
 *
 * The tines are the point. A wall with only a gap constrains the part in one
 * direction and it falls away sideways -- Slant3D demos a cube doing exactly
 * that mid-print. Tines are what make it a *combined* support.
 *
 * WHY THE TINES ARE HORIZONTAL: a horizontal tine prints as one continuous layer
 * line -- the nozzle runs along the wall, crosses into the part and back out,
 * with no retraction, laying a single strong bead. A vertical tine is its own
 * little tower grown a dot per layer: frail, often never touching the part, and
 * a retraction each. Horizontal tines also lie in the plane of the layer lines,
 * which is what lets you BEND them to snap clean instead of tearing them out.
 *
 * LAYOUT. This file is the entry point: `buildFins`, `buildFinsCore` (auto and
 * prop), `applyTunables`, `coverPitch`, and re-exports of everything app.js,
 * orient.js, finworker.js, ui/, the plugins and the tests import. The pieces
 * live in web/fins/:
 *
 *   config.js     FIN, the tine, pad and coverage numbers the UI shares
 *   seating.js    how the part sits on the plate: contact, face/edge/point
 *   pad.js        PAD and the bed pad (conforming oval, or the brim-style one)
 *   wedges.js     angled wedges where no wall reaches; gripPatches for Draw
 *   shortwalls.js the last resort: short, stocky walls where nothing else reached
 *
 * Each module imports only modules above it in this list and never fins.js.
 */
import { floatingPieces } from './pieces.js';
import { findWallPatches } from './planes.js';
import { buildProps, noProps, PROP } from './prop.js';
import { buildSwayBraces } from './sway.js';
import { CUT, CUTOUT_PATTERNS } from './cutout.js';
import { FIN } from './fins/config.js';
import { buildPad, PAD } from './fins/pad.js';
import { bedContact, seatedPartTris, seatingOf } from './fins/seating.js';
import { lastResortWalls } from './fins/shortwalls.js';
import { buildPerpFins, PERP, propServesPatch, unservedAfterWedges, wedgeVeto } from './fins/wedges.js';

// Moved into web/fins/ (one module per concern); re-exported here so every
// importer of fins.js is unchanged.
export { FIN } from './fins/config.js';
export { PAD } from './fins/pad.js';
export { gripPatches, perpColumns } from './fins/wedges.js';

/**
 * Wedge row pitch for a coverage setting, mirroring prop.js's coverRowSpan: 0.5 is
 * the neutral default (coverSparse, the pre-slider behaviour), left of it loosens
 * toward coverExtraSparse, right of it tightens toward coverDense. Kept monotonic.
 */
function coverPitch(coverage) {
  const c = Math.max(0, Math.min(1, coverage));
  return c <= 0.5
    ? FIN.coverSparse + ((0.5 - c) / 0.5) * (FIN.coverExtraSparse - FIN.coverSparse)
    : FIN.coverSparse - ((c - 0.5) / 0.5) * (FIN.coverSparse - FIN.coverDense);
}

/**
 * Apply the page's clearance settings to FIN / PROP / PAD.
 *
 * WHY THIS IS A PARAMETER AND NOT JUST A MODULE EDIT. ui/settings.js sets these objects
 * directly (applyMaterial for the PLA/PETG profiles, the Support gap and Pad grip
 * fields) and that works for anything it builds itself. But the real build runs in
 * finworker.js, a module Worker with its OWN instance of fins.js and prop.js: module
 * state does not cross a Worker boundary, so everything the page set stayed on the
 * page. PETG picked in Auto mode therefore printed PLA's clearances -- silently, since
 * the numbers on screen were right and only the geometry disagreed.
 *
 * So the values travel WITH the build request (opts.tunables, structured-cloned like
 * every other option) and are applied here, in whichever instance is doing the work.
 * Unknown or non-finite entries are ignored, and calling this with nothing leaves the
 * defaults alone -- an old caller that doesn't pass tunables behaves exactly as before.
 */
export function applyTunables(t) {
  if (!t) return;
  const set = (obj, key, v) => { if (Number.isFinite(v)) obj[key] = v; };
  set(FIN, 'tineBite', t.tineBite);
  set(FIN, 'padH', t.padH);
  set(PAD, 'grab', t.padGrab);
  if (['auto', 'light', 'sure', 'custom'].includes(t.padStyle)) PAD.style = t.padStyle;
  if (t.padCustom) for (const k of Object.keys(PAD.custom)) set(PAD.custom, k, t.padCustom[k]);
  set(PROP, 'gap', t.propGap);
  // The wedge keeps its own copy of the clearance, so the Support gap field and the
  // PETG profile never reached it -- not even on the main thread, where everything
  // else worked. One clearance, applied everywhere it is spelled.
  set(PERP, 'gap', t.propGap);
  // Not a clearance, but module state with the same Worker problem.
  if (CUTOUT_PATTERNS.includes(t.cutout)) CUT.pattern = t.cutout;
}

/**
 * Generate supports for the part in its current orientation.
 *
 * @param opts.mode     'prop' (the default: a vertical breakaway wall under
 *                      each overhang, no tines) or 'auto' (tined walls PLUS
 *                      wedges under the faces no wall reached). 'stabilize' is
 *                      an old name for 'auto'; any other mode builds 'prop'.
 * @param opts.bedPad   add the pad when bed contact is too small to hold
 */
export function buildFins(topo, result, rot, opts = {}) {
  const built = buildFinsAndBraces(topo, result, rot, opts);
  // A piece of the part that starts in mid-air (a cut clean through, a loose
  // body) needs saying no matter what was placed: see floatingPieces.
  built.floating = floatingPieces(topo, result, rot);
  return built;
}

function buildFinsAndBraces(topo, result, rot, opts = {}) {
  applyTunables(opts.tunables);
  const built = buildFinsCore(topo, result, rot, opts);
  // Sway braces are an optional ADD-ON to whatever the mode placed (sway.js): a
  // tall part still needs its overhangs held, and bracing its sides is a
  // separate job on separate faces.
  if (!opts.sway?.on) return built;
  // Braces run LAST, so everything this mode placed is already on the plate: hand
  // the props' and wedges' centrelines over as things to stand clear of. Fused to
  // one of those, a brace is no longer a piece that snaps off by itself.
  const walls = (built.fins ?? []).map((f) => f.line).filter((l) => Array.isArray(l) && l.length);
  const sw = buildSwayBraces(topo, result, rot,
    { ...opts.sway, tines: opts.tines, layerHeight: opts.layerHeight, avoid: { walls } });
  // Each brace also gets a fin record: the Auto view draws and exports only the
  // triangles some record claims (per-fin removal), so an unrecorded brace would
  // be counted in the readout but never shown or written out.
  const base = built.triangles.length;
  const fins = built.fins ?? [];
  let id = fins.reduce((m, f) => Math.max(m, (f.id ?? -1) + 1), fins.length);
  const braces = sw.ribs.map((r) => ({
    height: r.height, length: r.depth, tines: r.tines, rows: 0, stilt: 0, lean: 0, bearing: 0, site: null,
    id: id++, kind: 'sway',
    triRanges: [[r.triRange[0] + base, r.triRange[1] + base]],
    line: r.foot, span: r.depth,
  }));
  return {
    ...built,
    triangles: [...built.triangles, ...sw.triangles],
    fins: [...fins, ...braces],
    sway: { count: sw.count, tines: sw.tines, skipped: sw.skipped, reason: sw.reason,
            // The outlines travel back so a brace the user then clicks by hand can be
            // checked against these: Auto builds in the Worker, so the page has no
            // other way to know where they stand. Plain data, structured-cloneable.
            braces: (sw.ribs ?? []).map((r) => ({ foot: r.foot, halfW: r.halfW, th: r.th,
                                          height: r.height, levels: r.levels })) },
  };
}

function buildFinsCore(topo, result, rot, opts = {}) {
  const mode = opts.mode ?? 'prop';
  const padOut = [];

  // THE COMBINED SUPPORT IS A TINED PERPENDICULAR RIB (prop.js), not the old
  // beside-the-face fin that lay FLAT against the part. A support fin has to stand
  // PERPENDICULAR to the part -- a wall UNDER the overhang, rising off the plate as
  // an upside-down T, gripped along its top by a comb of tines -- the way a human
  // draws one and the way it actually prints. The earlier geometry leaned the wall
  // parallel to the face (planes.js "the fin leans with the part"), which put a
  // 35deg-raked blade flat on a 35deg-tilted cube: wrong, and the reason this was
  // rebuilt.
  //
  // So both the grip mode ('stabilize') and the recommendation ('auto') now
  // deliver prop.js's rib with the tine comb ON. prop.js already sites these
  // correctly: one wall down a curved tube's lowest line, rows across a wide flat
  // overhang, part-attached where a floor sits under the overhang -- all watertight
  // and weld-certified. Tines default ON here (that is what makes it "combined"
  // rather than a plain breakaway prop); 'prop' proper leaves them off. The old
  // leaning-fin machinery (rankSites / chooseSpan / buildFin) was deleted once
  // nothing reached it; git history has it.
  if (mode === 'auto' || mode === 'stabilize') {
    const withTines = opts.tines ?? true;
    // Wide-face coverage (0 sparse .. 1 dense) drives how densely a broad face is
    // lined -- the prop rows (buildProps reads opts.coverage, forwarded below) and
    // the wedge row pitch here. Denser only ADDS supports and never loosens past
    // the structural cap, so dragging it right can't strand an overhang. Pinned by
    // tests/coverage.test.js.
    const coverage = Math.max(0, Math.min(1, opts.coverage ?? FIN.coverDefault));
    const covPitch = coverPitch(coverage);
    // The wedge candidates: broad down-facing patches. Found before the props so
    // a raster wall can be kept off the ones the normal pass leaves to a wedge
    // (wedgeVeto).
    const wedgeable = findWallPatches(topo, rot, result.offset).filter((p) =>
      p.n.z < -0.05 && p.area >= PERP.minArea && (p.u1 - p.u0) >= PERP.minWidth);
    const wedgeOpts = { tines: withTines, pitch: covPitch, tineDensity: opts.tineDensity };
    const base = buildFinsCore(topo, result, rot, { ...opts, mode: 'prop', tines: withTines,
      rasterVeto: wedgeVeto(wedgeable, topo, rot, result.offset, wedgeOpts) });

    // Add ANGLED WEDGES on grippable down-facing patches that NO prop wall
    // reached -- the wide/long leaning face where a vertical wall is blocked by
    // the part itself. "Reached" is decided in SPACE (a prop line under the
    // patch's footprint), not by face-index, because a wall-patch and an overhang
    // region grow from different seeds and don't share a face set. Patches props
    // already serve are left untouched, so the reachable parts don't change.
    const wedgeTris = [];
    const wedgeRecs = [];   // per-wedge records, triRange into wedgeTris (pre-offset)
    let wedgeTines = 0;
    let wedgedPatches = 0;
    for (const p of wedgeable) {                    // downward, broad faces only
      if (propServesPatch(p, base.props)) continue; // a prop already stands under it
      const w = buildPerpFins(p, topo, rot, result.offset, wedgeOpts);
      if (!w.count) continue;
      // Offset each wedge's range from its per-call `out` into the merged
      // wedgeTris array, so the range lands correctly in the final triangles.
      const off = wedgeTris.length;
      for (const v of w.triangles) wedgeTris.push(v);
      for (const wd of w.wedges) {
        wedgeRecs.push({ triRange: [wd.triRange[0] + off, wd.triRange[1] + off],
                         line: wd.line, height: wd.height, span: wd.span });
      }
      wedgeTines += w.tines; wedgedPatches++;
    }
    const wedgeCount = wedgeRecs.length;

    // LAST RESORT: short walls under the regions no wall or wedge reached (issue
    // #121's strut lattice). Only bare regions, so a served part is unchanged.
    // `lastResort: false` skips it, like `raster: false` (the tests' baselines).
    // A point-seated part with the pad off gets no walls (the prop-mode gate below);
    // the last resort must not build them back.
    const noShort = opts.lastResort === false || (base.seating?.kind === 'point' && !base.pad);
    const short = noShort ? { triangles: [], props: [], served: [], tines: 0 } : lastResortWalls(topo, result, rot, { ...opts, tines: withTines, coverage },
                                  base.servedRegions ?? [], wedgeTris, [...base.triangles, ...wedgeTris]);

    // Unified per-fin array: each entry carries its triangle segment(s) into the
    // final `built.triangles`, so the UI can address and remove an individual fin
    // by its geometry. Prop ranges already index `base.triangles` (the prefix of
    // the merged array); wedge ranges are offset past it by base.triangles.length.
    // base.fins[i] is order-aligned with base.props[i] (it is built from it), so
    // the existing stats fields carry over and only triRanges/id/kind are added.
    const baseLen = base.triangles.length;
    const fins = base.props.map((q, i) => ({
      ...(base.fins[i] ?? {}),                     // existing stats (height/length/tines/...)
      id: q.id ?? i, kind: 'prop',
      triRanges: q.triRanges ?? [],
      line: q.line, span: q.span, height: q.height,
    }));
    let wid = fins.length;
    for (const wd of wedgeRecs) {
      fins.push({
        height: wd.height, length: wd.span, tines: 0, rows: 0, stilt: 0, lean: 0, bearing: 0, site: null,
        id: wid++, kind: 'wedge',
        triRanges: [[wd.triRange[0] + baseLen, wd.triRange[1] + baseLen]],
        line: wd.line, span: wd.span,
      });
    }
    const shortAt = baseLen + wedgeTris.length;
    // Into the merged triangles, for fins AND props (prototype/examples/compare.js
    // reads props' ranges against result.triangles).
    const shortProps = short.props.map((q) => ({ ...q, triRanges: q.triRanges.map(([a, b]) => [a + shortAt, b + shortAt]) }));
    for (const q of shortProps) {
      fins.push({
        height: q.height, length: q.span, tines: q.tines ?? 0, rows: 0, stilt: 0, lean: 0, bearing: 0, site: null,
        id: wid++, kind: 'prop', short: true,
        triRanges: q.triRanges,
        line: q.line, span: q.span,
      });
    }
    const servedRegions = [...(base.servedRegions ?? []), ...short.served];
    return {
      ...base, mode,
      triangles: [...base.triangles, ...wedgeTris, ...short.triangles],
      props: [...base.props, ...shortProps],
      servedRegions,
      fins,
      tines: (base.tines ?? 0) + wedgeTines + short.tines,
      // A tined rib/wedge IS the combined support (a "brace"); a tineless one is a
      // plain prop. Report the split so the stress harness / UI metrics keep working.
      braceCount: withTines ? fins.length : wedgeCount,
      propCount: withTines ? 0 : base.fins.length + short.props.length,
      unserved: wedgedPatches ? unservedAfterWedges(topo, rot, result, servedRegions, wedgeTris)
                              : (base.unserved ?? 0) - short.served.length,
    };
  }

  // Prop (and any other mode) is its own support, built by its own module -- a
  // wall UNDER each overhang with no tines.
  const contact = bedContact(topo, result, rot);
  const seating = seatingOf(result, contact.pts);
  const pad = (opts.bedPad ?? true) && result.bedArea < FIN.padMinArea
    ? buildPad(contact.pts, seatedPartTris(topo, rot, result.offset), padOut, opts.layerHeight) : null;
  // A part seated on a POINT gets no props -- nothing standing on the plate
  // can hold a part that never touches it -- UNLESS the bed pad is on, in
  // which case the pad is what seats it and the walls have something to work
  // against. That is not speculation, it is the shelter workflow this whole
  // tool descends from: hub.py's apex hub is a SPHERE-bottomed part with
  // 0.0 mm2 of bed contact, and it printed cleanly as core pad + two webs
  // (tools/shelter/hub.py --supports). The first version of this gate
  // refused it -- the flagship real-world part, the one breakaway.py was
  // written for -- while the readout said "rotate", which is exactly the
  // advice the printed evidence contradicts. Refuse only when the user has
  // turned the pad off.
  const built = seating.kind === 'point' && !pad
    ? noProps() : buildProps(topo, result, rot, opts);
  return {
    triangles: built.triangles, padTriangles: padOut, pad, mode,
    // Carry each prop's triangle range + identity up so per-fin removal can
    // address an individual fin regardless of which mode produced it. The stats
    // fields (height/length/tines/...) are preserved; triRanges/id/kind/line are
    // additive on top of built.props (which already carry them).
    fins: built.props.map((q) => ({
      height: q.height, length: q.span, tines: 0, rows: 0,
      stilt: 0, lean: 0, bearing: 0, site: null,
      id: q.id, kind: q.kind ?? 'prop',
      triRanges: q.triRanges ?? [], line: q.line, span: q.span,
    })),
    props: built.props,
    volume: built.volume,
    // Prop's own reasons, unflattened. These USED to be squashed into the
    // stabilize-shaped object below, which keeps only `blocked` -- so noLine,
    // notALine, stub, degenerate and buried were dropped before anything could
    // read them. M5 was then measured through that channel and recorded as
    // working on parts where it built nothing: hub_post_foot reported
    // `blocked: 0` at 0 degrees when the real reason was `buried: 1`.
    // Whatever explains a failure has to survive the trip to the UI.
    skipped: built.skipped,
    rejected: { blocked: built.skipped.blocked, tooFewTines: 0,
                sites: result.regions.length,
                tried: result.regions.length },
    patchCount: 0, patchStats: {}, tines: built.tines ?? 0,
    servedRegions: built.servedRegions ?? [],
    // regions minus SERVED REGIONS, not minus the prop count: a region can
    // yield several walls now that it is split into sub-patches, and the old
    // subtraction would go negative.
    unserved: result.regions.length - built.served,
    sagRisk: built.sagRisk ?? false,
    seating,
    tip: null,
  };
}
