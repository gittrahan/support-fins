/**
 * THE BRACE'S OWN STRIP of the part, for a brace placed by hand (GH #351).
 *
 * Auto stands braces on the flat patches planes.js finds: a patch is a supporting
 * plane with the surface no more than FLAT_TOL_IN (1.2 mm) behind it, which is
 * what lets one flat wall grip it. On a part that curves UP its side -- the back of
 * a bent arm, a domed slab -- the surface leaves that 1.2 mm band within a few cm,
 * so the patch under the cursor is a short strip and the brace is refused ("only
 * reaches 20mm up"), or stands as a flat plate the curve runs into ("the part
 * sticks out"). Which spots work then depends on where the patch seams fall, so a
 * user hovers the whole back to find the one that does.
 *
 * A brace doesn't need a flat face, only the face in its own slab. So a hand-placed
 * brace grows its patch from the clicked face over every connected face a brace may
 * stand against, kept to a strip either side of the click, with no flatness limit.
 * buildSwayRib then runs its inner edge up that strip in bands (the profiled shape
 * it already uses under a capped top), so the edge follows the curve, convex or
 * concave, and it stops the brace where the back rolls over past 45 degrees.
 */
import { faceAdjacency, fitPatch } from './planes.js';
import { clip } from './swayhit.js';
import { triIndex, eachCandidate } from './triindex.js';

export const COLUMN = {
  // mm either side of the click: covers buildSwayRib's nudges (±4), half the widest
  // rib (1.2) and a tine (0.5), with slack so the strip's sides don't clip it
  halfW: 10,
  // how far a face's heading (its normal, level) may turn from the clicked face's:
  // the flank of a dome turns away, and past this it is a different side of the part
  agreeDeg: 50,
};

const rnCache = new WeakMap();
/** Rotated face normals for this pose, cached per topology. */
function rotatedNormals(topo, rot) {
  const key = Array.from(rot).join(',');
  const hit = rnCache.get(topo);
  if (hit && hit.key === key) return hit.rn;
  const { nrm, nFaces } = topo;
  const rn = new Float64Array(nFaces * 3);
  for (let f = 0; f < nFaces; f++) {
    const i = f * 3, x = nrm[i], y = nrm[i + 1], z = nrm[i + 2];
    rn[i] = rot[0] * x + rot[3] * y + rot[6] * z;
    rn[i + 1] = rot[1] * x + rot[4] * y + rot[7] * z;
    rn[i + 2] = rot[2] * x + rot[5] * y + rot[8] * z;
  }
  rnCache.set(topo, { key, rn });
  return rn;
}

/**
 * The strip of faces a brace clicked at print-space `point` on face `faceIndex`
 * stands against, as a planes.js patch (supporting plane, frame, (u, t, dn) tris)
 * that may be curved. `takes(nz)` is the caller's rule for which faces take a brace.
 * Returns null if the strip is too small to be a patch at all.
 */
export function columnPatch(topo, rot, offset, faceIndex, point, takes) {
  const rn = rotatedNormals(topo, rot);
  const sx = rn[faceIndex * 3], sy = rn[faceIndex * 3 + 1];
  const sh = Math.hypot(sx, sy);
  if (sh < 1e-9 || !takes(rn[faceIndex * 3 + 2])) return null;
  const hx = sx / sh, hy = sy / sh;          // the clicked face's heading
  const ux = -hy, uy = hx;                   // across it, level
  const uc = point[0] * ux + point[1] * uy;
  const agreeCut = Math.cos((COLUMN.agreeDeg * Math.PI) / 180);
  const { pos, area, nFaces } = topo;

  // a face's span across the strip, in print space (u is level, so z never enters)
  const uSpan = (f) => {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < 3; i++) {
      const o = f * 9 + i * 3, x = pos[o], y = pos[o + 1], z = pos[o + 2];
      const wx = rot[0] * x + rot[3] * y + rot[6] * z + offset.x;
      const wy = rot[1] * x + rot[4] * y + rot[7] * z + offset.y;
      const u = wx * ux + wy * uy;
      if (u < lo) lo = u;
      if (u > hi) hi = u;
    }
    return [lo, hi];
  };
  const fits = (g) => {
    const x = rn[g * 3], y = rn[g * 3 + 1], h = Math.hypot(x, y);
    if (h < 1e-9 || !takes(rn[g * 3 + 2])) return false;
    if ((x * hx + y * hy) / h < agreeCut) return false;
    const [lo, hi] = uSpan(g);
    return hi >= uc - COLUMN.halfW && lo <= uc + COLUMN.halfW;
  };

  const { start, nbr } = faceAdjacency(topo);
  const seen = new Uint8Array(nFaces);
  const faces = [faceIndex], queue = [faceIndex];
  seen[faceIndex] = 1;
  let total = area[faceIndex];
  while (queue.length) {
    const f = queue.pop();
    for (let e = start[f]; e < start[f + 1]; e++) {
      const g = nbr[e];
      if (seen[g]) continue;
      seen[g] = 1;
      if (!fits(g)) continue;
      faces.push(g);
      total += area[g];
      queue.push(g);
    }
  }
  return fitPatch(topo, { faces, area: total }, rn, rot, offset, null, Infinity);
}

