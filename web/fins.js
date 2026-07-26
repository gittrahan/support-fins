/**
 * Fin generation -- M4. The fin stands BESIDE the part on a flat upright face,
 * held off by a standoff, and horizontal tines fuse across that gap into the
 * part. See planes.js for why M3's sweep-under-the-overhang geometry had to be
 * abandoned, and docs/FIN-SPEC.md for where every number below comes from.
 *
 * A fin is three kinds of solid that overlap and get unioned by the slicer -- no
 * boolean kernel anywhere, the same approach the rest of the project uses:
 *   1. the WALL, a thin round-topped blade standing off the part face;
 *   2. the BASE, a wide flat ellipse that keeps the wall stuck to the plate;
 *   3. the TINES, tiny horizontal nubs bridging the standoff into the part.
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
 * Everything about the wall is built in the patch's frame (planes.js), so a fin
 * serving a leaning face leans with it. The tines are the exception: they are
 * built in world axes, because a tine must occupy ONE layer, and a box that is
 * flat in a leaning frame is not flat in z.
 */
import { findWallPatches, patchProbe, patchPoint, tAtZ, zAt } from './planes.js';
import { BED_EPS } from './overhangs.js';
import { insidePart } from './inside.js';
import { buildProps } from './prop.js';

export const FIN = {
  // --- from docs/FIN-SPEC.md, stated on camera. Do not "tune" these. ---
  gap: 0.2,           // standoff from the part face
  tineH: 0.3,         // one layer line; smaller bead = smaller divot
  tineW: 0.5,         // between one nozzle pass (0.4) and out-and-back (0.8)
  baseH: 1.0,         // base disc thickness
  rowsLow: 8,         // tine rows in the dense zone -- "7 or 8 low down"

  // --- ours, derived or measured ---
  th: 1.2,            // wall thickness
  tineBite: 0.3,      // how far a tine sinks into the part
  tineGrip: 0.4,      // how far a tine reaches back into the wall
  tineSpanMax: 1.5,   // mm of UNSUPPORTED tine; past this it is a bridge, not a
                      // tine (measured in prototype/probe_tines2.py)
  tineSpacingU: 14,   // mm between tines along the wall
  rowGapMin: 0.8,     // mm; below this the rows stop being separate beads
  denseZone: 6,       // mm of height that gets the dense tine rows
  rowGrowth: 1.6,     // row spacing multiplier above the dense zone
  baseMinor: 9.0,     // base ellipse depth, across the wall
  basePad: 3.0,       // base ellipse overhang past the wall ends
  arcSegs: 8,         // segments in the rounded top
  ellipseSegs: 40,
  minTines: 3,        // fewer than this and it is a prop, not a combined support
  stiltFrac: 0.35,    // reject a site whose tined zone starts above this * height
  padH: 0.5,          // bed pad thickness
  padMargin: 4.0,     // how far the pad spreads past the part's contact
  padMinArea: 60.0,   // mm^2 of bed contact above which no pad is needed
  maxLen: 25,         // mm; a fin is a short brace at a corner, not a full-length wall
  maxFins: 3,
  maxSiteTries: 24,   // candidate faces to attempt before giving up
  minScoreRatio: 0.35,  // a 2nd/3rd fin must score this fraction of the best
  minSeparationDeg: 60, // ...and face at least this far from those chosen
  minSiteGap: 12,     // mm; ...and stand this far from them in space, see below
};

/**
 * Extrude a closed convex polygon into a prism.
 *
 * `poly` is [[a, b], ...] wound counter-clockwise in the (a, b) plane, and the
 * frame (a, b, t) must be RIGHT-handed -- a x b = t. Given that, the winding
 * below comes out consistently outward, which is what makes each solid closed
 * and a thing the slicer will union rather than argue with.
 *
 * @param P  (a, b, t) -> [x, y, z] world point
 */
function extrude(poly, tLo, tHi, P, out) {
  const n = poly.length;
  const lo = poly.map(([a, b]) => P(a, b, tLo));
  const hi = poly.map(([a, b]) => P(a, b, tHi));

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    out.push(lo[i], lo[j], hi[j]);
    out.push(lo[i], hi[j], hi[i]);
  }
  for (let i = 1; i < n - 1; i++) {
    out.push(hi[0], hi[i], hi[i + 1]);   // +t cap
    out.push(lo[0], lo[i + 1], lo[i]);   // -t cap
  }
}

/**
 * Where along the patch to put a fin, and how tall to make it.
 *
 * A patch is flat but the PART is not, so a wall standing off the patch plane
 * can still drive straight through geometry beside it. The fix is not to trim
 * the wall's LENGTH against a globally-tall wall -- that was the previous
 * version and it found nothing.
 *
 * THE THING THAT WAS WRONG: the wall's height came from the patch's bounding
 * box, so every u got a wall as tall as the patch's highest point. On a tilted
 * part the patch is a DIAGONAL BAND in (u, z), so at most u values that wall
 * shot right past the patch into the part's neighbouring faces. Mapping it made
 * it obvious -- two diagonal lines of obstruction running along the patch's
 * edges, together sweeping 92 of 100 bins on the hub. The wall was being blocked
 * by geometry it only reached because it was too tall to begin with.
 *
 * So the height follows the patch LOCALLY. Per bin we know the patch's own top,
 * and the lowest obstruction crossing the wall's slab; a window is valid when
 * its wall -- no taller than the lowest patch top inside it -- clears every
 * obstruction inside it.
 *
 * The window is also capped at `maxLen`, which is docs/FIN-SPEC.md's "place it
 * on an edge or corner, never mid-face" expressed as arithmetic: a fin is a
 * short brace at a corner, not a wall down the whole side of the part.
 */
