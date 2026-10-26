/**
 * The JUDGE (local issue 062): how well walls hold an overhang -- one ruler for
 * the races and the coverage scoreboard (prototype/examples/judge.js, probe.js).
 *
 * The older ruler (raster.js heldBy, held.js) asks "is a wall top within half a
 * span?", which can't tell a BRIDGE from a CANTILEVER: the cable reel (#269),
 * whose walls stop short of its curved rim all round, scored 100%. Here a point
 * of the overhang is
 *   - NEAR: an ANCHOR within JUDGE.cantilever past a wall's face (what a layer may
 *     hang past its support before the free edge curls or droops -- provisional:
 *     the slenderness coupon's 4 mm lip curled; prototype/calibration/lip/ sets it);
 *   - BRIDGED: anchors on roughly opposite sides (>= JUDGE.bridgeDeg apart) whose
 *     distances add up to the span (PROP.maxUnsupportedSpan) plus a wall: a bridge
 *     runs face to face, and distances run to the wall's centre line;
 *   - CANT: neither, an anchor within half a span on one side only (a cantilever
 *     the older ruler counted as held); BARE: nothing near.
 * ANCHORS are what a layer can build out from: wall-top points 0..1.5 mm under it,
 * and the part itself where an overhang meets part that goes DOWN from the edge (a
 * ledge off a spine, a flange off its hub). Part going UP from the edge (a rounded
 * rim curling up, a tilted cube's side) leaves the edge FREE.
 * Each face is scored at samples ~1 mm2 apart: a CAD part's flat face is a few big
 * triangles, and one centroid swung its whole area.
 */
import { PROP } from './config.js';
import { insidePart } from '../inside.js';
import { seat } from './surface.js';

export const JUDGE = {
  cantilever: 2.0,   // mm past a wall's face (provisional, see above)
  bridgeDeg: 135,    // anchors this far apart, seen from the point, bridge it
  sectors: 16,       // direction bins for the nearest anchor each way
  sample: 1.0,       // mm2 per sample
  // What plastic buys: a race (raster.js raceAgainst `price`) swaps to walls that
  // weigh more only when they hold at least this much more overhang per mm3 added
  // (0.01 = 10 mm2 per cm3, ~1.24 g of PLA). PROVISIONAL, Matthew's to set: the
  // cable reel's rim buys 22 mm2/cm3, the lamp shade's 34; a wall for a sliver, ~0.
  price: 0.01,
};
const cache = new WeakMap();

/**
 * Part anchors for a pose (`result` keys the cache: one analyze per pose): points
 * every 0.5 mm along each overhang edge whose non-overhang neighbour goes down.
 */
export function partAnchors(topo, result, rot) {
  let hit = cache.get(result);
  if (hit?.anchors) return hit.anchors;
  const { pos, adjA, adjB } = topo, off = result.offset;
  const S = (o) => seat(pos, o, rot, off, [0, 0, 0]);
  const pts = [];
  for (let k = 0; k < adjA.length; k++) {
    const a = adjA[k], b = adjB[k];
    if (!result.over[a] === !result.over[b]) continue;
    const o = result.over[a] ? a : b, n = result.over[a] ? b : a;
    const shared = sharedEdge(pos, o, n);
    if (!shared) continue;
    const [p, q] = shared.map(S);
    if (attached(topo, result, rot, o, n, shared, p, q)) densify([p, q], 0.5, pts);
  }
  if (!hit) cache.set(result, (hit = {}));
  hit.anchors = pts;
  return pts;
}

/** Sample points [x, y, z, weight] over face `f`, seated, ~JUDGE.sample mm2 each. */
export function faceSamples(topo, result, rot, f) {
  let hit = cache.get(result);
  if (!hit) cache.set(result, (hit = {}));
  const memo = (hit.samples ??= new Map());
  let s = memo.get(f);
  if (s) return s;
  const off = result.offset;
  const [A, B, C] = [0, 1, 2].map((i) => seat(topo.pos, f * 9 + i * 3, rot, off, [0, 0, 0]));
  const a = topo.area[f];
  const k = Math.max(1, Math.min(24, Math.ceil(Math.sqrt(a / JUDGE.sample))));
  const w = a / (k * k);
  const at = (u, v) => [0, 1, 2].map((c) => A[c] + (B[c] - A[c]) * u + (C[c] - A[c]) * v);
  s = [];
  for (let i = 0; i < k; i++) for (let j = 0; j < k - i; j++) {
    s.push([...at((i + 1 / 3) / k, (j + 1 / 3) / k), w]);
    if (i + j < k - 1) s.push([...at((i + 2 / 3) / k, (j + 2 / 3) / k), w]);
  }
  memo.set(f, s);
  return s;
}

