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
 */
import { insidePart, solidClearance } from './inside.js';
import { faceAdjacency } from './planes.js';
import { MIN_REGION_AREA } from './overhangs.js';
import { ribbon, boxExtrude } from './solids.js';
import { bodyMask, insertFloorStations, longestRun, stationCertified, stationIsClear, tallBody, tallSpan, withLowTails } from './prop/clearance.js';
import { PROP } from './prop/config.js';
import { contactLine, contourTop, lowerSag, settleTop, straightness } from './prop/contact.js';
import { seat, surfaceZAt, surfaceZsAt } from './prop/surface.js';
import { sweep, sweepBetween } from './prop/sweep.js';

// Moved into web/prop/ (one module per concern); re-exported here so every
// importer of prop.js is unchanged.
export { PROP } from './prop/config.js';
export { straightness, contactLine, lowerSag, contourTop, settleTop } from './prop/contact.js';
export { footFor, profileHalf, sweep, sweepBetween } from './prop/sweep.js';
export { surfaceZAt, surfaceZsAt } from './prop/surface.js';
export { stationIsClear, stationCertified, pathToPlateIsClear, longestRun,
  withLowTails, insertFloorStations } from './prop/clearance.js';

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

/**
 * Lay a comb of grip tines along a placed wall's top, biting a hair into the
 * part, and return how many actually landed.
 *
 * `line` is the wall's settled TOP contour (each station's z is the part surface
 * directly above it; the wall's own top sits `gap` under that). A tine is one
 * layer-tall nub that reaches horizontally off the wall top into the part. The
 * direction is chosen, not assumed: the part material adjacent to the top lies
 * DOWN-slope (where the underside is lower, the wall-top height is already inside
 * the solid), so the emitter tries both run directions and keeps whichever puts
 * the nub's tip inside the part -- and emits nothing where neither does, which is
 * the honest "this face is too shallow to grip" case a horizontal tine has by
 * nature (fins.js's tineSpanMax rule, expressed as a containment test here).
 *
 * Nubs are the wall's own thickness wide and overlap back into it, so the slicer
 * unions them onto the wall the same way every other solid here is unioned.
 */
/** Squared distance from point p to triangle (a,b,c). Ericson closest-point. */
function ptTriDist2(p, a, b, c) {
  const sub = (u, v) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return dot(ap, ap);
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return dot(bp, bp);
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return dot(cp, cp);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); const q = [a[0] + v * ab[0], a[1] + v * ab[1], a[2] + v * ab[2]]; const w = sub(p, q); return dot(w, w); }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); const q = [a[0] + w * ac[0], a[1] + w * ac[1], a[2] + w * ac[2]]; const u = sub(p, q); return dot(u, u); }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); const q = [b[0] + w * (c[0] - b[0]), b[1] + w * (c[1] - b[1]), b[2] + w * (c[2] - b[2])]; const u = sub(p, q); return dot(u, u); }
  const denom = 1 / (va + vb + vc), v = vb * denom, w = vc * denom;
  const q = [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
  const u = sub(p, q); return dot(u, u);
}

/**
 * Horizontal INWARD-normal of the part face nearest a tine seed -- the direction
 * a tine must bite to grip "straight on". The bite heading has to come from the
 * PART (which way the face points), never from the wall's run: a wall along a
 * leaning face's level contour runs TANGENT to the surface, so a run-aligned nub
 * lies flat instead of biting in. The nearest face handles both scenarios the tool
 * places walls in -- under a sloped overhang (nearest face is the underside) and
 * beside a near-vertical wall (nearest face is that side) -- while a shallow ceiling
 * (near-vertical normal, tiny horizontal component) returns null, the honest "too
 * flat to grip horizontally" case. Returns {x,y} unit horizontal or null.
 */
function biteDirsAt(topo, rot, offset, px, py, pz) {
  const pos = topo.pos, nrm = topo.nrm, nF = topo.nFaces;
  const P = [px, py, pz];
  const seat = (o) => [rot[0] * pos[o] + rot[3] * pos[o + 1] + rot[6] * pos[o + 2] + offset.x,
                       rot[1] * pos[o] + rot[4] * pos[o + 1] + rot[7] * pos[o + 2] + offset.y,
                       rot[2] * pos[o] + rot[5] * pos[o + 1] + rot[8] * pos[o + 2] + offset.z];
  const d2 = new Float64Array(nF);
  let best = Infinity;
  for (let f = 0; f < nF; f++) {
    const o = f * 9;
    d2[f] = ptTriDist2(P, seat(o), seat(o + 3), seat(o + 6));
    if (d2[f] < best) best = d2[f];
  }
  if (!(best < Infinity)) return [];
  // TIES. At an inside corner two faces can be EXACTLY equidistant (a step's
  // underside and the part's side face, 6.7100e-3 both), and which one a strict
  // `<` kept was decided by 1e-15 of float noise -- so an unrelated change that
  // nudged a station by that much flipped tines between biting and missing.
  // Return every tied face (nearest first by index, as before) and let the caller
  // take the first whose bite lands in the part.
  const tol = best * 1e-9 + 1e-12;
  const dirs = [];
  for (let f = 0; f < nF; f++) {
    if (d2[f] > best + tol) continue;
    const nx = nrm[f * 3], ny = nrm[f * 3 + 1], nz = nrm[f * 3 + 2];
    // seated normal, then INWARD (into the part) = negated, horizontal component only
    const sx = rot[0] * nx + rot[3] * ny + rot[6] * nz;
    const sy = rot[1] * nx + rot[4] * ny + rot[7] * nz;
    const hx = -sx, hy = -sy, hm = Math.hypot(hx, hy);
    if (hm < 0.34) continue;                  // face too flat (near-horizontal ceiling) to grip sideways
    dirs.push({ x: hx / hm, y: hy / hm });
  }
  return dirs;
}

