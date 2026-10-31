/**
 * PROP mode -- a breakaway wall that stands UNDER an overhang.
 *
 * This is a different support from the fin in fins.js, not a variant of it, and
 * the difference is what it leans on:
 *
 *   Stabilize  a wall BESIDE the part, gripping a face with horizontal tines.
 *              Needs a face to grip, so it cannot serve a cone or a sphere.
 *   Prop       a wall UNDER the overhang, rising from the plate and stopping
 *              `gap` short. The part bridges that last layer, so the wall never
 *              fuses and it snaps off. Needs only an underside contact line,
 *              which every shape has.
 *
 * A prop has no tines, deliberately. Tine-less supports were rejected early in
 * this project on Slant3D's demo of a cube falling away from one -- but that is
 * a part balanced on an EDGE with the support as its only restraint. A part
 * sitting down on the plate with an overhang above it has no such failure mode:
 * gravity holds it onto the prop. `tools/support/breakaway.py` in the video repo
 * works exactly this way, has no tines anywhere in it, and produced good fins on
 * real printed shelter hubs -- the parts Stabilize could not touch.
 *
 * The geometry is M3's, which was validated (34/36 regions served, every wall
 * watertight) and then retired for the wrong reason. What is new here is the
 * judgement around it: a prop is only emitted where the wall can actually reach
 * the plate through open air.
 *
 * LAYOUT. This file is the entry point: `buildProps` (the auto-placer's whole
 * pass over a part), `noProps`, `coverRowSpan`, and re-exports of everything
 * fins.js, draw.js, ui/ and the tests import. The pieces live in web/prop/:
 *
 *   config.js     PROP, every number a wall is built from
 *   surface.js    seat a vertex; part surface height(s) above (x, y)
 *   contact.js    the contact line under an overhang, settled to exactly `gap`
 *   crest.js      the interface crest: a wall's top band as its own tagged solid
 *   sweep.js      the wall solid: the upside-down T, and a part-attached wall
 *   brace.js      ribs at the plate for a short wall that stands tall (the fill pass's)
 *   ties.js       zigzag struts tying two neighbouring walls into one frame (the fill pass's)
 *   clearance.js  which stations can carry a wall (reach, certification, runs)
 *   tines.js      the grip comb along a wall's top
 *   endrows.js    flush end rows at a patch's free edges (a candidate the judge races, 062)
 *   tracks.js     where Suggest puts walls: straight patches, tracks, tube line
 *   mold.js       the floor under a wall on the part, and its bottom's shape
 *   attached.js   walls that stand on the part instead of the plate
 *   squat.js      brimmed squat walls for the near-bed band
 *   judge.js      the 062 judge: held as a bridge or a short cantilever (races, scoreboard)
 *   rival.js      a small tube against the patch path: the region keeps the better
 *   raster.js     walls across a region's whole footprint, raced against the rest
 *   lattice.js    a net of struts cut back into struts (the raster slot's contender for a net)
 *   downhill.js   walls that run down an overhang and follow it to the plate (#25)
 *   curved.js     the Curved walls checkbox: when a bending downhill wall wins its race
 *   trace.js      the Curved walls' tracing surface: regions grown across the slivers, grouped
 *   arc.js        one wall along a level strip that curves in plan (a slot through a tube)
 *   rim.js        a wall along a patch's free outline, the rows stopped short of it (062)
 *   regions.js    each region's patches for one pass (tube, arc, split, raster, downhill, strut, circular)
 *   place.js      one track -> its walls: part-attached, or plate wall trimmed / settled / swept, + squat bed
 *
 * Each module imports only modules above it in this list and never prop.js.
 */
import { insidePart } from './inside.js';
import { PROP } from './prop/config.js';
import { clipToRim, rimTracks } from './prop/rim.js';
import { JUDGE, judgeRuler } from './prop/judge.js';
import { bends } from './prop/curved.js';
import { circularRegions } from './prop/circular.js';
import { DOWNHILL } from './prop/downhill.js';
import { raceAgainst, withRaster } from './prop/raster.js';
import { tubeRivalry } from './prop/rival.js';
import { bridgeRace } from './prop/bridgerace.js';
import { traceGroups } from './prop/trace.js';
import { seat } from './prop/surface.js';
import { tineStepFor } from './prop/tines.js';
import { patchTracks } from './prop/tracks.js';
import { regionPatches } from './prop/regions.js';
import { placeLine } from './prop/place.js';

