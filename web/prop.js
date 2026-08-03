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
import { insidePart, nearestPart, solidClearance } from './inside.js';
import { faceAdjacency } from './planes.js';
import { MIN_REGION_AREA } from './overhangs.js';

export const PROP = {
  th: 1.0,          // wall thickness. 1.0 (two 0.5mm passes) not breakaway.py's
                    // 1.2: a prop is a free-standing wall with nothing bracing
                    // its sides, so it cannot go as thin as a Slant3D fin (whose
                    // tines grip the part), but 1.2 read as chunky. Contact tip
                    // stays 0.6 (Slant3D's tine width) and the base flange 1mm.
  gap: 0.2,         // breakaway clearance below the part
  tip: 0.6,         // width of the contact tip
  baseH: 1.0,       // height of the flat base flange (Slant3D's ~1mm disc). The
                    // foot used to be a CONE that ramped up over `chamfer` mm,
                    // which reads in a slicer as a golf tee, not the upside-down
                    // T a breakaway support should be. Now the base is a thin
                    // flat slab, emitted as its own solid and unioned by the
                    // slicer, with the wall standing straight up off it.
  tipH: 1.5,        // height the tip taper runs
  // Foot half-width. Kept well under maxUnsupportedSpan/2 on purpose: props are
  // laid in ROWS spaced maxUnsupportedSpan apart, so a foot wider than half that
  // spacing overlaps its neighbour and the row's feet fuse into one slab -- the
  // "thick overlapping feet, not thin fins" the flagship showed. breakaway.py's
  // own 7.0 never hit this because a human places ONE wall per feature, never a
  // packed row. A long wall also gets ample bed grip from its LENGTH, so the foot
  // is only an anti-wobble brace, not the adhesion; 3.0 braces a tall thin wall
  // fine and leaves a clean ~6mm gap between neighbours at the 12mm span.
  footMax: 3.0,     // widest the foot ever gets (< maxUnsupportedSpan/2)
  footMin: 1.6,
  footRatio: 0.12,  // foot half-width as a fraction of wall height
  minSpan: 7.0,     // a wall shorter than this is not worth the plate space
  minHeight: 1.5,   // nor is one this short
  // mm between cross-sections; a LENGTH, not a count -- see `straightness`.
  // 1.0 rather than 2.0 deliberately, and the trade is measured: at 2.0 the
  // matrix is 8 clean / 2 walls that would weld / 18% coverage, at 1.0 it is
  // 9 clean / ZERO bad walls / 13%. Denser stations both contour the top more
  // finely and probe the flanks more often, and the coverage it costs is lost
  // to the straightness gate rejecting curved regions -- which is M6b's problem
  // to solve by splitting them, not this one's to solve by shipping a support
  // that fuses. "No prop is a fixable disappointment, a fused prop is a ruined
  // print" is already this module's rule; this is that rule priced.
  stationStep: 1.0,
  minStations: 3,   // a run shorter than this is not a wall
  clearProbes: 12,  // points checked down the wall for a clear path to the plate
  // mm the part must stay off the wall's FLANKS. Larger than `gap` on purpose:
  // the top is meant to come within 0.2mm and be bridged over, the flanks are
  // meant never to touch, and a slicer's own XY support distance is ~0.35 on a
  // 0.4 nozzle for the same reason. Set to 0.15 first, which put the closest
  // approach on the flank instead of the top on 4 of 6 walls.
  sideClear: 0.35,
  maxWander: 0.10,  // RMS deviation / chord: above this there is no line to sweep
  // Below this footprint anisotropy (lam1/lam2) the overhang is too round for its
  // PCA principal axis to mean anything -- the top eigenvector is then covariance
  // noise and the tracks run at an arbitrary diagonal (a jittered flat square,
  // ratio 1.00, laid them at 84deg). A real frame patch reads well above this and
  // keeps PCA; 1.6 sits in the gap. See patchTracks.
  isoRatio: 1.6,
  // For a round patch WITH slope, walls follow the level contour; flatter than
  // this (rise/run) there is no contour to follow, so they snap to a world axis.
  contourSlopeMin: 0.15,
  // how far a face's normal may swing from its sub-patch SEED's before the
  // region is split there -- see splitRegion
  splitAgreeDeg: 15,
  // A region is CURVED (one wall under its lowest line, the tube case) when
  // at least tubeCurvedFrac of its AREA has a normal more than tubeSpreadDeg
  // from the area-weighted mean; otherwise it is a plane (rows of walls).
  // The fraction matters, not the worst face -- a worst-face test routed the
  // drive frame's 3,276 mm2 tilted plane to a single wall because its pocket
  // rims fan to 66-75deg, and the flagship regressed from 9 walls / 86%
  // coverage to 1 / 34%. Measured populations, area beyond 25deg: planes with
  // pockets 4-29%, true curved bands 51-83%. 0.4 sits in the gap.
  tubeSpreadDeg: 25,
  tubeCurvedFrac: 0.4,
  // A region must be at least this big for the tube route. Small curved
  // POCKETS pass the fraction test too (filter_housing carries 15-230 mm2
  // pockets at 25-75% deviant area), but a straight chord track under a
  // pocket that curves in PLAN drifts off the surface -- one such wall
  // measured 0.297 against the 0.2 spec, a wall the part never lands on.
  // The patch path serves them correctly and always did. Real tube bands
  // measure 1,000+ mm2; 300 sits in the gap.
  tubeMinArea: 300,
  // mm an overhang may bridge unsupported: the wall-to-wall spacing across a
  // wide patch, and the ONE dial M7b puts in front of the user. check_stl.py
  // reads this value out of this file (MAX_UNSUPPORTED_SPAN) so the checker and
  // the generator cannot disagree about it.
  maxUnsupportedSpan: 12.0,
};

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
export function patchTracks(pts, patchTris, step = PROP.stationStep) {
  if (!pts.length) return [];

  // Run direction for the parallel tracks. Default: the footprint's principal
  // HORIZONTAL axis, via the 2x2 XY covariance -- on a frame whose underside
  // slopes along its length that axis IS the slope, and the wall's top climbs it.
  // BUT the principal axis is only meaningful when the footprint is elongated. On
  // a square or otherwise round patch the covariance is isotropic, so the top
  // eigenvector is pure noise and the tracks run at an arbitrary diagonal (a
  // jittered flat square, aniso 1.00, laid them at 84deg). There the axis is
  // abandoned for the underside's own geometry -- see the isotropic branch.
  let cx = 0, cy = 0, cz = 0;
  for (const p of pts) { cx += p[0]; cy += p[1]; cz += p[2]; }
  cx /= pts.length; cy /= pts.length; cz /= pts.length;
  let sxx = 0, sxy = 0, syy = 0, sxz = 0, syz = 0;
  for (const p of pts) {
    const dx = p[0] - cx, dy = p[1] - cy, dz = p[2] - cz;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
    sxz += dx * dz; syz += dy * dz;
  }
  const tr = sxx + syy, det = sxx * syy - sxy * sxy;
  const rad = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const lam1 = tr / 2 + rad, lam2 = tr / 2 - rad;
  const aniso = lam2 > 1e-9 ? lam1 / lam2 : Infinity;
  // underside plane z = a x + b y + c: gradient (a,b) = steepest descent, from
  // the same centred sums (the covariance IS the normal-equation matrix)
  const gx = det > 1e-9 ? (syy * sxz - sxy * syz) / det : 0;
  const gy = det > 1e-9 ? (sxx * syz - sxy * sxz) / det : 0;
  const slope = Math.hypot(gx, gy);

  let ux, uy;
  if (aniso >= PROP.isoRatio) {
    // clearly elongated: the principal axis is real. UNCHANGED behaviour, so the
    // flagship frame's along-the-slope walls are untouched.
    ux = sxy; uy = lam1 - sxx;
    if (Math.hypot(ux, uy) < 1e-9) { ux = 1; uy = 0; }
  } else if (slope >= PROP.contourSlopeMin) {
    // round but sloped: run each wall along the level contour (perpendicular to
    // the gradient) so it is a uniform height, with rows marching up the slope.
    ux = -gy; uy = gx;
  } else {
    // flat round ledge: no contour to follow. Snap to the longer world axis --
    // axis-aligned, the way a human draws a fin on a square face, never a diagonal.
    let xLo = Infinity, xHi = -Infinity, yLo = Infinity, yHi = -Infinity;
    for (const p of pts) {
      if (p[0] < xLo) xLo = p[0]; if (p[0] > xHi) xHi = p[0];
      if (p[1] < yLo) yLo = p[1]; if (p[1] > yHi) yHi = p[1];
    }
    if (xHi - xLo >= yHi - yLo) { ux = 1; uy = 0; } else { ux = 0; uy = 1; }
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
  const nWalls = Math.max(1, Math.round(vExt / PROP.maxUnsupportedSpan));

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
  return tracks.filter((t) => t.length >= PROP.minStations);
}

/**
 * How far the contact polyline strays from the straight line through it: RMS
 * perpendicular deviation from the best-fit axis, over the chord it spans.
 * 0 is a perfectly straight run; a ring reads ~0.2.
 *
 * THIS IS A PRECONDITION, NOT A QUALITY SCORE. `breakaway.py` says so in its own
 * docstring -- "the contact line is assumed ~straight (a linear overhang)" --
 * and the port inherited the sweep without inheriting the assumption. When the
 * overhang is a BOWL rather than a ledge (the underside of a ball hub, a cone, a
 * sphere) its lowest points form a ring, not a line. `contactLine` then fits a
 * principal axis to an isotropic point set, which is noise, and buckets along
 * it -- so the "line" alternates between the two sides of the ring and the swept
 * wall saws through the part.
 *
 * WHY NOT ARC LENGTH / CHORD, which is what this used to be. Arc length grows
 * without bound as you sample a curve more finely; the chord does not. So
 * "tortuosity" measured the SAMPLING, not the shape, and the 2.0 gate flipped on
 * a perfectly good region as soon as anyone densified the stations. Measured on
 * voron_drive_frame at 40 degrees, one region, varying only the station count:
 *
 *   stations      8      14     24     48     96
 *   arc/chord     1.14   1.44   1.59   2.08   3.16   <- crosses the gate
 *   THIS          0.081  0.069  0.062  0.065  0.065  <- flat
 *
 * That is why fixing this had to come BEFORE `stationStep`: densifying first
 * regressed the drive frame from one good wall to none.
 *
 * The 0.10 threshold sits in the measured gap between the two populations:
 * servable ledges land at 0.06-0.08, and hub_post_foot's ball-hub bowl -- the
 * case the gate exists for -- at 0.15-0.21. Note that a LOW score is not a
 * promise of a good wall: it is only the precondition for a swept wall meaning
 * anything at all.
 */
export function straightness(line) {
  const n = line.length;
  if (n < 3) return Infinity;

  let cx = 0, cy = 0;
  for (const p of line) { cx += p[0]; cy += p[1]; }
  cx /= n; cy /= n;

  let sxx = 0, sxy = 0, syy = 0;
  for (const p of line) {
    const dx = p[0] - cx, dy = p[1] - cy;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  const tr = sxx + syy, det = sxx * syy - sxy * sxy;
  const lam = tr / 2 + Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  let ax = sxy, ay = lam - sxx;
  if (Math.hypot(ax, ay) < 1e-9) { ax = 1; ay = 0; }
  const an = Math.hypot(ax, ay); ax /= an; ay /= an;

  let ss = 0, lo = Infinity, hi = -Infinity;
  for (const p of line) {
    const dx = p[0] - cx, dy = p[1] - cy;
    const t = dx * ax + dy * ay;
    const perp = -dx * ay + dy * ax;
    ss += perp * perp;
    if (t < lo) lo = t;
    if (t > hi) hi = t;
  }
  const chord = hi - lo;
  return chord < 1e-9 ? Infinity : Math.sqrt(ss / n) / chord;
}

/**
 * Foot half-width for a wall of height `h`.
 *
 * The spike used a fixed 7mm foot, which assumes the overhang sits well above
 * the plate. Real parts' overhangs are low -- median wall height 2.5mm -- so 22
 * of 36 walls degenerated into 14mm-wide splayed sheets. The foot has to scale
 * with how tall the wall actually is: `footRatio * h`, floored and capped.
 *
 * The cap is the load-bearing part. A row of walls is spaced maxUnsupportedSpan
 * apart, so the foot MUST stay under half that spacing or adjacent feet overlap
 * and the whole row merges into a solid buttress (the flagship's "thick feet",
 * measured 2026-07-30: 65mm-tall walls maxed the old 7mm foot -> 14mm feet on a
 * 12mm pitch). `footMax` is set below that line, and this clamp enforces it even
 * if the span is later dialled down -- leave ~1mm of air between neighbours.
 */
export const footFor = (h) => {
  const spanCap = Math.max(PROP.footMin, (PROP.maxUnsupportedSpan - 1) / 2);
  return Math.max(PROP.footMin,
                  Math.min(PROP.footMax, spanCap, h * PROP.footRatio));
};

/**
 * Half-width of the ⊥ cross-section at height `z` above the bed, for a wall
 * whose contact tips out at `top`: a flat base flange (the foot of the T), a
 * straight thin wall, then the breakaway tip taper. ONE definition, shared by
 * the geometry in sweep() and the two measurement passes -- they used to carry
 * three separate copies of a cone formula, which is exactly how a shape change
 * silently disagrees with the checker that is supposed to catch it.
 */
export function profileHalf(z, top) {
  const ztip = Math.max(top - PROP.tipH, PROP.baseH + 0.1);
  if (z < PROP.baseH) return footFor(top);      // flat flange (the T's foot)
  if (z < ztip) return PROP.th / 2;             // straight wall (the T's stem)
  return PROP.th / 2                            // neck into the contact tip
       - ((PROP.th - PROP.tip) / 2) * ((z - ztip) / Math.max(1e-6, top - ztip));
}

/** Rotate + seat one raw vertex into print space. */
function seat(pos, i, rot, off, out) {
  const x = pos[i], y = pos[i + 1], z = pos[i + 2];
  out[0] = rot[0] * x + rot[3] * y + rot[6] * z + off.x;
  out[1] = rot[1] * x + rot[4] * y + rot[7] * z + off.y;
  out[2] = rot[2] * x + rot[5] * y + rot[8] * z + off.z;
  return out;
}

/**
 * The lowest surface height of the region directly above (x, y), or null if the
 * region does not cover that point.
 *
 * This is what the wall's top has to clear, and it has to be asked about the
 * wall's OWN path. Taking the lowest point in a cross-slice of the region
 * instead -- which is what bucketing does -- answers about somewhere off to the
 * side, and produced walls sitting 13mm below the surface they were meant to
 * touch.
 *
 * CAUTION on that 13mm: the roadmap carried an OUTSTANDING "one wall still sits
 * 13mm under its region" bug attributed to this function, and it was not real.
 * `hub_corner.stl` is a two-body mesh and `check_stl.py` measured the prop
 * against the larger body only. Re-measured against the body it actually serves,
 * that wall is 0.2mm under it. Don't re-fix this on the strength of that number.
 */
export function surfaceZAt(tris, x, y) {
  let best = Infinity;
  for (let i = 0; i < tris.length; i += 9) {
    const ax = tris[i], ay = tris[i + 1], az = tris[i + 2];
    const bx = tris[i + 3], by = tris[i + 4], bz = tris[i + 5];
    const cx = tris[i + 6], cy = tris[i + 7], cz = tris[i + 8];
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(den) < 1e-12) continue;
    const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / den;
    const l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / den;
    const l3 = 1 - l1 - l2;
    if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
    const z = l1 * az + l2 * bz + l3 * cz;
    if (z < best) best = z;
  }
  return best === Infinity ? null : best;
}

/**
 * The lowest-surface polyline under a region: principal horizontal axis, then
 * the minimum-z sample in each bucket along it.
 *
 * It must follow the part's true UNDERSIDE, not its centreline. For a tilted
 * round tube the lowest point is offset sideways from, and higher than,
 * `centreline - R`; propping the centreline mis-places the wall and can drop it
 * straight into whatever the tube emerges from. `breakaway.py` learned this the
 * same way and says so in its docstring.
 */
export function contactLine(pts, tris, nSamples) {
  if (pts.length < 3) return null;

  let cx = 0, cy = 0;
  for (const p of pts) { cx += p[0]; cy += p[1]; }
  cx /= pts.length; cy /= pts.length;

  // principal horizontal direction, via the 2x2 covariance of the XY spread
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of pts) {
    const dx = p[0] - cx, dy = p[1] - cy;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  const tr = sxx + syy, det = sxx * syy - sxy * sxy;
  const lam = tr / 2 + Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  let ax = sxy, ay = lam - sxx;
  if (Math.hypot(ax, ay) < 1e-9) { ax = 1; ay = 0; }
  const an = Math.hypot(ax, ay); ax /= an; ay /= an;

  let lo = Infinity, hi = -Infinity;
  for (const p of pts) {
    const t = (p[0] - cx) * ax + (p[1] - cy) * ay;
    if (t < lo) lo = t;
    if (t > hi) hi = t;
  }
  if (hi - lo < 1e-6) return null;

  const buckets = new Array(nSamples).fill(null);
  for (const p of pts) {
    const t = (p[0] - cx) * ax + (p[1] - cy) * ay;
    let k = Math.floor(((t - lo) / (hi - lo)) * nSamples);
    if (k >= nSamples) k = nSamples - 1;
    if (!buckets[k] || p[2] < buckets[k][2]) buckets[k] = p;
  }
  const line = buckets.filter(Boolean);
  if (line.length < 3) return null;

  // Re-fit each station's height to the surface directly above its OWN xy. The
  // bucket only chose where the wall should stand; the z it happened to carry
  // belongs to whichever point in that cross-slice was lowest, which is usually
  // somewhere else entirely.
  for (let i = 0; i < line.length; i++) {
    const zz = surfaceZAt(tris, line[i][0], line[i][1]);
    if (zz !== null) line[i] = [line[i][0], line[i][1], zz];
  }

  contourTop(line, tris);
  lowerSag(line, tris);
  return line;
}

/**
 * Lower the ends of any segment that would pass above the surface between them.
 * The wall's top runs STRAIGHT between stations while the underside curves, so a
 * midpoint can end up proud of the part -- measured at 0.005mm of clearance
 * where 0.2mm was intended, which welds. Checking the midpoints and pulling the
 * span down is what turns the gap into a floor.
 */
export function lowerSag(line, tris) {
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (let i = 0; i < line.length - 1; i++) {
      const mx = (line[i][0] + line[i + 1][0]) / 2;
      const my = (line[i][1] + line[i + 1][1]) / 2;
      const zz = surfaceZAt(tris, mx, my);
      if (zz === null) continue;
      const midWall = (line[i][2] + line[i + 1][2]) / 2;
      const over = midWall - zz;
      if (over > 1e-4) {
        line[i] = [line[i][0], line[i][1], line[i][2] - over];
        line[i + 1] = [line[i + 1][0], line[i + 1][1], line[i + 1][2] - over];
        moved = true;
      }
    }
    if (!moved) break;
  }
  return line;
}

