/**
 * FULL COVERAGE -- the fill pass (local issue 036; Matthew 2026-10-05: "if we have
 * red overhang we have to have something, somehow"). Runs after Auto's walls,
 * wedges and last resort, in mode 'full' only, so Auto is unchanged.
 *
 * What it aims at is the coverage scoreboard's number: the MUST red (coverage.js
 * classify -- every overhang face but a tiny hole's ceiling and the near-plate
 * strip) that no wall top reaches (coverage.js reachOf). That red is sampled into
 * points, and walls are added one at a time, each built by Draw's builder
 * (draw.js drawnWall -- part-attached, plate, squat fallback, tines: the path a
 * hand-drawn wall takes, which is the reliable one).
 *
 * CONNECTED, like a slicer's support areas. A slicer grows each layer's overhang
 * and merges what touches, so islands a few mm apart share one support; a mini
 * drawn by hand took one long wall top to bottom across several red patches and
 * printed well. So the points are grouped by DISTANCE (FILL.link in plan, and not
 * one above the other), not by region, and a wall's line may cross a gap of up to
 * FILL.bridge between patches -- one longer wall instead of a stub per patch.
 *
 * THE LINE. Not a PCA axis (a square patch's eigenvector snaps to 45deg -- the old
 * auto-placer's diagonal walls): FILL.dirs directions are each slid across the
 * group, and the line that keeps the most red area within reach wins, x or y on a
 * near-tie; the best few are also tried shifted a few mm across themselves, and
 * every direction at its heaviest FILL.narrow band (a hem ring: a line that hugs
 * its edge, not one across the leg inside it). Its ends are the outermost red it
 * serves. When no line across a group builds, it is tried patch by patch around
 * its densest red (FILL.local): an upright figure's group is a hem, both arms and
 * the hands at one height, and every line across all that met the first wall.
 *
 * THE SLIDER. Wide-face coverage (opts.coverage) sets how much gets added, so
 * there is no wall-count field: below FILL.sparseBelow every group gets at most
 * ONE wall ("something" under every red patch); from there up, walls are added
 * until every point is within reach, the reach tightening from
 * maxUnsupportedSpan/2 (6 mm, the scoreboard's held rule) at the middle to
 * FILL.denseReach at the right.
 *
 * GUARDRAILS. A wall is kept only if it holds new red and keeps PROP.sideClear off
 * every support already built (fused walls don't break away) -- from its floor up:
 * a wall on the part (a chin over the chest) has no plate foot to keep clear. FILL.maxWalls,
 * maxTries and maxChecks bound the work -- counts, not a clock, so the output is the same
 * on every machine. Red no wall can reach is returned (`unserved`), never hidden:
 * quality first, surface the dropped overhang.
 */
import { drawnLine, drawnWall, DRAW_MIN_LEN } from '../draw.js';
import { braceWall, footFor, PART_BAND, PROP, surfaceHitsAt } from '../prop.js';
import { classify, reachOf, PLATE_Z, MUST } from './coverage.js';
import { seatedPartTris } from './seating.js';

export const FILL = {
  sample: 1.0,       // mm: leftover red is merged into points this far apart
  link: 12.0,        // mm in plan: points this close are one group (maxUnsupportedSpan)
  narrow: 1.0,       // mm: each direction also tried at its heaviest band this narrow (a hem ring's edge)
  local: 6.0,        // mm: a group no line across builds on is tried patch by patch, this radius...
  localZ: 3.0,       // ...and this far up or down (a hem, a chin, a hand)
  bridge: 8.0,       // mm: a line may cross this much plan gap between red it serves
  dirs: 12,          // line directions tried, 180 / dirs apart
  axisBias: 0.97,    // a diagonal must serve 1/0.97 x an x/y line's red to beat it
  bestDirs: 3,       // directions tried per group, best first...
  shifts: [-2, 2, -4, 4], // ...each also this many mm across itself (off a wall's foot)
  sparseBelow: 0.25, // coverage under this: one wall per group, then stop
  denseReach: 4.0,   // mm: the reach at coverage 1 (the middle is maxUnsupportedSpan/2)
  minGain: 0.5,      // mm2 of new red a wall must hold to be kept
  maxStep: 2.5,      // mm: a line's top may climb or drop this much between stations
  redNear: 1.5,      // mm: a station this close to leftover red counts toward its stretch
  maxWalls: 40,
  maxTries: 120,     // drawnWall calls, kept or not
  groupTries: 12,     // drawnWall calls one group gets before its red is given up on
  maxChecks: 2000,   // line checks (underStretch, then settledStretch; both gridded), built or not
};

