/**
 * Which overhang faces a build actually holds -- the one rule probe.js and compare.js
 * share. A face counts as HELD when a wall-top point lies within maxUnsupportedSpan/2
 * of its centroid in plan and 0..1.5 mm below it, or it sits on the plate (z < 0.6).
 *
 * EVERY overhang face counts (`res.over`), including the ones in regions under
 * MIN_REGION_AREA that analyze() drops as slivers and the engine never looks at:
 * on a miniature those are most of the overhang (a 26 mm goblin: 106 mm2 of overhang,
 * 26 mm2 of it in a region big enough to be seen). `small` marks them, so a report
 * can say how much the floor alone costs.
 */
export function heldFaces(topo, res, rot, build, R) {
  const { pos } = topo;
  const off = res.offset;
  const tops = [];
  for (const w of build.fins ?? []) for (const p of w.line ?? []) tops.push(p);
  // grid the wall tops by plan cell, so a 1M-face mini isn't faces x tops
  const cell = Math.max(R, 1), grid = new Map();
  const key = (i, j) => i * 100003 + j;
  for (const p of tops) {
    const k = key(Math.floor(p[0] / cell), Math.floor(p[1] / cell));
    let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(p);
  }
  const near = (cx, cy, cz) => {
    const gi = Math.floor(cx / cell), gj = Math.floor(cy / cell);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      for (const p of grid.get(key(gi + di, gj + dj)) || []) {
        const dz = cz - p[2];
        if (dz >= -0.05 && dz <= 1.5 && Math.hypot(cx - p[0], cy - p[1]) <= R) return true;
      }
    }
    return false;
  };
  const faces = [];
  let area = 0, held = 0, small = 0, smallHeld = 0;
  for (let f = 0; f < topo.nFaces; f++) {
    if (!res.over[f]) continue;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < 3; i++) {
      const o = f * 9 + i * 3, x = pos[o], y = pos[o + 1], z = pos[o + 2];
      cx += (rot[0] * x + rot[3] * y + rot[6] * z + off.x) / 3;
      cy += (rot[1] * x + rot[4] * y + rot[7] * z + off.y) / 3;
      cz += (rot[2] * x + rot[5] * y + rot[8] * z + off.z) / 3;
    }
    const a = topo.area[f], s = !res.kept[f];
    const h = cz < 0.6 || near(cx, cy, cz);
    area += a; if (h) held += a;
    if (s) { small += a; if (h) smallHeld += a; }
    faces.push([f, h ? 1 : 0, s ? 1 : 0]);
  }
  return { faces, area, held, small, smallHeld };
}