/**
 * Lower each station until the wall's whole TOP FACE clears the part, not just
 * its centreline.
 *
 * The top is a `tip`-wide flat, and the gap used to be set at the centre of it.
 * On a sloped underside the up-slope corner therefore rises by
 * `half_tip x slope` INTO the gap -- and past a slope of `gap / half_tip`, which
 * is only `atan(0.2 / 0.3)` = 33.7 degrees from horizontal, straight into the
 * part. Most overhang surfaces are steeper than that.
 *
 * This was on record as an imprecision to tidy up later ("0.11-0.19mm where 0.2
 * was intended", one wall measuring 0.009mm, which is a weld). It is not a
 * precision problem, it is the main reason walls were being discarded outright:
 * `insidePart` sees the buried corner and `buildProps` throws the whole solid
 * away as `buried`. Measured across four failing cases, the buried vertices at
 * foot height numbered 0 of 5, 0 of 10, 0 of 23 and 0 of 29 -- every one of them
 * was at the wall's top.
 *
 * So evaluate the surface at BOTH TIP CORNERS as well as the centre, and take
 * the lowest. That makes `gap` a floor instead of an average.
 *
 * ACROSS the tip only, never ALONG the run. Sampling along the run as well was
 * tried and is wrong twice over: the top edge already interpolates linearly
 * between stations, and the sag that creates is already pulled down by the
 * midpoint pass in `contactLine`. Taking an along-run minimum on top of that
 * double-counts the slope -- measured, it opened gaps to 0.32-0.34mm on sloped
 * undersides and 2.4mm where the underside has a step, which is a wall the part
 * never lands on. The tip is 0.6mm wide; that is the only distance this pass is
 * responsible for.
 */