/** The reach the slider asks for: R(0.5) = 6 mm (the held rule), R(1) = denseReach. */
export function fillReach(coverage) {
  const r0 = PROP.maxUnsupportedSpan / 2;
  if (coverage <= 0.5) return r0;
  return r0 + (FILL.denseReach - r0) * Math.min(1, (coverage - 0.5) / 0.5);
}

/**
 * Leftover MUST red as points [x, y, z, area], merged into FILL.sample cells. A
 * big CAD triangle is subdivided first (a cube face is two triangles: its
 * centroid alone would call the whole face held or bare).
 */
function leftoverPoints(topo, result, rot, near, cls) {
  const { pos } = topo, off = result.offset;
  const seat = (o) => [rot[0] * pos[o] + rot[3] * pos[o + 1] + rot[6] * pos[o + 2] + off.x,
    rot[1] * pos[o] + rot[4] * pos[o + 1] + rot[7] * pos[o + 2] + off.y,
    rot[2] * pos[o] + rot[5] * pos[o + 1] + rot[8] * pos[o + 2] + off.z];
  const s = FILL.sample, cells = new Map();
  const put = (x, y, z, a) => {
    if (z < PLATE_Z || near(x, y, z)) return;
    const k = `${Math.floor(x / s)},${Math.floor(y / s)},${Math.floor(z / s)}`;
    const c = cells.get(k);
    if (c) { c[0] += x * a; c[1] += y * a; c[2] += z * a; c[3] += a; } else cells.set(k, [x * a, y * a, z * a, a]);
  };
  for (let f = 0; f < topo.nFaces; f++) {
    if (!result.over[f] || cls[f] !== MUST) continue;
    const A = seat(f * 9), B = seat(f * 9 + 3), C = seat(f * 9 + 6);
    const edge = Math.max(Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]),
      Math.hypot(C[0] - B[0], C[1] - B[1], C[2] - B[2]), Math.hypot(A[0] - C[0], A[1] - C[1], A[2] - C[2]));
    const n = Math.max(1, Math.ceil(edge / s));
    const a = topo.area[f] / (n * n);
    // n x n sub-triangles: centroids on the barycentric grid
    for (let i = 0; i < n; i++) for (let j = 0; i + j < n; j++) {
      for (const [u, v] of i + j < n - 1 ? [[i + 1 / 3, j + 1 / 3], [i + 2 / 3, j + 2 / 3]] : [[i + 1 / 3, j + 1 / 3]]) {
        const bu = u / n, bv = v / n, bw = 1 - bu - bv;
        put(bw * A[0] + bu * B[0] + bv * C[0], bw * A[1] + bu * B[1] + bv * C[1], bw * A[2] + bu * B[2] + bv * C[2], a);
      }
    }
  }
  return [...cells.values()].map((c) => [c[0] / c[3], c[1] / c[3], c[2] / c[3], c[3]]);
}

/**
 * Groups of points (index arrays): linked when within FILL.link in plan and no
 * steeper than 45deg apart (plus a mm) -- red straight above other red is a
 * separate overhang, held by its own wall on the part below.
 */
function groupsOf(pts) {
  const L = FILL.link, grid = new Map();
  const key = (i, j) => i * 100003 + j;
  pts.forEach((p, i) => {
    const k = key(Math.floor(p[0] / L), Math.floor(p[1] / L));
    let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(i);
  });
  const parent = pts.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  pts.forEach((p, i) => {
    const gi = Math.floor(p[0] / L), gj = Math.floor(p[1] / L);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      for (const j of grid.get(key(gi + di, gj + dj)) || []) {
        if (j <= i) continue;
        const q = pts[j], d = Math.hypot(p[0] - q[0], p[1] - q[1]);
        if (d <= L && Math.abs(p[2] - q[2]) <= d + 1) parent[find(i)] = find(j);
      }
    }
  });
  const by = new Map();
  pts.forEach((_, i) => { const r = find(i); let g = by.get(r); if (!g) by.set(r, (g = [])); g.push(i); });
  return [...by.values()];
}

/**
 * Candidate lines for a group, best first: for each direction, the offset whose
 * band (+-R across) holds the most red, split where the served red has a gap
 * wider than `bridge` along the line, the heaviest run kept. Each is
 * { a, b, weight, aims } with a, b = [x, y, zHint] and `aims` the indices it serves.
 */
