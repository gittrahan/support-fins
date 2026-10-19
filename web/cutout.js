/**
 * WALL CUTOUTS (issue #34) -- holes through a breakaway wall to save filament.
 *
 * prop/sweep.js sweeps each wall as per-station cross-sections and hands them here;
 * cutWall either emits the wall with holes or returns false, and the caller
 * emits it solid as before. Everything is in the wall's own (s, z) plane: s runs
 * along the wall, z up. The pattern choice lives here (CUT.pattern), set by the
 * page and carried to the Worker in opts.tunables (fins.js applyTunables).
 */
import { ribbon, boxExtrude } from './solids.js';

// Issue #34: a wall only has to carry the part along its TOP and stand on its
// FOOT, so the middle of a tall wall can be opened up to save filament. The
// holes are shaped so the wall still prints with no support of its own: every
// edge that roofs a hole climbs at CUT.slope (~55deg from horizontal) or
// steeper, so no layer ever bridges open air. That rules out circles, flat-topped
// hexagons and slots with flat tops, and leaves the shapes below (the honeycomb's
// hexagons stand on a corner, stretched until their roofs are that steep).
//
// A cut wall is still built the repo's way: overlapping closed solids that the
// slicer unions. A solid TOP BAND (the breakaway tip + a rail under it, so the
// contact line and the tine comb are untouched), a solid BOTTOM BAND (the
// flange or floor taper + a rail), a solid END POST at each end, and between
// the posts a row of cells, each a rectangle of wall with one hole (or a
// vertical stack of them) cut out of it. A cell whose hole wouldn't fit stays
// solid, so a low or short wall comes out exactly as it did before.
export const CUT = {
  pattern: 'none',  // which holes to cut: 'none' or one of CUTOUT_PATTERNS
  pitch: 8.0,     // target cell width along the wall, mm (one hole per cell)
  web: 1.6,       // solid left between neighbouring holes, mm -- the strut width
  rail: 1.2,      // solid kept above the bottom taper and below the top tip, mm
  post: 2.0,      // solid end post at each end of the wall, mm
  minHalf: 1.2,   // narrowest hole worth cutting (half-width), mm
  minHole: 3.0,   // shortest hole worth cutting, mm
  slope: 1.4,     // a hole's roof rises >= slope per unit across (~55deg): no bridging
  maxSlope: 3.0,  // a hole taller than this (x half-width) is stacked into several
  eps: 0.05,      // overlap into the neighbouring solid so the union is clean
  // LATTICE: small diamonds in staggered rows filling the whole wall between the
  // bands -- a truss of crossing diagonal struts rather than a row of big holes.
  latPitch: 6.0,  // centre-to-centre along a row, mm
  latStrut: 1.2,  // strut width, measured square to the strut, mm
  latSlope: 1.5,  // strut rise per unit across (~56deg), steeper than `slope`
  roofMin: 1.0,   // a clipped lattice hole's roof may be as flat as 45deg, no flatter
  minArea: 3.0,   // smallest lattice hole worth cutting, mm2
  // HONEYCOMB: hexagons stood on a corner in staggered rows, the solid left an even
  // strut between every pair -- the lattice's diagonals plus short VERTICAL struts
  // between neighbours in a row (each under the next row's hexagon, so the load
  // still zig-zags down: whether that is stiffer is the cutout coupon's question).
  hexPitch: 6.0,  // centre-to-centre along a row, mm
  hexStrut: 1.2,  // strut width, measured square to the strut, mm
  hexSlope: 1.4,  // roof rise per unit across (~55deg); 1/sqrt(3) is a regular hexagon,
                  // whose 30deg roofs the cutout coupon's HEX30 ledge prints -- below
                  // roofMin it is honoured as set, so only the coupon ever sets it
  minSaved: 0.10, // a wall whose holes open less of its face than this stays solid
};

/**
 * The hole shapes, as their LEFT boundary from bottom to top: [half-width, z]
 * with z as a fraction of the hole's height. The right side mirrors it. Each
 * shape's roof slopes at least CUT.slope, which `holeFits` enforces by making
 * the hole tall enough for its width.
 *   diamond  -- the lattice look; roof and floor both slope
 *   triangle -- flat floor, pointed roof (a truss)
 *   arch     -- a slot with a pointed, gothic roof; the most open of the three
 * plus 'lattice' and 'honeycomb' (latticeHoles, honeycombHoles), which aren't one
 * hole per cell.
 */
