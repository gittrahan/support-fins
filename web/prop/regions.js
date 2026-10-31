/**
 * The patches one placement pass builds walls along: each overhang region's
 * source of tracks, picked by the pass (prop.js buildPass) --
 *
 *   strutWalls    a lone strut's longitudinal walls (prop/lattice.js)
 *   circularPass  a circular region's tracks in its own frame (prop/circular.js)
 *   downhill      walls down the slope, traced groups too (prop/downhill.js, trace.js)
 *   raster        the whole footprint's tracks, or a lattice net's struts (prop/raster.js)
 *   normal        a tube's lowest line, a level arc, or the split's straight patches
 *
 * A patch carries `lines` when its tracks are already laid (every source above but
 * the split); a split patch has none, and buildPass fits its tracks (patchTracks).
 */
import { MIN_REGION_AREA } from '../overhangs.js';
import { PROP } from './config.js';
import { seat } from './surface.js';
import { splitRegion, tubeLine } from './tracks.js';
import { circularTracks } from './circular.js';
import { latticeStruts, strutPatches, loneStrut } from './lattice.js';
import { rasterTracks } from './raster.js';
import { downhillLines } from './downhill.js';
import { TRACE } from './trace.js';
import { arcLine } from './arc.js';

/**
 * Every region's patches for one pass. `pass` holds the pass's settings (step,
 * rowSpan, wantSparse, raster, downhill, traced, partTris) and the counters it
 * adds to (skipped.sliver, tally.sagRegions).
 */