/**
 * Nub spacing (mm) for a user "Tine grip" setting in [0 sparse .. 1 dense].
 * DEFAULT (undefined) is dense -- the proven comb. Sparse only ever LOOSENS the
 * requested spacing; emitTines's minGripTines floor still guarantees grip on
 * short walls, so a sparse setting thins surface marking without starving grip.
 */
export function tineStepFor(density) {
  const d = Math.max(0, Math.min(1, density ?? 1));
  return PROP.tineStepSparse - d * (PROP.tineStepSparse - PROP.tineStep);
}

export function emitTines(line, tris, topo, rot, offset, out, stepArg = PROP.tineStep,
                          minTop = PROP.baseH + 0.2, tineH = PROP.tineH, body = null) {
  if (line.length < 2) return 0;

  // arc length along the run, to space nubs by a real distance not a station count
  const s = [0];
  for (let i = 1; i < line.length; i++) {
    s.push(s[i - 1] + Math.hypot(line[i][0] - line[i - 1][0],
                                 line[i][1] - line[i - 1][1]));
  }
  // `body` = [i0, i1], the station range of a tall wall's full-height BODY (the
  // rest is its low TAILS, withLowTails). It only sizes the spacing below: the
  // minGripTines floor counts the body, as before walls grew tails, so a tail
  // never thins the comb. The comb itself runs the whole wall, anchored at the
  // lowest point a nub grips (see the end), so rows never land where a tail
  // can't take one. Callers without a tail pass nothing.
  const s0 = body ? s[body[0]] : 0;
  const s1 = body ? s[body[1]] : s[s.length - 1];
  const total = s1 - s0;
  if (!(total > 0)) return 0;

  // The caller's step encodes tip-over risk (sparse for a stable part). But grip
  // is a floor no part goes under: a wall gets at least minGripTines along its
  // length, so a squat part's sparse spacing never starves a long wall of grip or
  // leaves a short wall with a single lonely nub. min() only ever TIGHTENS the
  // requested spacing, never loosens it past the dense comb.
  const step = Math.min(stepArg, total / PROP.minGripTines);
  if (total < step) return 0;

  // half the tine's WIDTH across the run -- one nozzle bead (PROP.tineW), NOT the
  // wall thickness. Building it th-wide made a 1mm divot, ~2x Slant3D's spec.
  const half = PROP.tineW / 2;

  let count = 0;
  // Place ONE tine at arc length d0 (relative to the body start s0); true if it
  // landed. Everything below is per-station and unchanged.
  const place = (d0) => {
    const d = d0 + s0;                          // back onto the full run's arc length
    // interpolate the station at arc length d
    let k = 0;
    while (k < s.length - 1 && s[k + 1] < d) k++;
    const seg = Math.max(1e-9, s[k + 1] - s[k]);
    const f = (d - s[k]) / seg;
    const x = line[k][0] + (line[k + 1][0] - line[k][0]) * f;
    const y = line[k][1] + (line[k + 1][1] - line[k][1]) * f;
    const z = line[k][2] + (line[k + 1][2] - line[k][2]) * f;   // surface z
    const wallTop = z - PROP.gap;
    if (wallTop < minTop) return false;   // below the wall's base (flange or brim): no
                                      // face to attach a tine to. minTop defaults to
                                      // the flanged base; a squat wall passes its brim.

    // LAYER-SNAP so the tine prints as exactly ONE bead, not two partial layers.
    // A tine is tineH tall (= the slicer's layer height) precisely so it slices as a
    // single continuous bead that snaps clean. But its top used to be pinned to the
    // part underside `z`, which is almost never on the layer grid -- so a 0.2mm tine
    // straddled a layer boundary and sliced into two thin layers (Matthew's cube: all
    // 22 tines spanned 2 layers, each a 0.15mm + 0.05mm pair). A two-layer tine is a
    // taller, stronger weld that marks worse and won't bend-snap clean. Fix: snap the
    // tine's span onto the layer grid so it fills exactly one cell [tineBot, tineTop].
    //
    // Snap to the NEAREST grid line, not the one below. Flooring (always down) drops a
    // tine whose underside sits just under a layer line by nearly a full layer -- then
    // the part's own sub-layer sliver above it is too thin to print and the slicer
    // leaves a full empty layer between the tine top and the part's first real layer:
    // a "missing layer" with the part edge floating over it (Matthew's cube: every
    // underside sat ~0.19 above a line, so every tine dropped ~0.19). Rounding keeps
    // the tine top within half a layer of the underside, so it lands right where the
    // part's nearest layer begins -- supporting it -- and its bottom stays in the same
    // or the adjacent grid cell as the wall's top layer, so it still rests on the wall.
    // Grid is plate-origin (z = 0) at the layer height: exact when the slicer's first-
    // layer height equals its layer height (the common default); a different first
    // layer just offsets every tine by the same sub-layer amount. The probe below
    // still uses the underside level (zMid), so PLACEMENT is unchanged -- only the
    // built box moves onto the grid.
    const tineTop = Math.round(z / tineH) * tineH;
    const tineBot = tineTop - tineH;
    const zMid = z - tineH / 2;

    // BITE DIRECTION comes from the PART (which way the nearest face points),
    // never from the wall's run: a run-aligned nub lies flat on a leaning face
    // whose level contour the wall follows -- the regression. Then require the
    // nub's full reach to actually land inside the part, or skip it (honest -- no
    // tine gripping air, no tine on a ceiling too shallow to grab sideways).
    const bd = biteDirsAt(topo, rot, offset, x, y, zMid).find((c) =>
      insidePart(topo, rot, offset, x + c.x * PROP.tineBite, y + c.y * PROP.tineBite, zMid));
    if (!bd) return false;
    const dirx = bd.x, diry = bd.y;

    // frame (along = bite dir, across = z x along, up = z) is right-handed
    const ax = -diry, ay = dirx;                                // across = z x along
    const base = [x, y, 0];
    const P = (a, b, c) => [base[0] + dirx * a + ax * b,
                            base[1] + diry * a + ay * b, c];
    // rectangle in (along, across): from -overlap (into the wall) to +bite
    const poly = [
      [-PROP.tineOverlap, -half], [PROP.tineBite, -half],
      [PROP.tineBite, half], [-PROP.tineOverlap, half],
    ];
    boxExtrude(poly, tineBot, tineTop, P, out);
    // Test seam: tests/tines_realparts.test.js sets globalThis.__TINECAP to an array
    // and reads back each tine's seed + bite heading to verify grip on real parts
    // through the whole pipeline. Undefined in the browser -> a zero-cost noop.
    if (globalThis.__TINECAP) globalThis.__TINECAP.push({ x, y, z: zMid, biteX: dirx, biteY: diry });
    count++;
    return true;
  };
  // ONE COMB, LAID UP FROM THE BOTTOM. The wall's LOW end is the part's bottom
  // edge, where a tilted part peels off first (Slant3D's "dense low"), so the comb
  // is anchored there: scan up from the low end a tine-width at a time for the
  // lowest point a nub actually grips (the last stretch is often under minTop, or
  // curls away on a curved part), then step up the WHOLE run (tail + body) at the
  // regular spacing from that anchor. An earlier version stacked three passes --
  // the body comb from half a step in, a forced nub against EACH end, and a tail
  // pass below the body -- which bunched the bottom tines at uneven gaps (35deg
  // cube: 0.8/2.1/2.8 then 2mm) and jammed a nub 0.5mm from the TOP end, where the
  // overhang face ends and it hung past the part's edge. So: no nub within
  // tineTopClear of the top end. That margin is fixed, not half a step, so a sparse
  // comb doesn't lose its last nub to a 2.5mm dead zone. The anchor scan runs as far
  // up as it must: capping it and falling back to an arbitrary phase let the whole
  // comb straddle a narrow grippable stretch and miss it entirely.
  //
  // EDGE-BIASED spacing: dense (`step`) within tineEdgeBand of either end, thinned
  // (`step * tineMidFactor`) across the middle, so the comb clusters at the run's
  // ends/corners and stops marching across a visible flat face (PROP.tineEdgeBand).
  // The step chosen for the NEXT gap depends on where we are now: still dense while
  // the current station sits in either end band. A run <= 2*band is all-edge.
  // The interior step thins by tineMidFactor but never past the slider's OWN
  // sparsest setting: edge-bias must not compound with a user who already dialed
  // grip to light and starve the comb to a few scattered nubs.
  const S = s[s.length - 1];
  const lowFirst = line[0][2] <= line[line.length - 1][2];
  const at = (u) => place((lowFirst ? u : S - u) - s0);   // u = arc length from the LOW end
  const band = Math.min(PROP.tineEdgeBand, S / 2);
  const midStep = Math.min(step * PROP.tineMidFactor, PROP.tineStepSparse);
  const uTop = S - Math.min(step / 2, PROP.tineTopClear);
  const zLo = Math.min(line[0][2], line[line.length - 1][2]);
  const zHi = Math.max(line[0][2], line[line.length - 1][2]);
  if (!body && zHi - zLo < PROP.tineSlopeMin) {
    // A LEVEL line with no tail (most wedges, squat walls): main's plain comb,
    // unchanged -- it was already even, and a level line has no bottom edge to
    // anchor. Re-phasing these moved nubs off the few grippable spots (dense
    // wedges lost 10-20% of their tines). A SLOPED line, tail or not, runs down to
    // the part's bottom edge and takes the bottom-anchored comb below.
    for (let d = step / 2; d < S; ) {
      place(d);
      d += Math.min(d, S - d) <= band ? step : midStep;
    }
    return count;
  }
  // Start and scan scale down with the step on a very short run (a near-vertical
  // wedge line can be 0.1mm long in XY, and step shrinks to fit minGripTines there).
  const scan = Math.min(PROP.tineW, step / 2);
  let u = Math.min(half, step / 2);
  while (u <= uTop && !at(u)) u += scan;
  // Dense while this nub OR the next sparse one sits in an end band: anchoring
  // the comb lower shifts where it crosses into the top band, and judging only the
  // current nub let one 4mm gap straddle the band edge and cost the top a nub.
  for (;;) {
    const dense = Math.min(u, S - u) <= band || S - (u + midStep) <= band;
    u += dense ? step : midStep;
    if (u > uTop) break;
    at(u);
  }
  return count;
}