// Re-exported so fins.js, draw.js, ui/ and the tests import from prop.js alone.
export { PROP } from './prop/config.js';
export { splitRegion, tubeLine, patchTracks } from './prop/tracks.js';
export { straightness, contactLine, lowerSag, contourTop, settleTop } from './prop/contact.js';
export { footFor, profileHalf, sweep, sweepBetween } from './prop/sweep.js';
export { BRACE, braceWall } from './prop/brace.js';
export { TIE, tieWalls } from './prop/ties.js';
export { surfaceHitsAt, surfaceZAt, surfaceZsAt } from './prop/surface.js';
export { stationIsClear, stationCertified, pathToPlateIsClear, longestRun,
  withLowTails, insertFloorStations, welds } from './prop/clearance.js';
export { tineStepFor, emitTines } from './prop/tines.js';
export { crestOn, crestKinds, crestPart, emitCrest, flatCrestRing, flatCut, splitInterface } from './prop/crest.js';
export { PART_BAND, trimmedEnds } from './prop/attached.js';
export { floorLine, moldLine } from './prop/mold.js';
export { sweepSquat, buildSquatBed } from './prop/squat.js';

/**
 * What buildProps returns when it builds nothing -- kept here so the callers
 * that refuse to build (a part seated on a point) return the same shape.
 */
export function noProps() {
  return {
    triangles: [], props: [], served: 0, volume: 0,
    skipped: { noLine: 0, wanders: 0, stub: 0, blocked: 0,
               degenerate: 0, buried: 0, weld: 0, sliver: 0, onPart: 0 },
  };
}

// mm row pitch at the sparsest coverage (0). This is DELIBERATELY wider than
// maxUnsupportedSpan: the mid-slider (0.5) is the structural anti-sag cap, and
// dragging left of it trades sag safety for fewer supports -- the tool warns when
// a part actually lands a row wider than the cap (buildProps.sagRisk). Matthew
// asked for this: a small part was floored at 3 fins by the hard cap.
export const COVER_SPARSE_SPAN = 30.0;

/**
 * Wide-face row pitch for a coverage setting. 0.5 is the neutral default and maps
 * to the structural cap (maxUnsupportedSpan) -- the old sparse behaviour, so a part
 * built at the slider's default is byte-identical to before. Left of centre loosens
 * past the cap toward COVER_SPARSE_SPAN (fewer supports, may sag); right of centre
 * tightens to half the cap (denser). Monotonic, so tests/coverage.test.js holds.
 */
export function coverRowSpan(coverage) {
  const c = Math.max(0, Math.min(1, coverage));
  const cap = PROP.maxUnsupportedSpan;
  return c <= 0.5
    ? cap + ((0.5 - c) / 0.5) * (COVER_SPARSE_SPAN - cap)   // 30 .. 12
    : cap - ((c - 0.5) / 0.5) * (cap / 2);                  // 12 .. 6
}

/**
 * Build a breakaway prop under every overhang region that can take one.
 *
 * Two passes: the normal one (tube line or split patches per region), then a
 * raster pass over the regions it left partly bare, and each region keeps the
 * pass that holds more of it -- see web/prop/raster.js. `opts.raster === false`
 * runs the normal pass alone.
 *
 * @returns {{triangles, props, skipped, served, sagRisk}}
 */