function candidateLines(pts, group, R, bridge, narrow = false) {
  const dirs = [], narrowOut = [];
  for (let d = 0; d < FILL.dirs; d++) {
    const th = (Math.PI * d) / FILL.dirs, ux = Math.cos(th), uy = Math.sin(th);
    const axis = d === 0 || 2 * d === FILL.dirs;
    // slide a 2R window over the across-coordinate, heaviest window wins
    const across = group.map((i) => [-uy * pts[i][0] + ux * pts[i][1], i]).sort((p, q) => p[0] - q[0]);
    let best = -1, bestAt = 0, w = 0, lo = 0;
    for (let hi = 0; hi < across.length; hi++) {
      w += pts[across[hi][1]][3];
      while (across[hi][0] - across[lo][0] > 2 * R) w -= pts[across[lo++][1]][3];
      if (w > best) { best = w; bestAt = (across[lo][0] + across[hi][0]) / 2; }
    }
    const line = (off) => lineAt(pts, across, ux, uy, off, R, bridge, axis);
    const c = line(bestAt);
    if (c) dirs.push({ c, line, bestAt });
    if (narrow) {
      const N = FILL.narrow; let nb = -1, nAt = 0; w = 0; lo = 0;
      for (let hi = 0; hi < across.length; hi++) {
        w += pts[across[hi][1]][3];
        while (across[hi][0] - across[lo][0] > 2 * N) w -= pts[across[lo++][1]][3];
        if (w > nb) { nb = w; nAt = (across[lo][0] + across[hi][0]) / 2; }
      }
      const v = lineAt(pts, across, ux, uy, nAt, N, bridge, axis);
      if (v) narrowOut.push(v);
    }
  }
  // the best directions, each also SHIFTED across itself: the heaviest band's centre
  // often sits ~5 mm off a wall already built, inside its foot (a tall wall's is 3 mm
  // a side), and a line a few mm over clears it
  dirs.sort((p, q) => q.c.weight - p.c.weight);
  const out = [];
  for (const { c, line, bestAt } of dirs.slice(0, FILL.bestDirs)) {
    out.push(c);
    for (const s of FILL.shifts) { const v = line(bestAt + s); if (v) out.push(v); }
  }
  // all by the red they'd hold (stable: on a tie a direction's own line stays ahead of
  // its shifts; between directions, the better direction's lines come first)
  return out.sort((p, q) => q.weight - p.weight).concat(narrowOut.sort((p, q) => q.weight - p.weight));
}

/** One candidate: the line along (ux, uy) at across-offset `off`, over the red within
 *  R of it, split at plan gaps over `bridge` with the heaviest run kept. */
function lineAt(pts, across, ux, uy, off, R, bridge, axis) {
  const band = across.filter(([v]) => Math.abs(v - off) <= R).map(([, i]) => [ux * pts[i][0] + uy * pts[i][1], i])
    .sort((p, q) => p[0] - q[0]);
  let run = null, cur = { from: 0, w: 0 };
  for (let k = 0; k < band.length; k++) {
    if (k > 0 && band[k][0] - band[k - 1][0] > bridge) cur = { from: k, w: 0 };
    cur.w += pts[band[k][1]][3];
    cur.to = k;
    if (!run || cur.w > run.w) run = { ...cur };
  }
  if (!run) return null;
  let t0 = band[run.from][0], t1 = band[run.to][0];
  if (t1 - t0 < DRAW_MIN_LEN + 0.5) { const m = (t0 + t1) / 2; t0 = m - (DRAW_MIN_LEN + 0.5) / 2; t1 = m + (DRAW_MIN_LEN + 0.5) / 2; }
  // z hint at each end: the red nearest that end
  const zAt = (t) => {
    let z = 0, bd = Infinity;
    for (let k = run.from; k <= run.to; k++) { const dd = Math.abs(band[k][0] - t); if (dd < bd) { bd = dd; z = pts[band[k][1]][2]; } }
    return z;
  };
  const at = (t) => [ux * t - uy * off, uy * t + ux * off, zAt(t)];
  const aims = band.slice(run.from, run.to + 1).map(([, i]) => i);
  return { a: at(t0), b: at(t1), weight: run.w * (axis ? 1 : FILL.axisBias), aims };
}