const HOLES = {
  diamond:  { prof: [[0, 0], [1, 0.5], [0, 1]], roof: 0.5 },
  triangle: { prof: [[1, 0], [0, 1]], roof: 1 },
  arch:     { prof: [[1, 0], [1, null], [0, 1]], roof: null },   // null: set by slope
};
export const CUTOUT_PATTERNS = ['none', ...Object.keys(HOLES), 'lattice', 'honeycomb'];

/**
 * The holes that fit a cell `w` wide and `H` tall, as [{a, z0, z1}] (half-width,
 * bottom, top), or [] when none does. Tall cells stack holes with a `web` between
 * them rather than stretching one into a long thin slit.
 */
export function holesFor(kind, w, H) {
  const shape = HOLES[kind];
  let a = (w - CUT.web) / 2;
  if (!shape || a < CUT.minHalf || H < CUT.minHole) return [];
  // The part of the hole height that is roof, per unit of it: the roof must rise
  // slope*a over that share, so the hole needs at least slope*a/roof of height.
  // The arch's straight sides take up whatever height is left over.
  const roof = shape.roof ?? 0;
  const minH = (h) => roof ? CUT.slope * h / roof : CUT.slope * h + CUT.minHole / 2;
  const maxH = (h) => Math.max(minH(h), 2 * CUT.maxSlope * h);
  let n = Math.max(1, Math.ceil((H + CUT.web) / (maxH(a) + CUT.web)));
  let hh = (H - (n - 1) * CUT.web) / n;
  if (hh < minH(a) && n > 1) {         // stacking made them squat: one fewer, full width
    n--; hh = (H - (n - 1) * CUT.web) / n;   // (a bit over maxH -- only a steeper roof)
  } else if (hh < minH(a)) {           // a lone hole too squat for its width: narrow it
    a = roof ? hh * roof / CUT.slope : (hh - CUT.minHole / 2) / CUT.slope;
    if (a < CUT.minHalf) return [];
  }
  const holes = [];
  for (let j = 0; j < n; j++) {
    const z0 = j * (hh + CUT.web);
    holes.push({ a, z0, z1: z0 + hh });
  }
  return holes;
}

/**
 * The per-cell pattern's hole(s) for one cell, as convex CCW polygons in (s, z):
 * up the right side, back down the left (a pointed tip appears once).
 */
function cellHoles(kind, s0, s1, lo, holes) {
  const sm = (s0 + s1) / 2;
  return holes.map(({ a, z0, z1 }) => {
    const b0 = lo + z0, b1 = lo + z1;
    const prof = HOLES[kind].prof.map(([f, t]) =>
      [f * a, t === null ? b1 - CUT.slope * a : b0 + t * (b1 - b0)]);
    const poly = [...prof.map(([w, z]) => [sm + w, z]),
                  ...prof.slice().reverse().map(([w, z]) => [sm - w, z])];
    return poly.filter((v, i) => {
      const u = poly[(i + 1) % poly.length];
      return Math.abs(u[0] - v[0]) > 1e-9 || Math.abs(u[1] - v[1]) > 1e-9;
    });
  });
}

/** Clip a convex CCW polygon to the half-plane f(v) >= 0 (f linear). */
function clipPoly(poly, f) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const A = poly[i], B = poly[(i + 1) % poly.length];
    const fa = f(A), fb = f(B);
    if (fa >= 0) out.push(A);
    if ((fa >= 0) !== (fb >= 0)) {
      const t = fa / (fa - fb);
      out.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t]);
    }
  }
  return out;
}

const polyArea = (P) => {
  let A = 0;
  for (let i = 0; i < P.length; i++) {
    const [x0, y0] = P[i], [x1, y1] = P[(i + 1) % P.length];
    A += x0 * y1 - x1 * y0;
  }
  return A / 2;
};

/** Does every ROOF edge (solid above it) rise at least `k` per unit across? */
function roofsOk(P, k) {
  for (let i = 0; i < P.length; i++) {
    const [x0, z0] = P[i], [x1, z1] = P[(i + 1) % P.length];
    const dx = x1 - x0, dz = z1 - z0;
    // CCW: the hole is on the left, so an edge running LEFTWARD has the hole below
    // it and solid above -- a roof.
    if (dx < -1e-9 && Math.abs(dz) < k * -dx - 1e-9) return false;
  }
  return true;
}

