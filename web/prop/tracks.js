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
  if (regionArea < PROP.tubeMinArea) return null;  // a pocket, not a tube

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
  const rough = contactLine(pts, regionTris, nSamples);
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
 */
export function patchTracks(pts, patchTris, step = PROP.stationStep, support = null,
                            span = PROP.maxUnsupportedSpan) {
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
  if (slope >= PROP.contourSlopeMin) {
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
  const nWalls = Math.max(1, Math.round(vExt / rowSpan));

  const tracks = [];
  for (let w = 0; w < nWalls; w++) {
    const v0 = vLo + (vExt * (w + 0.5)) / nWalls;
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
  kept.spacing = nWalls > 1 ? vExt / nWalls : 0;
  return kept;
}
