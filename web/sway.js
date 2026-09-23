/**
 * SWAY BRACES -- buttress ribs that keep a TALL part from drifting, sagging and
 * wobbling as it grows.
 *
 * The rest of the engine answers "what holds this overhang up?" A tall, slender
 * part has a different problem: nothing overhangs, but the higher it gets the
 * more the nozzle's drag and each layer's shrink as it cools push the top around.
 * The part flexes, and every flex is a visible layer line. The cure is the one a
 * builder uses on a tall wall: a buttress standing out from the side, tied to it
 * at intervals all the way up.
 *
 * So a sway brace is:
 *   1. the RIB, a vertical plate standing PERPENDICULAR to an upright face (edge-on
 *      to it, which is its stiff direction -- a plate lying flat against the face,
 *      the old Brace, bends the easy way exactly when the part leans into it). Its
 *      inner edge follows the face at the breakaway gap, and it TAPERS: deep at the
 *      bed, narrow at the top, so it stays stiffer than the part it holds;
 *   2. the FOOT, a thin flange on the plate so the rib stays down;
 *   3. the TINES, one-layer horizontal bridges from the rib's inner edge into the
 *      part, spaced EVENLY up the whole height. The Brace spaced its tines densely
 *      at the base and spread them 1.6x per row, which suits a part that might tip
 *      over early but leaves the top of a tall part, where the sway is, nearly
 *      untied. Here the spacing stays even, and the user can start the grip higher.
 *
 * Same rules as everything else here (docs/FIN-SPEC.md): the rib never leans, the
 * tines are horizontal and exactly one layer tall, the geometry is plain closed
 * solids unioned by the slicer, and a rib that can't be built says why.
 *
 * Gap and bite arrive in `opts` rather than being read from FIN/PROP, so this
 * module depends on neither: the caller passes the material's numbers, whether it
 * runs in the Worker (after fins.js applyTunables) or on the page (Draw).
 */
import { findWallPatches, patchProbe, patchPoint, tAtZ } from './planes.js';
import { insidePart } from './inside.js';

export const SWAY = {
  // which faces take a brace
  maxLeanDeg: 30,     // a face leaning further than this is an overhang or a roof, not a side
  minFaceH: 30,       // mm of face height before auto-placement bothers bracing it
  minTopFrac: 0.4,    // ...and it must reach this far up the part, or it braces the easy half
  minPartH: 30,       // mm; a shorter part doesn't sway enough to need this

  // the rib
  thMin: 1.2,         // wall thickness at the minimum height (the fins' own wall)
  thPerMm: 0.004,     // grows with height: 1.2mm at 0, 2.2mm at 250mm
  thMax: 2.4,
  reach: 0.15,        // DEFAULT base depth as a fraction of rib height (UI: "Brace depth")
  topDepth: 4,        // mm at the top: a flat edge, not a point (a point is a retraction)
  minDepth: 8,
  maxDepth: 60,
  topClear: 1.0,      // the rib stops this far below the top of the face it braces
  minRibH: 20,        // a shorter rib isn't bracing anything

  // the foot
  footH: 0.6,
  footHalf: 3.0,      // flange past the rib on each side
  footPad: 3.0,       // ...and past its outer end

  // the tines (standoff and bite come from the material profile, via opts)
  gap: 0.2,
  bite: 0.3,
  tineW: 0.5,         // one nozzle bead, as elsewhere
  tineOverlap: 0.3,   // how far the tine sinks back into the rib, so they union
  tineSpanMax: 1.5,   // past this much open air a tine is a bridge (probe_tines2.py)
  tineSpacing: 6,     // DEFAULT mm between tines up the rib (UI: "Tine spacing")
  minTines: 3,
  minGripShare: 0.3,  // ...and at least this share of the rows up the rib must find the face

  // auto-placement
  pitch: 100,         // mm of face width per rib
  maxPerFace: 4,
  endInset: 10,       // keep ribs near the ends of a face (FIN-SPEC: edges hide marks)
  maxFaces: 4,
  minBearingSep: 60,  // faces this far apart in bearing, so opposite + adjacent sides both count
  nudges: [0, 3, -3, 6, -6, 10, -10],
  clearance: 1.0,     // mm of air two braces must keep between them
  levelStep: 10,      // mm between the heights a clash check compares
  // Half-width to assume for a prop wall or wedge the braces must stay clear of.
  // Their own records carry a centreline, not a footprint, so this is the widest
  // foot either builds (PROP/PERP footHalf 3.0 + half a 1.2mm wall) rounded up.
  wallHalf: 3.6,
};

