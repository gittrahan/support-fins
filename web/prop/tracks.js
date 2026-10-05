/**
 * Where the auto-placer ("Suggest") puts walls under a region: `splitRegion`
 * cuts it into locally-straight sub-patches, `patchTracks` lays straight
 * parallel tracks across each, and `tubeLine` gives a curved region one wall
 * along its lowest line.
 *
 * Split out of prop.js, which re-exports the public names.
 */
import { insidePart } from '../inside.js';
import { faceAdjacency } from '../planes.js';
import { PROP } from './config.js';
import { contactLine, straightness } from './contact.js';
import { surfaceZAt } from './surface.js';

/**
 * Split one overhang region into locally-straight sub-patches.
 *
 * A connected overhang region is a topological artifact, not a support unit:
 * union-find in overhangs.js merges the entire tilted underside of
 * voron_drive_frame into one 3,240 mm2 region whose contact line sits 6.4 mm RMS
 * off any straight axis, so the straightness gate -- correctly -- refuses to
 * sweep a wall along it, and the region's genuinely straight ledges are refused
 * with it. The unit a wall wants is the locally-flat piece.
 *
 * Split the FACES, never the polyline: `contactLine` fits ONE principal axis to
 * whatever it is given, so for an L-shaped or wrapped region the polyline is
 * already wrong before any split could rescue it.
 *
 * Region-grow from a seed face, judging every candidate against the SEED's
 * normal, never its neighbour's. planes.js documents why pairwise agreement is
 * wrong: it creeps -- a cylinder's faces each differ from the next by a few
 * degrees, so the whole cylinder merges into one "flat" patch. Growing against
 * the seed cannot creep, because the hundredth face is judged by the same
 * reference as the first. The cutoff is tighter than planes.js's 35 degrees
 * because the jobs differ: a wall patch only has to keep facing the fin, while a
 * sub-patch here has to yield a contact line straight enough for `straightness`
 * (0.10 RMS/chord) -- a band of underside curving more than ~15 degrees each way
 * already bows past that.
 *
 * Seeds are taken largest-face-first, so the flattest expanse defines each
 * patch's reference normal and slivers join a patch instead of founding one.
 */
export function splitRegion(topo, faces, rot) {
  const { nrm, area } = topo;
  const agreeCut = Math.cos((PROP.splitAgreeDeg * Math.PI) / 180);
  const { start, nbr } = faceAdjacency(topo);

  // rotated normals, for this region's faces only
  const rn = new Map();
  for (const f of faces) {
    const x = nrm[f * 3], y = nrm[f * 3 + 1], z = nrm[f * 3 + 2];
    rn.set(f, [
      rot[0] * x + rot[3] * y + rot[6] * z,
      rot[1] * x + rot[4] * y + rot[7] * z,
      rot[2] * x + rot[5] * y + rot[8] * z,
    ]);
  }

  const order = [...faces].sort((a, b) => area[b] - area[a]);
  const assigned = new Set();
  const patches = [];

  for (const seed of order) {
    if (assigned.has(seed)) continue;
    const [sx, sy, sz] = rn.get(seed);
    assigned.add(seed);
    const members = [seed];
    let total = area[seed];
    const queue = [seed];

    while (queue.length) {
      const f = queue.pop();
      for (let e = start[f]; e < start[f + 1]; e++) {
        const g = nbr[e];
        if (assigned.has(g)) continue;
        const gn = rn.get(g);          // absent = not in this region
        if (!gn) continue;
        if (gn[0] * sx + gn[1] * sy + gn[2] * sz < agreeCut) continue;
        assigned.add(g);
        members.push(g);
        total += area[g];
        queue.push(g);
      }
    }
    patches.push({ faces: members, area: total });
  }
  return patches;
}