/**
 * A scorer for one set of wall tops: `(x, y, z) -> 'near' | 'bridged' | 'cant' |
 * 'bare'`, with `partPts` (partAnchors) as anchors too. Tops are wall lines' points
 * (densified here to 0.5 mm).
 */
export function scorer(tops, partPts) {
  const SPAN = PROP.maxUnsupportedSpan;
  const bridgeMax = SPAN + PROP.th, cantMax = JUDGE.cantilever + PROP.th / 2;
  const dense = [];
  for (const line of tops) densify(line, 0.5, dense);
  const walls = gridOf(dense, bridgeMax), part = gridOf(partPts, bridgeMax);
  const N = JUDGE.sectors, apart = Math.ceil((JUDGE.bridgeDeg / 360) * N);
  const best = new Float64Array(N);
  return (x, y, z) => {
    best.fill(Infinity);
    const look = (grid) => grid.each(x, y, (p) => {
      const dz = z - p[2];
      if (dz < -0.05 || dz > 1.5) return;
      const d = Math.hypot(p[0] - x, p[1] - y);
      if (d > bridgeMax) return;
      const s = Math.floor(((Math.atan2(p[1] - y, p[0] - x) + Math.PI) / (2 * Math.PI)) * N) % N;
      if (d < best[s]) best[s] = d;
    });
    look(walls);
    look(part);
    let nearest = Infinity;
    for (const d of best) if (d < nearest) nearest = d;
    if (nearest <= cantMax) return 'near';
    for (let i = 0; i < N; i++) {
      if (best[i] === Infinity) continue;
      for (let k = i + 1; k < N; k++) {
        if (Math.min(k - i, N - (k - i)) >= apart && best[i] + best[k] <= bridgeMax) return 'bridged';
      }
    }
    return nearest <= SPAN / 2 ? 'cant' : 'bare';
  };
}

/**
 * A race ruler (raster.js raceAgainst's `ruler`): `(faces, tops) -> held area`,
 * `faces` in overhangFaces' shape ([cx, cy, cz, area, region, face]), `tops` the
 * wall lines' points.
 */
export function judgeRuler(topo, result, rot) {
  const partPts = partAnchors(topo, result, rot);
  return (faces, tops) => {
    // (tops come flattened, every wall's points in one list: each its own line, so
    // none is joined to the next wall's)
    const held = scorer(tops.map((p) => [p]), partPts);
    let sum = 0;
    for (const fc of faces) {
      for (const [x, y, z, w] of faceSamples(topo, result, rot, fc[5])) {
        const c = held(x, y, z);
        if (c === 'near' || c === 'bridged') sum += w;
      }
    }
    return sum;
  };
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

/**
 * Does the part go DOWN from overhang face `o`'s edge `p`-`q` (seated; `shared`
 * its offsets, `n` the face across it)? By the face across it -- or, for a part
 * built of unwelded bodies (a Tinkercad union: a deck laid on a post), by the part
 * itself just outside the edge and under it.
 */
export function attached(topo, result, rot, o, n, shared, p, q) {
  const { pos } = topo, off = result.offset;
  const far = seat(pos, n * 9 + 3 * otherVertex(pos, n, shared), rot, off, [0, 0, 0]);
  const z = Math.min(p[2], q[2]);
  if (far[2] < z - 0.2) return true;
  const c = [0, 1, 2].map((i) => seat(pos, o * 9 + i * 3, rot, off, [0, 0, 0]));
  let nx = p[1] - q[1], ny = q[0] - p[0];
  const len = Math.hypot(nx, ny);
  if (len < 1e-9) return false;
  const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
  const cx = (c[0][0] + c[1][0] + c[2][0]) / 3, cy = (c[0][1] + c[1][1] + c[2][1]) / 3;
  if (nx * (mx - cx) + ny * (my - cy) < 0) { nx = -nx; ny = -ny; }
  return insidePart(topo, rot, off, mx + (nx / len) * 0.5, my + (ny / len) * 0.5, z - 0.5);
}

// the two vertex offsets (into pos) face `o` shares with face `n`, by position
export function sharedEdge(pos, o, n) {
  const out = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const a = o * 9 + i * 3, b = n * 9 + j * 3;
    if (pos[a] === pos[b] && pos[a + 1] === pos[b + 1] && pos[a + 2] === pos[b + 2]) { out.push(a); break; }
  }
  return out.length === 2 ? out : null;
}
/** Which vertex (0-2) of face `n` is not on the `shared` edge. */
export function otherVertex(pos, n, shared) {
  for (let j = 0; j < 3; j++) {
    const b = n * 9 + j * 3;
    if (!shared.some((a) => pos[a] === pos[b] && pos[a + 1] === pos[b + 1] && pos[a + 2] === pos[b + 2])) return j;
  }
  return 0;
}