/**
 * The floor contour a PART-ATTACHED support stands on: for each station of
 * `topLine`, the HIGHEST part surface strictly below the overhang, or 0 (the
 * plate) where nothing intervenes.
 *
 * This is the exact mirror of `contourTop`. contourTop looks UP across the tip
 * and takes the LOWEST hit, so the tip stops `gap` under the overhang; floorLine
 * looks DOWN across the tip and takes the HIGHEST hit below the overhang, so the
 * support lands on the part instead of driving to z=0. Taking the highest hit
 * across the tip's width (not just the centre) means the bottom rests ON the
 * floor and never digs into it -- the same reasoning contourTop uses to keep the
 * top out of the part.
 *
 * `margin` keeps the overhang's OWN face from being read as its floor: only
 * surfaces at least `margin` below the contact line count. Stations with no
 * intervening surface fall through to 0, so a wall that is part over-part and
 * part over-bed degrades station-by-station to the plate with nothing special-
 * cased -- the current all-to-plate behaviour is just the everywhere-0 case.
 */
export function floorLine(topLine, tris, margin = 1.0) {
  const half = PROP.tip / 2;
  const bot = [];
  for (let i = 0; i < topLine.length; i++) {
    const a = topLine[Math.max(0, i - 1)];
    const b = topLine[Math.min(topLine.length - 1, i + 1)];
    let rx = b[0] - a[0], ry = b[1] - a[1];
    const rn = Math.hypot(rx, ry) || 1;
    const sx = ry / rn, sy = -rx / rn;      // across the wall
    const ceil = topLine[i][2] - margin;
    let z = 0;                               // plate fallback
    for (const o of [-half, 0, half]) {
      for (const zz of surfaceZsAt(tris, topLine[i][0] + sx * o, topLine[i][1] + sy * o)) {
        if (zz < ceil && zz > z) z = zz;     // highest surface below the overhang
      }
    }
    bot.push([topLine[i][0], topLine[i][1], z]);
  }
  return bot;
}