const leanCut = () => Math.sin((SWAY.maxLeanDeg * Math.PI) / 180);

/** Resolve the caller's options against the defaults, clamped to what prints. */
function settings(opts = {}) {
  const num = (v, d) => (Number.isFinite(v) ? v : d);
  return {
    tines: opts.tines !== false,
    layerH: Math.max(0.04, num(opts.layerHeight, 0.2)),
    gap: num(opts.gap, SWAY.gap),
    bite: num(opts.bite, SWAY.bite),
    gripFrom: Math.max(0, num(opts.gripFrom, 0)),
    spacing: Math.max(1, num(opts.tineSpacing, SWAY.tineSpacing)),
    reach: Math.max(0.05, Math.min(0.5, num(opts.reach, SWAY.reach))),
  };
}

/** The part's triangles in print space, as a flat array. */
function printTriangles(topo, rot, offset) {
  const { pos, nFaces } = topo;
  const a = new Float64Array(nFaces * 9);
  for (let i = 0; i < a.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    a[i] = rot[0] * x + rot[3] * y + rot[6] * z + offset.x;
    a[i + 1] = rot[1] * x + rot[4] * y + rot[7] * z + offset.y;
    a[i + 2] = rot[2] * x + rot[5] * y + rot[8] * z + offset.z;
  }
  return a;
}

/** Sutherland-Hodgman: keep the part of `poly` where `f(v) >= 0`. */
function clip(poly, f) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const fa = f(a), fb = f(b);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) {
      const t = fa / (fa - fb);
      out.push(a.map((v, k) => v + (b[k] - v) * t));
    }
  }
  return out;
}

/** Push a closed solid, flipping the winding outward if its signed volume is negative. */
function pushSolid(local, out) {
  let V = 0;
  for (let i = 0; i < local.length; i += 3) {
    const a = local[i], b = local[i + 1], c = local[i + 2];
    V += a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2])
       + a[2] * (b[0] * c[1] - b[1] * c[0]);
  }
  if (V < 0) for (let i = 0; i < local.length; i += 3) out.push(local[i], local[i + 2], local[i + 1]);
  else for (const v of local) out.push(v);
}

/** A convex polygon `poly` ([[a, b], ...]) extruded from c = lo to c = hi, mapped by P(a, b, c). */
function prism(poly, lo, hi, P, out) {
  const n = poly.length;
  const L = poly.map(([a, b]) => P(a, b, lo));
  const H = poly.map(([a, b]) => P(a, b, hi));
  const local = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    local.push(L[i], L[j], H[j], L[i], H[j], H[i]);
  }
  for (let i = 1; i < n - 1; i++) local.push(H[0], H[i], H[i + 1], L[0], L[i + 1], L[i]);
  pushSolid(local, out);
}

/**
 * The rib's frame on a patch: `s` is horizontal distance out of the face (along
 * the face normal's horizontal part), `uu` is across the face (the patch's own
 * u, so patchProbe reads it directly), z is z. A world point is s*nh + uu*u.
 */
function frameOf(p) {
  const nh = { x: p.n.x / p.h, y: p.n.y / p.h };
  const toWorld = (s, uu, z) => [nh.x * s + p.u.x * uu, nh.y * s + p.u.y * uu, z];
  const sOf = (q) => q[0] * nh.x + q[1] * nh.y;
  return { nh, toWorld, sOf };
}

/**
 * The lowest z at which any part triangle crosses the volume the rib would
 * occupy, or Infinity. Exact per triangle: clip to the rib's slab across the
 * face, then against the rib's own (s, z) outline -- the same "does anything
 * cross the volume" question fins.js asks of its walls, for a tapered outline.
 */