export function buildProps(topo, result, rot, opts = {}) {
  opts = { ...opts, circularFrames: circularRegions(topo, result, rot) };
  const capFrom = globalThis.__TINECAP?.length ?? 0;    // tests' tine capture: see withRaster
  // Flush end rows (prop/endrows.js) are a candidate: this base lays the mid-strip rows
  // and flags the regions whose free edges the candidate would move (`flushable`).
  const racing = opts.raster !== false && opts.endRows !== false;
  const rows = buildPass(topo, result, rot, racing ? { ...opts, rowsOnly: true } : opts, null);
  const normal = !racing || !rows.flushable.length ? rows
    : raceAgainst(topo, result, rot, { ...opts, rasterVeto: undefined }, rows, capFrom,   // (the wedge veto guards raster walls, not these)
      (regions) => buildPass(topo, result, rot, { ...opts, onlyRegions: regions }, null),
      // (`equivalent` and no price: a tie on the judge keeps the flush layout, as before the
      // race -- only a layout the judge scores higher swaps away from it)
      'flush', null, 0, null, true, {
        tried: new Set(rows.flushable), ruler: judgeRuler(topo, result, rot), alone: true,
        // rows that serve a patch the flush layout leaves to a wedge drop that wedge
        // (it grips from the bed): the flush layout stays (fins/wedges.js wedgeVeto)
        hold: opts.rasterVeto && ((qa, qb, ri) => {
          const after = [...rows.props.filter((q) => q.region !== ri), ...qb];
          return qa.some((q) => opts.rasterVeto(q, after));
        }),
      });
  const rasterBase = opts.raster === false ? normal
    : withRaster(topo, result, rot, opts, normal, capFrom,
                 (regions) => buildPass(topo, result, rot, opts, regions));
  // Circular candidates use a local geometric frame. The race still checks the
  // surrounding faces and lowest grip; keep the original layout if they lose.
  const circ = opts.raster !== false && opts.circularFrames.size ? raceAgainst(topo, result, rot, opts, rasterBase, capFrom,
    (regions) => buildPass(topo, result, rot, { ...opts, onlyRegions: regions, circularPass: true }, null),
    'circular', null, 0, null, true) : rasterBase;
  // Rim walls (prop/rim.js, local issue 062): a region the patch path built also
  // tries a wall along its free outline, the rows stopped short of it, and keeps it
  // where the judge (prop/judge.js) says it holds more -- at JUDGE.price, held area
  // per plastic added: the curved edges rows can't reach, not a sliver for a wall.
  // (Regions an earlier race swapped -- raster, circular -- keep their walls.)
  const swapped = new Set(circ.props.filter((q) => q.circular).map((q) => q.region));
  const base = opts.rimWalls === false || opts.raster === false ? circ : raceAgainst(topo, result, rot, opts, circ, capFrom,
    (regions) => buildPass(topo, result, rot, { ...opts, onlyRegions: regions, rimRegions: regions }, null),
    'rim', null, 0, null, false, {
      tried: new Set(result.regions.map((_, i) => i).filter((i) => !swapped.has(i))),
      ruler: judgeRuler(topo, result, rot), price: JUDGE.price,
    });
  // Downhill walls (issue #25): walls that run down the overhang and follow it to
  // the plate, raced per region against what the passes above built -- a region
  // swaps only when they hold more. opts.downhill === true only: Auto turns it on
  // and judges the whole build (fins/downhill.js); a direct call is unchanged.
  if (opts.downhill !== true) return base;
  const off0 = result.offset;
  // A downhill wall starts at the region's top edge, where the overhang meets the
  // part: a flank lying exactly flush with a part face there reads as clear to
  // the weld check and the station probes (lbracket Y20 on the plugin path: 45
  // flank vertices inside the part). Any wall vertex inside the part drops the
  // wall -- the wall's own triangles (`wallRange`), not its tines, which bite in
  // by design.
  const unburied = (pass) => {
    pass.props = pass.props.filter((q) => {
      if (!q.wallRange) return true;
      for (let i = q.wallRange[0]; i < q.wallRange[1]; i++) {
        const v = pass.triangles[i];
        if (insidePart(topo, rot, off0, v[0], v[1], v[2])) return false;
      }
      return true;
    });
    return pass;
  };
  const strict = raceAgainst(topo, result, rot, opts, base, capFrom,
    (regions) => unburied(buildPass(topo, result, rot, { ...opts, curvedWalls: undefined, downhillRegions: regions }, null)),
    'downhill', DOWNHILL.maxGrow, DOWNHILL.race);
  if (opts.curvedWalls !== true) return strict;
  // Curved walls (prop/curved.js, prop/trace.js): a second race over the regions
  // grown across the slivers, where a group whose walls bend always swaps to them
  // and every other group keeps what the strict race left it -- so ticking changes
  // nothing where no wall bends. Its walls are downhill walls too (`downhill`), raced
  // under their own tag so the tine capture re-points each wall's own.
  return raceAgainst(topo, result, rot, opts, strict, capFrom, (regions) => {
    const pass = unburied(buildPass(topo, result, rot, { ...opts, downhillRegions: regions }, null));
    for (const q of pass.props) q.downhill = true;
    return pass;
  }, 'curved', null, DOWNHILL.race, bends);
}

/**
 * The last-resort pass (web/fins/shortwalls.js): the normal placement for `regions`
 * only (a Set of region indices), with the short-wall floor (minSpanFor `short`).
 * No raster race -- these are regions every other pass already left bare.
 */
export function buildShortWalls(topo, result, rot, opts, regions) {
  return buildPass(topo, result, rot, { ...opts, onlyRegions: regions, shortWalls: true }, null);
}

/**
 * One placement pass. `raster` null = the normal placement for every region;
 * a Set of region indices = raster tracks (rasterTracks) for those regions only.
 */