function chooseSpan(p, topo, rot, offset) {
  const { pos, nFaces } = topo;
  const BIN = 0.5;
  const nBins = Math.max(1, Math.ceil((p.u1 - p.u0) / BIN));
  const wMin = FIN.gap - 0.05;   // anything this far out is in the wall's way
  const zOf = (t) => p.n.z * p.d + p.t.z * t;   // world z on the patch face

  // Per bin: how high the patch itself reaches, how low it starts, the lowest
  // obstruction crossing the wall's slab, and whether the base is obstructed.
  const patchTopT = new Float64Array(nBins).fill(-Infinity);
  const patchBotT = new Float64Array(nBins).fill(Infinity);
  const obsMinZ = new Float64Array(nBins).fill(Infinity);
  const baseBlocked = new Uint8Array(nBins);

  // the patch's own profile: intersect each of its triangles with the vertical
  // line at each bin centre, in the patch's (u, t) plane
  const tris = p.tris;
  for (let i = 0; i < tris.length; i += 9) {
    const ux = [tris[i], tris[i + 3], tris[i + 6]];
    const tv = [tris[i + 1], tris[i + 4], tris[i + 7]];
    let lo = Math.min(ux[0], ux[1], ux[2]), hi = Math.max(ux[0], ux[1], ux[2]);
    let b0 = Math.max(0, Math.ceil((lo - p.u0) / BIN - 0.5));
    let b1 = Math.min(nBins - 1, Math.floor((hi - p.u0) / BIN - 0.5));
    for (let b = b0; b <= b1; b++) {
      const u = p.u0 + (b + 0.5) * BIN;
      let tLo = Infinity, tHi = -Infinity;
      for (let e = 0; e < 3; e++) {
        const j = (e + 1) % 3;
        const ua = ux[e], ub = ux[j];
        if ((ua <= u) === (ub <= u)) continue;      // edge does not cross
        const s = (u - ua) / (ub - ua);
        const t = tv[e] + (tv[j] - tv[e]) * s;
        if (t < tLo) tLo = t;
        if (t > tHi) tHi = t;
      }
      if (tHi === -Infinity) continue;
      if (tHi > patchTopT[b]) patchTopT[b] = tHi;
      if (tLo < patchBotT[b]) patchBotT[b] = tLo;
    }
  }

  // The wall and the base sweep different volumes, so each gets its own band.
  // The base is only 1mm tall but reaches `baseMinor` outboard, which nothing
  // used to check at all.
  const bands = [
    { wLo: wMin, wHi: FIN.gap + FIN.th + 0.15, base: false },
    { wLo: wMin, wHi: FIN.gap + FIN.baseMinor + 0.3, base: true },
  ];

  // Blocking is per TRIANGLE, clipped to the volume the fin actually sweeps,
  // then its u-extent is marked.
  //
  // The `w` bound is a BAND, not a half-space, and that distinction is the whole
  // problem. Blocking on "any surface outboard of the wall's inner face" sounds
  // safe and is badly wrong: on a hub, every other arm of the part sticks out
  // past this patch's plane, so all 52 bins blocked with the obstruction sitting
  // 14-58mm away -- open air where the wall wanted to stand. Bounding the band
  // at the wall's outer face asks the right question, "does anything cross the
  // volume the fin occupies".
  //
  // It is exact, not a heuristic, and the reason is worth keeping: if the wall's
  // box were entirely buried inside solid material with no surface crossing it,
  // the part would have to be solid down to the plate there -- and since nothing
  // can extend below z = 0, it would then have a face at z ~ 0 inside the box,
  // which this band catches. Engulfment without a crossing is not reachable.
  //
  // The two rejected alternatives, so they are not re-tried: testing VERTICES
  // misses large faces (the hub is 1,186 triangles for the whole part, so single
  // faces sail across the span with every vertex outside it), and blocking a
  // face's FULL u-extent is far too blunt -- one big triangle grazing the wall
  // blocks the entire patch.
  const tri = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];   // [w, u, z] per vertex
  for (let f = 0; f < nFaces; f++) {
    for (let i = 0; i < 3; i++) {
      const o = f * 9 + i * 3;
      const x = pos[o], y = pos[o + 1], z = pos[o + 2];
      const wx = rot[0] * x + rot[3] * y + rot[6] * z + offset.x;
      const wy = rot[1] * x + rot[4] * y + rot[7] * z + offset.y;
      const wz = rot[2] * x + rot[5] * y + rot[8] * z + offset.z;
      tri[i][0] = wx * p.n.x + wy * p.n.y + wz * p.n.z - p.d;
      tri[i][1] = wx * p.u.x + wy * p.u.y;
      tri[i][2] = wz;
    }
    // cheap rejects shared by both bands
    if (Math.max(tri[0][1], tri[1][1], tri[2][1]) < p.u0) continue;
    if (Math.min(tri[0][1], tri[1][1], tri[2][1]) > p.u1) continue;
    if (Math.min(tri[0][0], tri[1][0], tri[2][0]) > bands[1].wHi) continue;
    if (Math.max(tri[0][0], tri[1][0], tri[2][0]) < wMin) continue;

    for (const band of bands) {
      if (Math.min(tri[0][0], tri[1][0], tri[2][0]) > band.wHi) continue;
      const zHi = band.base ? FIN.baseH + 0.2 : Infinity;
      if (Math.min(tri[0][2], tri[1][2], tri[2][2]) > zHi) continue;
      if (Math.max(tri[0][2], tri[1][2], tri[2][2]) < -0.1) continue;

      let poly = tri.map((v) => v.slice());
      poly = clipHalfSpace(poly, (v) => v[0] - band.wLo);
      poly = clipHalfSpace(poly, (v) => band.wHi - v[0]);
      poly = clipHalfSpace(poly, (v) => v[2] + 0.1);
      if (band.base) poly = clipHalfSpace(poly, (v) => zHi - v[2]);
      if (poly.length < 2) continue;

      let lo = Infinity, hi = -Infinity, zMin = Infinity;
      for (const v of poly) {
        if (v[1] < lo) lo = v[1];
        if (v[1] > hi) hi = v[1];
        if (v[2] < zMin) zMin = v[2];
      }
      if (hi < p.u0 || lo > p.u1) continue;
      const b0 = Math.max(0, Math.floor((Math.max(lo, p.u0) - p.u0) / BIN));
      const b1 = Math.min(nBins - 1, Math.floor((Math.min(hi, p.u1) - p.u0) / BIN));
      for (let b = b0; b <= b1; b++) {
        if (band.base) baseBlocked[b] = 1;
        else if (zMin < obsMinZ[b]) obsMinZ[b] = zMin;
      }
    }
  }

  // Slide a window of up to maxLen and keep the best one. "Best" is wall AREA --
  // height times length -- because a fin's job is bracing: a stubby tall fin and
  // a long low one are both worse than the balanced one between them, and the
  // scoring in chooseStabilize already handles WHICH face, not how much of it.
  const maxBins = Math.max(1, Math.round(FIN.maxLen / BIN));
  const minBins = Math.max(1, Math.ceil(MIN_SPAN / BIN));
  const padBins = Math.ceil(FIN.basePad / BIN);
  const cands = [];

  for (let a = 0; a < nBins; a++) {
    if (patchTopT[a] === -Infinity) continue;
    let topT = Infinity, botT = -Infinity, lowObs = Infinity;
    for (let b = a; b < Math.min(nBins, a + maxBins); b++) {
      if (patchTopT[b] === -Infinity) break;     // patch has a hole here
      topT = Math.min(topT, patchTopT[b]);
      botT = Math.max(botT, patchBotT[b]);
      lowObs = Math.min(lowObs, obsMinZ[b]);
      if (b - a + 1 < minBins) continue;

      // the base overhangs the wall's ends, so its own footprint must be clear
      let baseOk = true;
      for (let k = a - padBins; k <= b + padBins && baseOk; k++) {
        if (k >= 0 && k < nBins && baseBlocked[k]) baseOk = false;
      }
      if (!baseOk) continue;

      // The wall's highest point is not on the patch plane: it sits `w` outboard
      // and carries a rounded cap, and on a leaning patch that lifts it further.
      // Compare the real top against the obstruction, not the face's.
      const wallTopZ = zOf(topT)
        + Math.abs(p.n.z) * (FIN.gap + FIN.th) + FIN.th / 2;
      if (wallTopZ >= lowObs) continue;          // wall would hit something
      const grip = zOf(topT) - Math.max(zOf(botT), FIN.baseH);
      if (grip < MIN_GRIP) continue;             // too little face to tine into

      // Score by GRIP area, not wall area. A 57mm wall that only overlaps the
      // patch for its top 4mm is mostly stilt: it looks impressive and holds
      // almost nothing. What braces the part is the face the tines can reach.
      const len = (b - a + 1) * BIN;
      const score = grip * len;
      cands.push({ score, a, b, topT, botT });
    }
  }

  // Return several, not one. The winner still has to survive an exact
  // containment check once its geometry exists (buildFin), and a site whose best
  // window is buried usually has a perfectly good second one a few millimetres
  // along. Returning only the maximum threw the whole face away.
  cands.sort((x, y) => y.score - x.score);
  const picked = [];
  for (const cnd of cands) {
    // keep them genuinely distinct rather than 40 slivers of the same window
    if (picked.some((q) => Math.abs(q.a - cnd.a) < minBins
                        && Math.abs(q.b - cnd.b) < minBins)) continue;
    picked.push(cnd);
    if (picked.length >= MAX_SPAN_TRIES) break;
  }
  return picked.map((cnd) => ({
    u0: p.u0 + cnd.a * BIN,
    u1: p.u0 + (cnd.b + 1) * BIN,
    tTop: cnd.topT,
    tBot: cnd.botT,
  }));
}