function lowestHit(tris, fr, uLo, uHi, outline) {
  let best = Infinity;
  const v = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < tris.length; i += 9) {
    let umin = Infinity, umax = -Infinity;
    for (let k = 0; k < 3; k++) {
      const x = tris[i + k * 3], y = tris[i + k * 3 + 1], z = tris[i + k * 3 + 2];
      v[k][0] = x * fr.nh.x + y * fr.nh.y;
      v[k][1] = x * fr.uDir.x + y * fr.uDir.y;
      v[k][2] = z;
      if (v[k][1] < umin) umin = v[k][1];
      if (v[k][1] > umax) umax = v[k][1];
    }
    if (umax < uLo || umin > uHi) continue;
    let poly = v.map((q) => q.slice());
    poly = clip(poly, (q) => q[1] - uLo);
    poly = clip(poly, (q) => uHi - q[1]);
    for (const f of outline) {
      if (poly.length < 2) break;
      poly = clip(poly, f);
    }
    if (poly.length < 2) continue;
    for (const q of poly) if (q[2] < best) best = q[2];
  }
  return best;
}

/**
 * Build one sway brace against patch `p`, centred across the face at `uc`.
 * Returns { ok: true, tris, tines, height, depth, th, foot } or { ok: false, reason }.
 */
export function buildSwayRib(p, uc, partTris, topo, rot, offset, opts = {}) {
  const S = settings(opts);
  if (Math.abs(p.n.z) > leanCut()) {
    return { ok: false, reason: 'that face leans too far to stand a brace against — pick an upright side' };
  }
  const fr = { ...frameOf(p), uDir: { x: p.u.x, y: p.u.y } };

  // How much of the face this column actually crosses, 1mm at a time.
  let fz0 = Infinity, fz1 = -Infinity;
  for (let z = Math.max(0, p.z0); z <= p.z1 + 1e-6; z += 1) {
    if (patchProbe(p, uc, tAtZ(p, 0, z)) !== null) {
      if (z < fz0) fz0 = z;
      if (z > fz1) fz1 = z;
    }
  }
  if (fz1 === -Infinity) return { ok: false, reason: 'there is no face under that spot to brace' };

  let H = fz1 - SWAY.topClear;
  if (H < SWAY.minRibH) {
    return { ok: false, reason: `that face only reaches ${fz1.toFixed(0)}mm up — too short to need a brace` };
  }
  const thFor = (h) => Math.min(SWAY.thMax, SWAY.thMin + SWAY.thPerMm * h);
  let th = thFor(H);

  // Seat the rib's inner edge on the outermost point of the face INSIDE its own
  // slab, as fins.js does per window: the patch plane touches the patch's global
  // high point, which may be elsewhere on the face, and the gap has to be a floor
  // here, not somewhere else on the same side.
  const shiftIn = (half) => {
    let m = -Infinity;
    for (let i = 0; i < p.tris.length; i += 9) {
      let poly = [
        [p.tris[i], p.tris[i + 1], p.tris[i + 2]],
        [p.tris[i + 3], p.tris[i + 4], p.tris[i + 5]],
        [p.tris[i + 6], p.tris[i + 7], p.tris[i + 8]],
      ];
      poly = clip(poly, (q) => q[0] - (uc - half));
      poly = clip(poly, (q) => (uc + half) - q[0]);
      for (const q of poly) if (q[2] > m) m = q[2];
    }
    return m === -Infinity ? 0 : m;
  };

  // The outline in (s, z). The inner edge follows the (possibly leaning) face
  // plane at the gap; the outer edge tapers from `D0` at the bed to topDepth.
  let wIn = 0, sIn0 = 0, sInSlope = 0, D0 = 0;
  const shape = () => {
    th = thFor(H);
    wIn = shiftIn(th / 2 + SWAY.tineW) + S.gap;
    const a = fr.sOf(patchPoint(p, wIn, uc, tAtZ(p, wIn, 0)));
    const b = fr.sOf(patchPoint(p, wIn, uc, tAtZ(p, wIn, 1)));
    sIn0 = a; sInSlope = b - a;
    D0 = Math.max(SWAY.minDepth, Math.min(SWAY.maxDepth, S.reach * H));
  };
  const sIn = (z) => sIn0 + sInSlope * z;
  const depthAt = (z) => D0 + (SWAY.topDepth - D0) * Math.min(1, Math.max(0, z / H));

  // Shrink the rib until nothing on the part crosses it: a feature sticking out
  // above the face (a ledge, a shoulder) caps it below that feature.
  let hit = Infinity;
  for (let iter = 0; iter < 6; iter++) {
    shape();
    const outline = [
      (q) => q[2] + 0.1,
      (q) => (H + 0.3) - q[2],
      (q) => q[0] - (sIn(q[2]) - 0.05),
      (q) => (sIn(q[2]) + depthAt(q[2]) + 0.1) - q[0],
    ];
    hit = lowestHit(partTris, fr, uc - th / 2 - 0.3, uc + th / 2 + 0.3, outline);
    if (hit === Infinity) break;
    H = hit - 1.0;
    if (H < SWAY.minRibH) break;
  }
  if (hit !== Infinity) {
    return { ok: false, reason: 'the part sticks out over that spot, so a brace standing on the plate can’t reach up the face' };
  }

  // The foot has its own, wider footprint on the plate.
  const sFootOut = sIn(0) + D0 + SWAY.footPad;
  const footHalfW = th / 2 + SWAY.footHalf;
  const footHit = lowestHit(partTris, fr, uc - footHalfW - 0.2, uc + footHalfW + 0.2, [
    (q) => q[2] + 0.1,
    (q) => (SWAY.footH + 0.2) - q[2],
    (q) => q[0] - (sIn(0) - 0.05),
    (q) => (sFootOut + 0.1) - q[0],
  ]);
  if (footHit !== Infinity) {
    return { ok: false, reason: 'the part’s base spreads out under this face, so there is no room on the plate for the brace’s foot' };
  }

  const out = [];
  const P = (s, z, uu) => fr.toWorld(s, uu, z);
  prism([[sIn(0), 0], [sIn(0) + D0, 0], [sIn(H) + SWAY.topDepth, H], [sIn(H), H]],
        uc - th / 2, uc + th / 2, P, out);
  prism([[sIn(0), uc - footHalfW], [sFootOut, uc - footHalfW], [sFootOut, uc + footHalfW], [sIn(0), uc + footHalfW]],
        0, SWAY.footH, (s, uu, z) => fr.toWorld(s, uu, z), out);

  // Tines: evenly spaced up the face, each snapped into exactly one layer cell.
  let tines = 0;
  if (S.tines) {
    const zStart = Math.max(fz0 + 0.5, S.gripFrom, SWAY.footH + 0.5);
    const zEnd = Math.min(fz1, H) - 0.5;
    for (let z = zStart; z <= zEnd + 1e-6; z += S.spacing) {
      const bot = Math.round(z / S.layerH) * S.layerH;
      const top = bot + S.layerH;
      if (top > H) break;
      const zMid = bot + S.layerH / 2;
      let dev = patchProbe(p, uc, tAtZ(p, 0, zMid));
      if (dev === null) continue;
      const refined = patchProbe(p, uc, tAtZ(p, dev, zMid));
      if (refined !== null) dev = refined;
      const sPart = fr.sOf(patchPoint(p, dev, uc, tAtZ(p, dev, zMid)));
      const sWall = sIn(zMid);
      if (sWall - sPart > SWAY.tineSpanMax) continue;      // a bridge, not a tine
      const bx = fr.toWorld(sPart - S.bite / 2, uc, zMid);
      if (!insidePart(topo, rot, offset, bx[0], bx[1], bx[2])) continue;  // grips nothing
      prism([[sPart - S.bite, bot], [sWall + SWAY.tineOverlap, bot],
             [sWall + SWAY.tineOverlap, top], [sPart - S.bite, top]],
            uc - SWAY.tineW / 2, uc + SWAY.tineW / 2, P, out);
      tines++;
    }
    // A tall rib tied on at a handful of points still lets the part wave about
    // between them, so the grip has to cover a real share of the height too.
    const wanted = Math.max(SWAY.minTines, Math.floor(SWAY.minGripShare * (zEnd - zStart) / S.spacing));
    if (tines < wanted) {
      return { ok: false, reason: 'too little of this face lines up with the brace for its tines to grip — try a flatter part of the side' };
    }
  }

  const foot = [fr.toWorld(sIn(0), uc, 0), fr.toWorld(sFootOut, uc, 0)];
  // The rib's footprint at a ladder of heights, so a clash check can compare two
  // ribs at the SAME z: two ribs on facing walls of a channel reach toward each
  // other, and whether they meet depends on both depths at that height.
  const levels = [];
  for (let z = 0; ; z = Math.min(H, z + SWAY.levelStep)) {
    levels.push({ z, a: fr.toWorld(sIn(z), uc, z), b: fr.toWorld(sIn(z) + depthAt(z), uc, z) });
    if (z >= H) break;
  }
  return { ok: true, tris: out, tines, height: H, depth: D0, th, foot, halfW: footHalfW, levels };
}

