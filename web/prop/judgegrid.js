/**
 * The judge's anchor buckets (judge.js scorer): the wall-top and part-anchor points
 * near a sample, by cell in plan AND in height.
 *
 * The scorer asks, for every ~1 mm2 sample of every overhang face, which anchors lie
 * within `cell` (bridgeMax) in plan and 0..1.5 mm under it. The old bucket was plan
 * only: a sample read the 3 x 3 cells around it and threw most of them out on height,
 * and on a bust on its side (84,000 mm2 of overhang, anchors at every height) that read
 * was 5 of 12 s of Auto, 24 of 56 s at 512 mm, and a third of Suggest orientation.
 * Here the points are also bucketed by `zCell` of height, so a sample reads only the
 * one or two bands its 1.55 mm window crosses; each cell's points are stored flat.
 *
 * The scorer keeps a MINIMUM per direction, which no order of reading changes, and it
 * still applies its own height and distance tests to every point handed back: this
 * only has to hand back a superset of the points that pass them, which the band
 * window does with slack on both ends (`each`). Non-finite points can't pass those
 * tests and are left out. Cell keys past +-2^18 cells in plan (2^13 in height) wrap
 * onto other cells, which only adds candidates.
 */
const KI = 262144, KJ = 524288, KK = 8192, KZ = 16384;
const key = (i, j, k) => ((i + KI) * KJ + (j + KI)) * KZ + (k + KK);

/** Buckets over `pts` ([x, y, z, ...] each): `cell` mm in plan, `zCell` mm in height. */
export function anchorGrid(pts, cell, zCell) {
  const n = pts.length;
  const ci = new Int32Array(n), px = new Float64Array(n), py = new Float64Array(n), pz = new Float64Array(n);
  const cellOf = new Map();
  let m = 0, nc = 0;
  for (const p of pts) {
    const x = p[0], y = p[1], z = p[2];
    if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))) continue;
    const k = key(Math.floor(x / cell), Math.floor(y / cell), Math.floor(z / zCell));
    let c = cellOf.get(k);
    if (c === undefined) cellOf.set(k, (c = nc++));
    ci[m] = c; px[m] = x; py[m] = y; pz[m] = z; m++;
  }
  // counting sort: each cell's points contiguous in qx/qy/qz
  const start = new Int32Array(nc + 1);
  for (let i = 0; i < m; i++) start[ci[i] + 1]++;
  for (let c = 0; c < nc; c++) start[c + 1] += start[c];
  const cur = start.slice(0, nc);
  const qx = new Float64Array(m), qy = new Float64Array(m), qz = new Float64Array(m);
  for (let i = 0; i < m; i++) { const t = cur[ci[i]]++; qx[t] = px[i]; qy[t] = py[i]; qz[t] = pz[i]; }
  return {
    /** fn(x, y, z) for every point in the 3 x 3 plan cells around (x, y) whose
     *  height band meets [z0, z1]. */
    each(x, y, z0, z1, fn) {
      const gi = Math.floor(x / cell), gj = Math.floor(y / cell);
      const k0 = Math.floor(z0 / zCell), k1 = Math.floor(z1 / zCell);
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          for (let k = k0; k <= k1; k++) {
            const c = cellOf.get(key(gi + di, gj + dj, k));
            if (c === undefined) continue;
            for (let t = start[c], e = start[c + 1]; t < e; t++) fn(qx[t], qy[t], qz[t]);
          }
        }
      }
    },
  };
}