// How far below the clicked/probed overhang a settle pass may still pull the top
// down when looking for a part-attached support. Comfortably covers an overhang's
// own slope over a wall's length, and stays well under the smallest floor-to-
// overhang gap worth supporting -- so the top settles on the overhang, never its
// floor. Shared with draw.js so the two paths measure a part-attached wall alike.
export const PART_BAND = 3.0;

const BORE = {
  radius: 10,      // mm; a cavity narrower than ~2x this reads as a bore/slot
  dirs: 8,         // compass rays cast outward from the support column
  walledMin: 6,    // ...this many hitting part within `radius` = enclosed
  step: 0.5,       // mm along each ray
};

/**
 * Is the support column at station `k` enclosed by part walls -- i.e. standing
 * inside a bore or narrow slot? A support there SCARS an internal surface you
 * cannot clean (worse than a little sag), so [[project_support_fin_quality_first]]
 * says refuse it: a hole is an ORIENTATION problem, not a support one.
 *
 * Cast `dirs` horizontal rays out from the column's centreline at mid-height and
 * count how many strike part material within `radius`. An open ledge-over-base
 * has air on at least some sides (few walled); a blind bore is walled all round.
 */
function enclosedFloor(top, floor, k, topo, rot, offset) {
  const p = top[k];
  const zMid = (floor[k][2] + (top[k][2] - PROP.gap)) / 2;
  // A column whose own centreline is inside the part is buried, not standable.
  if (insidePart(topo, rot, offset, p[0], p[1], zMid)) return true;
  let walled = 0;
  for (let d = 0; d < BORE.dirs; d++) {
    const ang = (d / BORE.dirs) * 2 * Math.PI;
    const dx = Math.cos(ang), dy = Math.sin(ang);
    for (let r = BORE.step; r <= BORE.radius; r += BORE.step) {
      if (insidePart(topo, rot, offset, p[0] + dx * r, p[1] + dy * r, zMid)) {
        walled++;
        break;
      }
    }
  }
  return walled >= BORE.walledMin;
}

/**
 * Can a PART-ATTACHED wall at station `k` stand between its floor and the overhang
 * without piercing a side wall? Mirror of stationIsClear, but bounded to the
 * (floor, top) span the wall actually occupies -- it probes STRICTLY between the
 * ends, since the bottom is meant to weld to the floor and the top to break away
 * under the overhang, and probing those would read the intended contacts as welds.
 */