/** Closest distance between two 2D segments. */
function segDist(a, b, c, d) {
  const pt = (p, q, r) => {
    const dx = r[0] - q[0], dy = r[1] - q[1];
    const L = dx * dx + dy * dy;
    const t = L > 0 ? Math.max(0, Math.min(1, ((p[0] - q[0]) * dx + (p[1] - q[1]) * dy) / L)) : 0;
    return Math.hypot(p[0] - q[0] - dx * t, p[1] - q[1] - dy * t);
  };
  const cross = (o, p, q) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const d1 = cross(a, b, c), d2 = cross(a, b, d), d3 = cross(c, d, a), d4 = cross(c, d, b);
  if (((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))) return 0;
  return Math.min(pt(a, c, d), pt(b, c, d), pt(c, a, b), pt(d, a, b));
}

/**
 * Would `rib` run into any of `ribs`? Two tests: the FEET on the plate (the widest
 * part, flange included), and the RIBS themselves compared level by level up to
 * the shorter one's top -- ribs on opposite walls of a channel point at each other
 * and would fuse into one bar across it, which neither snaps off nor breaks away.
 * Needs SWAY.clearance of air between them, so the slicer keeps them apart.
 */
export function swayClashes(rib, ribs) {
  for (const r of ribs) {
    if (!r?.foot) continue;
    if (segDist(rib.foot[0], rib.foot[1], r.foot[0], r.foot[1]) < rib.halfW + r.halfW + SWAY.clearance) return true;
    const need = (rib.th + r.th) / 2 + SWAY.clearance;
    const top = Math.min(rib.height, r.height);
    for (const L of rib.levels) {
      if (L.z > top) break;
      const M = levelAt(r.levels, L.z);
      if (segDist(L.a, L.b, M.a, M.b) < need) return true;
    }
  }
  return false;
}