/**
 * The single lowest-line wall for a CURVED region -- the tube case, and the
 * case this whole tool descends from.
 *
 * `breakaway.py` was written for the shelter hubs: round tubes fanning off a
 * ball core, each propped by ONE web that follows `tube_underside()` -- the
 * tube's true lowest generatrix. Those parts printed. The port lost that
 * behaviour when splitRegion arrived: a tube's underside band curves, so the
 * 15-degree grow cut shatters it into facet strips, and each strip then gets
 * its own track along its own axis -- six short walls fanned across a tube
 * that wants one long one (rendered and looked at, hub_corner at 25 degrees:
 * a star of crossing walls under the ball).
 *
 * The routing question is CURVATURE, not width. A cylinder's underside band
 * is ~1.4R wide -- wider than maxUnsupportedSpan on every hub -- but one wall
 * under its lowest line is still the right support, because the band curves
 * UP away from that line: each shell of the tube rests on the shell below it
 * once the bottom generatrix is held. A flat plane has no such self-support,
 * which is why it gets rows. So: normals fanning from their mean = curved =
 * one wall on the lowest line; normals agreeing = flat = rows via
 * splitRegion/patchTracks.
 *
 * A BOWL also fans, in every direction at once -- its lowest points form a
 * ring, and `straightness` refuses the ring here, exactly as it always has.
 * The caller then falls through to the splitRegion path, whose track holes
 * refuse it a second way. Returns null when this region is not a tube.
 */
export function tubeLine(topo, faces, rot, pts, regionTris, step = PROP.stationStep) {
  const { nrm, area } = topo;

  let regionArea = 0;
  for (const f of faces) regionArea += area[f];
  // Below tubeMinArea only a CONVEX tube may take this route (a pipe, peg or
  // chimney lying on its side, checked once the lowest line is known below):
  // the pockets tubeMinArea keeps out are concave, and a small convex band
  // has no other way in -- splitRegion's 15-degree cut shatters it into facet
  // strips under MIN_REGION_AREA, every strip is dropped as a sliver, and the
  // region goes unserved (3DBenchy's chimney on its side: 28 mm2, 0 walls).
  const small = regionArea < PROP.tubeMinArea;
  if (small && regionArea < PROP.tubeSmallMinArea) return null;

  // area-weighted mean normal, in print space
  let mx = 0, my = 0, mz = 0, A = 0;
  const rn = [];
  for (const f of faces) {
    const x = nrm[f * 3], y = nrm[f * 3 + 1], z = nrm[f * 3 + 2];
    const v = [
      rot[0] * x + rot[3] * y + rot[6] * z,
      rot[1] * x + rot[4] * y + rot[7] * z,
      rot[2] * x + rot[5] * y + rot[8] * z,
    ];
    rn.push([v, area[f]]);
    A += area[f];
    mx += v[0] * area[f]; my += v[1] * area[f]; mz += v[2] * area[f];
  }
  const mn = Math.hypot(mx, my, mz);
  if (mn < 1e-9 || A < 1e-9) return null;
  mx /= mn; my /= mn; mz /= mn;

  // The FRACTION of area that deviates, never the worst face: one pocket rim
  // in a big flat region must not reroute the whole region (see PROP).
  const cut = Math.cos((PROP.tubeSpreadDeg * Math.PI) / 180);
  let deviant = 0;
  for (const [v, a] of rn) {
    if (v[0] * mx + v[1] * my + v[2] * mz < cut) deviant += a;
  }
  if (deviant / A < PROP.tubeCurvedFrac) return null;  // flat: rows handle it

  // The lowest line, from the mesh's own points -- good enough to decide
  // whether a line EXISTS and where it runs, and no better: a coarse tube
  // region has tens of vertices, so this polyline can have stations 7 mm
  // apart with ends that sit wherever a vertex happened to land.
  let dLo = [Infinity, Infinity], dHi = [-Infinity, -Infinity];
  for (const p of pts) {
    for (const a of [0, 1]) {
      if (p[a] < dLo[a]) dLo[a] = p[a];
      if (p[a] > dHi[a]) dHi[a] = p[a];
    }
  }
  const diag = Math.hypot(dHi[0] - dLo[0], dHi[1] - dLo[1]);
  const nSamples = Math.max(8, Math.min(400, Math.ceil(diag / step)));
  // A small tube is often meshed as a few long strips (a CAD export's cylinder:
  // every facet runs end to end), so its vertices sit only at the two ends and
  // the per-bucket lowest point zigzags across the line. Sample the edges too.
  const rough = contactLine(small ? edgePoints(regionTris, pts, step / 2) : pts, regionTris, nSamples);
  if (!rough || straightness(rough) > PROP.maxWander) return null;  // a ring, not a tube

  // So RESAMPLE it the way patchTracks samples a track: fit the XY axis
  // through the rough line's points, then walk it at stationStep asking the
  // surface for its height at every station. Where the region does not cover
  // a station (the mouth of a bore, a gap) the track splits, and each piece
  // stands on its own -- same rule as patchTracks, same reason.
  let cx = 0, cy = 0;
  for (const p of rough) { cx += p[0]; cy += p[1]; }
  cx /= rough.length; cy /= rough.length;
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of rough) {
    const dx = p[0] - cx, dy = p[1] - cy;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  const tr2 = sxx + syy, det = sxx * syy - sxy * sxy;
  const lam = tr2 / 2 + Math.sqrt(Math.max(0, (tr2 * tr2) / 4 - det));
  let ux = sxy, uy = lam - sxx;
  if (Math.hypot(ux, uy) < 1e-9) { ux = 1; uy = 0; }
  const un = Math.hypot(ux, uy); ux /= un; uy /= un;
  let uLo = Infinity, uHi = -Infinity;
  for (const p of rough) {
    const u = (p[0] - cx) * ux + (p[1] - cy) * uy;
    if (u < uLo) uLo = u;
    if (u > uHi) uHi = u;
  }
  if (uHi - uLo < 1e-6) return null;
  if (small && !convexAbout(rn, regionTris, cx, cy, ux, uy)) return null;  // a pocket
  const nSt = Math.max(2, Math.min(400, Math.ceil((uHi - uLo) / step)));

  const lines = [];
  let cur = [];
  for (let k = 0; k <= nSt; k++) {
    const u = uLo + ((uHi - uLo) * k) / nSt;
    const x = cx + ux * u, y = cy + uy * u;
    const z = surfaceZAt(regionTris, x, y);
    if (z === null) {
      if (cur.length) { lines.push(cur); cur = []; }
    } else {
      cur.push([x, y, z]);
    }
  }
  if (cur.length) lines.push(cur);
  return lines.filter((t) => t.length >= PROP.minStations);
}

