import { PLATE_Z, MUST } from '../../web/fins/coverage.js';
import { PROP, surfaceZAt } from '../../web/prop.js';
import { classify } from './held.js';

/**
 * The JUDGE (local issue 062): how well a build holds a part, one ruler for every
 * candidate layout. held.js asks "is a wall top within half a span?", which can't
 * tell a BRIDGE (support either side) from a CANTILEVER (support on one side only):
 * main's cable reel, its last wall 7 mm in from each rounded tip, scored 100%.
 *
 * Each must-hold overhang face (held.js classify) is
 *   - PLATE / PAD: on the plate, or the bed pad's top just under it (as held.js);
 *   - NEAR: an ANCHOR within CANTILEVER in plan -- what a layer may hang past its
 *     support before the free edge curls (provisional 2 mm: the slenderness coupon's
 *     4 mm lip curled; prototype/calibration/lip/ sets it when printed);
 *   - BRIDGED: anchors on roughly opposite sides (>= BRIDGE_DEG apart, seen from the
 *     face) whose distances add up to at most the span (PROP.maxUnsupportedSpan);
 *   - BARE: neither. `cant` is the bare area held.js would have called held (an
 *     anchor within half a span on one side only): the cantilevers it missed;
 *     `bare` the rest. (`bare` + `cant` = all that isn't held.)
 * ANCHORS are what a layer can build out from: wall-top points (0..1.5 mm under the
 * face, as held.js), and the part itself where an overhang patch meets part that
 * goes DOWN from the edge (a ledge off a spine). Where the part goes UP from the
 * edge (a rim curling up, a tilted cube's side) the edge is FREE: no anchor.
 *
 * Score order (rank): held share of must-hold, then plastic. Removal is not scored
 * yet (062 step 2 follow-up).
 */
export const CANTILEVER = 2.0;
export const BRIDGE_DEG = 135;
const SECTORS = 16;

export function judge(topo, res, rot, build) {
  const SPAN = PROP.maxUnsupportedSpan;
  const { pos, nFaces, adjA, adjB } = topo;
  const off = res.offset;
  const seat = (o) => [rot[0] * pos[o] + rot[3] * pos[o + 1] + rot[6] * pos[o + 2] + off.x,
    rot[1] * pos[o] + rot[4] * pos[o + 1] + rot[7] * pos[o + 2] + off.y,
    rot[2] * pos[o] + rot[5] * pos[o + 1] + rot[8] * pos[o + 2] + off.z];

  // wall tops, densified to 0.5 mm along each line
  const tops = [];
  for (const w of build.fins ?? []) densify(w.line ?? [], 0.5, tops);
  // part anchors: overhang edges whose non-overhang neighbour goes down from the edge
  const edges = [];
  for (let k = 0; k < adjA.length; k++) {
    const a = adjA[k], b = adjB[k];
    if (!res.over[a] === !res.over[b]) continue;
    const o = res.over[a] ? a : b, n = res.over[a] ? b : a;
    const shared = sharedEdge(pos, o, n);
    if (!shared) continue;
    const [p, q] = shared.map((i) => seat(i));
    const far = seat(n * 9 + 3 * otherVertex(pos, n, shared));
    if (far[2] < Math.min(p[2], q[2]) - 0.2) densify([p, q], 0.5, edges);
  }
  const wallGrid = gridOf(tops, SPAN), partGrid = gridOf(edges, SPAN);

  const cls = classify(topo, res, rot);
  const onPad = padUnder(build.padTriangles);
  const out = { must: 0, held: 0, plate: 0, near: 0, bridged: 0, bare: 0, cant: 0, faces: [] };
  const mark = (f, c, x, y, z) => out.faces.push([f, c, +x.toFixed(2), +y.toFixed(2), +z.toFixed(2)]);
  // distances run to a wall's CENTRE line: a bridge spans face to face, so it may
  // be a wall's thickness longer centre to centre, and a cantilever starts at the
  // wall's face, half a wall out
  const bridgeMax = SPAN + PROP.th, cantMax = CANTILEVER + PROP.th / 2;
  const apart = Math.ceil((BRIDGE_DEG / 360) * SECTORS);
  const best = new Float64Array(SECTORS);
  const score = (cx, cy, cz) => {
    if (cz < PLATE_Z || onPad(cx, cy, cz)) return 'plate';
    // the nearest anchor per direction sector, within a span
    best.fill(Infinity);
    const look = (grid, ok) => grid.each(cx, cy, (p) => {
      if (!ok(cz - p[2])) return;
      const d = Math.hypot(p[0] - cx, p[1] - cy);
      if (d > bridgeMax) return;
      const s = Math.floor(((Math.atan2(p[1] - cy, p[0] - cx) + Math.PI) / (2 * Math.PI)) * SECTORS) % SECTORS;
      if (d < best[s]) best[s] = d;
    });
    look(wallGrid, (dz) => dz >= -0.05 && dz <= 1.5);
    // the part edge: a layer builds out from it at about its own height (a slope
    // falling away from its edge is held by walls, not by the edge far above it)
    look(partGrid, (dz) => dz >= -0.05 && dz <= 1.5);
    let nearest = Infinity;
    for (const d of best) if (d < nearest) nearest = d;
    if (nearest <= cantMax) return 'near';
    for (let i = 0; i < SECTORS; i++) {
      if (best[i] === Infinity) continue;
      for (let k = i + 1; k < SECTORS; k++) {
        const sep = Math.min(k - i, SECTORS - (k - i));
        if (sep >= apart && best[i] + best[k] <= bridgeMax) return 'bridged';
      }
    }
    return nearest <= SPAN / 2 ? 'cant' : 'bare';
  };
  // each face scored at sample points ~1 mm2 apart, not its centroid: a CAD part's
  // flat face is a few big triangles, and one centroid swung its whole area
  for (let f = 0; f < nFaces; f++) {
    if (!res.over[f] || cls[f] !== MUST) continue;
    const [A, B, C] = [0, 1, 2].map((i) => seat(f * 9 + i * 3));
    const a = topo.area[f];
    out.must += a;
    const k = Math.max(1, Math.min(24, Math.ceil(Math.sqrt(a))));
    const w = a / (k * k);
    const at = (u, v) => [0, 1, 2].map((c) => A[c] + (B[c] - A[c]) * u + (C[c] - A[c]) * v);
    const pts = [];
    for (let i = 0; i < k; i++) for (let jj = 0; jj < k - i; jj++) {
      pts.push(at((i + 1 / 3) / k, (jj + 1 / 3) / k));
      if (i + jj < k - 1) pts.push(at((i + 2 / 3) / k, (jj + 2 / 3) / k));
    }
    for (const [x, y, z] of pts) {
      const c = score(x, y, z);
      out[c] = (out[c] ?? 0) + w;
      if (c !== 'cant' && c !== 'bare') out.held += w;
      if (out.faces.length < 200000) mark(f, c, x, y, z);
    }
  }
  out.anchors = { tops: tops.length, edges };
  out.pct = out.must ? (100 * out.held) / out.must : null;
  return out;
}