export function contourTop(line, tris) {
  const half = PROP.tip / 2;
  for (let i = 0; i < line.length; i++) {
    const a = line[Math.max(0, i - 1)];
    const b = line[Math.min(line.length - 1, i + 1)];
    const rx = b[0] - a[0], ry = b[1] - a[1];
    const rn = Math.hypot(rx, ry);
    if (rn < 1e-9) continue;
    const sx = ry / rn, sy = -rx / rn;     // across the wall

    let z = line[i][2];
    for (const o of [-half, half]) {
      const zz = surfaceZAt(tris, line[i][0] + sx * o, line[i][1] + sy * o);
      if (zz !== null && zz < z) z = zz;
    }
    line[i] = [line[i][0], line[i][1], z];
  }
  return line;
}

/**
 * Shift a finished contact line so its CLOSEST approach to the part is exactly
 * `gap` -- no more, no less.
 *
 * Everything upstream works on stations: `contactLine` picks their z from the
 * surface, `contourTop` lowers them for the tip's width, the midpoint pass pulls
 * down spans that sag. All of it is sampled AT stations, and the wall's top edge
 * is the straight line BETWEEN them. So the real minimum clearance lives
 * somewhere those samples never looked, and it came out at 0.10-0.19mm against a
 * 0.2 spec -- the family of "unexplained imprecision" the roadmap had been
 * carrying for two milestones.
 *
 * Chasing it with denser probes is the wrong shape of fix: the generator checks
 * with sampled points and the checker measures exact surface-to-surface
 * distance, so tightening the sampling narrows the disagreement without ever
 * closing it. Measure the built edge instead, then move it. Sampling every
 * 0.25mm along the top at both tip corners, the minimum is what the checker will
 * report, and shifting every station by `gap - min` puts it exactly on spec
 * while preserving the contour.
 *
 * This is the repo's "cheap search, exact confirmation" pattern with the last
 * step made corrective rather than merely fatal: the wall is not discarded for
 * being 0.07mm high, it is lowered 0.07mm.
 */