const MIN_SPAN = 4.0;   // mm; a shorter wall is not worth the plate space
const MAX_SPAN_TRIES = 8;  // candidate windows per site before giving up
const MIN_GRIP = 3.0;   // mm of patch face the wall must overlap to be worth tining

/** Sutherland-Hodgman: keep the part of `poly` where `f(v) >= 0`. */
function clipHalfSpace(poly, f) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const fa = f(a), fb = f(b);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) {
      const t = fa / (fa - fb);
      out.push([a[0] + (b[0] - a[0]) * t,
                a[1] + (b[1] - a[1]) * t,
                a[2] + (b[2] - a[2]) * t]);
    }
  }
  return out;
}

/**
 * Does anything cross the volume this fin will occupy?
 *
 * chooseSpan already asks this, but against the PATCH's plane -- and buildFin
 * then re-seats the plane inward onto the window's own high point, which moves
 * the wall into space the search never examined. Two fins came out 0.005mm from
 * a neighbouring feature: outside the part, so containment passed, and close
 * enough to weld solid on the first layer. This re-checks the volume the fin
 * actually occupies, so it has to run on the final geometry rather than earlier.
 */
function wallIsClear(p, u0, u1, zTop, topo, rot, offset) {
  const { pos, nFaces } = topo;
  const bands = [
    { wLo: FIN.gap - 0.05, wHi: FIN.gap + FIN.th + 0.15, zHi: zTop },
    { wLo: FIN.gap - 0.05, wHi: FIN.gap + FIN.baseMinor + 0.3, zHi: FIN.baseH + 0.2 },
  ];
  const uLo = u0 - FIN.basePad, uHi = u1 + FIN.basePad;
  const tri = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];

  for (let f = 0; f < nFaces; f++) {
    for (let i = 0; i < 3; i++) {
      const o = f * 9 + i * 3;
      const x = pos[o], y = pos[o + 1], z = pos[o + 2];
      const wx = rot[0] * x + rot[3] * y + rot[6] * z + offset.x;
      const wy = rot[1] * x + rot[4] * y + rot[7] * z + offset.y;
      const wz = rot[2] * x + rot[5] * y + rot[8] * z + offset.z;
      tri[i][0] = wx * p.n.x + wy * p.n.y + wz * p.n.z - p.d;
      tri[i][1] = wx * p.u.x + wy * p.u.y;
      tri[i][2] = wz;
    }
    if (Math.max(tri[0][1], tri[1][1], tri[2][1]) < uLo) continue;
    if (Math.min(tri[0][1], tri[1][1], tri[2][1]) > uHi) continue;
    if (Math.max(tri[0][0], tri[1][0], tri[2][0]) < bands[0].wLo) continue;
    if (Math.min(tri[0][0], tri[1][0], tri[2][0]) > bands[1].wHi) continue;

    for (const band of bands) {
      const uA = band.zHi > FIN.baseH + 0.3 ? u0 : uLo;   // base overhangs the ends
      const uB = band.zHi > FIN.baseH + 0.3 ? u1 : uHi;
      let poly = tri.map((v) => v.slice());
      poly = clipHalfSpace(poly, (v) => v[0] - band.wLo);
      poly = clipHalfSpace(poly, (v) => band.wHi - v[0]);
      poly = clipHalfSpace(poly, (v) => v[2] + 0.1);
      poly = clipHalfSpace(poly, (v) => band.zHi - v[2]);
      poly = clipHalfSpace(poly, (v) => v[1] - uA);
      poly = clipHalfSpace(poly, (v) => uB - v[1]);
      if (poly.length >= 3) return false;
    }
  }
  return true;
}