/** A rib's footprint at height z, interpolated between its sampled levels. */
function levelAt(levels, z) {
  let k = 0;
  while (k < levels.length - 2 && levels[k + 1].z < z) k++;
  const A = levels[k], B = levels[Math.min(k + 1, levels.length - 1)];
  const f = B.z > A.z ? Math.max(0, Math.min(1, (z - A.z) / (B.z - A.z))) : 0;
  const mix = (p, q) => [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f];
  return { a: mix(A.a, B.a), b: mix(A.b, B.b) };
}

/**
 * Would `rib` run into a support that is already there -- a prop wall or a wedge?
 *
 * Braces keep clear of the part and of each other, but the props and wedges Auto
 * places are neither: a rib standing beside a prop under a ledge on the same side
 * merges with it into one piece that no longer snaps off in two halves. Their
 * records carry a centreline (`line`, world points), so this compares the rib's
 * FOOT against that line in XY -- the bed is where both are widest, and a support
 * that clears there is clear the whole way up, since both taper inward with height.
 *
 * @param walls  array of polylines ([[x, y, z], ...]), e.g. `built.fins[i].line`
 */
export function swayClashesWall(rib, walls) {
  if (!walls?.length) return false;
  const need = rib.halfW + SWAY.wallHalf + SWAY.clearance;
  for (const line of walls) {
    if (!Array.isArray(line) || line.length < 1) continue;
    if (line.length === 1) {
      const p = line[0];
      if (segDist(rib.foot[0], rib.foot[1], p, p) < need) return true;
      continue;
    }
    for (let i = 1; i < line.length; i++) {
      if (segDist(rib.foot[0], rib.foot[1], line[i - 1], line[i]) < need) return true;
    }
  }
  return false;
}