function buildPass(topo, result, rot, opts, raster) {
  const { pos } = topo;
  const step = opts.step ?? PROP.stationStep;
  // Wide-face coverage (0 sparse .. 1 dense) sets the row spacing via coverRowSpan:
  // 0.5 is the anti-sag cap (the default), left of it loosens past the cap (fewer
  // supports, flagged as sagRisk when a row actually lands wider than the cap),
  // right of it tightens. Pinned by tests/coverage.test.js.
  const coverage = Math.max(0, Math.min(1, opts.coverage ?? 0.5));
  const rowSpan = coverRowSpan(coverage);
  // sagRisk warns ONLY when the user dragged coverage below centre, asking for row
  // pitch wider than the anti-sag cap. It is NOT enough that the placed spacing
  // exceeds the cap: rounding vExt/rowSpan down routinely lands a hair over the cap
  // even at the neutral default (a 53mm face / 12mm cap -> 4 rows at 13.25mm), and
  // warning there is just noise. So gate on the REQUESTED pitch, not the rounded
  // result.
  const wantSparse = rowSpan > PROP.maxUnsupportedSpan + 0.5;
  const off = result.offset;
  const withTines = opts.tines === true;
  const short = opts.shortWalls === true;
  const downhill = opts.downhillRegions ?? null;
  // Curved walls (prop/trace.js): the downhill lines trace regions grown across the
  // slivers, and regions whose growth meets trace (and race) as one
  const traced = downhill && opts.curvedWalls === true ? traceGroups(topo, result, rot, off, downhill) : null;
  // tines emitted; sagRisk: the user chose sub-cap spacing AND a real row landed wide
  const tally = { tines: 0, sagRisk: false, sagRegions: new Set(), flushable: new Set() };

  const out = [];
  const props = [];
  const skipped = { noLine: 0, wanders: 0, stub: 0, blocked: 0,
                    degenerate: 0, buried: 0, weld: 0, sliver: 0, onPart: 0 };
  // Plate only (#218): every support stands on the plate. A line with part under it
  // (the part-attached path's) is counted (onPart) and handed to the plate path,
  // whose column probes trim the stations over the part and keep any stretch that
  // stands on the plate -- never stilting through the part.
  const plateOnly = opts.plateOnly === true;
  const v = [0, 0, 0];

  // The whole part, seated once, for the part-attached floor probe: the floor a
  // support lands on is usually a DIFFERENT region than the overhang, so it must
  // raycast the full mesh. Cheap next to the per-region work below.
  const partTris = new Float64Array(pos.length);
  for (let f = 0; f < topo.nFaces; f++) {
    for (let i = 0; i < 3; i++) {
      seat(pos, f * 9 + i * 3, rot, off, v);
      partTris[f * 9 + i * 3] = v[0];
      partTris[f * 9 + i * 3 + 1] = v[1];
      partTris[f * 9 + i * 3 + 2] = v[2];
    }
  }

  // DENSE grip comb, uniform along every grippable wall. A tip-over-risk scale
  // (commit c0fcf8e) once let "stable" parts fall back to a sparse 9mm comb -- which
  // starved shallow parts down to a few nubs that read as "laying on the face"
  // instead of a gripping comb (regression Matthew caught). The cube-detach that
  // scale was reacting to was actually the bed pad's fault (fixed separately in the
  // pad commits), not the tines'. So the comb is uniformly dense again (Slant3D's
  // "7-8 low down, spreading with height"); density DEFAULTS to PROP.tineStep and
  // tests/tines_realparts.test.js pins that real parts get a full comb. The user's
  // "Tine grip" slider (opts.tineDensity) can loosen it toward tineStepSparse for a
  // surface-critical face, never silently -- see tineStepFor / tests/tine_density.test.js.
  const tineStepEff = tineStepFor(opts.tineDensity);
  // A tine MUST be exactly one slicer layer tall or it stops printing as one clean
  // continuous bead and tears on removal (welts) instead of bending off. So it
  // tracks the user's real layer height (default 0.2mm) -- see the UI's Layer height.
  const tineHeight = opts.layerHeight ?? PROP.tineH;
  // where the tests' tine capture stands (see buildProps); null when off
  const capAt = () => globalThis.__TINECAP?.length ?? null;
  // A wall's `grip` is its lowest tine bottom (emitTines fills grip.z), which the
  // raster race must not raise (prop/raster.js gripZ). Infinity: no tines. Read
  // from the tines, not the triangles: a wall step under a tine sits lower.

  const pass = { topo, rot, off, opts, step, rowSpan, wantSparse, raster, downhill, traced,
                 partTris, plateOnly, short, withTines, tineStepEff, tineHeight, capAt,
                 out, props, skipped, served: new Set(), tally,
                 // Per-fin identity, assigned in build order. The id is only used to map a
                 // raycast hit back to its fin WITHIN one build (the UI tracks removals across
                 // rebuilds by a spatial signature, not this id). Sequential keeps it stable
                 // within a generation.
                 nextId: 0 };
  const patches = regionPatches(topo, result, rot, opts, pass);
  const servedRegions = pass.served;

  // A small tube competes with its region's patches: see web/prop/rival.js.
  const rivalry = tubeRivalry({ out, props, skipped, served: servedRegions, tally },
                              topo, result, partTris);
  // A flat patch turned across the slicer's bridge competes with its old-way
  // walls: see web/prop/bridgerace.js.
  const race = bridgeRace({ out, props, skipped, served: servedRegions, tally });

  const rims = new Map();               // region -> its rim tracks (prop/rim.js)
  for (const patch of patches) {
    const regionTris = patch.tris;
    race.begin(patch);                   // first: settling a race cuts `out` back
    const mark = rivalry.begin(patch);  // a small tube undoes to here
    let lines;
    if (patch.lines) {
      // (the rim pass rebuilds only patch-path regions: a tube's, an arc's, a
      // raster's keep what they had)
      if (opts.rimRegions) continue;
      // A tube's lowest-line track(s), fitted and resampled by tubeLine.
      lines = patch.lines;
    } else {
      // The patch's own geometry: vertices plus face centroids for the frame
      // fit, and its triangles for asking "does the patch cover this station".
      const pts = [];
      const patchTris = new Float64Array(patch.faces.length * 9);
      for (let k = 0; k < patch.faces.length; k++) {
        const f = patch.faces[k];
        let gx = 0, gy = 0, gz = 0;
        for (let i = 0; i < 3; i++) {
          seat(pos, f * 9 + i * 3, rot, off, v);
          pts.push([v[0], v[1], v[2]]);
          patchTris[k * 9 + i * 3] = v[0];
          patchTris[k * 9 + i * 3 + 1] = v[1];
          patchTris[k * 9 + i * 3 + 2] = v[2];
          gx += v[0]; gy += v[1]; gz += v[2];
        }
        pts.push([gx / 3, gy / 3, gz / 3]);
      }
      lines = patchTracks(pts, patchTris, step, { topo, rot, offset: off, sway: !!opts.sway?.on, rowsOnly: opts.rowsOnly },
                          rowSpan, patch.axis ?? null);
      race.turned(patch, lines, patches);
      if (lines.flushable) tally.flushable.add(patch.region);
      // Rim walls (prop/rim.js): for the regions in `opts.rimRegions` only -- the race
      // in buildProps decides -- a wall along the patch's free outline, the rows
      // stopped short of it.
      // The rim is the REGION's outline (a flat patch's edge can meet the same
      // overhang carrying on as another patch, a rounded edge's lower half), traced
      // once: its first patch takes the rim, every patch's rows stop short of it.
      if (opts.rimRegions?.has(patch.region)) {
        let rim = rims.get(patch.region);
        const first = !rim;
        if (first) rims.set(patch.region, (rim = rimTracks(topo, result, rot, result.regions[patch.region].faces, regionTris, step)));
        if (!rim.length) continue;      // no free outline: the region keeps what it had
        lines = Object.assign([...clipToRim(lines, rim), ...(first ? rim : [])], { spacing: lines.spacing, turned: lines.turned });
      }
      // The user chose sub-cap spacing (wantSparse) AND this face actually landed a
      // multi-row gap wider than the cap. Flag it so the UI can warn (never blocks;
      // Matthew's call). Single-row faces (spacing 0) can't sag, so they don't warn.
      if (wantSparse && lines.length && lines.spacing > PROP.maxUnsupportedSpan) tally.sagRisk = true;
    }
    if (!lines.length) { skipped.noLine++; continue; }

    // An index loop, not for...of over a copy: a raster track's leftover pieces
    // are appended to `lines` mid-loop (rasterRest).
    for (let li = 0; li < lines.length; li++) placeLine(lines, li, patch, pass);
    if (patch.smallTube) rivalry.tubeDone(patch, mark, patches);
  }
  rivalry.finish();
  race.finish();

  // `served` counts REGIONS with at least one wall, because a region can now
  // yield several -- subtracting a prop count from a region count would say a
  // part with one region and three walls had "-2 unserved".
  return { triangles: out, props, skipped, served: servedRegions.size,
           servedRegions: [...servedRegions],
           tines: tally.tines, sagRisk: tally.sagRisk, flushable: [...tally.flushable],
           ...(raster ? { sagRegions: tally.sagRegions } : {}),
           ...(traced ? { leaderOf: traced.leaderOf } : {}),
           volume: props.reduce((s, q) => s + q.volume, 0) };
}