function clearBetween(top, floor, k, topo, rot, offset) {
  const p = top[k];
  const a = top[Math.max(0, k - 1)];
  const b = top[Math.min(top.length - 1, k + 1)];
  const rx = b[0] - a[0], ry = b[1] - a[1];
  const rn = Math.hypot(rx, ry);
  if (rn < 1e-9) return true;
  const sx = ry / rn, sy = -rx / rn;
  const zTop = p[2] - PROP.gap, zBot = floor[k][2];
  const nP = Math.max(3, Math.ceil((zTop - zBot) / 1.5));
  for (let i = 1; i < nP; i++) {                 // strictly interior heights
    const z = zBot + ((zTop - zBot) * i) / nP;
    for (const m of [0.12, 0.24, PROP.sideClear]) {
      const w = PROP.th / 2 + m;
      if (insidePart(topo, rot, offset, p[0] + sx * w, p[1] + sy * w, z)) return false;
      if (insidePart(topo, rot, offset, p[0] - sx * w, p[1] - sy * w, z)) return false;
    }
  }
  return true;
}

/**
 * Try to stand a PART-ATTACHED wall under `line` (the overhang contact polyline,
 * seated). Returns one of three verdicts:
 *   { ok: true, prop }   -- a part-attached wall was built into `out`.
 *   { floored: true }    -- there IS a floor here (an over-the-part overhang) but
 *                           no safe wall fits (a bore, or side walls in the way);
 *                           the caller must NOT then stilt to the plate through
 *                           the part -- it counts this and moves on.
 *   { }                  -- no floor beneath the overhang; an ordinary bed
 *                           overhang. The caller falls through to the plate path
 *                           UNCHANGED, so the flagship parts don't change.
 *
 * This is the auto-placer's version of what draw.js does by hand: settle a BANDED
 * top so the overhang isn't dragged onto its own floor, read the floor with
 * floorLine, and bridge the two with sweepBetween. It only claims a line when a
 * real floor sits under MOST of it, refuses bores (enclosedFloor), and refuses to
 * pierce side walls (clearBetween).
 */
function buildPartAttached(line, partTris, topo, rot, offset, out) {
  const top = line.map((p) => [p[0], p[1], p[2]]);
  contourTop(top, partTris, PART_BAND);
  lowerSag(top, partTris, PART_BAND);
  settleTop(top, partTris, 0.25, PART_BAND);
  const floor = floorLine(top, partTris);

  // A real floor under a majority of stations, or this is a bed overhang -- let
  // the plate path have it. floorLine returns ~0 with clear air to the plate, so
  // this declines on every ordinary overhang and the flagship parts don't change.
  let real = 0;
  for (const f of floor) if (f[2] > PROP.gap + 0.5) real++;
  if (real < Math.max(PROP.minStations, Math.ceil(floor.length * 0.5))) return {};

  const ok = top.map((p, k) => {
    if (floor[k][2] <= PROP.gap + 0.5) return false;               // no real floor
    if ((p[2] - PROP.gap) - floor[k][2] < PROP.minHeight) return false;
    if (enclosedFloor(top, floor, k, topo, rot, offset)) return false;
    return clearBetween(top, floor, k, topo, rot, offset);
  });
  const run = longestRun(ok);
  if (!run || run[1] - run[0] < PROP.minStations) return { floored: true };

  const subTop = top.slice(run[0], run[1]);
  const subFloor = floor.slice(run[0], run[1]);
  const span = Math.hypot(subTop[subTop.length - 1][0] - subTop[0][0],
                          subTop[subTop.length - 1][1] - subTop[0][1]);
  if (span < PROP.minSpan) return { floored: true };

  const before = out.length;
  if (!sweepBetween(subTop, subFloor, out)) { out.length = before; return { floored: true }; }

  let height = 0, vol = 0;
  for (let i = 0; i < subTop.length; i++) {
    height = Math.max(height, (subTop[i][2] - PROP.gap) - subFloor[i][2]);
  }
  for (let i = before; i < out.length; i += 3) {
    const a = out[i], b = out[i + 1], c = out[i + 2];
    vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2])
          + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return {
    ok: true,
    prop: {
      span, height, stations: subTop.length, volume: Math.abs(vol),
      partAttached: true,
      line: subTop.map((p) => [p[0], p[1], p[2] - PROP.gap]),
    },
  };
}

/**
 * Sweep a SQUAT breakaway wall: a thin wall necking to the breakaway tip, on a
 * flat brim. The full T-flange (`sweep`) can't fit here -- baseH 1.0 alone is most
 * of the wall -- but a squat wall still has to hold to the plate, so it gets a
 * thin WIDE brim instead: two layers tall (snaps off, leaves no part mark since it
 * sits on the plate), wide enough to grip. Two overlapping solids the slicer
 * unions, exactly like `sweep`'s wall + flange.
 */