export function settleTop(line, tris, step = 0.25) {
  const half = PROP.tip / 2;

  // PER STATION, not one shift for the whole wall. A single global drop was
  // tried and it is too blunt: one low triangle anywhere under the run lowers
  // every station by that much, and the wall then stops 0.42-0.48mm under the
  // surface along its whole length -- too far for the part to land on, which the
  // checker reports as a gap that is too LARGE. Correcting each station against
  // the span it owns keeps the contour and confines a local dip to the place it
  // actually happens.
  //
  // Iterated, because lowering a station changes the interpolated top of both
  // segments touching it, and therefore what its neighbours measure.
  for (let pass = 0; pass < 3; pass++) {
    const drop = new Float64Array(line.length);
    let moved = false;

    for (let i = 0; i < line.length - 1; i++) {
      const p = line[i], q = line[i + 1];
      const dx = q[0] - p[0], dy = q[1] - p[1];
      const seg = Math.hypot(dx, dy);
      if (seg < 1e-9) continue;
      const sx = dy / seg, sy = -dx / seg;
      const n = Math.max(1, Math.ceil(seg / step));

      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const x = p[0] + dx * t, y = p[1] + dy * t;
        const topZ = (p[2] + (q[2] - p[2]) * t) - PROP.gap;
        for (const o of [-half, 0, half]) {
          const zz = surfaceZAt(tris, x + sx * o, y + sy * o);
          if (zz === null) continue;
          // LOWER ONLY, never raise. `surfaceZAt` sees this region's triangles
          // and nothing else, so a clearance LARGER than `gap` does not mean the
          // wall is too low -- usually the thing it is closest to belongs to
          // another part of the mesh, which this pass cannot see. Raising on
          // that evidence welds it to what it could not measure: tried, and it
          // took the matrix from 6 clean to 0, with gaps of 0.002-0.015mm.
          const need = PROP.gap - (zz - topZ);
          if (need <= 1e-4) continue;
          // charge the deficit to whichever end of the span owns this sample
          const j = t < 0.5 ? i : i + 1;
          if (need > drop[j]) { drop[j] = need; moved = true; }
        }
      }
    }

    if (!moved) break;
    for (let i = 0; i < line.length; i++) {
      if (drop[i] > 0) line[i] = [line[i][0], line[i][1], line[i][2] - drop[i]];
    }
  }
  return line;
}

