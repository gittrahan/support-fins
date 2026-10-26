/**
 * Rim walls (local issue 062): a wall along an overhang patch's FREE outline,
 * whatever its shape -- straight, curved, a stadium flange's half-rounds.
 *
 * Rows cross a patch in one direction, so along any edge they don't run parallel
 * to, each row stops at the edge and the outline between two row ends hangs with
 * nothing to bridge to: it curls up as the nozzle pulls away, or droops (#269's
 * cable reel, its curved flanks bare all round; the judge, prop/judge.js, scores
 * it). A rim wall stands under that outline, PROP.edgeInset in, and the rows stop
 * short of it -- so the rows bridge to the rim and the rim holds the edge.
 *
 * FREE: the patch meets part that goes UP from the edge (a rim curling up, a
 * plate's side), a sliver of overhang too small for a region (a rounded edge's
 * lower half), or nothing. Not free: a kept overhang face (the overhang carries
 * on), or part going DOWN (a ledge's spine, a flange's hub -- the layer
 * builds out from it), or an edge down at the bed (it rests there).
 *
 * Only a LEVEL region (RIM.levelDeg, most of its area) gets a rim -- its whole
 * outline, a flange's rounded lip included.
 *
 * The rim is cut into pieces (RIM.pieceLen long, RIM.pieceTurn of turn at most,
 * RIM.pieceGap apart) so each can come out: a closed ring between two flanges
 * can't be pulled out, an arc can (Matthew 2026-10-26: split pieces are fine).
 *
 * Tracks come back in patchTracks' shape (each tagged `rim`) -- [x, y, z] stations ~`step` apart, z
 * the region's surface -- and buildProps builds them like any other track.
 */
import { PROP } from './config.js';
import { attached, sharedEdge } from './judge.js';
import { seat, surfaceZAt } from './surface.js';

export const RIM = {
  pieceLen: 40,     // mm: the longest rim piece
  pieceTurn: 90,    // deg: the most a piece may turn (a U can't be pulled out)
  pieceGap: 1.5,    // mm between pieces
  // deg off horizontal: a rim stands under a LEVEL region (most of its area) (a flange, a shelf -- the
  // "flat + curved edges" class). A sloped patch's rows already run downhill to
  // its edges (the flush end rows, #143/#269); a rim round a tilted face just
  // rings it with walls (tube X25: 8 for 4).
  levelDeg: 10,
};

/**
 * The rim tracks for a region (`faces`, its seated triangles `regionTris`), or []
 * when it has no free edge.
 */
export function rimTracks(topo, result, rot, faces, regionTris, step = PROP.stationStep) {
  const level = -Math.cos((RIM.levelDeg * Math.PI) / 180), n = topo.nrm;
  let flat = 0, all = 0;
  for (const f of faces) {
    all += topo.area[f];
    if (rot[2] * n[f * 3] + rot[5] * n[f * 3 + 1] + rot[8] * n[f * 3 + 2] <= level) flat += topo.area[f];
  }
  if (flat < all / 2) return [];
  const segs = freeEdges(topo, result, rot, new Set(faces));
  const tracks = [];
  for (const chain of chains(segs)) {
    const line = inset(resample(chain, step), regionTris);
    for (const run of runs(line)) tracks.push(...pieces(run, step));
  }
  // (tagged, so the wall built on it says rimWall: true)
  return tracks.filter((t) => t.length >= PROP.minStations).map((t) => Object.assign(t, { rim: true }));
}

/**
 * `rows` with every station within a wall and its side clearance of the rim
 * dropped (a row is then split into its runs): a row stops short of the rim
 * instead of fusing into it, and a flush end row along a straight rim goes.
 */
export function clipToRim(rows, rim) {
  if (!rim.length) return rows;
  const keep = PROP.th + PROP.sideClear;
  const pts = rim.flat();
  const near = (p) => pts.some((q) => Math.abs(q[0] - p[0]) < keep && Math.abs(q[1] - p[1]) < keep
    && Math.hypot(q[0] - p[0], q[1] - p[1]) < keep);
  const out = [];
  for (const row of rows) {
    let cur = [];
    for (const p of row) {
      if (near(p)) { if (cur.length) out.push(cur); cur = []; } else cur.push(p);
    }
    if (cur.length) out.push(cur);
  }
  return out.filter((t) => t.length >= PROP.minStations);
}