/**
 * The stretch of candidate line `c` a wall can follow, checked BEFORE drawnWall
 * (which costs ~100 ms on a 250k-face part): stations every PROP.stationStep at
 * the surface nearest the line's height there (drawnLine's pick, through prop's
 * gridded surfaceHitsAt), cut wherever that surface faces UP (not an underside), or the top jumps more than FILL.maxStep (a line
 * grouped across a figure ran over its head: the top climbed to 32 mm on a 32 mm
 * mini), or the station's own wall would come within sideClear of a support
 * already built (`others`), so a line across an Auto wall splits there instead of
 * fusing to it. Of the stretches left, the one passing most leftover red
 * (`redAt`), as { a, b } surface points; null when none is DRAW_MIN_LEN long.
 * Between patches the underside still carries a bridge.
 */
function underStretch(c, tris, redAt, others, relax = null) {
  const dx = c.b[0] - c.a[0], dy = c.b[1] - c.a[1], len = Math.hypot(dx, dy);
  const n = Math.max(PROP.minStations - 1, Math.ceil(len / PROP.stationStep));
  const top = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n, x = c.a[0] + dx * t, y = c.a[1] + dy * t, hint = c.a[2] + (c.b[2] - c.a[2]) * t;
    let hit = null;
    // the underside nearest the line's height here (drawnLine's `under` pick)
    for (const h of surfaceHitsAt(tris, x, y)) if (h[1] < 0 && (!hit || Math.abs(h[0] - hint) < Math.abs(hit[0] - hint))) hit = h;
    top.push(hit === null ? null : [x, y, hit[0], hit[1]]);
  }
  const ok = top.map((p) => {
    // too low for a full wall: drawnWall refuses a whole line for one such station
    // (a line down a cube's 40deg underside to its plate edge); the plate rows
    // and squat walls are Auto's for that band
    if (!p || p[3] >= 0 || p[2] < PROP.minHeight + PROP.gap) return false;
    return stationClear(p, tris, others, relax);
  });
  let pick = null, from = -1, red = 0;
  const close = (to) => {
    if (from < 0 || to < from) return;
    const l = Math.hypot(top[to][0] - top[from][0], top[to][1] - top[from][1]);
    if (l >= DRAW_MIN_LEN && red > 0 && (!pick || red > pick.red)) pick = { a: top[from].slice(0, 3), b: top[to].slice(0, 3), red };
  };
  for (let i = 0; i < top.length; i++) {
    if (!ok[i]) { close(i - 1); from = -1; continue; }
    if (from >= 0 && Math.abs(top[i][2] - top[i - 1][2]) > FILL.maxStep) { close(i - 1); from = -1; }
    if (from < 0) { from = i; red = 0; }
    if (redAt(top[i])) red++;
  }
  close(top.length - 1);
  return pick;
}

/**
 * The same cut on drawnLine's SETTLED stations -- the top drawnWall actually builds
 * to, which the raw stations above only approximate (on a thin chair shell the
 * raw stretch's ends sent drawnWall to refuse three walls in four) -- cut wherever a station's surface faces UP or the top
 * jumps more than FILL.maxStep -- a line grouped across a figure ran over its head
 * (the top climbed to 32 mm on a 32 mm mini) -- or where the station's own wall would
 * come within sideClear of a support already built (`others`), so a line across an
 * Auto wall splits there instead of fusing to it. Of the stretches left, the one passing
 * most leftover red (`redAt`), as { a, b } surface points; null when none is
 * DRAW_MIN_LEN long. Between patches the underside still carries a bridge.
 */
function settledStretch(c, tris, redAt, others, relax = null) {
  const top = drawnLine(c.a, c.b, tris, PROP.stationStep, PART_BAND, true);
  if (!top) return null;
  const down = top.map((p) => {
    let best = null;
    for (const h of surfaceHitsAt(tris, p[0], p[1])) {
      const d = Math.abs(h[0] - p[2]);
      if (d < 1 && (!best || d < Math.abs(best[0] - p[2]))) best = h;
    }
    if (best === null || best[1] >= 0 || p[2] < PROP.minHeight + PROP.gap) return false;
    return stationClear(p, tris, others, relax);
  });
  let pick = null, from = 0, red = 0;
  for (let i = 0; i <= top.length; i++) {
    const breaks = i === top.length || !down[i] || (i > from && Math.abs(top[i][2] - top[i - 1][2]) > FILL.maxStep);
    if (breaks) {
      const len = i > from ? Math.hypot(top[i - 1][0] - top[from][0], top[i - 1][1] - top[from][1]) : 0;
      if (len >= DRAW_MIN_LEN && red > 0 && (!pick || red > pick.red)) pick = { a: top[from], b: top[i - 1], red };
      // a jump starts the next stretch at this station; a face looking up skips it
      from = i < top.length && down[i] ? i : i + 1;
      red = from === i && i < top.length && redAt(top[i]) ? 1 : 0;
    } else if (redAt(top[i])) red++;
  }
  return pick;
}