/** `pts` plus points every <= `gap` mm along every edge of `tris`. */
function edgePoints(tris, pts, gap) {
  const out = pts.slice();
  for (let t = 0; t < tris.length; t += 9) {
    for (let e = 0; e < 3; e++) {
      const a = t + e * 3, b = t + ((e + 1) % 3) * 3;
      const len = Math.hypot(tris[b] - tris[a], tris[b + 1] - tris[a + 1], tris[b + 2] - tris[a + 2]);
      const n = Math.ceil(len / gap);
      for (let k = 1; k < n; k++) {
        const u = k / n;
        out.push([tris[a] + (tris[b] - tris[a]) * u, tris[a + 1] + (tris[b + 1] - tris[a + 1]) * u,
                  tris[a + 2] + (tris[b + 2] - tris[a + 2]) * u]);
      }
    }
  }
  return out;
}

/**
 * Is this curved band the underside of a small TUBE -- a pipe, peg or chimney
 * lying on its side? Two tests, both area-weighted over the faces off the line
 * so a few odd facets can't flip them:
 *
 *  - CONVEX: seen across the line in plan, a pipe's faces tilt away from its
 *    lowest line; a pocket's ceiling (concave) tilts back toward it.
 *  - TWO-SIDED: a pipe's underside wraps the line, with band on both sides of
 *    it. A rounded EDGE (a roof's front, a fillet) is convex too, but its lowest
 *    line runs along the band's lower border, with the band all on one side and
 *    the part's own face carrying on down past it. A wall under that line meets
 *    that face, not air (3DBenchy at Y35: a new wall under the cabin roof's
 *    edge fused 0.09 mm into the part before this test).
 *
 * rn: [[normal, area], ...] in print space, in the same order as regionTris.
 * (cx, cy, ux, uy): a point on the lowest line and its unit direction in plan.
 */