/**
 * Can a wall under `line` actually reach the plate, or is the part in the way?
 *
 * The prop attaches to the BED and nothing else -- that is what makes it one
 * clean thing to remove rather than two welds to cut. An overhang tucked above
 * other geometry has no such path, and a wall driven down through the part is
 * worse than no wall at all. Sampled down the centreline of each station.
 */
export function stationIsClear(line, k, topo, rot, offset) {
  const p = line[k];
  const a = line[Math.max(0, k - 1)];
  const b = line[Math.min(line.length - 1, k + 1)];
  const rx = b[0] - a[0], ry = b[1] - a[1];
  const rn = Math.hypot(rx, ry);
  if (rn < 1e-9) return true;
  const sx = ry / rn, sy = -rx / rn;      // across the wall

  const top = p[2] - PROP.gap;

  // Probe the FULL height, and probe OUTSIDE the wall's own faces.
  //
  // Both halves of that were wrong and each cost a weld. The heights ran
  // `top * i / (clearProbes + 1)` for i = 1..6, so they stopped at 6/7 of the
  // way up and never looked at the top seventh of the wall -- which is where
  // both remaining welds were, at z = 47.5 and 45.3 on walls topping at 51.0
  // and 49.3. And the offsets were the wall's own half-width, which asks "is my
  // surface inside the part" rather than "is the part about to touch my
  // surface": a flank sitting 0.0002mm off the part is outside it, passes
  // containment, and fuses solid on the first layer.
  //
  // fins.js already learned this exact lesson -- "two fins came out 0.005mm from
  // a neighbouring feature: outside the part, so containment passed, and close
  // enough to weld" -- and grew `wallIsClear` for it. Prop never got the
  // equivalent, so it is here: probe at the wall's half-width PLUS a margin, and
  // if the part is inside THAT, the station cannot carry a wall.
  //
  // `clearProbes` is a FLOOR, not the count: a fixed 12 probes on a 70mm wall
  // is one per 6mm, scale-blind the same way `foot: 7.0` and `samples: 14`
  // were, and a rib arriving between two probes fused a wall on hub_corner.
  // Probe at least every 1.5mm of height. Offsets step through the clearance
  // corridor rather than testing only its far edge, because insidePart is a
  // parity test: a rib THINNER than the corridor can sit wholly between the
  // wall face and a single far-edge probe, containing neither. Stepping at
  // ~0.12mm resolves anything a nozzle can actually print.
  const nProbes = Math.max(PROP.clearProbes, Math.ceil(top / 1.5));
  for (let i = 1; i <= nProbes; i++) {
    const z = (top * i) / nProbes - 0.05;
    if (z <= 0) continue;
    const half = profileHalf(z, top);   // flange, wall, or tip taper at this z
    for (const m of [0.12, 0.24, PROP.sideClear]) {
      const w = half + m;
      if (insidePart(topo, rot, offset, p[0] + sx * w, p[1] + sy * w, z)) return false;
      if (insidePart(topo, rot, offset, p[0] - sx * w, p[1] - sy * w, z)) return false;
    }
    if (insidePart(topo, rot, offset, p[0], p[1], z)) return false;
  }
  return true;
}