/**
 * Build one fin -- wall, base, tines -- for `patch`, or null if the site cannot
 * carry enough tines to be a combined support.
 */
function buildFin(p0, out, span, topo, rot, offset) {
  const before = out.length;
  const { u0, u1 } = span;
  const r = FIN.th / 2;
  const wIn = FIN.gap, wOut = FIN.gap + FIN.th;

  // Re-seat the plane on the outermost point INSIDE THIS WINDOW. The patch's own
  // supporting plane touches its global high point, which is usually somewhere
  // else on a long curved face, leaving the wall hanging 0.4mm back from the bit
  // it is actually gripping. Shifting it in makes the standoff mean 0.2mm here
  // rather than 0.2mm somewhere on the same face.
  //
  // The shift is never outward: every sample is <= 0 behind the patch plane, so
  // the wall still clears the whole window by at least the standoff.
  // Computed EXACTLY, not sampled. `dev` is linear across each triangle, so its
  // maximum over the window is attained at a vertex of the triangle clipped to
  // the window -- clip and take the max. A 13x11 sample grid was tried first and
  // it missed peaks between samples, seating walls 0.007mm off the part, which
  // is worse than hanging back: that fuses.
  const tLo = span.tBot ?? p0.t0, tHi = span.tTop ?? p0.t1;
  let shift = -Infinity;
  for (let i = 0; i < p0.tris.length; i += 9) {
    let poly = [
      [p0.tris[i], p0.tris[i + 1], p0.tris[i + 2]],
      [p0.tris[i + 3], p0.tris[i + 4], p0.tris[i + 5]],
      [p0.tris[i + 6], p0.tris[i + 7], p0.tris[i + 8]],
    ];
    poly = clipHalfSpace(poly, (v) => v[0] - u0);
    poly = clipHalfSpace(poly, (v) => u1 - v[0]);
    poly = clipHalfSpace(poly, (v) => v[1] - tLo);
    poly = clipHalfSpace(poly, (v) => tHi - v[1]);
    for (const v of poly) if (v[2] > shift) shift = v[2];
  }
  if (shift === -Infinity) shift = 0;
  const p = { ...p0, d: p0.d + shift };

  // --- wall: section in (t, w), extruded along u. (t, n, u) is right-handed. ---
  // The bottom edge is the z = 0 line. In this frame that line is straight but
  // SLANTED, because the two faces of a leaning wall meet the plate at different
  // heights up the face -- which is exactly why the section is built here rather
  // than as an axis-aligned rectangle.
  const tBedIn = tAtZ(p, wIn, 0), tBedOut = tAtZ(p, wOut, 0);
  const tTop = span.tTop ?? p.t1;
  if (tTop - r <= Math.max(tBedIn, tBedOut) + 0.5) return null;  // no wall to build

  const sec = [[tBedIn, wIn], [tTop - r, wIn]];
  for (let i = 1; i < FIN.arcSegs; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / FIN.arcSegs;
    sec.push([tTop - r + r * Math.cos(a), FIN.gap + r + r * Math.sin(a)]);
  }
  sec.push([tTop - r, wOut], [tBedOut, wOut]);

  // Verify the fin is actually in open air before committing to it. The span
  // search is a proximity test over bins; this is the exact question. A fin that
  // fails here is not a fin to shorten -- it is a site to abandon.
  //
  // Sampled on a grid, not at a few corners: a coarser version of this check
  // passed a wall that had three vertices buried in a hub. The base gets its own
  // samples because it reaches `baseMinor` outboard and `basePad` past the ends,
  // so it can be inside the part while every point on the wall is clear.
  const NU = 7, NT = 6;
  for (let i = 0; i < NU; i++) {
    const uu = u0 + ((u1 - u0) * i) / (NU - 1);
    for (let j = 0; j < NT; j++) {
      const tt = tBedIn + ((tTop - tBedIn) * j) / (NT - 1);
      for (const ww of [wIn, wOut]) {
        const q = patchPoint(p, ww, uu, tt);
        if (insidePart(topo, rot, offset, q[0], q[1], q[2])) return null;
      }
    }
  }
  {
    // the base's outer rim, at the height it actually occupies
    const nhx0 = p.n.x / p.h, nhy0 = p.n.y / p.h;
    const bw0 = FIN.baseMinor / 2, bu0 = (u1 - u0) / 2 + FIN.basePad;
    const foot0 = patchPoint(p, wIn, (u0 + u1) / 2, tAtZ(p, wIn, 0));
    const cx0 = foot0[0] + nhx0 * bw0, cy0 = foot0[1] + nhy0 * bw0;
    // sampled through the base's full thickness, not just its mid-height: parts
    // commonly flare in the first millimetre off the plate, so the rim can be
    // clear at 0.5mm and buried at 1.0mm
    for (let i = 0; i < 24; i++) {
      const a = (2 * Math.PI * i) / 24;
      const sx = bw0 * Math.cos(a), su = bu0 * Math.sin(a);
      const qx = cx0 + nhx0 * sx + p.u.x * su;
      const qy = cy0 + nhy0 * sx + p.u.y * su;
      for (const qz of [0.05, FIN.baseH / 2, FIN.baseH]) {
        if (insidePart(topo, rot, offset, qx, qy, qz)) return null;
      }
    }
  }

  if (!wallIsClear(p, u0, u1, zAt(p, FIN.gap + FIN.th, tTop) + r,
                   topo, rot, offset)) return null;

  extrude(sec, u0, u1, (a, b, t) => patchPoint(p, b, t, a), out);

  // --- base: an ellipse on the plate, in world XY, extruded in z ---
  // Its inner edge is tangent to the wall's inner face rather than centred under
  // the wall, so the base never reaches the part. A base touching the part would
  // weld the fin to it at the plate and stop it breaking away -- the one thing a
  // breakaway fin must not do.
  const nhx = p.n.x / p.h, nhy = p.n.y / p.h;
  const foot = patchPoint(p, wIn, (u0 + u1) / 2, tBedIn);
  const bw = FIN.baseMinor / 2;
  const bu = (u1 - u0) / 2 + FIN.basePad;
  const cx = foot[0] + nhx * bw, cy = foot[1] + nhy * bw;

  const ell = [];
  for (let i = 0; i < FIN.ellipseSegs; i++) {
    const a = (2 * Math.PI * i) / FIN.ellipseSegs;   // (nh, u) is CCW in world XY
    const s = bw * Math.cos(a), t = bu * Math.sin(a);
    ell.push([cx + nhx * s + p.u.x * t, cy + nhy * s + p.u.y * t]);
  }
  extrude(ell, 0, FIN.baseH, (a, b, t) => [a, b, t], out);

  // --- tines, in world axes so each one lands in a single layer ---
  // Tine rows follow THIS window, not the patch's global z-range. Using the
  // global range put most stations outside the local face, where patchCovers
  // rejected them -- a 46mm wall came out with six tines.
  const zTop = zAt(p, FIN.gap + r, tTop);
  const localBot = span.tBot != null ? zAt(p, 0, span.tBot) : p.z0;
  const zLo = Math.max(localBot, FIN.baseH) + 0.4;
  const zHi = Math.min(zAt(p, 0, tTop), zTop) - FIN.tineH - 0.5;

  // Dense low, spreading with height: the part is least stable early, when it is
  // a narrow foot with all its leverage still to come. Higher up it is already
  // braced by everything below.
  const rows = [];
  if (zHi > zLo) {
    const dense = Math.min(zHi - zLo, FIN.denseZone);
    let step = Math.max(FIN.rowGapMin, dense / FIN.rowsLow);
    for (let z = zLo; z <= zHi; z += step) {
      rows.push(z);
      if (z > zLo + dense) step *= FIN.rowGrowth;
    }
  }

  const inset = Math.min(FIN.tineW, (u1 - u0) / 4);
  const sA = u0 + inset, sB = u1 - inset;
  const nU = sB > sA ? Math.max(2, Math.ceil((sB - sA) / FIN.tineSpacingU) + 1) : 1;

  let tines = 0;
  for (const z of rows) {
    const zMid = z + FIN.tineH / 2;
    // the wall's outer anchor is fixed; the inner end moves to meet the surface
    const s1 = (p.d + FIN.gap + FIN.tineGrip - p.n.z * zMid) / p.h;
    for (let i = 0; i < nU; i++) {
      const uv = nU === 1 ? (sA + sB) / 2 : sA + ((sB - sA) * i) / (nU - 1);

      // Each tine measures its own gap. The wall is one flat plane but the
      // surface it grips is not -- on a round part the face recedes as you move
      // along the wall, and a fixed-length tine would hang in air a few
      // millimetres from the middle. This is what lets one flat wall span many
      // facets of a cone instead of gripping exactly one.
      //
      // Also does the coverage test: a patch's bounding box is not its shape,
      // and a tine in the notch of an L-shaped face would print into thin air.
      // Probe, then re-probe where the surface actually is. The first guess
      // uses the t at which the PLANE crosses this height, but the surface sits
      // `dev` behind the plane, and on a leaning patch that displaces t by up to
      // a millimetre -- enough to read the offset off the wrong part of a curved
      // face and leave the tine hanging.
      let raw = patchProbe(p0, uv, tAtZ(p0, 0, zMid));
      if (raw === null) continue;
      const refined = patchProbe(p0, uv, tAtZ(p0, raw, zMid));
      if (refined !== null) raw = refined;
      const dev = raw - shift;          // relative to this fin's own plane
      // past this the tine stops being a bead and becomes a bridge
      if (FIN.gap - dev > FIN.tineSpanMax) continue;

      const sPart = (p.d + dev - p.n.z * zMid) / p.h;
      const s0 = sPart - FIN.tineBite / p.h;

      // Confirm the bite rather than trusting the probe. The offset is
      // interpolated across a triangle, so near an edge it can be off by enough
      // for the tine to stop short -- and a tine that fuses nothing is a loose
      // speck rattling around the plate. Cheap: one parity query against the
      // grid inside.js already built.
      if (!insidePart(topo, rot, offset,
                      nhx * s0 + p.u.x * uv, nhy * s0 + p.u.y * uv, zMid)) continue;
      const rect = [[z, s0], [z + FIN.tineH, s0], [z + FIN.tineH, s1], [z, s1]];
      // (z, nh, u) is right-handed: z x nh = u.
      extrude(rect, uv - FIN.tineW / 2, uv + FIN.tineW / 2,
              (a, b, t) => [nhx * b + p.u.x * t, nhy * b + p.u.y * t, a], out);
      tines++;
    }
  }

  // A wall with too little grip is the M3 failure mode with extra steps: it
  // props the part in one direction and lets it fall away in the other.
  if (tines < FIN.minTines) { out.length = before; return null; }

  return {
    // the site, so a failure can be traced back to the face that produced it
    site: { d: p.d, n: { ...p.n }, u0, u1, tTop, lean: p.lean,
            patchU: [p.u0, p.u1], patchT: [p.t0, p.t1] },
    tines, rows: rows.length,
    height: zTop, length: u1 - u0,
    stilt: Math.max(0, p.z0 - FIN.baseH),
    lean: p.lean,
    bearing: Math.round((Math.atan2(p.n.y, p.n.x) * 180) / Math.PI),
  };
}

