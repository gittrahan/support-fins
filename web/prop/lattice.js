/**
 * Lattice nets: a big overhang region that is really many struts joined at nodes.
 *
 * Issue #121 (a headset's ring-and-strut shell). A strut standing alone is its own
 * small region and takes the small-tube route -- one wall under its lowest line.
 * Where struts MEET, their undersides join into one region (the headset's crown:
 * 1,516 mm2, the whole net), which is over tubeMinArea, so it went to splitRegion,
 * whose 15-degree cut shattered every round strut into facet strips under
 * MIN_REGION_AREA (229 patches, most dropped as slivers): two walls for the net.
 * The same strut got a wall or nothing depending on whether it touched a
 * neighbour -- "overhangs that look identical don't get the same support".
 *
 * `latticeStruts` cuts such a region back into its struts, so each can take the
 * route a standalone strut already takes. In plan: rasterise the region's
 * footprint, thin it to a one-cell skeleton (Zhang-Suen), cut the skeleton at its
 * junctions, and hand every face to the branch nearest it WITHIN the footprint
 * (a breadth-first flood out from the branches, so a face never jumps a hole to a
 * strut across the ring). Only a NET qualifies: narrow everywhere (the footprint's
 * widest point, 99th percentile, at most NET_HALF from its edge) and at least
 * MIN_STRUTS struts. A broad face, a bowl, a single tube all return null and route as
 * before.
 *
 * `strutPatches` then routes each strut the way buildProps routes a standalone
 * small region: the small-tube line raced against its split patches (rival.js),
 * or else the whole strut as ONE patch whose track runs along the strut (its long
 * axis, see patchTracks `axis`), not down the slope and not split again. Each strut's own faces pick its line; the walls
 * still finish against the whole region's triangles (`regionTris`), as every
 * patch does.
 *
 * buildProps runs this in the raster pass's slot (the per-region contender raced
 * against the normal placement, prop/raster.js), so a lattice region swaps only
 * when its struts' walls hold more than the normal walls did.
 */
import { PROP } from './config.js';
import { splitRegion, tubeLine } from './tracks.js';

const CELL = 0.5;            // mm, plan raster
// A strut's underside is at most NET_HALF from its edge (99th percentile of the
// footprint), and a net has at least MIN_STRUTS of them. Measured: the headset
// crown 2.7 mm / 28-32 struts; voron_filter_housing Y45's bands 4.0 mm / 4 pieces,
// which are broad faces, and swapping their three cross walls for one long one
// cost 6 tines and coverage (the sweep caught it at 4.0 mm / p95 / no count).
const NET_HALF = 3.5;
const MIN_STRUTS = 5;
const NODE_CUT = 1.5;        // cells of skeleton removed around each junction

/**
 * Face groups (arrays of face indices), one per strut, or null when `faces` is
 * not a lattice net. `seated(f)` gives face f's three seated vertices.
 */