/**
 * Certify a SETTLED station by measuring, the way the checker will.
 *
 * `settleTop` puts the top exactly on spec against the region's own triangles
 * -- but the geometry nearest a wall can be a different region, a face too
 * steep to be an overhang, or a surface arriving tangent to the wall's flank,
 * and against those nothing was ever measured: walls shipped with welds of
 * 0.016, 0.005 and 0.0005mm that three rounds of ever-denser parity probing
 * never saw (see nearestPart). So sample the station's cross-section outline
 * and measure the actual distance to the part, classifying each approach the
 * way check_stl.py does: toward a surface ABOVE, this is the breakaway
 * interface and ~gap is correct (the floor sits just under the checker's
 * gap - 0.06 acceptance so a legitimate 0.2 x cos(slope) approach on a steep
 * underside is not trimmed); sideways, it is a flank and must clear by more
 * than the checker's FLANK_MIN. A station that fails is trimmed by the same
 * longestRun machinery as every other local problem -- including an end
 * station whose cap would stop nearly touching whatever blocked the trim,
 * because the cap's outline IS this station's outline and the measurement has
 * no preferred direction.
 *
 * Runs AFTER settling: before it, a proud top that settling was about to fix
 * would read as a false hit.
 */
export function stationCertified(line, k, topo, rot, offset) {
  const p = line[k];
  const a = line[Math.max(0, k - 1)];
  const b = line[Math.min(line.length - 1, k + 1)];
  const rx = b[0] - a[0], ry = b[1] - a[1];
  const rn = Math.hypot(rx, ry);
  if (rn < 1e-9) return true;
  const sx = ry / rn, sy = -rx / rn;

  const top = p[2] - PROP.gap;

  // The cross-section outline: the top flat, then both flanks every 2mm down
  // the full height, at the profile's own half-width for that height. A first
  // version probed the flank at one mid-height point and the welds simply sat
  // between the probes (z=11.2 on a 38.6mm wall probed at 2.5 and 19.7). 2mm
  // spacing is enough BECAUSE this is a distance measure with a 0.45mm reach:
  // any surface tall enough to matter is seen by some probe, tangent or not --
  // the thing parity probing could not promise at any density.
  const probes = [[0, top], [PROP.tip / 2, top], [-PROP.tip / 2, top]];
  for (let z = 0.4; z < top - 0.05; z += 2.0) {
    const half = profileHalf(z, top);
    probes.push([half, z], [-half, z]);
  }
  for (const [o, z] of probes) {
    if (z <= 0.05) continue;
    const hit = nearestPart(topo, rot, offset, p[0] + sx * o, p[1] + sy * o, z);
    if (!hit) continue;
    if (hit.cosUp > 0.7) {
      if (hit.d < PROP.gap - 0.065) return false;   // breakaway would weld
    } else if (hit.d < 0.205) {
      return false;                                 // flank would weld
    }
  }
  return true;
}