/**
 * The clip shared by the patterns that tile the whole zone (lattice, honeycomb):
 * a function taking a convex CCW hole and returning it fitted to the zone's real
 * outline, or null when no useful hole is left. Roofs the clip leaves flatter than
 * `roofMin` are cut back to it.
 */
function zoneFit(s, zLo, zHi, sA, sB, roofMin) {
  // the zone's edges as half-planes, one per station segment (convex clip is
  // conservative where the outline bends: the hole only ever gets smaller)
  const segs = [];
  for (let i = 0; i + 1 < s.length; i++) {
    if (s[i + 1] <= sA || s[i] >= sB || s[i + 1] - s[i] < 1e-9) continue;
    segs.push(i);
  }
  const line = (zs, i) => (v) => zs[i] + (zs[i + 1] - zs[i]) * (v[0] - s[i]) / (s[i + 1] - s[i]);
  const fit = (poly) => {
    let P = clipPoly(poly, (v) => v[0] - sA);
    P = clipPoly(P, (v) => sB - v[0]);
    for (const i of segs) {
      const [lo, hi] = [s[i], s[i + 1]];
      // a segment only bounds the hole over its own stretch of the wall
      if (!P.some((v) => v[0] > lo - 1e-9) || !P.some((v) => v[0] < hi + 1e-9)) continue;
      const top = line(zHi, i), bot = line(zLo, i);
      P = clipPoly(P, (v) => top(v) - v[1]);
      P = clipPoly(P, (v) => v[1] - bot(v));
      if (P.length < 3) return null;
    }
    // A roof clipped to a zone edge flatter than roofMin would be a bridge. Rather
    // than give the hole up, drop that roof to exactly roofMin from its HIGH
    // corner: the hole keeps its reach along the slope with a printable roof.
    for (let pass = 0; pass < 4 && P.length >= 3 && !roofsOk(P, roofMin); pass++) {
      for (let n = 0; n < P.length; n++) {
        const A = P[n], B = P[(n + 1) % P.length];
        const dx = B[0] - A[0], dz = B[1] - A[1];
        if (!(dx < -1e-9 && Math.abs(dz) < roofMin * -dx - 1e-9)) continue;
        if (Math.abs(dz) < 0.25 * -dx) {
          // a near-level roof: peak it in the middle, a gable rather than a lean-to
          const M = [(A[0] + B[0]) / 2, Math.min(A[1], B[1])];
          P = clipPoly(P, (v) => M[1] - roofMin * (v[0] - M[0]) - v[1]);
          P = clipPoly(P, (v) => M[1] + roofMin * (v[0] - M[0]) - v[1]);
        } else {
          const [H, Lo] = A[1] >= B[1] ? [A, B] : [B, A];
          const d = Math.sign(Lo[0] - H[0]);
          P = clipPoly(P, (v) => H[1] - roofMin * (v[0] - H[0]) * d - v[1]);
        }
        break;
      }
    }
    if (P.length < 3 || polyArea(P) < CUT.minArea || !roofsOk(P, roofMin)) return null;
    // Too thin to be a hole: a sliver clipped along the zone's edge has room
    // lengthwise but none across. 2*area/perimeter is the inradius of a triangle
    // and a fair stand-in for any convex shape's half-thickness.
    let per = 0;
    for (let n = 0; n < P.length; n++) {
      const u = P[n], v = P[(n + 1) % P.length];
      per += Math.hypot(v[0] - u[0], v[1] - u[1]);
    }
    if (2 * polyArea(P) / per < CUT.minHalf / 1.5) return null;
    return P;
  };
  return fit;
}

/** Where the zone's holes start and stop: its lowest floor and highest top. */
function zoneSpan(s, zLo, zHi, sA, sB) {
  return [Math.min(...zLo.filter((_, i) => s[i] >= sA && s[i] <= sB)),
          Math.max(...zHi.filter((_, i) => s[i] >= sA && s[i] <= sB))];
}

