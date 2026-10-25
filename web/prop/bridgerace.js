/**
 * A flat patch's walls turned across the slicer's bridge (prop/bridge.js)
 * against the same patch's walls the old way, along the longer free run.
 *
 * Why a race. Turning is right for the print -- walls parallel to the bridge
 * lines hold one line each (orient coupon: "junk") -- but a turned wall is
 * shorter and its rows fit the face differently, and on some parts it simply
 * holds less: the first sweep lost >2 points of coverage on 10 cases
 * (ssdMounts flat cov0 100 -> 77 %). Quality first, so a turned patch keeps its
 * walls only while they hold about as much; otherwise the old walls stay
 * (Matthew, 2026-10-23: race per patch).
 *
 * buildProps drives it from its patch loop, like tubeRivalry:
 *
 *   race.begin(patch);                  // top of every patch, before tubeRivalry's
 *   ...lines = patchTracks(...)...      //   mark: a settle cuts `out` back
 *   race.turned(patch, lines, patches); // queue the old-way twin
 *   ...build the patch's walls...
 *   race.finish();                             // after the loop
 *
 * The twin runs right after its patch, so the two builds are the tail of `out`
 * when they are judged, and the loser can be cut off or the winner moved down.
 */
import { PROP } from './config.js';
import { routeState } from './rival.js';

// The old walls win only by this much more held area: RACE_REL of the turned
// walls' held area, and at least RACE_ABS mm2 (a sliver is not worth parallel walls).
export const RACE_REL = 0.02;
export const RACE_ABS = 2.0;

export function bridgeRace(acc) {
  const { out, props, skipped, served, tally } = acc;
  // plus the tests' tine capture (globalThis.__TINECAP, see raster.js): the loser's
  // tines come out of it too, and a moved winner's walls point at their new slice
  const route = routeState(acc);
  const snapshot = () => ({ ...route.snapshot(), cap: globalThis.__TINECAP?.length ?? null });
  const restore = (m) => {
    route.restore(m);
    if (m.cap !== null && globalThis.__TINECAP) globalThis.__TINECAP.length = m.cap;
  };
  let pending = null;          // { patch, twin, start, mid }

  // keep [mid, end) in place of [start, end): restore to start, push the tail back
  const keepTail = (start, mid, region) => {
    const end = snapshot();
    const tris = out.slice(mid.out), qs = props.slice(mid.props);
    const caps = mid.cap === null ? [] : globalThis.__TINECAP.slice(mid.cap);
    restore(start);
    const shift = out.length - mid.out;
    for (const t of tris) out.push(t);
    const capShift = start.cap === null ? 0 : globalThis.__TINECAP.length - mid.cap;
    for (const c of caps) globalThis.__TINECAP.push(c);
    const move = (r, d) => r && [r[0] + d, r[1] + d];
    for (const q of qs) {
      props.push({ ...q, triRanges: q.triRanges.map((r) => move(r, shift)),
                   ...(q.wallRange ? { wallRange: move(q.wallRange, shift) } : {}),
                   ...(q.caps ? { caps: move(q.caps, capShift) } : {}) });
    }
    tally.tines += end.tines - mid.tines;
    for (const k in skipped) skipped[k] += end.skipped[k] - mid.skipped[k];
    tally.sagRisk ||= end.sagRisk;
    for (const r of end.served) if (!mid.served.has(r)) served.add(r);
    // the turned walls had served the patch's own region before mid, so the diff
    // above misses it: restored to start, the region read unserved (lowledge cov0)
    if (qs.length) served.add(region);
  };

  const settle = () => {
    if (!pending?.mid) return;
    const { patch, start, mid } = pending;
    pending = null;
    const turned = heldPieces(patch.tris, out, start.out, mid.out);
    const old = heldPieces(patch.tris, out, mid.out, out.length);
    if (old > turned + Math.max(RACE_ABS, RACE_REL * turned)) keepTail(start, mid, patch.region);
    else restore(mid);
  };

  return {
    /** Top of every patch: settle a finished race, or mark where the twin starts.
     *  Before any other mark is taken -- a settle cuts `out` back, and a small
     *  tube's mark taken first undid to past the end (holes in `out`). */
    begin(patch) {
      if (pending && patch === pending.twin) pending.mid = snapshot();
      else if (pending) settle();
    },
    /** The patch's tracks are laid: if they were turned (`lines.turned` = the old
     *  axis), queue its old-way twin next. Nothing is built between begin and here,
     *  so the race starts here: only turned patches pay for a snapshot. */
    turned(patch, lines, patches) {
      if (!lines.turned || patch.bridgeTwin || patch.rival || patch.smallTube || patch.axis) return;
      const twin = { ...patch, axis: lines.turned, bridgeTwin: true };
      patches.splice(patches.indexOf(patch) + 1, 0, twin);   // for...of reaches it next
      pending = { patch, twin, start: snapshot(), mid: null };
    },
    /** After the patch loop: settle the last race. */
    finish() { settle(); },
  };
}

// Region area held by support triangles tris[from..to), on the sweep's own
// ruler (prototype/sweep/sweep.js coverage): each face cut into ~SUB mm pieces,
// a piece held when a support vertex sits within maxUnsupportedSpan in plan and
// 0-3 mm below it. Judged by centroid, a flat ceiling of two big triangles read
// fully held by rows 30 mm apart (lowledge cov0 tied 1760 = 1760 mm2 while the
// sweep said 100 -> 82 %). `faces` = the region's seated triangles, flat xyz.
const SUB = 3;
function heldPieces(faces, tris, from, to) {
  const span = PROP.maxUnsupportedSpan, grid = new Map();
  const key = (i, j) => i * 100003 + j;
  for (let i = from; i < to; i++) {
    const v = tris[i], k = key(Math.floor(v[0] / span), Math.floor(v[1] / span));
    let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(v);
  }
  const heldAt = (cx, cy, cz) => {
    const gi = Math.floor(cx / span), gj = Math.floor(cy / span);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      for (const v of grid.get(key(gi + di, gj + dj)) ?? []) {
        if (v[2] > cz - 3 && v[2] < cz + 0.5 && Math.hypot(v[0] - cx, v[1] - cy) <= span) return true;
      }
    }
    return false;
  };
  let held = 0;
  for (let t = 0; t + 8 < faces.length; t += 9) {
    const ax = faces[t], ay = faces[t + 1], az = faces[t + 2];
    const ux = faces[t + 3] - ax, uy = faces[t + 4] - ay, uz = faces[t + 5] - az;
    const vx = faces[t + 6] - ax, vy = faces[t + 7] - ay, vz = faces[t + 8] - az;
    const area = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    if (area < 1e-9) continue;
    const n = Math.max(1, Math.ceil(Math.max(Math.hypot(ux, uy, uz), Math.hypot(vx, vy, vz),
      Math.hypot(vx - ux, vy - uy, vz - uz)) / SUB));
    const piece = area / (n * n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n - i; j++) {
      // upright piece at (i, j), plus the inverted one beside it
      for (const [s1, t1] of j < n - i - 1 ? [[i + 1 / 3, j + 1 / 3], [i + 2 / 3, j + 2 / 3]] : [[i + 1 / 3, j + 1 / 3]]) {
        if (heldAt(ax + (ux * s1 + vx * t1) / n, ay + (uy * s1 + vy * t1) / n, az + (uz * s1 + vz * t1) / n)) held += piece;
      }
    }
  }
  return held;
}