// the patch's free outline edges, seated: [[p, q], ...]
function freeEdges(topo, result, rot, own) {
  const { pos, adjA, adjB } = topo, off = result.offset;
  const S = (o) => seat(pos, o, rot, off, [0, 0, 0]);
  const segs = [];
  for (let k = 0; k < adjA.length; k++) {
    const a = adjA[k], b = adjB[k];
    if (own.has(a) === own.has(b)) continue;
    const o = own.has(a) ? a : b, n = own.has(a) ? b : a;
    // the overhang carries on -- unless only as a sliver the engine drops (the lower
    // half of a rounded edge: the reel's round lip, beyond the flat patch's edge)
    if (result.over[n] && result.kept[n]) continue;
    const shared = sharedEdge(pos, o, n);
    if (!shared) continue;
    const [p, q] = shared.map(S);
    if (Math.min(p[2], q[2]) < PROP.minHeightSquat) continue;   // resting at the bed
    if (attached(topo, result, rot, o, n, shared, p, q)) continue;   // part goes down
    segs.push([p, q]);
  }
  return segs;
}

// segments joined end to end into polylines (a closed loop comes back closed)
function chains(segs) {
  const key = (p) => `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)},${Math.round(p[2] * 1e4)}`;
  const at = new Map();
  segs.forEach((s, i) => { for (const p of s) { const k = key(p); (at.get(k) ?? at.set(k, []).get(k)).push(i); } });
  const used = new Uint8Array(segs.length), out = [];
  const grow = (line, from) => {
    for (;;) {
      const next = (at.get(key(line.at(-1))) ?? []).find((i) => !used[i]);
      if (next === undefined) return;
      used[next] = 1;
      const [p, q] = segs[next];
      line.push(key(p) === key(line.at(-1)) ? q : p);
      if (key(line.at(-1)) === key(from)) return;       // closed
    }
  };
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const line = [segs[i][0], segs[i][1]];
    grow(line, line[0]);
    if (key(line.at(-1)) !== key(line[0])) {            // open: grow the other end too
      line.reverse();
      grow(line, line[0]);
    }
    out.push(line);
  }
  return out;
}

// stations every `step` along a polyline (its own vertices' z, linearly)
function resample(line, step) {
  const out = [line[0]];
  let carry = 0;
  for (let i = 1; i < line.length; i++) {
    const p = line[i - 1], q = line[i];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    let t = step - carry;
    while (t <= len) {
      const u = t / len;
      out.push([p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u, p[2] + (q[2] - p[2]) * u]);
      t += step;
    }
    carry = len - (t - step);
  }
  return out;
}

// each station moved PROP.edgeInset in, toward the region's underside, z its
// surface there; null where the surface isn't under it
function inset(line, regionTris) {
  const e = PROP.edgeInset;
  return line.map((p, i) => {
    const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const tl = Math.hypot(tx, ty);
    if (tl < 1e-9) return null;
    tx /= tl; ty /= tl;
    const side = [1, -1].find((s) => surfaceZAt(regionTris, p[0] - s * ty * 0.5, p[1] + s * tx * 0.5) !== null);
    if (side === undefined) return null;
    const x = p[0] - side * ty * e, y = p[1] + side * tx * e;
    const z = surfaceZAt(regionTris, x, y);
    return z === null ? null : [x, y, z];
  });
}

// the runs of stations between nulls
function runs(line) {
  const out = [];
  let cur = [];
  for (const p of line) {
    if (p) cur.push(p); else { if (cur.length) out.push(cur); cur = []; }
  }
  if (cur.length) out.push(cur);
  return out;
}

// a run cut into pull-out pieces, RIM.pieceGap apart
function pieces(run, step) {
  const out = [];
  const gap = Math.max(1, Math.round(RIM.pieceGap / step));
  const maxN = Math.max(PROP.minStations, Math.round(RIM.pieceLen / step));
  const maxTurn = (RIM.pieceTurn * Math.PI) / 180;
  let cur = [], turn = 0;
  for (let i = 0; i < run.length; i++) {
    const p = run[i];
    if (cur.length >= 2) {
      const a = cur.at(-2), b = cur.at(-1);
      const h = Math.atan2(p[1] - b[1], p[0] - b[0]), h0 = Math.atan2(b[1] - a[1], b[0] - a[0]);
      let d = h - h0;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      turn += d;
    }
    if (cur.length >= maxN || Math.abs(turn) > maxTurn) {
      out.push(cur);
      cur = []; turn = 0;
      i += gap - 1;                                     // leave the gap
      continue;
    }
    cur.push(p);
  }
  if (cur.length) out.push(cur);
  return out;
}