function convexAbout(rn, regionTris, cx, cy, ux, uy) {
  const wx = -uy, wy = ux;                 // across the line, in plan
  let away = 0, toward = 0, left = 0, right = 0;
  for (let k = 0; k < rn.length; k++) {
    const t = k * 9;
    const gx = (regionTris[t] + regionTris[t + 3] + regionTris[t + 6]) / 3;
    const gy = (regionTris[t + 1] + regionTris[t + 4] + regionTris[t + 7]) / 3;
    const d = (gx - cx) * wx + (gy - cy) * wy;     // which side, how far
    if (Math.abs(d) < 0.05) continue;              // on the line: no vote
    const [n, a] = rn[k];
    const s = (n[0] * wx + n[1] * wy) * Math.sign(d);
    if (s > 0) away += a; else toward += a;
    if (d > 0) left += a; else right += a;
  }
  return away > PROP.tubeConvexFrac * (away + toward)
      && Math.min(left, right) > PROP.tubeTwoSidedFrac * (left + right);
}

/**
 * The contact polylines for one locally-flat sub-patch: straight parallel
 * tracks sampled on the patch's own surface, spaced maxUnsupportedSpan apart,
 * split wherever the patch does not cover them.
 *
 * This replaces per-bucket lowest-point selection (`contactLine`) for
 * sub-patches, because on the patches splitRegion produces, that selection is
 * unsound three different ways -- all measured on the dev matrix:
 *
 *   - On a WIDE tilted plane the lowest point per slice alternates between the
 *     downhill edge and pocket rims 26mm away; the polyline zigzags (34 reversals
 *     on voron_drive_frame @25) yet PASSES the RMS/chord gate, because 6mm of
 *     wobble is small against a 115mm chord. The sweep then self-intersects:
 *     134 bodies, one with negative volume.
 *   - On a FLAT ledge every point ties for lowest, so the pick is arbitrary and
 *     the "line" reads 0.103 -- voron_filter_housing @0's one servable ledge,
 *     refused on tie-breaking noise.
 *   - On a COARSE mesh a 169mm2 patch can be a single triangle: four points
 *     cannot be bucketed into a track at all.
 *
 * Tracks run along the patch's principal HORIZONTAL axis -- the same axis
 * contactLine fits, and the direction the owner's sketch draws: on a frame
 * whose underside slopes along its length, the principal axis IS the slope, and
 * the wall's top climbs with it. (A first version ran tracks along the mean
 * normal's level contour instead, which sounds right and is wrong the same way
 * planes.js's 15-degree vertical cut was: on that frame the level contour is
 * the SHORT direction, and the flagship 96mm wall came out 15.7mm.)
 *
 * One track per maxUnsupportedSpan of width, centred so the outermost sit half
 * a spacing inside the edges: a patch narrower than one span gets exactly one
 * wall down its middle, a wide plane gets a row of parallel buttresses. Each
 * track is straight in XY by construction, so the sweep's sections are parallel
 * and cannot collide.
 *
 * Where the patch does not cover a station -- a pocket, the hole in the middle
 * of a bowl's ring, the notch of an L -- the track SPLITS, and each piece stands
 * on its own against minStations/minSpan. That is what keeps refusing the bowl:
 * its ring only ever covers short chords of a straight line, and short chords
 * are stubs. The hole is load-bearing; never bridge across a null.
 *
 * `axis` ([ux, uy]) overrides the run direction. A lattice strut passes its own
 * long axis (prop/lattice.js): a strut running AROUND a dome slopes across its
 * 4 mm width, so down-slope runs across it and every track is a stub, while the
 * same strut running down the dome got a wall -- identical struts, different
 * support. A lone strut's long axis is clean; the drift below is a messy
 * region's.
 */
