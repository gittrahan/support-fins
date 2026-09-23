/**
 * WALL CUTOUTS (issue #34) -- holes through a breakaway wall to save filament.
 *
 * prop.js sweeps each wall as per-station cross-sections and hands them here;
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
// steeper, so no layer ever bridges open air. That rules out circles, hexagons
// and slots with flat tops, and leaves the shapes below.
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
};

/**
 * The hole shapes, as their LEFT boundary from bottom to top: [half-width, z]
 * with z as a fraction of the hole's height. The right side mirrors it. Each
 * shape's roof slopes at least CUT.slope, which `holeFits` enforces by making
 * the hole tall enough for its width.
 *   diamond  -- the lattice look; roof and floor both slope
 *   triangle -- flat floor, pointed roof (a truss)
 *   arch     -- a slot with a pointed, gothic roof; the most open of the three
 */
const HOLES = {
  diamond:  { prof: [[0, 0], [1, 0.5], [0, 1]], roof: 0.5 },
  triangle: { prof: [[1, 0], [0, 1]], roof: 1 },
  arch:     { prof: [[1, 0], [1, null], [0, 1]], roof: null },   // null: set by slope
};
export const CUTOUT_PATTERNS = ['none', ...Object.keys(HOLES)];

/**
 * The holes that fit a cell `w` wide and `H` tall, as [{a, z0, z1}] (half-width,
 * bottom, top), or [] when none does. Tall cells stack holes with a `web` between
 * them rather than stretching one into a long thin slit.
 */