/**
 * The PART in a brace's slab -- up to `halfMax` either side of `uc`, from the plate
 * to `zTop`, within `reach` mm either side of patch `p`'s plane -- gathered once and
 * bucketed by height, for the bands a strip doesn't cover: below where it starts the
 * part is still there (the steeper foot of a bent arm), and the brace's inner edge
 * must stay outside it rather than fall back to the plane.
 *
 * `band(half, zLo, zHi)` is how far out of the plane (its w, as patch tris carry it)
 * the part reaches there, or null if nothing is.
 */
export function partSlab(partTris, p, uc, halfMax, zTop, reach = 80) {
  const n = p.n, ux = p.u.x, uy = p.u.y, hx = n.x / p.h, hy = n.y / p.h;
  // the slab's footprint: the plane at the bottom and the top, +-reach out of the
  // face (level) and +-halfMax across it
  let xa = Infinity, xb = -Infinity, ya = Infinity, yb = -Infinity;
  for (const z of [0, zTop]) {
    const t = (z - n.z * p.d) / p.t.z;
    const cx = n.x * p.d + ux * uc + p.t.x * t, cy = n.y * p.d + uy * uc + p.t.y * t;
    for (const sg of [-reach / p.h, reach / p.h]) {
      for (const u of [-halfMax, halfMax]) {
        const x = cx + hx * sg + ux * u, y = cy + hy * sg + uy * u;
        if (x < xa) xa = x; if (x > xb) xb = x;
        if (y < ya) ya = y; if (y > yb) yb = y;
      }
    }
  }
  // each triangle that may reach the slab, in (u, z, w), bucketed by the mm of z it spans
  const kept = [], buckets = [];
  eachCandidate(triIndex(partTris), xa, xb, ya, yb, (t) => {
    const i = t * 9, q = [];
    let uLo = Infinity, uHi = -Infinity, zLo = Infinity, zHi = -Infinity, wLo = Infinity, wHi = -Infinity;
    for (let k = 0; k < 3; k++) {
      const x = partTris[i + k * 3], y = partTris[i + k * 3 + 1], z = partTris[i + k * 3 + 2];
      const u = x * ux + y * uy, w = x * n.x + y * n.y + z * n.z - p.d;
      q.push([u, z, w]);
      if (u < uLo) uLo = u; if (u > uHi) uHi = u;
      if (z < zLo) zLo = z; if (z > zHi) zHi = z;
      if (w < wLo) wLo = w; if (w > wHi) wHi = w;
    }
    if (uHi < uc - halfMax || uLo > uc + halfMax || wHi < -reach || wLo > reach || zLo > zTop) return;
    const id = kept.push(q) - 1;
    for (let b = Math.max(0, Math.floor(zLo)); b <= Math.min(Math.floor(zTop), Math.floor(zHi)); b++) (buckets[b] ??= []).push(id);
  });
  const band = (half, zLo, zHi) => {
    let m = -Infinity;
    const seen = new Set();
    for (let b = Math.max(0, Math.floor(zLo)); b <= Math.floor(zHi); b++) {
      for (const id of buckets[b] ?? []) {
        if (seen.has(id)) continue;
        seen.add(id);
        let poly = kept[id];
        poly = clip(poly, (q) => q[0] - (uc - half));
        poly = clip(poly, (q) => (uc + half) - q[0]);
        poly = clip(poly, (q) => q[1] - zLo);
        poly = clip(poly, (q) => zHi - q[1]);
        poly = clip(poly, (q) => reach - Math.abs(q[2]));
        for (const q of poly) if (q[2] > m) m = q[2];
      }
    }
    return m === -Infinity ? null : m;
  };
  return { band };
}