export function patchTracks(pts, patchTris, step = PROP.stationStep, support = null,
                            span = PROP.maxUnsupportedSpan, axis = null) {
  if (!pts.length) return [];

  // The 2x2 XY covariance of the patch, plus its cross-terms with Z. This used to
  // pick the run direction from the covariance's principal axis, but that axis is
  // only trustworthy on a clean rectangle -- see the run-direction note below.
  let cx = 0, cy = 0, cz = 0;
  for (const p of pts) { cx += p[0]; cy += p[1]; cz += p[2]; }
  cx /= pts.length; cy /= pts.length; cz /= pts.length;
  let sxx = 0, sxy = 0, syy = 0, sxz = 0, syz = 0;
  for (const p of pts) {
    const dx = p[0] - cx, dy = p[1] - cy, dz = p[2] - cz;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
    sxz += dx * dz; syz += dy * dz;
  }
  const det = sxx * syy - sxy * sxy;
  // underside plane z = a x + b y + c: gradient (a,b) = steepest descent, from
  // the same centred sums (the covariance IS the normal-equation matrix)
  const gx = det > 1e-9 ? (syy * sxz - sxy * syz) / det : 0;
  const gy = det > 1e-9 ? (sxx * syz - sxy * sxz) / det : 0;
  const slope = Math.hypot(gx, gy);

  // Run direction for the parallel wall tracks. Driven by the underside's SLOPE,
  // not by the footprint's covariance principal axis. The principal axis is only
  // trustworthy on a clean rectangle; a real overhang is a messy cloud of rings
  // and struts whose covariance leans to a spurious diagonal even when the part
  // is elongated straight along an axis (drive_frame tilted 30deg about X: the
  // footprint is 51x99 along Y, but PCA reports 71deg, while the slope is a clean
  // 90deg down the long axis). The slope gradient, fitted from the same sums, is
  // robust and part-aligned -- so the walls run parallel to a real edge instead
  // of at an angle the part never suggested.
  let ux, uy;
  if (axis) {
    [ux, uy] = axis;
  } else if (slope >= PROP.contourSlopeMin) {
    // run each wall DOWN the slope (steepest descent). When a part is tilted into
    // a strong pose it is usually tipped about its SHORT axis, so down-slope is
    // the LONG direction: long walls, the flagship's 96mm wall rather than the
    // 15.7mm stub a level-contour run produced on the same messy region.
    ux = gx; uy = gy;
  } else {
    // near-flat ledge: no slope to follow, so align to the longer world axis, the
    // way a human draws a fin on a square face -- never a covariance diagonal.
    let xLo = Infinity, xHi = -Infinity, yLo = Infinity, yHi = -Infinity;
    for (const p of pts) {
      if (p[0] < xLo) xLo = p[0]; if (p[0] > xHi) xHi = p[0];
      if (p[1] < yLo) yLo = p[1]; if (p[1] > yHi) yHi = p[1];
    }
    let spanX = xHi - xLo, spanY = yHi - yLo;

    // Run walls along the axis of the longer UNSUPPORTED span, not the longer
    // face. A bridge ceiling is one flat square face whose ends rest on the two
    // legs below it; the part that bridges is only the gap between them. Measured
    // as the whole face the gap reads square, the tie picks the wrong axis, and
    // the walls run ALONG the bridge (parallel to the layer lines they should be
    // breaking up) instead of across it. So SCAN A GRID, mark every cell with
    // solid part directly beneath as supported, and size each axis by its longest
    // CONTIGUOUS free run (not the free bounding box, whose edges survive on the
    // odd boundary cell insidePart reads as outside). With nothing below -- an
    // ordinary bed overhang -- every cell is free and the runs equal the bbox, so
    // this is the old longer-axis rule unchanged.
    if (support && spanX > 0 && spanY > 0) {
      const gstep = Math.max(1, step);
      const nx = Math.min(80, Math.ceil(spanX / gstep));
      const ny = Math.min(80, Math.ceil(spanY / gstep));
      const grid = [];                                    // grid[i][j] = free?
      for (let i = 0; i <= nx; i++) {
        const x = xLo + (spanX * i) / nx;
        const col = [];
        for (let j = 0; j <= ny; j++) {
          const y = yLo + (spanY * j) / ny;
          const z = surfaceZAt(patchTris, x, y);
          col.push(z !== null &&
            !insidePart(support.topo, support.rot, support.offset, x, y, z - 0.1));
        }
        grid.push(col);
      }
      const dx = spanX / nx, dy = spanY / ny;
      let runX = 0, runY = 0;
      for (let j = 0; j <= ny; j++) {                     // longest free run along X
        let run = 0;
        for (let i = 0; i <= nx; i++) {
          run = grid[i][j] ? run + 1 : 0;
          if (run > runX) runX = run;
        }
      }
      for (let i = 0; i <= nx; i++) {                     // longest free run along Y
        let run = 0;
        for (let j = 0; j <= ny; j++) {
          run = grid[i][j] ? run + 1 : 0;
          if (run > runY) runY = run;
        }
      }
      if (runX > 0 && runY > 0) { spanX = runX * dx; spanY = runY * dy; }
    }
    if (spanX >= spanY) { ux = 1; uy = 0; } else { ux = 0; uy = 1; }
  }
  const un = Math.hypot(ux, uy); ux /= un; uy /= un;
  const vx = -uy, vy = ux;

  let uLo = Infinity, uHi = -Infinity, vLo = Infinity, vHi = -Infinity;
  for (const p of pts) {
    const u = p[0] * ux + p[1] * uy;
    const t = p[0] * vx + p[1] * vy;
    if (u < uLo) uLo = u; if (u > uHi) uHi = u;
    if (t < vLo) vLo = t; if (t > vHi) vHi = t;
  }
  if (uHi - uLo < 1e-6) return [];
  const nSt = Math.max(2, Math.min(400, Math.ceil((uHi - uLo) / step)));

  const vExt = vHi - vLo;
  // `span` is the requested row spacing from the coverage slider (see coverRowSpan).
  // The old code clamped this to maxUnsupportedSpan so a wide face always got at
  // least cap-density rows; Matthew wanted to be able to go SPARSER than that on a
  // small part, so the clamp is gone and the caller warns (sagRisk) when the
  // resulting spacing actually exceeds the cap. Denser still only adds rows.
  const rowSpan = Math.max(1, span);
  // (free-edge rows only under a near-flat underside -- see PROP.edgeFlatDeg)
  const flat = slope <= Math.tan((PROP.edgeFlatDeg * Math.PI) / 180);
  const rows = rowOffsets(vLo, vHi, rowSpan, support && flat && {
    support, patchTris, ux, uy, vx, vy, uLo, uHi,
  });

  const tracks = [];
  for (const v0 of rows) {
    let cur = [];
    for (let k = 0; k <= nSt; k++) {
      const u = uLo + ((uHi - uLo) * k) / nSt;
      const x = ux * u + vx * v0, y = uy * u + vy * v0;
      const z = surfaceZAt(patchTris, x, y);
      if (z === null) {
        if (cur.length) { tracks.push(cur); cur = []; }
      } else {
        cur.push([x, y, z]);
      }
    }
    if (cur.length) tracks.push(cur);
  }
  const kept = tracks.filter((t) => t.length >= PROP.minStations);
  // The lateral gap between adjacent rows this face ended up with. The caller
  // compares it to the anti-sag cap to decide whether to warn: only a face wide
  // enough to want >1 row can actually sag, and only when its spacing exceeds cap.
  kept.spacing = rows.spacing;
  return kept;
}