function holesFor(kind, w, H) {
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
  if (hh < minH(a)) {                  // too squat for its width: narrow it
    n = 1; hh = H;
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
 * The solid around one hole, as convex polygons in the cell's (s, z) plane,
 * wound CCW. Sliced into horizontal slabs at the hole's vertices: in each slab
 * the solid is one trapezoid left of the hole and one right of it, each with a
 * straight outer side, so every piece is convex however the hole is shaped.
 */
function holeSolid(kind, s0, s1, hole) {
  const sm = (s0 + s1) / 2, { a, z0, z1 } = hole, h = z1 - z0;
  const prof = HOLES[kind].prof.map(([f, t]) =>
    [f * a, t === null ? z1 - CUT.slope * a : z0 + t * h]);
  const polys = [];
  for (let k = 0; k + 1 < prof.length; k++) {
    const [wa, za] = prof[k], [wb, zb] = prof[k + 1];
    polys.push([[s0, za], [sm - wa, za], [sm - wb, zb], [s0, zb]]);   // left
    polys.push([[sm + wa, za], [s1, za], [s1, zb], [sm + wb, zb]]);   // right
  }
  return polys;
}

/**
 * Emit `st` (per-station wall data from sweep / sweepBetween) as a wall with
 * CUT.pattern holes, or return false to have the caller emit its solid ribbon.
 * `full` is the caller's solid sections, reused for the end posts; `wall` the
 * wall's own numbers (prop.js PROP: th, tip, minStations).
 */
export function cutWall(st, full, out, wall) {
  const kind = CUT.pattern;
  if (!HOLES[kind] || st.length < wall.minStations) return false;
  // arclength of each station along the wall, in XY
  const s = [0];
  for (let i = 1; i < st.length; i++) {
    s.push(s[i - 1] + Math.hypot(st[i].p[0] - st[i - 1].p[0], st[i].p[1] - st[i - 1].p[1]));
  }
  const L = s[s.length - 1];
  const use = L - 2 * CUT.post;
  const nCells = Math.floor(use / CUT.pitch);
  if (nCells < 1) return false;
  // Cell edges snap to stations, so each cell's rectangle sits between two real
  // cross-sections and the bands can step their cut height exactly there.
  const snap = (x) => {
    let best = 0;
    for (let i = 1; i < s.length; i++) if (Math.abs(s[i] - x) < Math.abs(s[best] - x)) best = i;
    return best;
  };
  const edges = [];
  const lead = (L - nCells * CUT.pitch) / 2;
  for (let c = 0; c <= nCells; c++) {
    const i = snap(lead + c * CUT.pitch);
    if (!edges.length || i > edges[edges.length - 1]) edges.push(i);
  }
  // Each station's highest band-free z (below the top rail) and lowest (above
  // the bottom rail). A cell's hole has to clear both across its whole width.
  const zHi = st.map((q) => q.ztip - CUT.rail);
  const zLo = st.map((q) => q.botTip + CUT.rail);
  const cells = [];
  for (let c = 0; c + 1 < edges.length; c++) {
    const i0 = edges[c], i1 = edges[c + 1];
    let hi = Infinity, lo = -Infinity;
    for (let i = i0; i <= i1; i++) { hi = Math.min(hi, zHi[i]); lo = Math.max(lo, zLo[i]); }
    // a cell whose hole doesn't fit is kept as a solid block, not dropped, so the
    // bands never have to close over it
    cells.push({ i0, i1, lo, hi, holes: holesFor(kind, s[i1] - s[i0], hi - lo) });
  }
  if (!cells.some((c) => c.holes.length)) return false;

  // Per-station band cuts: the top band reaches down to its cell's hole zone and
  // the bottom band up to it. A station shared by two cells takes the lower top
  // and the higher bottom, so the bands are only ever MORE solid than a cell
  // asks. Stations outside every cell sit inside an end post.
  const cutTop = zHi.slice(), cutBot = zLo.slice();
  for (const c of cells) {
    for (let i = c.i0; i <= c.i1; i++) {
      cutTop[i] = Math.min(cutTop[i], c.hi);
      cutBot[i] = Math.max(cutBot[i], c.lo);
    }
  }
  const th = wall.th / 2, tp = wall.tip / 2;
  const top = [], bot = [];
  for (let i = 0; i < st.length; i++) {
    const q = st[i];
    const P = (o, z) => [q.p[0] + q.sx * o, q.p[1] + q.sy * o, z];
    // keep each band inside the wall's own profile (a short station's cuts can
    // cross; the bands then just overlap)
    const ct = Math.max(q.botTip, Math.min(cutTop[i], q.ztip - 0.01));
    const cb = Math.min(q.ztip, Math.max(cutBot[i], q.botTip + 0.01));
    top.push([P(+th, ct), P(+th, q.ztip), P(+tp, q.top),
              P(-tp, q.top), P(-th, q.ztip), P(-th, ct)]);
    bot.push(q.taperBot
      ? [P(+tp, q.bot), P(+th, q.botTip), P(+th, cb), P(-th, cb), P(-th, q.botTip), P(-tp, q.bot)]
      : [P(+th, q.bot), P(+th, cb), P(-th, cb), P(-th, q.bot)]);
  }
  ribbon(top, out);
  ribbon(bot, out);
  // End posts: the caller's full sections up to the first cut cell and from the
  // last one on, so the wall's ends stay solid pillars.
  const first = cells[0].i0, last = cells[cells.length - 1].i1;
  if (first > 0) ribbon(full.slice(0, first + 1), out);
  if (last < st.length - 1) ribbon(full.slice(last), out);

  // The cells: each hole's surrounding solid, mapped from (s, z) onto the wall.
  // Across-wall direction and XY position are interpolated between stations, so
  // a gently curved auto wall is followed as closely as the ribbon follows it.
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
  for (const c of cells) {
    const s0 = s[c.i0], s1 = s[c.i1];
    // Holes stack from the cell's floor; the leftover height (rounding) goes on top.
    // A cell with no hole is one solid block.
    const polys = [];
    const solidRect = (za, zb) => { if (zb > za) polys.push([[s0, za], [s1, za], [s1, zb], [s0, zb]]); };
    let z = c.lo;
    for (const h of c.holes) {
      const hole = { a: h.a, z0: c.lo + h.z0, z1: c.lo + h.z1 };
      solidRect(z, hole.z0);
      polys.push(...holeSolid(kind, s0, s1, hole));
      z = hole.z1;
    }
    solidRect(z, c.hi);
    for (const poly of polys) {
      // grow the piece by eps wherever it meets the cell's outer edge, so it
      // overlaps the posts / bands / next cell instead of just touching them
      const grown = poly.map(([u, v]) => [
        u === s0 ? u - e : u === s1 ? u + e : u,
        v <= c.lo + 1e-9 ? v - e : v >= c.hi - 1e-9 ? v + e : v]);
      const P = (u, v, o) => { const f = at(u); return [f.x + f.sx * o, f.y + f.sy * o, v]; };
      boxExtrude(grown, -th, th, P, out);
    }
  }
  return true;
}