export function sweepSquat(line, zBed, out) {
  const wall = [], brim = [];
  const brimTop = zBed + PROP.squatBrimH;
  for (let i = 0; i < line.length; i++) {
    const p = line[i];
    const a = line[Math.max(0, i - 1)];
    const b = line[Math.min(line.length - 1, i + 1)];
    let rx = b[0] - a[0], ry = b[1] - a[1];
    const rn = Math.hypot(rx, ry);
    if (rn < 1e-9) return false;
    rx /= rn; ry /= rn;
    const sx = ry, sy = -rx;                 // horizontal, across the wall

    const top = p[2] - PROP.gap;
    const h = top - zBed;
    if (h < PROP.minHeightSquat) return false;
    // neck to the tip over whatever height is left above the brim
    const ztip = Math.max(top - PROP.tipH, brimTop + 0.05);
    const P = (o, z) => [p[0] + sx * o, p[1] + sy * o, z];

    // the stem: bed to breakaway tip, th-wide then necking to the contact tip
    wall.push([
      P(+PROP.th / 2, zBed), P(+PROP.th / 2, ztip), P(+PROP.tip / 2, top),
      P(-PROP.tip / 2, top), P(-PROP.th / 2, ztip), P(-PROP.th / 2, zBed),
    ]);
    // the brim: a thin flat slab overlapping the wall's base, for plate grip
    brim.push([
      P(+PROP.squatBrimW, zBed), P(+PROP.squatBrimW, brimTop),
      P(-PROP.squatBrimW, brimTop), P(-PROP.squatBrimW, zBed),
    ]);
  }
  ribbon(wall, out);
  ribbon(brim, out);
  return true;
}

/**
 * Build brimmed squat breakaway walls on the sub-minHeight bed stations of a
 * contoured overhang line -- the near-bed overhangs a full T-wall can't reach.
 *
 * A flanged wall needs ~minHeight of headroom to exist at all, so `sweep` and its
 * trim discard every station lower than that; on an organic part whose underside
 * ramps down to the plate, that abandons the whole low band and it prints into
 * air. Here the low band is built directly: the stations with minHeightSquat <=
 * height < minHeight (DISJOINT from the tall run the caller builds, so the two
 * never compete) are walked into maximal runs, and each is swept via `sweepSquat`
 * -- a thin wall on a thin WIDE brim. The full T-foot can't fit under a 1mm wall
 * (footMin 1.6 would splay into a sheet), but the wall still has to HOLD to the
 * plate, so the brim gives it the adhesion area a bare 0.6mm-wide tip never could.
 * Same weld guard as the plate path: a squat wall that would fuse is dropped,
 * never shipped ("no prop" is fixable, a fused prop is a ruined print).
 *
 * Operates on a private deep copy of the line so `settleTop` never mutates the
 * points the caller's tall path still reads. Appends triangles to `out` and
 * returns the placed prop descriptors (marked `squat: true`).
 *
 * `claimed` (optional, per station) marks stations a tall wall already covers
 * with its low TAIL (withLowTails); those are skipped so the two never stack.
 * Only stations the built wall really spans are claimed -- a low band next to a
 * BLOCKED tall station still gets its squat wall.
 */
export function buildSquatBed(line, regionTris, topo, rot, offset, out, claimed = null) {
  const zBed = 0;
  const placed = [];
  const heightOf = (p) => (p[2] - PROP.gap) - zBed;
  const usable = line.map((p, k) => {
    const h = heightOf(p);
    return h >= PROP.minHeightSquat && h < PROP.minHeight && !(claimed && claimed[k])
        && stationIsClear(line, k, topo, rot, offset);
  });

  let k = 0;
  while (k < usable.length) {
    if (!usable[k]) { k++; continue; }
    let j = k;
    while (j < usable.length && usable[j]) j++;
    const raw = line.slice(k, j).map((p) => [p[0], p[1], p[2]]);  // deep copy
    k = j;
    if (raw.length < PROP.minStations) continue;
    const spanRaw = Math.hypot(raw[raw.length - 1][0] - raw[0][0],
                               raw[raw.length - 1][1] - raw[0][1]);
    if (spanRaw < PROP.minSpanSquat) continue;

    // Put the closest approach on spec, then re-trim: settling can lift a station
    // into the tall band or drop one below the squat floor, exactly as it can for
    // a full wall. Keep only what is still squat-height and measurably clear.
    settleTop(raw, regionTris);
    const avail = raw.map((p, i) => {
      const h = heightOf(p);
      return h >= PROP.minHeightSquat && h < PROP.minHeight
          && stationCertified(raw, i, topo, rot, offset);
    });
    const run = longestRun(avail);
    if (!run || run[1] - run[0] < PROP.minStations) continue;
    const settled = raw.slice(run[0], run[1]);
    const span = Math.hypot(settled[settled.length - 1][0] - settled[0][0],
                            settled[settled.length - 1][1] - settled[0][1]);
    if (span < PROP.minSpanSquat) continue;

    const before = out.length;
    if (!sweepSquat(settled, zBed, out)) {
      out.length = before;
      continue;
    }

    // Same acceptance as the plate path: an approach from above is the breakaway
    // interface (must clear the gap), anything else is a flank weld.
    const hit = solidClearance(topo, rot, offset, out.slice(before), 0.25);
    if (hit && (hit.cosUp > 0.7 ? hit.d < PROP.gap - 0.065 : hit.d < 0.205)) {
      out.length = before;
      continue;
    }

    const top = Math.max(...settled.map((p) => p[2])) - PROP.gap;
    let vol = 0;
    for (let i = before; i < out.length; i += 3) {
      const a = out[i], b = out[i + 1], c = out[i + 2];
      vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2])
            + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    }
    placed.push({
      span, height: top - zBed, stations: settled.length, volume: Math.abs(vol),
      squat: true,
      line: settled.map((p) => [p[0], p[1], p[2] - PROP.gap]),
      // Triangle range of THIS wall in the caller's `out`. The caller emits the
      // tines separately (after every squat wall), so a fin's full geometry is
      // [this wall range] + [its tines range] -- two non-contiguous segments,
      // tracked as `triRanges` at the push site.
      triRange: [before, out.length],
    });
  }
  return placed;
}

