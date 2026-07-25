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
import { findWallPatches, patchCovers, patchPoint, tAtZ, zAt } from './planes.js';
import { BED_EPS } from './overhangs.js';
import { insidePart } from './inside.js';

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
  tineSpacingU: 14,   // mm between tines along the wall
  rowGapMin: 0.8,     // mm; below this the rows stop being separate beads
  denseZone: 6,       // mm of height that gets the dense tine rows
  rowGrowth: 1.6,     // row spacing multiplier above the dense zone
  baseMinor: 9.0,     // base ellipse depth, across the wall
  basePad: 3.0,       // base ellipse overhang past the wall ends
  arcSegs: 8,         // segments in the rounded top
  ellipseSegs: 40,
  minTines: 3,        // fewer than this and it is a prop, not a combined support
  stiltFrac: 0.5,     // reject a site whose tined zone starts above this * height
  padH: 0.5,          // bed pad thickness
  padMargin: 4.0,     // how far the pad spreads past the part's contact
  padMinArea: 60.0,   // mm^2 of bed contact above which no pad is needed
  maxLen: 25,         // mm; a fin is a short brace at a corner, not a full-length wall
  maxFins: 3,
  minScoreRatio: 0.35,  // a 2nd/3rd fin must score this fraction of the best
  minSeparationDeg: 60, // ...and face at least this far from those chosen
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
  for (let i = 0; i < tris.length; i += 6) {
    const ux = [tris[i], tris[i + 2], tris[i + 4]];
    const tv = [tris[i + 1], tris[i + 3], tris[i + 5]];
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
 * Build one fin -- wall, base, tines -- for `patch`, or null if the site cannot
 * carry enough tines to be a combined support.
 */
function buildFin(p, out, span, topo, rot, offset) {
  const before = out.length;
  const { u0, u1 } = span;
  const r = FIN.th / 2;
  const wIn = FIN.gap, wOut = FIN.gap + FIN.th;

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

  // Verify the wall is actually in open air before committing to it. The span
  // search is a proximity test over bins; this is the exact question. A wall
  // that fails here is not a wall to shorten -- it is a site to abandon.
  for (const uu of [u0, (u0 + u1) / 2, u1]) {
    for (const [tt, ww] of [[tTop, wIn], [tTop, wOut], [tTop - r, wIn],
                            [(tBedIn + tTop) / 2, wIn], [(tBedIn + tTop) / 2, wOut]]) {
      const q = patchPoint(p, ww, uu, tt);
      if (insidePart(topo, rot, offset, q[0], q[1], q[2])) return null;
    }
  }

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
    // where the part's face sits, measured horizontally along the outward normal
    const sPart = (p.d - p.n.z * zMid) / p.h;
    const s0 = sPart - FIN.tineBite / p.h;
    const s1 = sPart + (FIN.gap + FIN.tineGrip) / p.h;
    for (let i = 0; i < nU; i++) {
      const uv = nU === 1 ? (sA + sB) / 2 : sA + ((sB - sA) * i) / (nU - 1);
      // A patch's bounding box is not its shape. Without this test a tine in the
      // notch of an L-shaped face prints into thin air, touching nothing.
      if (!patchCovers(p, uv, tAtZ(p, 0, zMid))) continue;
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
function chooseStabilize(patches, tip, maxFins) {
  // A site whose face starts high off the plate makes the wall below it a bare
  // stilt: it holds nothing, it is the part most likely to wobble, and it is
  // most of the plastic. Reject rather than score -- a 47mm stilt under 12mm of
  // grip is not a worse fin, it is a different and worse idea.
  const usable = patches.filter((p) => p.z0 - FIN.baseH <= FIN.stiltFrac * p.z1);
  if (!usable.length) return [];

  const maxH = Math.max(...usable.map((p) => p.z1), 1);
  const maxW = Math.max(...usable.map((p) => p.u1 - p.u0), 1);

  const ranked = usable.map((p) => {
    const align = tip ? (p.n.x * tip.x + p.n.y * tip.y) / p.h : 0;
    return {
      patch: p,
      score: 1.0 * Math.max(0, align)
           + 0.6 * (p.z1 / maxH)
           + 0.4 * ((p.u1 - p.u0) / maxW),
    };
  }).sort((a, b) => b.score - a.score);

  const sepCut = Math.cos((FIN.minSeparationDeg * Math.PI) / 180);
  const chosen = [ranked[0]];
  for (const cand of ranked.slice(1)) {
    if (chosen.length >= maxFins) break;
    if (cand.score < ranked[0].score * FIN.minScoreRatio) break;
    // Spread them around the part. Two fins on the same face are one fin's worth
    // of bracing and two fins' worth of plastic; the spec's "two fins, opposite
    // sides" exists because a single face lets the part twist off it.
    const clash = chosen.some((c) => {
      const a = c.patch, b = cand.patch;
      return (a.n.x * b.n.x + a.n.y * b.n.y) / (a.h * b.h) > sepCut;
    });
    if (!clash) chosen.push(cand);
  }
  return chosen.map((c) => c.patch);
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

  const patches = findWallPatches(topo, rot, result.offset);

  // where the part's mass is, versus where it is actually touching down
  const { pos, nFaces, area } = topo;
  const { x: ox, y: oy, z: oz } = result.offset;
  let mx = 0, my = 0, mw = 0;
  const contact = [];
  for (let f = 0; f < nFaces; f++) {
    let gx = 0, gy = 0;
    for (let i = 0; i < 3; i++) {
      const o = f * 9 + i * 3;
      const x = pos[o], y = pos[o + 1], z = pos[o + 2];
      const wx = rot[0] * x + rot[3] * y + rot[6] * z + ox;
      const wy = rot[1] * x + rot[4] * y + rot[7] * z + oy;
      const wz = rot[2] * x + rot[5] * y + rot[8] * z + oz;
      gx += wx; gy += wy;
      if (wz < BED_EPS) contact.push([wx, wy]);
    }
    mx += (gx / 3) * area[f]; my += (gy / 3) * area[f]; mw += area[f];
  }
  if (mw > 0) { mx /= mw; my /= mw; }

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

  const sites = mode === 'stabilize' ? chooseStabilize(patches, tip, maxFins) : [];

  const fins = [];
  const rejected = { blocked: 0, tooFewTines: 0 };
  for (const patch of sites) {
    const spans = chooseSpan(patch, topo, rot, result.offset);
    if (!spans.length) { rejected.blocked++; continue; }
    let info = null;
    for (const span of spans) {
      info = buildFin(patch, out, span, topo, rot, result.offset);
      if (info) break;
    }
    if (info) fins.push(info); else rejected.tooFewTines++;
  }

  let pad = null;
  if ((opts.bedPad ?? true) && result.bedArea < FIN.padMinArea) {
    pad = buildPad(contact, padOut);
  }

  return {
    triangles: out, padTriangles: padOut, fins, pad, rejected,
    patchCount: patches.length,
    tines: fins.reduce((a, f) => a + f.tines, 0),
    // Stabilize does not claim to serve overhangs -- it claims to keep the part
    // standing. Anything still red after the fins go on is the user's call:
    // rotate further, or wait for Draw mode. Saying so is the honest version.
    unserved: result.regions.length,
    tip,
  };
}