/**
 * A flat pad under the part's bed contact.
 *
 * Not a nicety: a part tilted into a strong orientation rests on an EDGE, so its
 * bed contact is near zero and it peels off before the fins have anything to
 * hold. The pad is a wide, thin ellipse -- thin enough to cut off, wide enough
 * to stick.
 *
 * It is fed the part's lowest VERTICES, not its bed-contact faces. A part
 * standing on an edge has no face on the plate at all, so a face-based footprint
 * is empty in precisely the case the pad exists for.
 */
function buildPad(contact, out) {
  if (contact.length < 3) return null;

  let cx = 0, cy = 0;
  for (const p of contact) { cx += p[0]; cy += p[1]; }
  cx /= contact.length; cy /= contact.length;

  // principal axis of the contact, so a long thin edge gets a long thin pad
  // instead of a circle sized to its length
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of contact) {
    const dx = p[0] - cx, dy = p[1] - cy;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  const tr = sxx + syy, det = sxx * syy - sxy * sxy;
  const lam = tr / 2 + Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  let ax = sxy, ay = lam - sxx;
  if (Math.hypot(ax, ay) < 1e-9) { ax = 1; ay = 0; }
  const an = Math.hypot(ax, ay); ax /= an; ay /= an;
  const bx = -ay, by = ax;

  let e1 = 0, e2 = 0;
  for (const p of contact) {
    const dx = p[0] - cx, dy = p[1] - cy;
    e1 = Math.max(e1, Math.abs(dx * ax + dy * ay));
    e2 = Math.max(e2, Math.abs(dx * bx + dy * by));
  }
  const r1 = e1 + FIN.padMargin, r2 = e2 + FIN.padMargin;

  const poly = [];
  for (let i = 0; i < FIN.ellipseSegs; i++) {
    const a = (2 * Math.PI * i) / FIN.ellipseSegs;
    const s = r1 * Math.cos(a), t = r2 * Math.sin(a);
    poly.push([cx + ax * s + bx * t, cy + ay * s + by * t]);
  }
  extrude(poly, 0, FIN.padH, (a, b, t) => [a, b, t], out);
  return { r1, r2, points: contact.length };
}