/**
 * Where the rows go across a patch (v, perpendicular to the walls), with the
 * widest gap between two rows as `.spacing` (0 for one row). The old layout puts
 * each row mid-strip (vExt / n apart, half that from each edge), which leaves a
 * lip of up to half a pitch past the last row; on a FREE edge (air past it, see
 * freeEdge) that lip is a cantilever, and on the slenderness coupon a 4 mm one
 * curled on every ledge. So the outermost row MOVES OUT to a free edge, flush
 * (PROP.edgeInset), and the rows spread evenly between the two ends: the same
 * number of walls. #143 added a row there instead and kept the old ones, which
 * doubled every free edge (lowledge 3 -> 5 walls, a cube at X20-30 3 -> 5, two
 * walls ~6 mm apart); Matthew 2026-10-01: same count, the end ones flush.
 * With no free edge, no part to probe, or a steep underside (`probe` null; see
 * PROP.edgeFlatDeg), the old layout exactly.
 */
function rowOffsets(vLo, vHi, rowSpan, probe) {
  const vExt = vHi - vLo, e = PROP.edgeInset;
  const n = Math.max(1, Math.round(vExt / rowSpan));
  let rows = Array.from({ length: n }, (_, w) => vLo + (vExt * (w + 0.5)) / n);
  const near = 2 * e;                        // an old row this close already sits at the end
  if (probe && vExt > 2 * near) {
    const lo = rows[0] - vLo > near && freeEdge(probe, vLo, -1);
    const hi = vHi - rows[n - 1] > near && freeEdge(probe, vHi, +1);
    if (lo || hi) {
      const a = lo ? vLo + e : rows[0], b = hi ? vHi - e : rows[n - 1];
      // one row can't stand at an end without leaving the rest bare: it keeps its
      // place mid-strip and the free ends get their own (as #143)
      // Spread wider than both the old pitch and 2 x maxUnsupportedSpan (a point
      // mid-gap out of a wall's reach), and the gap gets another row instead: two
      // rows moved out to a 60 mm strip's ends left 59 mm bare (tshape X25 sparse).
      const cap = Math.max(vExt / n, 2 * PROP.maxUnsupportedSpan);
      const m = Math.max(n, Math.ceil((b - a) / cap - 1e-9) + 1);
      rows = n === 1 ? [...(lo ? [a] : []), rows[0], ...(hi ? [b] : [])]
        : Array.from({ length: m }, (_, w) => a + ((b - a) * w) / (m - 1));
    }
  }
  if (probe) rows = lowEdgeRows(rows, lowEdges(probe, vLo, vHi), near);
  let widest = 0;
  for (let i = 1; i < rows.length; i++) widest = Math.max(widest, rows[i] - rows[i - 1]);
  rows.spacing = rows.length > 1 ? widest : 0;
  return rows;
}