export function regionPatches(topo, result, rot, opts, pass) {
  const { pos } = topo;
  const off = result.offset;
  const { step, rowSpan, wantSparse, raster, downhill, traced, partTris, skipped, tally } = pass;
  const only = opts.onlyRegions ?? null;
  const v = [0, 0, 0];
  // The support unit is the locally-straight sub-patch, not the connected
  // region -- see splitRegion. Fragments too small to be worth a wall are
  // counted, not silently dropped: absence of output recorded as success is
  // exactly how M5's scoreboard lied.
  const patches = [];
  for (let ri = 0; ri < result.regions.length; ri++) {
    if (only && !only.has(ri)) continue;
    const rFaces = result.regions[ri].faces;
    const circular = opts.circularFrames?.get(ri);
    if (opts.circularPass && !circular) continue;
    // Seat the WHOLE region's triangles once, shared by all its sub-patches.
    // The polyline each wall follows comes from its own sub-patch, but the
    // surface its top must CLEAR is the whole region's: a wall near a patch
    // boundary can run under a sibling patch's faces, and measuring against
    // patch-only triangles welded it to geometry it could not see -- gap
    // 0.003 mm and flank 0.011 mm on hub_corner, measured the first time this
    // split shipped with per-patch triangles.
    const regionTris = new Float64Array(rFaces.length * 9);
    const regionPts = [];
    let regionArea = 0;
    for (let k = 0; k < rFaces.length; k++) {
      regionArea += topo.area[rFaces[k]];
      let gx = 0, gy = 0, gz = 0;
      for (let i = 0; i < 3; i++) {
        seat(pos, rFaces[k] * 9 + i * 3, rot, off, v);
        regionTris[k * 9 + i * 3] = v[0];
        regionTris[k * 9 + i * 3 + 1] = v[1];
        regionTris[k * 9 + i * 3 + 2] = v[2];
        regionPts.push([v[0], v[1], v[2]]);
        gx += v[0]; gy += v[1]; gz += v[2];
      }
      regionPts.push([gx / 3, gy / 3, gz / 3]);
    }

    if (opts.strutWalls) {
      if (loneStrut(regionPts)) {
        const seated = (f) => [0, 1, 2].map((i) => seat(pos, f * 9 + i * 3, rot, off, [0, 0, 0]));
        patches.push(...strutPatches(topo, rot, [rFaces], seated, step, ri, regionTris));
      }
      continue;
    }

    if (opts.circularPass) {
      const circularLines = circular && circularTracks(circular, regionTris, step, rowSpan);
      if (circularLines?.length) patches.push({ faces: rFaces, area: regionArea,
        region: ri, tris: regionTris, lines: circularLines });
      continue;
    }

    // Downhill pass (prop/downhill.js): walls down the region's slope, for the
    // regions in `opts.downhillRegions` only -- the race in buildProps decides.
    if (downhill) {
      if (!downhill.has(ri)) continue;
      if (traced) {
        if (traced.leaderOf.get(ri) !== ri) continue;   // traced with its group's leader
        const g = traced.groups.get(ri);
        const lines = downhillLines(g.pts, g.tris, step, undefined, { h: TRACE.h, cover: g.red });
        const faces = g.members.flatMap((m) => result.regions[m].faces);
        let area = 0;
        for (const f of faces) area += topo.area[f];
        if (lines) patches.push({ faces, area, region: ri, tris: g.tris, lines, members: g.members });
        continue;
      }
      const lines = downhillLines(regionPts, regionTris, step);
      if (lines) patches.push({ faces: rFaces, area: regionArea, region: ri, tris: regionTris, lines });
      continue;
    }

    // Raster pass: the whole footprint's tracks, no tube route, no split.
    if (raster) {
      if (!raster.has(ri)) continue;
      // A lattice net (issue #121): its struts, each routed as a standalone strut
      // region would be, stand in for the raster tracks -- parallel rows across a
      // net land in its holes. See prop/lattice.js.
      const seated = (f) => [0, 1, 2].map((i) => seat(pos, f * 9 + i * 3, rot, off, [0, 0, 0]));
      const struts = latticeStruts(topo, rFaces, seated);
      if (struts) {
        if (struts.lost) skipped.sliver++;   // faces no strut reached: dropped, so counted
        patches.push(...strutPatches(topo, rot, struts, seated, step, ri, regionTris));
        continue;
      }
      const lines = rasterTracks(regionPts, regionTris, partTris, step, rowSpan,
                                 { topo, rot, offset: off, sway: !!opts.sway?.on });
      // the sparse-coverage sag warning, per region: it only counts if this region swaps
      if (wantSparse && lines.spacing > PROP.maxUnsupportedSpan) tally.sagRegions.add(ri);
      if (lines.length) patches.push({ faces: rFaces, area: regionArea, region: ri, tris: regionTris, lines });
      continue;
    }

    // Curved region whose lowest line is straight = a tube: ONE wall under
    // that line, the way breakaway.py props the shelter hubs. Only when the
    // region is flat, or its lowest points form a ring, does it go to
    // splitRegion for rows of tracks. See tubeLine.
    // A SMALL tube (under tubeMinArea, see tubeLine) is a new claim on a region
    // the patch path used to own, so it keeps the region's split too: the tube is
    // built first, the patches then compete for the same region, and the one that
    // holds more of it stays (see web/prop/rival.js).
    const tube = tubeLine(topo, rFaces, rot, regionPts, regionTris, step);
    const small = regionArea < PROP.tubeMinArea;
    const split = small || !tube?.length ? splitRegion(topo, rFaces, rot) : null;
    if (tube && tube.length) {
      patches.push({ faces: rFaces, area: regionArea, region: ri,
                     tris: regionTris, lines: tube, smallTube: small ? split : null });
      continue;
    }
    // A level strip that curves in plan (a slot through a tube's wall): one wall
    // along it, raced against the split's straight tracks like a small tube -- and
    // it keeps a tie, since it stands under the strip's whole length. See prop/arc.js.
    const arc = arcLine(regionPts, regionTris, step);
    if (arc) {
      patches.push({ faces: rFaces, area: regionArea, region: ri,
                     tris: regionTris, lines: arc, smallTube: split, arc: true });
      continue;
    }

    for (const p of split) {
      if (p.area < MIN_REGION_AREA) { skipped.sliver++; continue; }
      p.region = ri;
      p.tris = regionTris;
      patches.push(p);
    }
  }
  return patches;
}