/**
 * STABILIZE mode: pick the few sites that best keep the part standing.
 *
 * This is not "a fin per overhang" -- that is Coverage mode, and on a tilted
 * Voron frame it wants 13 walls 12-103mm tall. Stabilize asks the question the
 * technique was invented for: the part has been turned onto an edge to print
 * strong, so what stops it toppling? The answer is one or two tall fins on the
 * side it wants to fall toward, plus one opposite so it cannot twist off.
 *
 * `tip` is the horizontal direction the part leans: from the centre of its bed
 * contact toward the centre of its mass. A fin whose face looks along that
 * direction is a fin in the way of the fall.
 */
function rankSites(patches, tip, stats = null) {
  // A site whose face starts high off the plate makes the wall below it a bare
  // stilt: it holds nothing, it is the part most likely to wobble, and it is
  // most of the plastic.
  const usable = patches.filter((p) => p.z0 - FIN.baseH <= FIN.stiltFrac * p.z1);
  if (stats) stats.tooHigh = patches.length - usable.length;
  if (!usable.length) return [];

  const maxH = Math.max(...usable.map((p) => p.z1), 1);
  const maxW = Math.max(...usable.map((p) => p.u1 - p.u0), 1);

  // A stilt is penalised as well as capped. The hard filter alone let fins land
  // 10-14mm up the part -- legal, but they read as stuck on halfway up rather
  // than bracing anything, and the bare wall under them is the wobbliest part of
  // the fin. Between two otherwise equal faces, the lower one is the better
  // brace, so height alone must not decide it.
  return usable.map((p) => {
    const align = tip ? (p.n.x * tip.x + p.n.y * tip.y) / p.h : 0;
    const stilt = Math.max(0, p.z0 - FIN.baseH) / maxH;
    return {
      patch: p,
      score: 1.0 * Math.max(0, align)
           + 0.6 * (p.z1 / maxH)
           + 0.4 * ((p.u1 - p.u0) / maxW)
           - 1.2 * stilt,
    };
  }).sort((a, b) => b.score - a.score);
}

