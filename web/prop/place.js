/**
 * One track -> its wall(s): the body of a placement pass (prop.js buildPass) for
 * a single line. A wall on the part's floor when there is one (prop/attached.js),
 * else a plate wall -- trimmed to the run that can carry it, settled to `gap`,
 * swept and measured, cut back where it welds -- and the squat bed walls under
 * whatever the tall wall left near the plate (prop/squat.js).
 */
import { solidClearance } from '../inside.js';
import { buildPartAttached } from './attached.js';
import { bodyMask, insertFloorStations, longestRun, minSpanFor, stationCertified, stationIsClear, tallBody, tallSpan, welds, withLowTails } from './clearance.js';
import { PROP } from './config.js';
import { contourTop, lowerSag, settleTop, straightness } from './contact.js';
import { rasterRest } from './raster.js';
import { buildSquatBed } from './squat.js';
import { sweep } from './sweep.js';
import { emitTines } from './tines.js';

/**
 * Build `lines[li]`'s walls into `pass.out` / `pass.props`. `pass` is the pass's
 * shared state: the part (topo, rot, off, partTris), the user's settings, and the
 * outputs and counters every line adds to. A raster line's leftover pieces are
 * appended to `lines` (rasterRest), so the caller loops by index.
 */
export function placeLine(lines, li, patch, pass) {
  const { topo, rot, off, opts, out, props, skipped, served, tally, partTris,
          raster, short, downhill, plateOnly, withTines, tineStepEff, tineHeight, capAt } = pass;
  const regionTris = patch.tris;
  const zBed = 0;
  const line = lines[li];
  // PART-ATTACHED first: if solid part sits below this overhang, a support
  // must stand on THAT floor, not stilt to the plate through the part (the
  // bug Matthew hit on a real hub). buildPartAttached declines on an ordinary
  // bed overhang (floorLine ~0), so the plate path below is reached unchanged
  // for the flagship parts. When there IS a floor but no safe wall fits (side
  // walls in the way, a buried column, too short) it says `floored` with the
  // reason -- counted and skipped, never stilted through the part. A bore is
  // no longer a refusal: its wall is built and flagged inBore. Works on a COPY so
  // the plate path's own `line` is untouched.
  const tri0 = out.length;
  let pa = buildPartAttached(line, partTris, topo, rot, off, out);
  // (Plate only: undo it and take the plate path, as a bed overhang would)
  if (plateOnly && (pa.ok || pa.floored)) { out.length = tri0; skipped.onPart++; pa = {}; }
  if (pa.ok && patch.smallTube) {
    // A small tube's line is new to this path, so hold its wall to the same
    // measured clearance the plate path demands (see the sweep below): on
    // 3DBenchy at Y35 an unchecked one fused 0.09 mm into the cabin roof.
    const hit = solidClearance(topo, rot, off, out.slice(tri0), 0.25);
    if (hit && welds(hit)) {
      out.length = tri0;
      skipped.weld++;
      return;
    }
  }
  if (pa.ok) {
    served.add(patch.region);
    let nT = 0;
    const c0 = capAt(), grip = { z: Infinity };
    // pa.prop.line already carries the wall top (surface minus gap); add the
    // gap back so emitTines reads it as the surface, like the plate path does.
    if (withTines) {
      const topLine = pa.prop.line.map((p) => [p[0], p[1], p[2] + PROP.gap]);
      nT = emitTines(topLine, partTris, topo, rot, off, out, tineStepEff, undefined, tineHeight, null, grip);
      tally.tines += nT;
    }
    // buildPartAttached pushed the wall starting at tri0; emitTines above pushed
    // its tines right after, so wall + tines are contiguous -> one segment.
    props.push({ ...pa.prop, area: patch.area, region: patch.region, tines: nT,
                 caps: c0 === null ? undefined : [c0, capAt()], grip: grip.z,
                 trimmed: line.length - pa.prop.stations,
                 id: pass.nextId++, kind: 'prop',
                 ...(line.rim ? { rimWall: true } : {}),
                 triRanges: [[tri0, out.length]] });
    return;
  }
  if (pa.floored) { skipped[pa.floored]++; return; }

  // Finish the top against the WHOLE region, not just this patch: a track
  // near a patch boundary can run under a sibling patch's faces, and
  // clearance measured against patch-only triangles welded walls to
  // geometry they could not see (gap 0.003mm, flank 0.011mm, hub_corner).
  contourTop(line, regionTris);
  lowerSag(line, regionTris);
  // pin the wall's low end to the squat floor, not the nearest 1mm station
  if (insertFloorStations(line).length) contourTop(line, regionTris);

  // SQUAT BED PASS: hold the near-bed stations too low for the flanged wall
  // below (which discards everything under minHeight as stub/blocked). It runs
  // AFTER the tall wall (runSquat, on every exit path) so it can skip exactly
  // the stations that wall's low tail covered (`claimed`) and nothing more.
  // squatLine is a deep copy taken now, before the tall path's settleTop
  // mutates the shared points, so the squat pass sees the contoured line.
  const squatLine = line.map((p) => [p[0], p[1], p[2]]);
  const claimed = line.map(() => false);
  const runSquat = () => {
    for (const sq of buildSquatBed(squatLine, regionTris, topo, rot, off, out, claimed)) {
      // a squat wall's base is the thin brim, not the tall flange, so tines
      // attach from squatBrimH up (the default minTop would skip every one).
      const t0 = out.length, c0 = capAt(), grip = { z: Infinity };
      const nT = withTines ? emitTines(
        sq.line.map((p) => [p[0], p[1], p[2] + PROP.gap]),
        regionTris, topo, rot, off, out, tineStepEff, PROP.squatBrimH, tineHeight, null, grip) : 0;
      tally.tines += nT;
      served.add(patch.region);
      // buildSquatBed pushed this wall (sq.triRange) BEFORE every squat wall's
      // tines, so a fin's wall and its tines are NON-contiguous in `out` --
      // track both segments so removing the fin takes wall AND tines together.
      const segs = [sq.triRange];
      if (out.length > t0) segs.push([t0, out.length]);
      props.push({ ...sq, area: patch.area, region: patch.region, tines: nT,
                   caps: c0 === null ? undefined : [c0, capAt()], grip: grip.z,
                   id: pass.nextId++, kind: 'prop', triRanges: segs,
                   ...(line.rim ? { rimWall: true } : {}) });
    }
  };

  // A track is straight in XY by construction, so this gate is a tripwire
  // rather than the bowl-refusal it was for bucketed polylines -- bowls are
  // now refused by their holes (see patchTracks). Keep it: anything that
  // trips it means the frame fit itself went wrong.
  if (straightness(line) > PROP.maxWander) { skipped.wanders++; runSquat(); return; }

  // Trim to the longest run that can actually carry a wall, rather than
  // discarding the track over a local problem. See `longestRun`.
  const clear = line.map((p, k) =>
    p[2] - PROP.gap >= PROP.minHeightSquat && stationIsClear(line, k, topo, rot, off));
  const usable = withLowTails(
    line.map((p, k) => clear[k] && p[2] - PROP.gap >= PROP.minHeight), clear);
  const run = longestRun(usable);
  if (!run || run[1] - run[0] < PROP.minStations) { skipped.blocked++; runSquat(); return; }
  if (raster && !patch.strut) {       // a strut takes one wall, as it would standing alone
    for (const rest of rasterRest(line, run)) {
      lines.push(rest);
      // the piece runs its own squat pass; this line's must not double it
      for (let k = rest.from; k < rest.from + rest.length; k++) claimed[k] = true;
    }
  }
  const sub = line.slice(run[0], run[1]);

  const body = bodyMask(sub);               // before settleTop -- see bodyMask
  if (tallSpan(sub, body) < minSpanFor(sub, body, !!patch.smallTube, short)) { skipped.stub++; runSquat(); return; }

  // Last, on the trimmed run only: put the closest approach exactly on spec.
  // It runs here rather than earlier because trimming changes which part of
  // the edge is closest, so settling before the trim settles the wrong
  // thing.
  settleTop(sub, regionTris);

  // Settling can push a station that was only just tall enough below the
  // floor, and `sweep` would then throw away the whole wall -- the same
  // all-or-nothing failure the trim exists to prevent, reintroduced one step
  // later. Re-trim against the settled line: on height, and on the measured
  // clearance to everything settleTop could not see (stationCertified).
  // Tall stations carry the wall; low ones may only extend it as its tail.
  const lowA = sub.map((p, k) =>
    p[2] - PROP.gap >= PROP.minHeightSquat && stationCertified(sub, k, topo, rot, off));
  const tallA = sub.map((p, k) => lowA[k] && p[2] - PROP.gap >= PROP.minHeight);

  // Sweep, then MEASURE the finished solid -- exact triangle-to-triangle
  // clearance against the whole part (solidClearance), because the last
  // welds this pipeline shipped sat between stations, where no per-station
  // probe would ever look. A contact is a local problem like every other:
  // trim the station that owns it and try again, up to a few rounds,
  // rather than discarding a 90mm wall over one rib. A wall that cannot be
  // cut clear is dropped -- "no prop" is a fixable disappointment, a fused
  // prop is a ruined print.
  let placed = false, reason = null;
  for (let tries = 0; tries < 4 && !placed; tries++) {
    const run2 = longestRun(withLowTails(tallA, lowA));
    if (!run2 || run2[1] - run2[0] < PROP.minStations) { reason = 'blocked'; break; }
    const settled = sub.slice(run2[0], run2[1]);
    const span2 = Math.hypot(settled[settled.length - 1][0] - settled[0][0],
                             settled[settled.length - 1][1] - settled[0][1]);
    const settledBody = body.slice(run2[0], run2[1]);
    if (tallSpan(settled, settledBody) < minSpanFor(settled, settledBody, !!patch.smallTube, short)) { reason = 'stub'; break; }

    const before = out.length;
    if (!sweep(settled, zBed, out, PROP.minHeightSquat)) {
      out.length = before;
      reason = 'degenerate';
      break;
    }

    // 0.25 reach: the tightest threshold below is 0.205, and every extra
    // tenth of reach widens the broad phase for nothing. Isolated struts
    // also use tighter triangle bounds: long tilted walls have huge boxes.
    const hit = solidClearance(topo, rot, off, out.slice(before), 0.25, opts.strutWalls === true);
    // Same acceptance as stationCertified: an approach from above is the
    // breakaway interface, anything else is a flank. Interpenetration
    // measures 0 and fails the flank test, which is what retires the old
    // vertex-containment `buried` check -- crossing surfaces have
    // distance 0 long before any vertex is inside.
    if (hit && welds(hit)) {
      out.length = before;
      let kBest = 0, dBest = Infinity;
      for (let k = 0; k < settled.length; k++) {
        const dx = settled[k][0] - hit.x, dy = settled[k][1] - hit.y;
        if (dx * dx + dy * dy < dBest) { dBest = dx * dx + dy * dy; kBest = k; }
      }
      const at = run2[0] + kBest;
      for (const k of [Math.max(0, at - 1), at, Math.min(lowA.length - 1, at + 1)]) {
        lowA[k] = false;
        tallA[k] = false;
      }
      reason = 'weld';
      continue;
    }

    // The TALLEST point, not the lowest: this is what the wall costs to
    // print and how far it has to stand up on its own. `line` is
    // deliberately not used here -- the wall only exists over `sub`.
    const top = Math.max(...settled.map((p) => p[2])) - PROP.gap;
    // signed volume of the emitted solid (divergence theorem over its
    // triangles): the plastic this wall costs, which is the number the
    // "less material than slicer supports" claim has to be measured against
    let vol = 0;
    for (let i = before; i < out.length; i += 3) {
      const a = out[i], b = out[i + 1], c = out[i + 2];
      vol += (a[0] * (b[1] * c[2] - b[2] * c[1])
            + a[1] * (b[2] * c[0] - b[0] * c[2])
            + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    }
    served.add(patch.region);
    // The grip comb: nubs along this wall's settled top that bite into the
    // part. `settled` carries the surface z; emitTines subtracts the gap.
    const c0 = capAt(), grip = { z: Infinity }, wallEnd = out.length;
    const nT = withTines ? emitTines(settled, regionTris, topo, rot, off, out, tineStepEff, undefined, tineHeight,
                                     tallBody(settledBody), grip) : 0;
    tally.tines += nT;
    props.push({
      region: patch.region, tines: nT,
      caps: c0 === null ? undefined : [c0, capAt()], grip: grip.z,
      span: span2, height: top - zBed, area: patch.area,
      stations: settled.length, trimmed: line.length - settled.length,
      volume: Math.abs(vol),
      // the centreline, so a coverage check can ask what this wall reaches
      line: settled.map((p) => [p[0], p[1], p[2] - PROP.gap]),
      id: pass.nextId++, kind: 'prop',
      // `before` (captured at the start of THIS try) marks where this wall's
      // triangles begin in `out`; failed weld retries roll back to it, so on the
      // successful try it points at this wall. emitTines just pushed its tines
      // right after, so wall + tines are one contiguous segment.
      triRanges: [[before, out.length]],
      ...(downhill ? { wallRange: [before, wallEnd] } : {}),   // the wall without its tines
      ...(patch.members ? { members: patch.members } : {}),     // a traced group's regions
      ...(line.rim ? { rimWall: true } : {}),                   // a rim wall (prop/rim.js)
    });
    for (let k = run[0] + run2[0]; k < run[0] + run2[1]; k++) claimed[k] = true;
    placed = true;
  }
  if (!placed && reason) skipped[reason]++;
  runSquat();
}