/** True when EVERY station can reach the plate. */
export function pathToPlateIsClear(line, topo, rot, offset) {
  for (let k = 0; k < line.length; k++) {
    if (!stationIsClear(line, k, topo, rot, offset)) return false;
  }
  return true;
}

/**
 * The longest contiguous run of stations that can carry a wall, as [a, b).
 *
 * THIS IS THE `t0/t1` TRIM, and automating it is most of what was missing.
 * `breakaway_wall(bm, contact, t0, t1, ...)` takes the span as an argument and
 * tells the caller to "pick t0 so contact(t0) has already cleared any solid the
 * wall must NOT weld to" -- a human eyeballing the part. The port inherited the
 * sweep and not the trim, so a single bad station discarded the whole region:
 * `sweep()` returned false the moment any station was too short.
 *
 * That single line is what lost the flagship part. voron_drive_frame at 25 and
 * 40 degrees has an otherwise perfect contact line -- 92-100mm of span, zero
 * blocked stations -- but its first station or two sit where the underside meets
 * the plate, at a height of -0.2mm. The region was reported `degenerate` and
 * nothing was built. Trimmed instead, the same line gives a 44.1 x 96.1mm wall
 * at 25 degrees and 66.6 x 78.4mm at 40.
 */
export function longestRun(usable) {
  let best = null, start = -1;
  for (let i = 0; i <= usable.length; i++) {
    if (i < usable.length && usable[i]) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      if (!best || i - start > best[1] - best[0]) best = [start, i];
      start = -1;
    }
  }
  return best;
}

/**
 * Bridge a run of cross-sections into one closed solid and push its triangles.
 * Each section is a ring of `k` vertices in the same order; consecutive rings
 * are joined with quads and the two ends are fan-capped. Caps assume the
 * section is convex, which both sections below are (a rectangle, and a
 * rectangle with a tapered top).
 *
 * Wound OUTWARD. Inherited from M3, where this emitted every triangle backwards:
 * the shell was closed and consistent -- euler 2, no boundary edges -- but its
 * volume came out NEGATIVE, so every normal faced into the solid. M3's own check
 * only asked whether the mesh was watertight, which it was, so this survived
 * being called validated. A slicer would read it as a hole rather than a wall.
 */
function ribbon(secs, out) {
  const k = secs[0].length;
  const tri = (a, b, c) => out.push(a, c, b);
  for (let i = 0; i < secs.length - 1; i++) {
    for (let j = 0; j < k; j++) {
      const j2 = (j + 1) % k;
      tri(secs[i][j], secs[i][j2], secs[i + 1][j2]);
      tri(secs[i][j], secs[i + 1][j2], secs[i + 1][j]);
    }
  }
  for (let j = 1; j < k - 1; j++) {                        // end caps
    tri(secs[0][0], secs[0][j + 1], secs[0][j]);
    const e = secs[secs.length - 1];
    tri(e[0], e[j], e[j + 1]);
  }
}

/**
 * Sweep the prop along `line`, emitting an upside-down T: a straight thin wall
 * standing on a flat base flange. They are TWO overlapping closed solids, not
 * one -- the slicer unions them, the same overlap approach the rest of the repo
 * uses -- which keeps each section convex and sidesteps capping a T's concave
 * outline. Replaces the single cone-footed solid that read as a golf tee.
 */