/**
 * Does the wall at station p (its top, [x, y, z]) keep PROP.sideClear off every
 * support already built? Its stem runs from its floor to its top, with a foot
 * footFor(h) a side at the plate. `relax` (the second pass's retry), each part on
 * its own: `part` -- where part is under the station (a chin over the chest), from
 * that part up, where drawnWall stands it (part-attached); `flange` -- on the plate,
 * its flange may JOIN the flanges already there (one base under a crowded figure,
 * peeled off with all its walls) and only the stem above FLANGE_TOP keeps clear.
 */
function stationClear(p, tris, others, relax = null) {
  const w = PROP.th / 2 + PROP.sideClear;
  if (relax?.part) {
    // the nearest surface below, if it faces UP (a down-facing one below is another
    // overhang's underside, with air under it)
    let below = null;
    for (const h of surfaceHitsAt(tris, p[0], p[1])) if (h[0] < p[2] - 1 && (!below || h[0] > below[0])) below = h;
    if (below && below[1] > 0 && below[0] > PROP.gap + 0.5) {
      return !others.hitsBox([p[0] - w, p[1] - w, below[0], p[0] + w, p[1] + w, p[2]]);
    }
  }
  if (relax?.flange) return !others.hitsBox([p[0] - w, p[1] - w, FLANGE_TOP, p[0] + w, p[1] + w, p[2]]);
  const wf = footFor(p[2] - PROP.gap) + PROP.sideClear;
  return !others.hitsBox([p[0] - w, p[1] - w, PROP.baseH, p[0] + w, p[1] + w, p[2]])
    && !others.hitsBox([p[0] - wf, p[1] - wf, 0, p[0] + wf, p[1] + wf, PROP.baseH + PROP.gap]);
}

/** The points of group g (indices into pts) within FILL.local in plan and FILL.localZ
 *  in height of its densest point (by a coarse grid: a group can be thousands of points). */
function localPatch(pts, g) {
  const L = FILL.local, cell = new Map();
  const key = (p) => `${Math.floor(p[0] / L)},${Math.floor(p[1] / L)},${Math.floor(p[2] / FILL.localZ)}`;
  for (const i of g) { const k = key(pts[i]); cell.set(k, (cell.get(k) ?? 0) + pts[i][3]); }
  let seed = g[0], best = -1;
  for (const i of g) { const w = cell.get(key(pts[i])); if (w > best) { best = w; seed = i; } }
  const s = pts[seed];
  return g.filter((i) => Math.hypot(pts[i][0] - s[0], pts[i][1] - s[1]) <= L && Math.abs(pts[i][2] - s[2]) <= FILL.localZ);
}

/** Is there leftover red within FILL.redNear of p (plan and height)? Gridded. */
function redGrid(pts) {
  const C = FILL.redNear, grid = new Map();
  const key = (i, j) => i * 100003 + j;
  for (const p of pts) {
    const k = key(Math.floor(p[0] / C), Math.floor(p[1] / C));
    let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(p);
  }
  return (p) => {
    const gi = Math.floor(p[0] / C), gj = Math.floor(p[1] / C);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      for (const q of grid.get(key(gi + di, gj + dj)) || []) {
        if (Math.hypot(p[0] - q[0], p[1] - q[1]) <= C && Math.abs(p[2] - q[2]) <= C) return true;
      }
    }
    return false;
  };
}

/** [minX, minY, minZ, maxX, maxY, maxZ] of one triangle (three vertex entries). */
const triBox = (t, i) => [Math.min(t[i][0], t[i + 1][0], t[i + 2][0]), Math.min(t[i][1], t[i + 1][1], t[i + 2][1]),
  Math.min(t[i][2], t[i + 1][2], t[i + 2][2]), Math.max(t[i][0], t[i + 1][0], t[i + 2][0]),
  Math.max(t[i][1], t[i + 1][1], t[i + 2][1]), Math.max(t[i][2], t[i + 1][2], t[i + 2][2])];

const BOX_EDGE = 2.0;    // mm: largest support-triangle box boxGrid works with (see boxesOf)
const FLANGE_TOP = PROP.baseH + 0.05;   // mm: the plate flange's band, a hair over its top