/**
 * Where a near-flat patch sinks to the plate: each LOW edge, the row position
 * `v` nearest a band no wall can stand in, with `dir` pointing away from the
 * band (+1: the band is below v). A curved face lying on the bed is the case:
 * the DRO housing's bowed back at X-90 is 0-0.8 mm up for ~9 mm either side of
 * its contact strip, the pitch put the nearest surviving row at +-16 mm (and on
 * one side none at all at the default coverage), and the strip between printed
 * into air.
 *
 * Rows are sampled across v; at each, a row is OK when most samples along the
 * patch are high enough for a squat wall AND its brim each side (the weld guard
 * drops a brim within the gap of the part), LOW when none is and some sink
 * under the squat floor, PART otherwise (a row one end of which climbs out of
 * the band still carries a wall there). A low run's edge is the first OK row
 * past it, across PART rows only -- a hole or a pocket ('none') is no edge.
 */
function lowEdges(probe, vLo, vHi) {
  const { patchTris, ux, uy, vx, vy, uLo, uHi } = probe;
  const wallZ = PROP.minHeightSquat + PROP.gap + 0.02;   // clearance.js's squat floor
  const brimZ = PROP.squatBrimH + PROP.gap + 0.02;
  const step = 0.25, nU = 9;
  const at = (u, v) => surfaceZAt(patchTris, ux * u + vx * v, uy * u + vy * v);
  const vs = [], cls = [];
  for (let v = vLo; v <= vHi + 1e-9; v += step) {
    let hit = 0, ok = 0, sunk = false;
    for (let i = 0; i < nU; i++) {
      const u = uLo + ((uHi - uLo) * (i + 0.5)) / nU;
      const z = at(u, v);
      if (z === null) continue;
      hit++;
      if (z < wallZ) { sunk = true; continue; }
      const b1 = at(u, v - PROP.squatBrimW), b2 = at(u, v + PROP.squatBrimW);
      if ((b1 === null || b1 >= brimZ) && (b2 === null || b2 >= brimZ)) ok++;
    }
    vs.push(v);
    cls.push(hit === 0 ? 'none' : ok * 2 >= hit ? 'ok' : ok === 0 && sunk ? 'low' : 'part');
  }
  const edges = [];
  const reach = (k, dir) => {                // first OK row from k on, over PART rows
    for (let j = k; j >= 0 && j < cls.length; j += dir) {
      if (cls[j] === 'ok') return j;
      if (cls[j] !== 'part') return -1;
    }
    return -1;
  };
  for (let k = 0; k < cls.length; k++) {
    if (cls[k] !== 'low') continue;
    let j = k;
    while (j + 1 < cls.length && cls[j + 1] === 'low') j++;
    if ((j - k + 1) * step < PROP.lowBandMin) { k = j; continue; }   // a dip, not a band
    const below = reach(k - 1, -1), above = reach(j + 1, +1);
    if (below >= 0) edges.push({ v: vs[below], dir: -1 });
    if (above >= 0) edges.push({ v: vs[above], dir: +1 });
    k = j;
  }
  // a row's own class, so lowEdgeRows can tell a row behind an edge that still
  // builds (a PART row) from one in the band that never will
  edges.low = (v) => cls[Math.max(0, Math.min(cls.length - 1, Math.round((v - vLo) / step)))] === 'low';
  return edges;
}