/**
 * LATTICE: diamonds in staggered rows over the whole hole zone, the solid left
 * between them a truss of diagonal struts. The zone is the wall's REAL outline
 * (under the top rail, over the foot rail, between the end posts), so on a
 * triangular fin the lattice runs right up the slope instead of stopping at
 * the first cell that is short at one end.
 *
 * At the edges each diamond is clipped to the zone, and kept if every roof it
 * ends up with still rises at CUT.roofMin (45deg) -- a slope as steep as that
 * becomes a hole's roof, so a fin under a 45deg face gets triangles hugging it.
 * A flatter edge would leave a bridge, so there the diamond is shrunk instead
 * until it fits whole. Anything smaller than a useful hole is left solid.
 */
function latticeHoles(s, zLo, zHi, sA, sB) {
  const k = CUT.latSlope, p = CUT.latPitch;
  const inset = CUT.latStrut / 2 / (k / Math.hypot(1, k));   // strut half-width, measured flat
  const a = p / 2 - inset, b = k * a;
  if (a < CUT.minHalf) return [];
  const fit = zoneFit(s, zLo, zHi, sA, sB, CUT.roofMin);
  const [z0, zTop] = zoneSpan(s, zLo, zHi, sA, sB);
  const cols = Math.ceil((sB - sA) / p) + 1;
  const holes = [];
  for (let j = 0; z0 + j * (k * p / 2) - b <= zTop; j++) {
    const zc = z0 + b * 0.5 + j * (k * p / 2);
    for (let i = -1; i <= cols; i++) {
      const sm = sA + CUT.latStrut / 2 + a + i * p + (j % 2 ? p / 2 : 0);
      if (sm + a < sA || sm - a > sB) continue;
      for (const f of [1, 0.8, 0.62, 0.46, 0.34]) {
        const P = fit([[sm, zc - b * f], [sm + a * f, zc], [sm, zc + b * f], [sm - a * f, zc]]);
        if (P) { holes.push(P); break; }
      }
    }
  }
  return holes;
}

/**
 * HONEYCOMB: hexagons stood on a corner, in staggered rows, fitted to the zone as
 * the lattice's diamonds are. Each has vertical sides `h` tall and a pointed roof
 * and floor rising CUT.hexSlope per unit across; `h` is the roof edge's length, so
 * at a slope of 1/sqrt(3) it is a regular hexagon and steeper it is one stretched
 * upright. Neighbours in a row leave a vertical strut CUT.hexStrut wide; the next
 * row sits in the notches, its floors CUT.hexStrut square to the roofs below.
 */
export function honeycombHoles(s, zLo, zHi, sA, sB) {
  const k = CUT.hexSlope, p = CUT.hexPitch, t = CUT.hexStrut;
  const a = (p - t) / 2, r = k * a, h = a * Math.hypot(1, k);
  if (a < CUT.minHalf) return [];
  // row to row: the floor above runs parallel to the roof below, t apart square to it
  const dz = h + k * (p / 2 - t) + t * Math.hypot(1, k);
  const fit = zoneFit(s, zLo, zHi, sA, sB, Math.min(CUT.roofMin, k));
  const [z0, zTop] = zoneSpan(s, zLo, zHi, sA, sB);
  const half = h / 2 + r;                              // centre to tip
  const cols = Math.ceil((sB - sA) / p) + 1;
  const holes = [];
  for (let j = 0; z0 + half * 0.5 + j * dz - half <= zTop; j++) {
    const zc = z0 + half * 0.5 + j * dz;
    for (let i = -1; i <= cols; i++) {
      const sm = sA + t / 2 + a + i * p + (j % 2 ? p / 2 : 0);
      if (sm + a < sA || sm - a > sB) continue;
      for (const f of [1, 0.8, 0.62, 0.46, 0.34]) {
        const P = fit([[sm, zc - half * f], [sm + a * f, zc - h / 2 * f], [sm + a * f, zc + h / 2 * f],
                       [sm, zc + half * f], [sm - a * f, zc + h / 2 * f], [sm - a * f, zc - h / 2 * f]]);
        if (P) { holes.push(P); break; }
      }
    }
  }
  return holes;
}