function densify(line, step, into) {
  for (let i = 0; i < line.length; i++) {
    const p = line[i];
    into.push(p);
    const q = line[i + 1];
    if (!q) break;
    const n = Math.floor(Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) / step);
    for (let k = 1; k < n; k++) {
      const t = k / n;
      into.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]);
    }
  }
}

function gridOf(pts, cell) {
  const grid = new Map(), key = (i, j) => i * 100003 + j;
  for (const p of pts) {
    const k = key(Math.floor(p[0] / cell), Math.floor(p[1] / cell));
    let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(p);
  }
  return {
    each(x, y, fn) {
      const gi = Math.floor(x / cell), gj = Math.floor(y / cell);
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (const p of grid.get(key(gi + di, gj + dj)) || []) fn(p);
    },
  };
}

// the two vertex offsets (into pos) face `o` shares with face `n`, by position
function sharedEdge(pos, o, n) {
  const out = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const a = o * 9 + i * 3, b = n * 9 + j * 3;
    if (pos[a] === pos[b] && pos[a + 1] === pos[b + 1] && pos[a + 2] === pos[b + 2]) { out.push(a); break; }
  }
  return out.length === 2 ? out : null;
}
function otherVertex(pos, n, shared) {
  for (let j = 0; j < 3; j++) {
    const b = n * 9 + j * 3;
    if (!shared.some((a) => pos[a] === pos[b] && pos[a + 1] === pos[b + 1] && pos[a + 2] === pos[b + 2])) return j;
  }
  return 0;
}

function padUnder(pad) {
  if (!pad?.length) return () => false;
  const flip = new Float64Array(pad.length * 3);
  const reach = PROP.gap + 0.3;
  pad.forEach((v, i) => { flip[i * 3] = v[0]; flip[i * 3 + 1] = v[1]; flip[i * 3 + 2] = -v[2]; });
  return (x, y, z) => {
    const m = surfaceZAt(flip, x, y);
    return m !== null && z + m <= reach;
  };
}