/**
 * rowOffsets' rows plus a row at each low edge (lowEdges) with no row within a
 * brim width (2 x squatBrimW) of it -- either side, except a row IN the low band
 * behind it, which never builds. Only ever ADDED: the layout's rows are a guess
 * at where a wall builds, the edge scan is a coarser one, and moving a row onto
 * the edge lost real walls (the flat torus's 9-tine rim walls slid 1.3 mm in
 * and failed the build). The brim width keeps two squat brims from fusing: a
 * row behind the edge over a PART row still builds (a tilted cube at X60Z30
 * got a second squat wall 1.6 mm from it, one fused slab).
 */
function lowEdgeRows(rows, edges, near) {
  const out = [...rows];
  const brim = 2 * PROP.squatBrimW;
  for (const { v, dir } of edges) {
    const blocked = out.some((r) => {
      const d = (r - v) * dir;
      return d >= 0 ? d < brim : -d < near || (-d < brim && !edges.low(r));
    });
    if (!blocked) out.push(v);
  }
  return out.length === rows.length ? rows : out.sort((a, b) => a - b);
}

/**
 * Does the patch end in AIR along its edge at v = `vEdge` (`dir` -1 for the low
 * side, +1 for the high)? Probed at five points along the edge: the underside
 * just inside the edge gives the height, and a point 0.8 mm past the edge from
 * 2 mm below to 2 mm above that height is tested for part. Part there -- a spine
 * the ledge hangs off, the same overhang carrying on into the next sub-patch, or
 * an upright the underside meets -- makes the edge attached. Free only when most
 * probes that found an underside found air, and nothing stands in the column the
 * flush row would fill (either face, down to the bed).
 */
function freeEdge(probe, vEdge, dir) {
  const { support, patchTris, ux, uy, vx, vy, uLo, uHi } = probe;
  let air = 0, part = 0;
  for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    const u = uLo + (uHi - uLo) * t;
    const at = (v) => [ux * u + vx * v, uy * u + vy * v];
    const [ix, iy] = at(vEdge - dir * 0.3);
    const z = surfaceZAt(patchTris, ix, iy);
    if (z === null) continue;
    // an edge down at the bed rests on it: no lip to curl, and a flush wall there
    // is lower than any wall worth building (a cube at X20's low edge)
    if (z < PROP.minHeightSquat) { part++; continue; }
    const [ox, oy] = at(vEdge + dir * 0.8);
    const solid = [-2, -1, -0.3, 0.3, 1, 2].some((dz) => insidePart(support.topo, support.rot, support.offset, ox, oy, z + dz));
    if (solid) { part++; continue; }
    // the flush row's whole column must be clear too: just outside its outer
    // face, from the underside down to the bed (lbracket Y20: the side under the
    // edge leans out, and a flush wall stood in it lower down)
    // (both faces: a deck overhanging its leg by less than a wall stands the
    // flush row against the leg -- bridge, sparse: blocked and buried)
    for (const side of [+1, -1]) {
      const [cx, cy] = at(vEdge - dir * PROP.edgeInset + side * dir * (PROP.th / 2 + PROP.sideClear));
      for (let zz = z - 0.5; zz > 0.3; zz -= 1) {
        if (insidePart(support.topo, support.rot, support.offset, cx, cy, zz)) return false;
      }
    }
    air++;
  }
  return air >= 2 && air > part;
}