/**
 * fn(box) for pieces of triangle (a, b, c) no more than BOX_EDGE across: a long
 * wall's triangles are big and, on a diagonal wall, so are their boxes -- a box
 * over a whole quadrant of the plan read every line near it as a hit. Split at the
 * longest edge's midpoint (a sliver halves along its length, not into 4^n), at
 * most 16 deep.
 */
function boxesOf(a, b, c, fn, depth = 0) {
  const bx = triBox([a, b, c], 0);
  if (depth >= 16 || !(Math.max(bx[3] - bx[0], bx[4] - bx[1], bx[5] - bx[2]) > BOX_EDGE)) { fn(bx); return; }
  const d2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
  const ab = d2(a, b), bc = d2(b, c), ca = d2(c, a);
  // rotate so the longest edge is (a, b)
  if (bc >= ab && bc >= ca) [a, b, c] = [b, c, a];
  else if (ca >= ab && ca >= bc) [a, b, c] = [c, a, b];
  const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  boxesOf(a, m, c, fn, depth + 1);
  boxesOf(m, b, c, fn, depth + 1);
}

/** Every support triangle's box, gridded in plan, so "does this new wall touch one" is cheap. */
function boxGrid() {
  const C = 5, grid = new Map();
  const key = (i, j) => i * 100003 + j;
  const cellsOf = (b, pad, fn) => {
    for (let i = Math.floor((b[0] - pad) / C); i <= Math.floor((b[3] + pad) / C); i++) {
      for (let j = Math.floor((b[1] - pad) / C); j <= Math.floor((b[4] + pad) / C); j++) fn(key(i, j));
    }
  };
  return {
    add(tris) {
      for (let i = 0; i + 2 < tris.length; i += 3) {
        boxesOf(tris[i], tris[i + 1], tris[i + 2], (bx) => cellsOf(bx, 0, (k) => {
          let g = grid.get(k); if (!g) grid.set(k, (g = [])); g.push(bx);
        }));
      }
    },
    hitsBox(b) {
      let hit = false;
      cellsOf(b, 0, (k) => {
        if (hit) return;
        for (const o of grid.get(k) || []) {
          if (b[0] <= o[3] && o[0] <= b[3] && b[1] <= o[4] && o[1] <= b[4] && b[2] <= o[5] && o[2] <= b[5]) { hit = true; return; }
        }
      });
      return hit;
    },
    // `shared`: two pieces that both start in the flange band, either one wholly
    // within it (top at or under FLANGE_TOP), are the second pass's joined base, not
    // a hit -- a base on the part, above the band, never is
    hits(tris, pad, shared = false) {
      let hit = false;
      const test = (b) => {
        if (hit) return;
        cellsOf(b, pad, (k) => {
          if (hit) return;
          for (const o of grid.get(k) || []) {
            if (b[0] - pad <= o[3] && o[0] <= b[3] + pad && b[1] - pad <= o[4] && o[1] <= b[4] + pad &&
                b[2] - pad <= o[5] && o[2] <= b[5] + pad && !(shared && Math.max(b[2], o[2]) <= FLANGE_TOP && Math.min(b[5], o[5]) <= FLANGE_TOP)) { hit = true; return; }
          }
        });
      };
      // the new wall's triangles split the same way as the stored ones
      for (let i = 0; i + 2 < tris.length && !hit; i += 3) boxesOf(tris[i], tris[i + 1], tris[i + 2], test);
      return hit;
    },
  };
}

/**
 * BRACES, last: every wall is placed first, exactly as without them -- ribs built as
 * the walls went in took the plate the next walls needed (Isaac: 12 walls -> 10, bare
 * red 71 -> 85 mm2). Then each wall that stands tall and short on the plate gets the
 * ribs that fit (prop/brace.js), clear of Auto's supports and of every other fill wall
 * and its ribs (its own wall excepted; joined flanges allowed, as for the walls).
 * Appends to `triangles`, adds each wall's ribs as a second triRange; returns the count.
 */