export function latticeStruts(topo, faces, seated) {
  let area = 0;
  for (const f of faces) area += topo.area[f];
  if (area < PROP.tubeMinArea) return null;          // small regions already take the tube route

  // --- footprint raster ----------------------------------------------------
  const tri = faces.map(seated);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const t of tri) for (const v of t) {
    if (v[0] < x0) x0 = v[0]; if (v[0] > x1) x1 = v[0];
    if (v[1] < y0) y0 = v[1]; if (v[1] > y1) y1 = v[1];
  }
  x0 -= 2 * CELL; y0 -= 2 * CELL;
  const W = Math.ceil((x1 - x0) / CELL) + 3, H = Math.ceil((y1 - y0) / CELL) + 3;
  if (W * H > 4e6) return null;                      // a 1 m part: not a strut net
  const idx = (i, j) => j * W + i;
  const cellOf = (x, y) => [Math.floor((x - x0) / CELL), Math.floor((y - y0) / CELL)];
  const fp = new Uint8Array(W * H);
  for (const [a, b, c] of tri) {
    const [i0, j0] = cellOf(Math.min(a[0], b[0], c[0]), Math.min(a[1], b[1], c[1]));
    const [i1, j1] = cellOf(Math.max(a[0], b[0], c[0]), Math.max(a[1], b[1], c[1]));
    const d = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = x0 + (i + 0.5) * CELL, py = y0 + (j + 0.5) * CELL;
      if (Math.abs(d) < 1e-12) { fp[idx(i, j)] = 1; continue; }   // edge-on: its box is a sliver anyway
      const u = ((b[0] - px) * (c[1] - py) - (c[0] - px) * (b[1] - py)) / d;
      const v = ((c[0] - px) * (a[1] - py) - (a[0] - px) * (c[1] - py)) / d;
      const tol = CELL / Math.sqrt(Math.abs(d));    // a half-cell grace, so thin strips stay connected
      if (u >= -tol && v >= -tol && 1 - u - v >= -tol) fp[idx(i, j)] = 1;
    }
  }

  // --- narrow everywhere? (distance to the footprint's edge, chamfer 3-4) ----
  const dist = new Float32Array(W * H);
  for (let k = 0; k < W * H; k++) dist[k] = fp[k] ? 1e9 : 0;
  const relax = (k, n, w) => { if (dist[n] + w < dist[k]) dist[k] = dist[n] + w; };
  for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) {
    const k = idx(i, j); if (!fp[k]) continue;
    relax(k, k - 1, 3); relax(k, k - W, 3); relax(k, k - W - 1, 4); relax(k, k - W + 1, 4);
  }
  for (let j = H - 2; j > 0; j--) for (let i = W - 2; i > 0; i--) {
    const k = idx(i, j); if (!fp[k]) continue;
    relax(k, k + 1, 3); relax(k, k + W, 3); relax(k, k + W + 1, 4); relax(k, k + W - 1, 4);
  }
  const inside = [];
  for (let k = 0; k < W * H; k++) if (fp[k]) inside.push((dist[k] / 3) * CELL);
  inside.sort((a, b) => a - b);
  if (!inside.length || inside[Math.floor(0.99 * (inside.length - 1))] > NET_HALF) return null;

  // --- skeleton (Zhang-Suen thinning) --------------------------------------
  const sk = fp.slice();
  const nb = (k) => [sk[k - W], sk[k - W + 1], sk[k + 1], sk[k + W + 1], sk[k + W], sk[k + W - 1], sk[k - 1], sk[k - W - 1]];
  for (let changed = true; changed;) {
    changed = false;
    for (const pass of [0, 1]) {
      const del = [];
      for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) {
        const k = idx(i, j); if (!sk[k]) continue;
        const p = nb(k);                              // p2..p9, clockwise from north
        const B = p.reduce((s, q) => s + q, 0);
        if (B < 2 || B > 6) continue;
        let A = 0; for (let q = 0; q < 8; q++) if (!p[q] && p[(q + 1) % 8]) A++;
        if (A !== 1) continue;
        if (pass === 0 ? (p[0] * p[2] * p[4] || p[2] * p[4] * p[6]) : (p[0] * p[2] * p[6] || p[0] * p[4] * p[6])) continue;
        del.push(k);
      }
      for (const k of del) sk[k] = 0;
      if (del.length) changed = true;
    }
  }

  // --- cut at junctions into branches --------------------------------------
  const N8 = [-W - 1, -W, -W + 1, -1, 1, W - 1, W, W + 1];
  const junction = [];
  for (let k = 0; k < W * H; k++) {
    if (!sk[k]) continue;
    let n = 0; for (const d of N8) if (sk[k + d]) n++;
    if (n >= 3) junction.push(k);
  }
  if (!junction.length) return null;                 // one band or a ring: not a net
  const cut = sk.slice();
  const r = Math.ceil(NODE_CUT);
  for (const k of junction) {
    const i = k % W, j = (k - i) / W;
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      const ii = i + di, jj = j + dj;
      if (ii >= 0 && jj >= 0 && ii < W && jj < H) cut[idx(ii, jj)] = 0;
    }
  }
  const label = new Int32Array(W * H).fill(-1);
  let branches = 0;
  for (let k = 0; k < W * H; k++) {
    if (!cut[k] || label[k] >= 0) continue;
    const q = [k]; label[k] = branches;
    while (q.length) { const c = q.pop(); for (const d of N8) if (cut[c + d] && label[c + d] < 0) { label[c + d] = branches; q.push(c + d); } }
    branches++;
  }
  if (branches < 2) return null;

  // --- every footprint cell to its nearest live branch, through the footprint,
  // then faces by the branch under their centroid. A branch whose faces come to
  // under tubeSmallMinArea (a thinning spur at a strut's corner or a wide node)
  // is dropped and the flood rerun, so its cells go to the real struts beside
  // it instead of taking their faces down with it.
  const seed = label.slice();
  const centre = faces.map((f, n) => {
    const t = tri[n];
    const [i, j] = cellOf((t[0][0] + t[1][0] + t[2][0]) / 3, (t[0][1] + t[1][1] + t[2][1]) / 3);
    return idx(i, j);
  });
  const dead = new Uint8Array(branches);
  let groups;
  for (;;) {
    let front = [];
    for (let k = 0; k < W * H; k++) {
      label[k] = seed[k] >= 0 && !dead[seed[k]] ? seed[k] : -1;
      if (label[k] >= 0) front.push(k);
    }
    while (front.length) {
      const next = [];
      for (const c of front) for (const d of N8) {
        const n = c + d;
        if (fp[n] && label[n] < 0) { label[n] = label[c]; next.push(n); }
      }
      front = next;
    }
    groups = Array.from({ length: branches }, () => []);
    faces.forEach((f, n) => { const b = label[centre[n]]; if (b >= 0) groups[b].push(f); });
    let pruned = false;
    groups.forEach((g, b) => {
      if (g.length && g.reduce((s, f) => s + topo.area[f], 0) < PROP.tubeSmallMinArea) { dead[b] = 1; pruned = true; }
    });
    if (!pruned) break;
  }
  const sized = groups.filter((g) => g.length);
  if (sized.length < MIN_STRUTS) return null;
  // Faces no live branch reaches (an island of footprint with no strut of its
  // own) get no wall: counted as the caller's slivers, not silently dropped.
  sized.lost = faces.length - sized.reduce((s, g) => s + g.length, 0);
  return sized;
}