export function sweep(line, zBed, out) {
  const wall = [], flange = [];
  for (let i = 0; i < line.length; i++) {
    const p = line[i];
    const a = line[Math.max(0, i - 1)];
    const b = line[Math.min(line.length - 1, i + 1)];
    let rx = b[0] - a[0], ry = b[1] - a[1];
    const rn = Math.hypot(rx, ry);
    if (rn < 1e-9) return false;
    rx /= rn; ry /= rn;
    const sx = ry, sy = -rx;              // horizontal, across the wall

    const top = p[2] - PROP.gap;
    const h = top - zBed;
    if (h < PROP.minHeight) return false;
    const foot = footFor(h);
    const ztip = Math.max(top - PROP.tipH, zBed + PROP.baseH + 0.1);
    const baseTop = zBed + PROP.baseH;
    const P = (o, z) => [p[0] + sx * o, p[1] + sy * o, z];

    // the stem: a straight thin wall from the bed up to the breakaway tip
    wall.push([
      P(+PROP.th / 2, zBed), P(+PROP.th / 2, ztip), P(+PROP.tip / 2, top),
      P(-PROP.tip / 2, top), P(-PROP.th / 2, ztip), P(-PROP.th / 2, zBed),
    ]);
    // the foot: a flat slab, its own closed solid overlapping the wall's base
    flange.push([
      P(+foot, zBed), P(+foot, baseTop), P(-foot, baseTop), P(-foot, zBed),
    ]);
  }

  ribbon(wall, out);
  ribbon(flange, out);
  return true;
}

/**
 * What buildProps returns when it builds nothing -- kept here so the callers
 * that refuse to build (a part seated on a point) return the same shape.
 */
export function noProps() {
  return {
    triangles: [], props: [], served: 0, volume: 0,
    skipped: { noLine: 0, wanders: 0, stub: 0, blocked: 0,
               degenerate: 0, buried: 0, weld: 0, sliver: 0 },
  };
}

/**
 * Build a breakaway prop under every overhang region that can take one.
 *
 * @returns {{triangles, props, skipped, served}}
 */
export function buildProps(topo, result, rot, opts = {}) {
  const { pos } = topo;
  const step = opts.step ?? PROP.stationStep;
  const zBed = 0;
  const off = result.offset;

  const out = [];
  const props = [];
  const skipped = { noLine: 0, wanders: 0, stub: 0, blocked: 0,
                    degenerate: 0, buried: 0, weld: 0, sliver: 0 };
  const v = [0, 0, 0];

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
      lines = patchTracks(pts, patchTris, step);
    }
    if (!lines.length) { skipped.noLine++; continue; }

    for (const line of lines) {
      // Finish the top against the WHOLE region, not just this patch: a track
      // near a patch boundary can run under a sibling patch's faces, and
      // clearance measured against patch-only triangles welded walls to
      // geometry they could not see (gap 0.003mm, flank 0.011mm, hub_corner).
      contourTop(line, regionTris);
      lowerSag(line, regionTris);

      // A track is straight in XY by construction, so this gate is a tripwire
      // rather than the bowl-refusal it was for bucketed polylines -- bowls are
      // now refused by their holes (see patchTracks). Keep it: anything that
      // trips it means the frame fit itself went wrong.
      if (straightness(line) > PROP.maxWander) { skipped.wanders++; continue; }

      // Trim to the longest run that can actually carry a wall, rather than
      // discarding the track over a local problem. See `longestRun`.
      const usable = line.map((p, k) =>
        p[2] - PROP.gap >= PROP.minHeight && stationIsClear(line, k, topo, rot, off));
      const run = longestRun(usable);
      if (!run || run[1] - run[0] < PROP.minStations) { skipped.blocked++; continue; }
      const sub = line.slice(run[0], run[1]);

      const span = Math.hypot(sub[sub.length - 1][0] - sub[0][0],
                              sub[sub.length - 1][1] - sub[0][1]);
      if (span < PROP.minSpan) { skipped.stub++; continue; }

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
      const avail = sub.map((p, k) =>
        p[2] - PROP.gap >= PROP.minHeight && stationCertified(sub, k, topo, rot, off));

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
        const run2 = longestRun(avail);
        if (!run2 || run2[1] - run2[0] < PROP.minStations) { reason = 'blocked'; break; }
        const settled = sub.slice(run2[0], run2[1]);
        const span2 = Math.hypot(settled[settled.length - 1][0] - settled[0][0],
                                 settled[settled.length - 1][1] - settled[0][1]);
        if (span2 < PROP.minSpan) { reason = 'stub'; break; }

        const before = out.length;
        if (!sweep(settled, zBed, out)) {
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
          avail[Math.max(0, at - 1)] = false;
          avail[at] = false;
          avail[Math.min(avail.length - 1, at + 1)] = false;
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
        props.push({
          span: span2, height: top - zBed, area: patch.area,
          stations: settled.length, trimmed: line.length - settled.length,
          volume: Math.abs(vol),
          // the centreline, so a coverage check can ask what this wall reaches
          line: settled.map((p) => [p[0], p[1], p[2] - PROP.gap]),
        });
        placed = true;
      }
      if (!placed && reason) skipped[reason]++;
    }
  }

  // `served` counts REGIONS with at least one wall, because a region can now
  // yield several -- subtracting a prop count from a region count would say a
  // part with one region and three walls had "-2 unserved".
  return { triangles: out, props, skipped, served: servedRegions.size,
           volume: props.reduce((s, q) => s + q.volume, 0) };
}