/** A convex polygon's extent [left, right] at height z, or null if it misses. */
function spanAt(P, z) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < P.length; i++) {
    const [x0, z0] = P[i], [x1, z1] = P[(i + 1) % P.length];
    if ((z0 - z) * (z1 - z) > 0) continue;
    if (Math.abs(z1 - z0) < 1e-12) { lo = Math.min(lo, x0, x1); hi = Math.max(hi, x0, x1); continue; }
    const x = x0 + (x1 - x0) * (z - z0) / (z1 - z0);
    lo = Math.min(lo, x); hi = Math.max(hi, x);
  }
  return lo <= hi ? [lo, hi] : null;
}

/**
 * The solid of the strip [s0,s1] x [zb,zt] minus `obst` (convex polygons: the
 * holes, plus the regions above the zone's top edge and below its bottom edge),
 * as convex CCW polygons in (s, z). The strip is cut into horizontal slabs at
 * every obstacle corner and wherever an obstacle edge crosses the strip's side;
 * inside a slab every obstacle edge is one straight line, so the solid is a run
 * of trapezoids between neighbouring obstacles -- always convex.
 */
function stripSolid(s0, s1, zb, zt, obst) {
  const os = obst.filter((P) => P.some((v) => v[0] > s0) && P.some((v) => v[0] < s1)
    && P.some((v) => v[1] > zb) && P.some((v) => v[1] < zt));
  const zs = [zb, zt];
  for (const P of os) {
    for (let i = 0; i < P.length; i++) {
      const [x0, z0] = P[i], [x1, z1] = P[(i + 1) % P.length];
      zs.push(z0);
      for (const side of [s0, s1]) {
        const t = (side - x0) / (x1 - x0);
        if (x1 !== x0 && t > 0 && t < 1) zs.push(z0 + t * (z1 - z0));
      }
    }
  }
  const cuts = [...new Set(zs.filter((z) => z >= zb && z <= zt).map((z) => +z.toFixed(9)))]
    .sort((u, v) => u - v);
  const clampS = (x) => Math.max(s0, Math.min(s1, x));
  const polys = [];
  for (let n = 0; n + 1 < cuts.length; n++) {
    const za = cuts[n], zc = cuts[n + 1];
    if (zc - za < 1e-7) continue;
    const zm = (za + zc) / 2;
    const act = [];
    for (const P of os) {
      const m = spanAt(P, zm);
      if (m && m[1] > s0 && m[0] < s1) act.push(P);
    }
    act.sort((u, v) => spanAt(u, zm)[0] - spanAt(v, zm)[0]);
    // The solid's edges in this slab, as functions of z. Every obstacle edge is
    // straight across the slab, so each is read at two interior heights and
    // extended to the slab's ends -- reading AT an end can fall a rounding hair
    // outside an obstacle's corner and miss it.
    const L = [() => s0], R = [];
    const q1 = za + (zc - za) / 4, q2 = zc - (zc - za) / 4;
    for (const P of act) {
      const m1 = spanAt(P, q1) ?? spanAt(P, zm), m2 = spanAt(P, q2) ?? spanAt(P, zm);
      const lerp = (k) => (z) => clampS(m1[k] + (m2[k] - m1[k]) * (z - q1) / (q2 - q1));
      R.push(lerp(0));
      L.push(lerp(1));
    }
    R.push(() => s1);
    for (let g = 0; g < L.length; g++) {
      const q = [[L[g](za), za], [R[g](za), za], [R[g](zc), zc], [L[g](zc), zc]];
      const w0 = q[1][0] - q[0][0], w1 = q[2][0] - q[3][0];
      if (w0 < 1e-7 && w1 < 1e-7) continue;
      // a zero-width end (a hole's tip) makes the piece a triangle
      polys.push(w0 < 1e-7 ? [q[0], q[2], q[3]] : w1 < 1e-7 ? [q[0], q[1], q[2]] : q);
    }
  }
  return polys;
}

/**
 * Emit `st` (per-station wall data from sweep / sweepBetween) as a wall with
 * CUT.pattern holes, or return false to have the caller emit its solid ribbon.
 * `full` is the caller's solid sections, reused for the end posts; `wall` the
 * wall's own numbers (prop/config.js PROP: th, tip, minStations).
 */