/**
 * buildProps patches for a lattice region's struts (`groups`, from latticeStruts),
 * each marked `strut`.
 */
export function strutPatches(topo, rot, groups, seated, step, region, regionTris) {
  const patches = [];
  for (const faces of groups) {
    const tris = new Float64Array(faces.length * 9), pts = [];
    let area = 0;
    faces.forEach((f, k) => {
      const t = seated(f);
      area += topo.area[f];
      for (let i = 0; i < 3; i++) { tris.set(t[i], k * 9 + i * 3); pts.push(t[i]); }
      pts.push([0, 1, 2].map((c) => (t[0][c] + t[1][c] + t[2][c]) / 3));
    });
    const axis = longAxis(pts);
    const tube = tubeLine(topo, faces, rot, pts, tris, step);
    if (tube?.length) {
      // raced against its split patches (rival.js) when small, as a standalone
      // small tube is; over tubeMinArea it is a plain tube, as a standalone one is
      const small = area < PROP.tubeMinArea;
      const split = small ? splitRegion(topo, faces, rot).map((p) => Object.assign(p, { strut: true, axis })) : null;
      patches.push({ faces, area, region, tris: regionTris, reach: tris, lines: tube, smallTube: split, strut: true });
      continue;
    }
    // Not a tube: the WHOLE strut is one patch. splitRegion's 15-degree cut is
    // what shattered the net in the first place, and it cuts a chamfered strut
    // lengthwise into strips just the same.
    patches.push({ faces, area, region, tris: regionTris, strut: true, axis });
  }
  return patches;
}

/** Unit principal axis of points in plan (a strut's length direction). */
function longAxis(pts) {
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p[0]; cy += p[1]; }
  cx /= pts.length; cy /= pts.length;
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of pts) { const dx = p[0] - cx, dy = p[1] - cy; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
  const tr = sxx + syy, det = sxx * syy - sxy * sxy;
  const lam = tr / 2 + Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  let ux = sxy, uy = lam - sxx;
  if (Math.hypot(ux, uy) < 1e-9) { ux = sxx >= syy ? 1 : 0; uy = sxx >= syy ? 0 : 1; }
  const n = Math.hypot(ux, uy);
  return [ux / n, uy / n];
}
