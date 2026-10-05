import { insidePart } from '../../web/inside.js';

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
 *
 * Each face also gets a CLASS (classify, below): must-hold, a tiny hole's
 * ceiling, or the near-plate strip. Policy 2026-10-05: every red face must get
 * something, except tiny holes (a model issue -- they stay flagged, unsupported);
 * the near-plate strip is reported apart until a shim is coupon-tested.
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
  const cls = classify(topo, res, rot);
  const faces = [];
  let area = 0, held = 0, small = 0, smallHeld = 0;
  const by = [[0, 0], [0, 0], [0, 0]];      // per CLASS: [area, held]
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
    by[cls[f]][0] += a; if (h) by[cls[f]][1] += a;
    faces.push([f, h ? 1 : 0, s ? 1 : 0, cls[f]]);
  }
  return { faces, area, held, small, smallHeld,
           must: by[MUST][0], mustHeld: by[MUST][1], hole: by[HOLE][0], holeHeld: by[HOLE][1],
           low: by[LOW][0], lowHeld: by[LOW][1] };
}

export const MUST = 0, HOLE = 1, LOW = 2;
// A TINY HOLE is a horizontal bore this wide or less (Matthew 2026-10-05: ~6 mm;
// the DRO housing's top-plate holes are 3 mm). Its ceiling's overhang band (normal
// past 45deg) is a chord of 0.71 x the diameter, so a patch narrower than that,
// with part under it within the diameter and part either side just under its
// apex, is a hole's ceiling. A mini's sleeve over an arm has air on one side.
const HOLE_D = 6.0;
// The NEAR-PLATE strip: under the squat-wall floor (0.6 wall + 0.2 gap), where no
// wall fits (prop/config.js minHeightSquat). Above the 0.6 the plate already holds.
const LOW_Z = 0.82;

/**
 * Per overhang face (`res.over`), its class: MUST, HOLE or LOW (Uint8Array,
 * indexed by face; 0 for faces that aren't overhang). Faces are grouped into
 * connected patches (topo adjacency), and a patch is a HOLE as a whole; LOW is
 * per face, since a curved underside runs from the plate up through it.
 */
export function classify(topo, res, rot) {
  const { pos, nFaces, adjA, adjB, nrm, area } = topo;
  const off = res.offset;
  const cls = new Uint8Array(nFaces);
  const seat = (o) => [rot[0] * pos[o] + rot[3] * pos[o + 1] + rot[6] * pos[o + 2] + off.x,
    rot[1] * pos[o] + rot[4] * pos[o + 1] + rot[7] * pos[o + 2] + off.y,
    rot[2] * pos[o] + rot[5] * pos[o + 1] + rot[8] * pos[o + 2] + off.z];
  // connected overhang patches, union-find over shared edges
  const parent = new Int32Array(nFaces).map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  for (let k = 0; k < adjA.length; k++) {
    const a = adjA[k], b = adjB[k];
    if (res.over[a] && res.over[b]) parent[find(a)] = find(b);
  }
  const patches = new Map();
  for (let f = 0; f < nFaces; f++) if (res.over[f]) {
    const r = find(f);
    let p = patches.get(r); if (!p) patches.set(r, (p = []));
    p.push(f);
  }
  const inside = (x, y, z) => insidePart(topo, rot, off, x, y, z);
  for (const faces of patches.values()) {
    // plan extent across the patch's minor axis (2D PCA of its vertices)
    const pts = [];
    let top = -Infinity;
    for (const f of faces) for (let i = 0; i < 3; i++) {
      const v = seat(f * 9 + i * 3);
      pts.push(v);
      if (v[2] > top) top = v[2];
    }
    let mx = 0, my = 0;
    for (const v of pts) { mx += v[0]; my += v[1]; }
    mx /= pts.length; my /= pts.length;
    let sxx = 0, sxy = 0, syy = 0;
    for (const v of pts) { const dx = v[0] - mx, dy = v[1] - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
    const tr = sxx + syy, det = sxx * syy - sxy * sxy;
    const lam = tr / 2 + Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
    let ux = sxy, uy = lam - sxx;
    if (Math.hypot(ux, uy) < 1e-9) { ux = 1; uy = 0; }
    const un = Math.hypot(ux, uy); ux /= un; uy /= un;
    // Across the bore is whichever axis has part on BOTH sides: a short bore (a hole
    // through a 3 mm plate) is about as long as it is wide, so the principal axis
    // can land either way (the DRO's top-plate holes: 2.9 x 3.2 mm).
    const extent = (ax, ay) => {
      let lo = Infinity, hi = -Infinity;
      for (const v of pts) { const t = (v[0] - mx) * ax + (v[1] - my) * ay; lo = Math.min(lo, t); hi = Math.max(hi, t); }
      return hi - lo;
    };
    // probed from the patch's plan centre at the apex height: the highest vertex
    // itself can sit at the bore's mouth, on the plate's face, where every probe
    // grazes the boundary
    const z = top - 0.5;                     // just under the apex
    const apex = [mx, my, top];
    // part either side, equally far: a round bore is symmetric about its apex
    const wallAt = (ax, ay, sg) => {
      for (let d = 0.25; d <= HOLE_D / 2 + 1; d += 0.25) if (inside(apex[0] + sg * ax * d, apex[1] + sg * ay * d, z)) return d;
      return null;
    };
    const walled = (ax, ay) => {
      const a = wallAt(ax, ay, 1), b = wallAt(ax, ay, -1);
      return a !== null && b !== null && Math.abs(a - b) <= 0.5;
    };
    // a CYLINDER: every ceiling face's normal is square to the bore axis, which
    // runs across the walled direction (a goblin's armpit is walled and floored
    // too, and was 90 of its 106 mm2 of overhang until this)
    const square = (ax, ay) => {
      let off = 0, tot = 0;
      for (const f of faces) {
        const n = [0, 1, 2].map((k) => rot[k] * nrm[f * 3] + rot[3 + k] * nrm[f * 3 + 1] + rot[6 + k] * nrm[f * 3 + 2]);
        off += area[f] * Math.abs(n[0] * -ay + n[1] * ax);   // component along the bore (ax,ay rotated 90deg)
        tot += area[f];
      }
      return tot > 0 && off / tot < 0.15;
    };
    const narrow = (ax, ay) => extent(ax, ay) <= 0.71 * HOLE_D + 0.25 && walled(ax, ay) && square(ax, ay);
    // and a CEILING: some face within ~14deg of straight down -- a bore's apex or a
    // slot's flat roof. A V-notch (the Bosch vac's toothed ring) passes every test
    // above and is no bridge; only some of its identical teeth did, on probe noise.
    let roof = false;
    for (const f of faces) {
      if (rot[2] * nrm[f * 3] + rot[5] * nrm[f * 3 + 1] + rot[8] * nrm[f * 3 + 2] < -0.97) { roof = true; break; }
    }
    let hole = roof && (narrow(-uy, ux) || narrow(ux, uy));
    if (hole) {
      // under the apex: the bore's floor within a diameter
      let floor = false;
      for (let d = 0.5; d <= HOLE_D + 1e-9 && !floor; d += 0.5) floor = inside(apex[0], apex[1], apex[2] - d);
      hole = floor;
    }
    for (const f of faces) {
      if (hole) { cls[f] = HOLE; continue; }
      let cz = 0;
      for (let i = 0; i < 3; i++) cz += seat(f * 9 + i * 3)[2] / 3;
      cls[f] = cz < LOW_Z ? LOW : MUST;
    }
  }
  return cls;
}