export function cutWall(st, full, out, wall) {
  const kind = CUT.pattern;
  if (!CUTOUT_PATTERNS.includes(kind) || kind === 'none' || st.length < wall.minStations) return false;
  // arclength of each station along the wall, in XY
  const s = [0];
  for (let i = 1; i < st.length; i++) {
    s.push(s[i - 1] + Math.hypot(st[i].p[0] - st[i - 1].p[0], st[i].p[1] - st[i - 1].p[1]));
  }
  const L = s[s.length - 1];
  const nCells = Math.floor((L - 2 * CUT.post) / CUT.pitch);
  if (nCells < 1) return false;
  // Cells: strips between stations about CUT.pitch wide, snapped to stations so
  // each strip's edges sit on real cross-sections. The one-hole-per-cell
  // patterns put their hole in each; for every pattern they are also the strips
  // the solid is built in.
  const snap = (x) => {
    let best = 0;
    for (let i = 1; i < s.length; i++) if (Math.abs(s[i] - x) < Math.abs(s[best] - x)) best = i;
    return best;
  };
  // The cells share the length between the two end posts evenly, so the posts
  // stay CUT.post wide instead of soaking up the remainder.
  const edges = [];
  for (let c = 0; c <= nCells; c++) {
    const i = snap(CUT.post + c * (L - 2 * CUT.post) / nCells);
    if (!edges.length || i > edges[edges.length - 1]) edges.push(i);
  }
  if (edges.length < 2) return false;
  // The hole zone at each station: under the top rail, over the foot rail. Where
  // the wall is too short for any zone the two meet in the middle.
  const zHi = [], zLo = [];
  for (const q of st) {
    // under a flat interface crest ztip is the crest's cut; the holes still stop
    // where the wall's taper began (holeTop), so the crest takes no plastic from them
    const hi = (q.holeTop ?? q.ztip) - CUT.rail, lo = q.botTip + CUT.rail;
    const m = (hi + lo) / 2;
    zHi.push(hi > lo ? hi : m);
    zLo.push(hi > lo ? lo : m);
  }
  const sA = s[edges[0]], sB = s[edges[edges.length - 1]];
  let holes;
  if (kind === 'lattice') {
    holes = latticeHoles(s, zLo, zHi, sA, sB);
  } else if (kind === 'honeycomb') {
    holes = honeycombHoles(s, zLo, zHi, sA, sB);
  } else {
    holes = [];
    for (let c = 0; c + 1 < edges.length; c++) {
      const i0 = edges[c], i1 = edges[c + 1];
      let hi = Infinity, lo = -Infinity;
      for (let i = i0; i <= i1; i++) { hi = Math.min(hi, zHi[i]); lo = Math.max(lo, zLo[i]); }
      holes.push(...cellHoles(kind, s[i0], s[i1], lo, holesFor(kind, s[i1] - s[i0], hi - lo)));
    }
  }
  if (!holes.length) return false;
  // Not worth it for a hole or two: a wall whose holes would take out less than
  // CUT.minSaved of its face stays solid -- the extra pieces cost triangles and
  // overlap for next to no plastic saved.
  let face = 0, open = 0;
  for (let i = 0; i + 1 < st.length; i++) {
    face += (s[i + 1] - s[i]) * ((st[i].top - st[i].bot) + (st[i + 1].top - st[i + 1].bot)) / 2;
  }
  for (const H of holes) open += polyArea(H);
  if (open < CUT.minSaved * face) return false;

  // Bands: the top band reaches down to the zone's top edge, the bottom band up
  // to its bottom edge, station by station.
  const th = wall.th / 2, tp = wall.tip / 2;
  // Only between the end posts: the posts are solid full height already, and a
  // band running on under them would just be plastic counted twice.
  const top = [], bot = [];
  for (let i = edges[0]; i <= edges[edges.length - 1]; i++) {
    const q = st[i];
    const P = (o, z) => [q.p[0] + q.sx * o, q.p[1] + q.sy * o, z];
    // keep each band inside the wall's own profile. Where the zone has closed up
    // the bands would meet flush at its middle (issue #223), so they overlap there.
    const shut = zHi[i] - zLo[i] < 1e-9 ? CUT.eps / 2 : 0;
    const ct = Math.max(q.botTip, Math.min(zHi[i] - shut, q.ztip - 0.01));
    const cb = Math.min(q.ztip, Math.max(zLo[i] + shut, q.botTip + 0.01));
    const tq = q.tipHalf ?? tp;                 // narrower when an interface crest sits on it
    const w = q.sh ?? th;                       // the station's body: narrower on a low wide wall (044)
    top.push([P(+w, ct), P(+w, q.ztip), P(+tq, q.top),
              P(-tq, q.top), P(-w, q.ztip), P(-w, ct)]);
    bot.push(q.taperBot
      ? [P(+tp, q.bot), P(+w, q.botTip), P(+w, cb), P(-w, cb), P(-w, q.botTip), P(-tp, q.bot)]
      : [P(+w, q.botP ?? q.bot), P(+w, cb), P(-w, cb), P(-w, q.botN ?? q.bot)]);  // a tilted lifted bottom (sweepBetween)
  }
  // Against an end post a band starts 2 * CUT.eps inside it, on the line of its
  // first segment (same surface): ending at the post's own cap, it shared the
  // cap's tip edges -- flush, four faces to an edge (issue #223). Twice eps, past
  // the strips' own reach into the post (0.4-0.6 eps), so a band corner never
  // lands on one of theirs.
  const into = (k, k2) => {
    const f = 2 * CUT.eps / Math.max(1e-9, Math.abs(s[edges[k]] - s[edges[k] + k2]));
    for (const band of [top, bot]) {
      const j = k === 0 ? 0 : band.length - 1, n = j + k2;
      band[j] = band[j].map((v, m) => v.map((c, d) => c + (c - band[n][m][d]) * f));
    }
  };
  if (top.length > 1 && edges[0] > 0) into(0, 1);
  if (top.length > 1 && edges[edges.length - 1] < st.length - 1) into(edges.length - 1, -1);
  ribbon(top, out);
  ribbon(bot, out);
  // End posts: the caller's full sections outside the cut span, so the wall's
  // ends stay solid pillars.
  if (edges[0] > 0) ribbon(full.slice(0, edges[0] + 1), out);
  if (edges[edges.length - 1] < st.length - 1) ribbon(full.slice(edges[edges.length - 1]), out);

  // The strips: zone minus holes, mapped from (s, z) onto the wall. Across-wall
  // direction and XY position are interpolated between stations, so a gently
  // curved auto wall is followed as closely as the ribbon follows it.
  const at = (x) => {
    let i = 0;
    while (i < s.length - 2 && s[i + 1] < x) i++;
    const t = Math.max(-1, Math.min(2, (x - s[i]) / Math.max(1e-9, s[i + 1] - s[i])));
    const A = st[i], B = st[i + 1];
    const lerp = (u, v) => u + (v - u) * t;
    let sx = lerp(A.sx, B.sx), sy = lerp(A.sy, B.sy);
    const n = Math.hypot(sx, sy); sx /= n; sy /= n;
    return { x: lerp(A.p[0], B.p[0]), y: lerp(A.p[1], B.p[1]), sx, sy };
  };
  const e = CUT.eps;
  const zMin = Math.min(...zLo) - 1, zMax = Math.max(...zHi) + 1;
  // Beyond the zone's top and bottom edges, per station segment: obstacles like
  // the holes, pushed eps INTO the bands so the strips overlap them.
  const beyond = [];
  for (let i = edges[0]; i < edges[edges.length - 1]; i++) {
    if (s[i + 1] - s[i] < 1e-9) continue;
    beyond.push([[s[i], zHi[i] + e], [s[i + 1], zHi[i + 1] + e], [s[i + 1], zMax + 1], [s[i], zMax + 1]]);
    beyond.push([[s[i], zMin - 1], [s[i + 1], zMin - 1], [s[i + 1], zLo[i + 1] - e], [s[i], zLo[i] - e]]);
  }
  const obst = [...holes, ...beyond];
  // A strip's pieces tile it exactly: left as they are they meet FLUSH -- at every
  // slab cut, across every strip side, corner to corner at a hole's tip -- and
  // share the edges a slicer welds, four or six faces to an edge, which it reports
  // as non-manifold (issue #223). So every edge of a piece moves outward by
  // 0.4-0.6 e, and the piece is the region inside the moved edges -- an
  // intersection of half-planes, so still convex -- overlapping each neighbour by
  // about e across every shared boundary. Each piece takes its own distance in
  // that range (a fixed golden-ratio step, so the build stays deterministic): with
  // one distance for all, two pieces e apart (a slab e tall is common -- the
  // zone's edges sit e from the bands) grew into it and met flush in the middle.
  // A hole within reach stays out: the piece and the hole are disjoint and convex,
  // so one of their edges separates them, and the grown piece is clipped to that
  // line (a hole's own edge stays exactly where it was).
  const side = (A, B, V) => (B[0] - A[0]) * (V[1] - A[1]) - (B[1] - A[1]) * (V[0] - A[0]);
  // V outside A->B (on its right; holes and pieces are CCW), to within a micron so
  // shapes that touch along an edge or at a corner count; a lattice hole can
  // repeat a corner, and a zero-length edge separates nothing
  const outside = (A, B, V) => {
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
    return len > 1e-9 && side(A, B, V) <= 1e-6 * len;
  };
  let pieces = 0;
  const grow = (poly) => {
    const g = e * (0.4 + 0.2 * ((++pieces * 0.6180339887498949) % 1));
    let lo0 = Infinity, lo1 = Infinity, hi0 = -Infinity, hi1 = -Infinity;
    for (const [u, v] of poly) { lo0 = Math.min(lo0, u); hi0 = Math.max(hi0, u); lo1 = Math.min(lo1, v); hi1 = Math.max(hi1, v); }
    // the box a piece may grow into: g past its own extent, no further (a sharp
    // corner's moved edges would otherwise meet far out)
    let G = [[lo0 - g, lo1 - g], [hi0 + g, lo1 - g], [hi0 + g, hi1 + g], [lo0 - g, hi1 + g]];
    const keep = (A, B, d) => {             // the piece's side of A->B's line, moved out by d
      const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
      if (len >= 1e-9) G = clipPoly(G, (V) => side(A, B, V) / len + d);
    };
    for (let n = 0; n < poly.length; n++) keep(poly[n], poly[(n + 1) % poly.length], g);
    for (const H of holes) {
      if (G.length < 3) break;
      const near = H.some((V, n) => {
        const W = H[(n + 1) % H.length];
        return Math.max(V[0], W[0]) >= lo0 - e && Math.min(V[0], W[0]) <= hi0 + e
            && Math.max(V[1], W[1]) >= lo1 - e && Math.min(V[1], W[1]) <= hi1 + e;
      });
      if (!near) continue;
      // a hole edge with the whole piece outside it, or else a piece edge with the
      // whole hole outside it (that edge then stays put)
      let cut = null;
      for (let n = 0; n < H.length && !cut; n++) {
        const A = H[n], B = H[(n + 1) % H.length];
        if (poly.every((V) => outside(A, B, V))) cut = [B, A];
      }
      for (let n = 0; n < poly.length && !cut; n++) {
        const A = poly[n], B = poly[(n + 1) % poly.length];
        if (H.every((V) => outside(A, B, V))) cut = [A, B];
      }
      // nothing separates them only if the piece already overlaps the hole: then
      // it doesn't grow at all, rather than grow further in
      if (!cut) return poly;
      keep(cut[0], cut[1], 0);
    }
    return G;
  };
  const P = (u, v, o) => { const f = at(u); return [f.x + f.sx * o, f.y + f.sy * o, v]; };
  for (let c = 0; c + 1 < edges.length; c++) {
    const s0 = s[edges[c]], s1 = s[edges[c + 1]];
    let zb = Infinity, zt = -Infinity;
    let sw = th;   // a strip no wider than the narrowest body it spans (044)
    for (let i = edges[c]; i <= edges[c + 1]; i++) {
      zb = Math.min(zb, zLo[i] - e); zt = Math.max(zt, zHi[i] + e); sw = Math.min(sw, st[i].sh ?? th);
    }
    for (const poly of stripSolid(s0, s1, zb, zt, obst)) {
      // corners closer than 0.1 micron are one corner to a slicer, which welds
      // them: left twice, the extrusion has zero-area faces
      const g = grow(poly).filter((V, n, G) => {
        const U = G[(n + 1) % G.length];
        return Math.abs(U[0] - V[0]) > 1e-4 || Math.abs(U[1] - V[1]) > 1e-4;
      });
      if (g.length >= 3) boxExtrude(g, -sw, sw, P, out);
    }
  }
  return true;
}