function braceFill(props, floors, triangles, tris, autoTris) {
  let autoGrid = null;
  const grids = props.map(() => null);
  const gridOf = (k) => {
    if (!grids[k]) {
      grids[k] = boxGrid();
      for (const [a, b] of props[k].triRanges) grids[k].add(triangles.slice(a, b));
    }
    return grids[k];
  };
  let n = 0;
  props.forEach((q, k) => {
    if (!floors[k]) return;
    const out = [];
    const clear = (t) => {
      if (!autoGrid) { autoGrid = boxGrid(); autoGrid.add(autoTris); }
      if (autoGrid.hits(t, PROP.sideClear, true)) return false;
      for (let j = 0; j < props.length; j++) if (j !== k && gridOf(j).hits(t, PROP.sideClear, true)) return false;
      return true;
    };
    const built = braceWall(q.line, (i) => floors[k][i], tris, 0, out, (t) => {
      if (!clear(t)) return false;
      gridOf(k).add(t);            // the next wall's ribs keep clear of these
      return true;
    });
    if (!built) return;
    const at = triangles.length;
    for (const t of out) triangles.push(t);
    q.triRanges.push([at, triangles.length]);
    q.braces = built;
    n += built;
  });
  return n;
}

/**
 * The fill pass. `built` is Auto's result (fins with their contact lines, and
 * every support triangle in `triangles`). Returns the added walls:
 * { triangles, props, tines, unserved: { area, pts }, stats }.
 */