/**
 * Is this site too close to one that already carries a fin?
 *
 * Checked in POSITION as well as direction. Comparing only normals looks
 * sufficient and is not: the two faces of a thin rib are a perfect 180 degrees
 * apart and sail through, which is how one hub got two "opposite" fins standing
 * 1.6mm from each other. Two fins that close are one fin's worth of bracing at
 * two fins' cost -- and the reason the spec says opposite sides is torsion,
 * which needs a lever arm.
 */
function clashes(taken, cand) {
  const sepCut = Math.cos((FIN.minSeparationDeg * Math.PI) / 180);
  return taken.some((a) => {
    const aligned = (a.n.x * cand.n.x + a.n.y * cand.n.y) / (a.h * cand.h) > sepCut;
    const dx = a.mid.x - cand.mid.x, dy = a.mid.y - cand.mid.y;
    return aligned || Math.hypot(dx, dy) < FIN.minSiteGap;
  });
}

/**
 * The part's bed-contact points and its area-weighted centre of mass.
 *
 * Contact comes from VERTICES under BED_EPS, not from bed-flagged faces: a part
 * tilted onto an edge has no face on the plate at all, which is exactly the case
 * the bed pad exists for.
 */
function bedContact(topo, result, rot) {
  const { pos, nFaces, area } = topo;
  const { x: ox, y: oy, z: oz } = result.offset;
  let mx = 0, my = 0, mw = 0;
  const pts = [];
  for (let f = 0; f < nFaces; f++) {
    let gx = 0, gy = 0;
    for (let i = 0; i < 3; i++) {
      const o = f * 9 + i * 3;
      const x = pos[o], y = pos[o + 1], z = pos[o + 2];
      const wx = rot[0] * x + rot[3] * y + rot[6] * z + ox;
      const wy = rot[1] * x + rot[4] * y + rot[7] * z + oy;
      const wz = rot[2] * x + rot[5] * y + rot[8] * z + oz;
      gx += wx; gy += wy;
      if (wz < BED_EPS) pts.push([wx, wy]);
    }
    mx += (gx / 3) * area[f]; my += (gy / 3) * area[f]; mw += area[f];
  }
  if (mw > 0) { mx /= mw; my /= mw; }
  return { pts, mx, my };
}