/**
 * What buildProps returns when it builds nothing -- kept here so the callers
 * that refuse to build (a part seated on a point) return the same shape.
 */
export function noProps() {
  return {
    triangles: [], props: [], served: 0, volume: 0,
    skipped: { noLine: 0, wanders: 0, stub: 0, blocked: 0,
               degenerate: 0, buried: 0, weld: 0, sliver: 0, bore: 0 },
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
 * @returns {{triangles, props, skipped, served, sagRisk}}
 */
export function buildProps(topo, result, rot, opts = {}) {
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
  let sagRisk = false;   // the user chose sub-cap spacing AND a real row landed wide
  const zBed = 0;
  const off = result.offset;
  const withTines = opts.tines === true;
  let tineTotal = 0;

  const out = [];
  const props = [];
  // Per-fin identity, assigned in build order. The id is only used to map a
  // raycast hit back to its fin WITHIN one build (the UI tracks removals across
  // rebuilds by a spatial signature, not this id). Sequential keeps it stable
  // within a generation.
  let nextId = 0;
  const skipped = { noLine: 0, wanders: 0, stub: 0, blocked: 0,
                    degenerate: 0, buried: 0, weld: 0, sliver: 0, bore: 0 };
  const v = [0, 0, 0];

  // The whole part, seated once, for the part-attached floor probe: the floor a
  // support lands on is usually a DIFFERENT region than the overhang, so it must
  // raycast the full mesh. Cheap next to the per-region work below.
  const partTris = new Float64Array(pos.length);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity,
      minZ = Infinity, maxZ = -Infinity;
  for (let f = 0; f < topo.nFaces; f++) {
    for (let i = 0; i < 3; i++) {
      seat(pos, f * 9 + i * 3, rot, off, v);
      partTris[f * 9 + i * 3] = v[0];
      partTris[f * 9 + i * 3 + 1] = v[1];
      partTris[f * 9 + i * 3 + 2] = v[2];
      if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
      if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
      if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
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

  // The support unit is the locally-straight sub-patch, not the connected
  // region -- see splitRegion. Fragments too small to be worth a wall are
  // counted, not silently dropped: absence of output recorded as success is
  // exactly how M5's scoreboard lied.
  const patches = [];
  for (let ri = 0; ri < result.regions.length; ri++) {
    const rFaces = result.regions[ri].faces;
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

    // Curved region whose lowest line is straight = a tube: ONE wall under
    // that line, the way breakaway.py props the shelter hubs. Only when the
    // region is flat, or its lowest points form a ring, does it go to
    // splitRegion for rows of tracks. See tubeLine.
    const tube = tubeLine(topo, rFaces, rot, regionPts, regionTris, step);
    if (tube && tube.length) {
      patches.push({ faces: rFaces, area: regionArea, region: ri,
                     tris: regionTris, lines: tube });
      continue;
    }

    for (const p of splitRegion(topo, rFaces, rot)) {
      if (p.area < MIN_REGION_AREA) { skipped.sliver++; continue; }
      p.region = ri;
      p.tris = regionTris;
      patches.push(p);
    }
  }
  const servedRegions = new Set();

  for (const patch of patches) {
    const regionTris = patch.tris;
    let lines;
    if (patch.lines) {
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
      lines = patchTracks(pts, patchTris, step, { topo, rot, offset: off }, rowSpan);
      // The user chose sub-cap spacing (wantSparse) AND this face actually landed a
      // multi-row gap wider than the cap. Flag it so the UI can warn (never blocks;
      // Matthew's call). Single-row faces (spacing 0) can't sag, so they don't warn.
      if (wantSparse && lines.length && lines.spacing > PROP.maxUnsupportedSpan) sagRisk = true;
    }
    if (!lines.length) { skipped.noLine++; continue; }

    for (const line of lines) {
      // PART-ATTACHED first: if solid part sits below this overhang, a support
      // must stand on THAT floor, not stilt to the plate through the part (the
      // bug Matthew hit on a real hub). buildPartAttached declines on an ordinary
      // bed overhang (floorLine ~0), so the plate path below is reached unchanged
      // for the flagship parts. When there IS a floor but no safe wall fits (a
      // bore, or side walls in the way) it says `floored` -- counted and skipped,
      // never stilted through the part or scarred into a bore. Works on a COPY so
      // the plate path's own `line` is untouched.
      const tri0 = out.length;
      const pa = buildPartAttached(line, partTris, topo, rot, off, out);
      if (pa.ok) {
        servedRegions.add(patch.region);
        // pa.prop.line already carries the wall top (surface minus gap); add the
        // gap back so emitTines reads it as the surface, like the plate path does.
        if (withTines) {
          const topLine = pa.prop.line.map((p) => [p[0], p[1], p[2] + PROP.gap]);
          tineTotal += emitTines(topLine, partTris, topo, rot, off, out, tineStepEff, undefined, tineHeight);
        }
        // buildPartAttached pushed the wall starting at tri0; emitTines above pushed
        // its tines right after, so wall + tines are contiguous -> one segment.
        props.push({ ...pa.prop, area: patch.area,
                     trimmed: line.length - pa.prop.stations,
                     id: nextId++, kind: 'prop',
                     triRanges: [[tri0, out.length]] });
        continue;
      }
      if (pa.floored) { skipped.bore++; continue; }

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
          const t0 = out.length;
          if (withTines) tineTotal += emitTines(
            sq.line.map((p) => [p[0], p[1], p[2] + PROP.gap]),
            regionTris, topo, rot, off, out, tineStepEff, PROP.squatBrimH, tineHeight);
          servedRegions.add(patch.region);
          // buildSquatBed pushed this wall (sq.triRange) BEFORE every squat wall's
          // tines, so a fin's wall and its tines are NON-contiguous in `out` --
          // track both segments so removing the fin takes wall AND tines together.
          const segs = [sq.triRange];
          if (out.length > t0) segs.push([t0, out.length]);
          props.push({ ...sq, area: patch.area, id: nextId++, kind: 'prop', triRanges: segs });
        }
      };

      // A track is straight in XY by construction, so this gate is a tripwire
      // rather than the bowl-refusal it was for bucketed polylines -- bowls are
      // now refused by their holes (see patchTracks). Keep it: anything that
      // trips it means the frame fit itself went wrong.
      if (straightness(line) > PROP.maxWander) { skipped.wanders++; runSquat(); continue; }

      // Trim to the longest run that can actually carry a wall, rather than
      // discarding the track over a local problem. See `longestRun`.
      const clear = line.map((p, k) =>
        p[2] - PROP.gap >= PROP.minHeightSquat && stationIsClear(line, k, topo, rot, off));
      const usable = withLowTails(
        line.map((p, k) => clear[k] && p[2] - PROP.gap >= PROP.minHeight), clear);
      const run = longestRun(usable);
      if (!run || run[1] - run[0] < PROP.minStations) { skipped.blocked++; runSquat(); continue; }
      const sub = line.slice(run[0], run[1]);

      const body = bodyMask(sub);               // before settleTop -- see bodyMask
      if (tallSpan(sub, body) < PROP.minSpan) { skipped.stub++; runSquat(); continue; }

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
        if (tallSpan(settled, settledBody) < PROP.minSpan) { reason = 'stub'; break; }

        const before = out.length;
        if (!sweep(settled, zBed, out, PROP.minHeightSquat)) {
          out.length = before;
          reason = 'degenerate';
          break;
        }

        // 0.25 reach: the tightest threshold below is 0.205, and every extra
        // tenth of reach widens the broad phase for nothing
        const hit = solidClearance(topo, rot, off, out.slice(before), 0.25);
        // Same acceptance as stationCertified: an approach from above is the
        // breakaway interface, anything else is a flank. Interpenetration
        // measures 0 and fails the flank test, which is what retires the old
        // vertex-containment `buried` check -- crossing surfaces have
        // distance 0 long before any vertex is inside.
        if (hit && (hit.cosUp > 0.7 ? hit.d < PROP.gap - 0.065 : hit.d < 0.205)) {
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
        servedRegions.add(patch.region);
        // The grip comb: nubs along this wall's settled top that bite into the
        // part. `settled` carries the surface z; emitTines subtracts the gap.
        if (withTines) tineTotal += emitTines(settled, regionTris, topo, rot, off, out, tineStepEff, undefined, tineHeight,
                                              tallBody(settledBody));
        props.push({
          span: span2, height: top - zBed, area: patch.area,
          stations: settled.length, trimmed: line.length - settled.length,
          volume: Math.abs(vol),
          // the centreline, so a coverage check can ask what this wall reaches
          line: settled.map((p) => [p[0], p[1], p[2] - PROP.gap]),
          id: nextId++, kind: 'prop',
          // `before` (captured at the start of THIS try, line ~2129) marks where
          // this wall's triangles begin in `out`; failed weld retries roll back to
          // it, so on the successful try it points at this wall. emitTines just
          // pushed its tines right after, so wall + tines are one contiguous segment.
          triRanges: [[before, out.length]],
        });
        for (let k = run[0] + run2[0]; k < run[0] + run2[1]; k++) claimed[k] = true;
        placed = true;
      }
      if (!placed && reason) skipped[reason]++;
      runSquat();
    }
  }

  // `served` counts REGIONS with at least one wall, because a region can now
  // yield several -- subtracting a prop count from a region count would say a
  // part with one region and three walls had "-2 unserved".
  return { triangles: out, props, skipped, served: servedRegions.size,
           servedRegions: [...servedRegions],
           tines: tineTotal, sagRisk,
           volume: props.reduce((s, q) => s + q.volume, 0) };
}