/**
 * Everything a new brace has to avoid, from either shape of `avoid` argument: a
 * plain array of braces (what the first version took), or { braces, walls }.
 */
function avoidance(avoid) {
  if (!avoid) return { braces: [], walls: [] };
  if (Array.isArray(avoid)) return { braces: avoid, walls: [] };
  return { braces: avoid.braces ?? [], walls: avoid.walls ?? [] };
}

const clashes = swayClashes;

/** How high the face reaches at `u` -- the tallest rib a column there could carry. */
function columnTop(p, u) {
  let top = -Infinity;
  for (let z = Math.max(0, p.z0); z <= p.z1 + 1e-6; z += 2) {
    if (patchProbe(p, u, tAtZ(p, 0, z)) !== null) top = z;
  }
  return top;
}

/**
 * Where along a face to stand its ribs: at the TALLEST columns, kept apart.
 * A face's outline is rarely a rectangle -- a gable, a sloped top, a notch --
 * and the sway lives at the top, so a rib at the face's low end braces the half
 * of the part that was never moving. Evenly spaced columns put the fence-cap
 * sample's ribs 160mm up a 249mm side; picking the tall columns reaches 234mm.
 * Ties go to the ends (FIN-SPEC: edges hide the tine marks).
 */
function columnsFor(p) {
  const W = p.u1 - p.u0;
  const n = Math.max(1, Math.min(SWAY.maxPerFace, Math.round(W / SWAY.pitch)));
  const inset = Math.min(SWAY.endInset, W / 4);
  const a = p.u0 + inset, b = p.u1 - inset;
  const steps = Math.max(1, Math.min(24, Math.round((b - a) / 5)));
  const mid = (a + b) / 2;
  const samples = [];
  for (let k = 0; k <= steps; k++) {
    const u = a + ((b - a) * k) / steps;
    samples.push({ u, top: columnTop(p, u), edge: Math.abs(u - mid) });
  }
  samples.sort((x, y) => (y.top - x.top) || (y.edge - x.edge));
  const apart = Math.max(SWAY.pitch / 2, W / (n + 1));
  const cols = [];
  for (const s of samples) {
    if (cols.length >= n) break;
    if (s.top === -Infinity) break;
    if (cols.some((c) => Math.abs(c - s.u) < apart)) continue;
    cols.push(s.u);
  }
  return cols.length ? cols : [mid];
}

/**
 * AUTO: brace the tallest upright sides of the part, a few faces facing
 * different ways so it is held in both directions (FIN-SPEC's "two fins,
 * opposite sides", extended to both axes of a tall part).
 *
 * Returns { triangles, count, tines, skipped, ribs, reason } -- `reason` set when
 * nothing was placed, so the readout can say why. Each rib carries `triRange`,
 * its vertex range into `triangles`, so the UI can remove one brace by itself.
 */