export function fillCoverage(topo, result, rot, opts, built) {
  const coverage = Math.max(0, Math.min(1, opts.coverage ?? 0.5));
  const R = fillReach(coverage);
  const oneEach = coverage < FILL.sparseBelow;
  const tops = [];
  for (const w of built.fins ?? []) for (const p of w.line ?? []) tops.push(p);
  const near = reachOf(tops, R);
  const cls = classify(topo, result, rot);
  const pts = leftoverPoints(topo, result, rot, near, cls);
  const triangles = [], props = [];
  const stats = { walls: 0, tries: 0, checks: 0, capped: false, refused: {}, startArea: pts.reduce((s, p) => s + p[3], 0) };
  if (!pts.length) return { triangles, props, tines: 0, unserved: { area: 0, pts: [] }, stats };

  const tris = seatedPartTris(topo, rot, result.offset);
  const others = boxGrid();
  others.add(built.triangles ?? []);
  const drawOpts = { under: true, tines: opts.tines ?? true, tineDensity: opts.tineDensity, layerHeight: opts.layerHeight,
                     topo, rot, offset: result.offset };
  let tines = 0;
  const floors = [];               // each kept wall's bottom z per station (drawnWall), for the braces
  const dead = new Set();          // points no line could serve
  const bare = (p) => !dead.has(p) && !near(p[0], p[1], p[2]);
  const full = () => stats.walls >= FILL.maxWalls || stats.tries >= FILL.maxTries || stats.checks >= FILL.maxChecks;
  const CAP = 'cap';               // wallFor stopped on a cap: give up on nothing

  // One wall for group `g` of `live`: the first candidate (bridged lines first, then
  // the same directions without crossing gaps) that builds, keeps off every support
  // and holds new red. Added in place: true; on a cap, CAP; otherwise the indices the
  // best line was aiming at, so only that red is given up on and the rest of the group
  // gets a try.
  const wallFor = (live, g, local = false) => {
    const redAt = redGrid(g.map((i) => live[i]));
    let aims = null, builds = 0, partOk = local, flangeOk = local;
    // the first of `cands` that builds, keeps off every support and holds new red:
    // true; CAP; aims (this group's tries are used up); or null (none built)
    const tryLines = (cands) => {
      for (const c0 of cands) {
        if (full()) return CAP;
        aims ??= c0.aims;
        stats.checks++;
        let quick = underStretch(c0, tris, redAt, others);
        let c = quick && settledStretch(quick, tris, redAt, others);
        // ...and relaxed (stationClear): standing on the part where there is part under
        // it (a chin over the chest, its plate below taken), its flange joining the
        // flanges on the plate. Tried second, each only until a wall it let through
        // builds into a support (the knuckle's mixed lines did, build after build)
        let relaxed = false;
        if (!c && (partOk || flangeOk)) {
          stats.checks++;
          const relax = { part: partOk, flange: flangeOk };
          quick = underStretch(c0, tris, redAt, others, relax);
          c = quick && settledStretch(quick, tris, redAt, others, relax);
          relaxed = !!c;
        }
        if (!c) { stats.refused['no underside to follow'] = (stats.refused['no underside to follow'] ?? 0) + 1; continue; }
        // a group whose lines keep passing the checks but won't build (part under it,
        // no headroom) stops here: each drawnWall is ~0.2 s on a 250k-face part
        if (builds++ >= FILL.groupTries) return aims;
        stats.tries++;
        const r = drawnWall(c.a, c.b, tris, 0, drawOpts);
        const why = !r.ok ? r.reason.split(' — ')[0].split(' -- ')[0] : others.hits(r.tris, PROP.sideClear, local) ? 'touches a support' : null;
        if (why) {
          stats.refused[why] = (stats.refused[why] ?? 0) + 1;
          // (the relaxation that let it through: on the part, or on the plate)
          if (relaxed && why === 'touches a support') { if (r.partAttached) partOk = false; else flangeOk = false; }
          continue;
        }
        const reach = reachOf(r.top, R);
        let gain = 0;
        for (const i of g) if (reach(live[i][0], live[i][1], live[i][2])) gain += live[i][3];
        if (gain < FILL.minGain) { stats.refused['holds no new red'] = (stats.refused['holds no new red'] ?? 0) + 1; continue; }
        const at = triangles.length;
        for (const t of r.tris) triangles.push(t);
        others.add(r.tris);
        for (const p of r.top) near.add(p);
        props.push({ line: r.top, triRanges: [[at, triangles.length]], height: r.height, span: r.length,
                     tines: r.tines ?? 0, partAttached: !!r.partAttached, squat: !!r.squat, fill: true });
        floors.push(r.floors ?? null);
        tines += r.tines ?? 0;
        stats.walls++;
        return true;
      }
      return null;
    };
    if (!local) {
      for (const bridge of [FILL.bridge, 2 * FILL.sample]) {
        const r = tryLines(candidateLines(live, g, R, bridge));
        if (r !== null) return r;
      }
      return aims ?? g;
    }
    // LOCAL (the second pass): patch by patch, densest red first -- lines over just
    // that patch, narrow ones too, standing on the part where there is part under
    // them. A patch none builds on is given up on here, and the next gets its turn.
    let rest = g;
    while (rest.length) {
      const sub = localPatch(live, rest);
      builds = 0;
      partOk = flangeOk = true;
      // (one bridge: a patch is at most 2 x FILL.local across)
      const r = tryLines(candidateLines(live, sub, R, FILL.bridge, true));
      if (r === true || r === CAP) return r;
      for (const i of sub) dead.add(live[i]);
      const gone = new Set(sub);
      rest = rest.filter((i) => !gone.has(i));
    }
    return aims ?? g;
  };
  const heaviest = (live) => groupsOf(live).map((g) => ({ g, w: g.reduce((s, i) => s + live[i][3], 0) }))
    .sort((p, q) => q.w - p.w).map((x) => x.g);

  if (oneEach) {
    // sparse: each group of the red Auto left gets ONE wall, against what is still bare
    for (const g0 of heaviest(pts)) {
      if (full()) break;
      // tries until it gets its wall: a failed line gives up only the red it aimed at
      for (;;) {
        const live = g0.map((i) => pts[i]).filter(bare);
        if (!live.length || full()) break;
        const r = wallFor(live, live.map((_, i) => i));
        if (r === true || r === CAP) break;
        for (const i of r) dead.add(live[i]);
      }
    }
  } else {
    // until every point is within reach: a wall under the heaviest bare group, regroup, again
    while (!full()) {
      const live = pts.filter(bare);
      if (!live.length) break;
      const g = heaviest(live)[0];
      const r = wallFor(live, g);
      if (r === CAP) break;
      if (r !== true) for (const i of r) dead.add(live[i]);
    }
    // ...then, with what the caps leave, the red still bare again, patch by patch
    // (wallFor's LOCAL): an upright figure's groups are a hem, both arms and the
    // hands at one height, and every line across all that met the first wall
    // (only if pass 1 left room: after a cap, what it gave up on stays given up, or
    // `capped` would count it as stopped-on)
    if (!full()) dead.clear();
    while (!full()) {
      const live = pts.filter(bare);
      if (!live.length) break;
      const r = wallFor(live, heaviest(live)[0], true);
      if (r === CAP) break;
      if (r !== true) for (const i of r) dead.add(live[i]);
    }
  }
  stats.braces = braceFill(props, floors, triangles, tris, built.triangles ?? []);
  const left = pts.filter((p) => !near(p[0], p[1], p[2]));
  stats.capped = full() && left.some((p) => !dead.has(p));
  return { triangles, props, tines,
           unserved: { area: left.reduce((s, p) => s + p[3], 0), pts: left.map((p) => [p[0], p[1], p[2]]) }, stats };
}