/**
 * Generate fins for the part in its current orientation.
 *
 * @param opts.mode     'stabilize' (only mode implemented; see docs/ROADMAP.md)
 * @param opts.bedPad   add the pad when bed contact is too small to hold
 */
export function buildFins(topo, result, rot, opts = {}) {
  const mode = opts.mode ?? 'stabilize';
  const maxFins = opts.maxFins ?? FIN.maxFins;
  const out = [];
  const padOut = [];

  // Prop is its own support, built by its own module -- a wall UNDER each
  // overhang with no tines, which needs none of the face-finding below. Handled
  // first so the patch search is not even run for it.
  if (mode === 'prop') {
    const built = buildProps(topo, result, rot, opts);
    const contact = bedContact(topo, result, rot);
    const pad = (opts.bedPad ?? true) && result.bedArea < FIN.padMinArea
      ? buildPad(contact.pts, padOut) : null;
    return {
      triangles: built.triangles, padTriangles: padOut, pad, mode,
      fins: built.props.map((q) => ({
        height: q.height, length: q.span, tines: 0, rows: 0,
        stilt: 0, lean: 0, bearing: 0, site: null,
      })),
      props: built.props,
      rejected: { blocked: built.skipped.blocked, tooFewTines: 0,
                  sites: result.regions.length,
                  tried: result.regions.length },
      patchCount: 0, patchStats: {}, tines: 0,
      unserved: result.regions.length - built.props.length,
      tip: null,
    };
  }

  const patchStats = {};
  const patches = findWallPatches(topo, rot, result.offset, patchStats);

  // where the part's mass is, versus where it is actually touching down
  const { pts: contact, mx, my } = bedContact(topo, result, rot);

  let tip = null;
  if (contact.length) {
    let bx = 0, by = 0;
    for (const p of contact) { bx += p[0]; by += p[1]; }
    bx /= contact.length; by /= contact.length;
    const dx = mx - bx, dy = my - by, dn = Math.hypot(dx, dy);
    // A well-balanced part has no lean worth reading, and normalising the noise
    // would aim the fins at a rounding error.
    if (dn > 0.5) tip = { x: dx / dn, y: dy / dn };
  }

  const ranked = mode === 'stabilize' ? rankSites(patches, tip, patchStats) : [];

  // Walk the ranking until enough fins EXIST, rather than picking sites up front
  // and hoping. Choosing first and building second meant a site that turned out
  // to have no clear window burned one of the three slots and the part came back
  // with no fins at all -- on a tapered hub, 1 site tried and 93 candidates left
  // untouched. Separation is therefore checked against the fins actually built.
  const fins = [];
  const taken = [];
  const rejected = { blocked: 0, tooFewTines: 0, sites: 0, tried: 0 };

  for (const cand of ranked) {
    if (fins.length >= maxFins) break;
    if (rejected.tried >= FIN.maxSiteTries) break;
    // a 2nd or 3rd fin still has to be worth its plastic next to the first
    if (fins.length && cand.score < ranked[0].score * FIN.minScoreRatio) break;
    if (clashes(taken, cand.patch)) continue;

    rejected.tried++;
    const spans = chooseSpan(cand.patch, topo, rot, result.offset);
    if (!spans.length) { rejected.blocked++; continue; }

    let info = null;
    for (const span of spans) {
      info = buildFin(cand.patch, out, span, topo, rot, result.offset);
      if (info) break;
    }
    if (info) { fins.push(info); taken.push(cand.patch); }
    else rejected.tooFewTines++;
  }
  rejected.sites = ranked.length;

  let pad = null;
  if ((opts.bedPad ?? true) && result.bedArea < FIN.padMinArea) {
    pad = buildPad(contact, padOut);
  }

  return {
    triangles: out, padTriangles: padOut, fins, pad, rejected,
    patchCount: patches.length, patchStats,
    tines: fins.reduce((a, f) => a + f.tines, 0),
    // Stabilize does not claim to serve overhangs -- it claims to keep the part
    // standing. Anything still red after the fins go on is the user's call:
    // rotate further, or wait for Draw mode. Saying so is the honest version.
    unserved: result.regions.length,
    tip,
  };
}
