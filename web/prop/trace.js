/**
 * The Curved walls' tracing surface (#25, jagged overhangs). A rippled surface
 * near the overhang angle breaks its red into islands and slivers: a downhill line
 * traced on one region's own faces stops where the island ends, within a few mm,
 * too short to bend (coffee bean tilted back: 0 curves). With the box ticked, each
 * region is grown across the down-facing faces around it -- the slivers and the
 * steep strips between them -- up to `bridge` mm from the red it grew from, and
 * regions whose growth meets become one surface, traced once: their walls would
 * otherwise trace on top of each other. The group races as one region (raster.js).
 *
 * Unticked nothing here runs: the downhill pass traces each region's own faces.
 */
import { PROP } from './config.js';
import { seat } from './surface.js';

export const TRACE = {
  grow: 0.34,   // a face grows the surface if its normal points down more than this
                // (cos 70deg: a steep strip between red islands, not a wall's side)
  bridge: PROP.maxUnsupportedSpan / 2,   // mm in plan from the red it grew from: two
                // islands a span apart join, and a line runs no further past the red
                // than a wall reaches
  h: 2.0,       // mm: the slope's central-difference step: ripples under it don't steer
};

// Face neighbours (CSR from topo's edge pairs), built once per topology
const NEIGHBOURS = new WeakMap();
function neighbours(topo) {
  let nb = NEIGHBOURS.get(topo);
  if (nb) return nb;
  const { nFaces, adjA, adjB } = topo;
  const start = new Int32Array(nFaces + 1);
  for (let e = 0; e < adjA.length; e++) { start[adjA[e] + 1]++; start[adjB[e] + 1]++; }
  for (let f = 0; f < nFaces; f++) start[f + 1] += start[f];
  const fill = start.slice(0, nFaces), items = new Int32Array(start[nFaces]);
  for (let e = 0; e < adjA.length; e++) { items[fill[adjA[e]]++] = adjB[e]; items[fill[adjB[e]]++] = adjA[e]; }
  nb = { start, items };
  NEIGHBOURS.set(topo, nb);
  return nb;
}

/**
 * Tracing groups for the regions in `tried` (a Set of region indices). Returns
 * `leaderOf` (region -> its group's lowest region index) and per leader its
 * `members`, seated `tris` and `pts` (vertices + centroids, downhillLines's input)
 * and `red`: the [x, y, z] centroids of every overhang face on the surface,
 * slivers too -- what its lines must cover.
 */
export function traceGroups(topo, result, rot, off, tried) {
  const { pos, nFaces, nrm } = topo;
  const { start, items } = neighbours(topo);
  const { grow, bridge } = TRACE;
  const label = new Int32Array(nFaces).fill(-1);
  const cx = new Float64Array(nFaces), cy = new Float64Array(nFaces);
  const sx = new Float64Array(nFaces), sy = new Float64Array(nFaces);   // the red it grew from
  const v = [0, 0, 0];
  const centre = (f) => {
    let x = 0, y = 0;
    for (let i = 0; i < 3; i++) { seat(pos, f * 9 + i * 3, rot, off, v); x += v[0]; y += v[1]; }
    cx[f] = x / 3; cy[f] = y / 3;
  };
  const nz = (f) => rot[2] * nrm[f * 3] + rot[5] * nrm[f * 3 + 1] + rot[8] * nrm[f * 3 + 2];

  // union-find over region indices
  const parent = result.regions.map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) x = parent[x] = parent[parent[x]]; return x; };
  const join = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); };

  // Grow every tried region at once, breadth first, so a face goes to the nearer
  // region and two growths meet between their islands
  let queue = [];
  for (const ri of tried) {
    for (const f of result.regions[ri].faces) {
      label[f] = ri; centre(f); sx[f] = cx[f]; sy[f] = cy[f];
      queue.push(f);
    }
  }
  const grown = [];
  while (queue.length) {
    const next = [];
    for (const f of queue) {
      for (let k = start[f]; k < start[f + 1]; k++) {
        const g = items[k];
        if (result.excludedSupportFaces?.[g]) continue;
        if (label[g] >= 0) { if (label[g] !== label[f]) join(label[g], label[f]); continue; }
        if (result.onBed[g] || nz(g) > -grow) continue;
        centre(g);
        if (Math.hypot(cx[g] - sx[f], cy[g] - sy[f]) > bridge) continue;
        label[g] = label[f]; sx[g] = sx[f]; sy[g] = sy[f];
        next.push(g);
        grown.push(g);
      }
    }
    queue = next;
  }

  const leaderOf = new Map(), faces = new Map();
  for (const ri of tried) {
    const l = find(ri);
    leaderOf.set(ri, l);
    if (!faces.has(l)) faces.set(l, { members: [], list: [] });
    faces.get(l).members.push(ri);
  }
  for (const ri of tried) faces.get(find(ri)).list.push(...result.regions[ri].faces);
  for (const g of grown) faces.get(find(label[g])).list.push(g);

  const groups = new Map();
  for (const [l, { members, list }] of faces) {
    list.sort((a, b) => a - b);   // face order, not growth order: the same surface either way
    const tris = new Float64Array(list.length * 9), pts = [], red = [];
    for (let k = 0; k < list.length; k++) {
      const f = list[k];
      let gx = 0, gy = 0, gz = 0;
      for (let i = 0; i < 3; i++) {
        seat(pos, f * 9 + i * 3, rot, off, v);
        tris[k * 9 + i * 3] = v[0]; tris[k * 9 + i * 3 + 1] = v[1]; tris[k * 9 + i * 3 + 2] = v[2];
        pts.push([v[0], v[1], v[2]]);
        gx += v[0]; gy += v[1]; gz += v[2];
      }
      pts.push([gx / 3, gy / 3, gz / 3]);
      if (result.over[f]) red.push([gx / 3, gy / 3, gz / 3]);
    }
    groups.set(l, { members: members.sort((a, b) => a - b), tris, pts, red });
  }
  return { leaderOf, groups };
}