export function buildSwayBraces(topo, result, rot, opts = {}) {
  // `ribs` is always an array, even when nothing was placed: callers map over it
  // to build their own records, and an undefined here threw on the first part too
  // short to brace.
  const none = (reason) => ({ triangles: [], count: 0, tines: 0, skipped: 0, ribs: [], reason });
  const partTris = printTriangles(topo, rot, result.offset);
  let partTop = 0;
  for (let i = 2; i < partTris.length; i += 3) if (partTris[i] > partTop) partTop = partTris[i];
  if (partTop < SWAY.minPartH) return none(`the part is only ${partTop.toFixed(0)}mm tall, too short to sway`);

  const cut = leanCut();
  const cands = findWallPatches(topo, rot, result.offset)
    .filter((p) => Math.abs(p.n.z) <= cut
      && p.z1 - Math.max(0, p.z0) >= SWAY.minFaceH
      && p.z1 >= SWAY.minTopFrac * partTop)
    .map((p) => ({ p, score: (p.z1 - Math.max(0, p.z0)) * (p.u1 - p.u0), bearing: Math.atan2(p.n.y, p.n.x) }))
    .sort((a, b) => b.score - a.score);
  if (!cands.length) return none('no upright side is tall and flat enough to brace in this pose');

  const sep = (SWAY.minBearingSep * Math.PI) / 180;
  const angGap = (a, b) => { const d = Math.abs(a - b) % (2 * Math.PI); return Math.min(d, 2 * Math.PI - d); };
  const faces = [];
  for (const c of cands) {
    if (faces.length >= SWAY.maxFaces) break;
    if (faces.some((f) => angGap(f.bearing, c.bearing) < sep)) continue;
    faces.push(c);
  }

  // Auto has usually placed props and wedges before this runs, and a rib that
  // merges with one of them is a support that no longer breaks away in pieces.
  const { walls } = avoidance(opts.avoid);
  const ribs = [];
  const out = [];
  let tines = 0, skipped = 0;
  for (const { p } of faces) {
    for (const u of columnsFor(p)) {
      let placed = null;
      for (const du of SWAY.nudges) {
        const uc = u + du;
        if (uc < p.u0 || uc > p.u1) continue;
        const r = buildSwayRib(p, uc, partTris, topo, rot, result.offset, opts);
        if (r.ok && !clashes(r, ribs) && !swayClashesWall(r, walls)) { placed = r; break; }
      }
      if (!placed) { skipped++; continue; }
      ribs.push(placed);
      placed.triRange = [out.length, out.length + placed.tris.length];
      for (const v of placed.tris) out.push(v);
      tines += placed.tines;
    }
  }
  return {
    triangles: out, count: ribs.length, tines, skipped, ribs,
    reason: ribs.length ? null : 'the upright sides are blocked by other parts of the model in this pose',
  };
}

// Patches per pose, so a click in Draw doesn't re-run the face search.
const patchCache = new WeakMap();
function patchesFor(topo, rot, offset) {
  const key = `${Array.from(rot).join(',')}|${offset.x},${offset.y},${offset.z}`;
  const hit = patchCache.get(topo);
  if (hit && hit.key === key) return hit;
  const patches = findWallPatches(topo, rot, offset);
  const byFace = new Map();
  for (const p of patches) for (const f of p.faces) if (!byFace.has(f)) byFace.set(f, p);
  const partTris = printTriangles(topo, rot, offset);
  const entry = { key, patches, byFace, partTris };
  patchCache.set(topo, entry);
  return entry;
}

/** Is this face (by index) upright enough, in this pose, to take a sway brace? */
export function faceIsUpright(topo, rot, faceIndex) {
  const i = faceIndex * 3;
  const x = topo.nrm[i], y = topo.nrm[i + 1], z = topo.nrm[i + 2];
  const nz = rot[2] * x + rot[5] * y + rot[8] * z;
  return Math.abs(nz) <= leanCut();
}

/**
 * DRAW: a sway brace on the face the user clicked, at the spot they clicked.
 * `point` is in print space. `avoid` is the braces already standing (each a
 * buildSwayRib result); the new one may shift a few mm to clear them, and is
 * refused -- with that reason -- if it can't. Returns buildSwayRib's result.
 */
export function swayAtFace(topo, result, rot, faceIndex, point, opts = {}, avoid = []) {
  const { byFace, partTris } = patchesFor(topo, rot, result.offset);
  const p = byFace.get(faceIndex);
  if (!p) return { ok: false, reason: 'that face is too small or curved to stand a brace against' };
  const u = point[0] * p.u.x + point[1] * p.u.y;
  const { braces, walls } = avoidance(avoid);
  let last = null, hitBrace = false, hitWall = false;
  for (const du of [0, 2, -2, 4, -4]) {
    const uc = Math.max(p.u0, Math.min(p.u1, u + du));
    const r = buildSwayRib(p, uc, partTris, topo, rot, result.offset, opts);
    if (r.ok && swayClashes(r, braces)) { hitBrace = true; continue; }
    if (r.ok && swayClashesWall(r, walls)) { hitWall = true; continue; }
    if (r.ok) return r;
    last = r;
  }
  if (hitBrace) {
    return { ok: false, reason: 'it would run into another brace (on the facing wall, or right beside it) '
      + '— click a spot staggered from it' };
  }
  if (hitWall) {
    return { ok: false, reason: 'a support already stands there, and the two would fuse into one piece '
      + '— click a spot clear of it' };
  }
  return last;
}
