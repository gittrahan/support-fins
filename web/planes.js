/**
 * Wall sites: the flat, near-upright patches of the part that a fin can stand
 * against.
 *
 * WHY THIS EXISTS AT ALL. M3 swept a wall along the contact line *under* an
 * overhang, and that geometry can never take a horizontal tine: a wall passes
 * under the contact line or rises above it, never both, because at the contact
 * height the part touches the wall's plane and the wall would have to pinch to
 * zero thickness right there (prototype/probe_tines{,2}.py). So the fin stands
 * BESIDE the part instead, off an upright face, and the tines carry the load --
 * which is what "combined support" means and why docs/FIN-SPEC.md says to place
 * fins on an edge or corner.
 *
 * That turns fin placement into a search for flat upright faces, and a flat face
 * is something the topology already knows exactly. No raycasting is needed here,
 * and therefore no BVH: the probes fired compass rays because they were hunting
 * for a face at an unknown bearing, but working from the mesh's own faces gives
 * the plane directly, to float precision rather than to whatever the ray ladder
 * happened to sample.
 *
 * THE FIN LEANS WITH THE PART. A first version of this file required faces to be
 * within 15 degrees of vertical, which sounds obviously right and is obviously
 * wrong: tilting a part into a strong orientation is exactly what stops its
 * faces being vertical. On a Voron frame at 30 degrees it found ONE usable
 * patch out of 35,520 faces. The fin has to be parallel to the face it serves --
 * so it leans by the same angle, which prints fine, because a thin wall leaning
 * by up to MAX_LEAN_DEG is a self-supporting overhang. Everything here is
 * therefore expressed in the patch's own frame, not the world's.
 *
 * The payoff shows up in the tines. Because a patch is certified flat to
 * FLAT_TOL, the distance from the fin wall to the part is the standoff
 * EVERYWHERE on it -- so a tine is a fixed-size nub, not a measured bridge, and
 * it needs no per-tine ray to size it.
 */

/**
 * How far from vertical a face may lean and still take a fin. Past 45 degrees
 * the fin wall itself becomes an overhang that needs support, which would be a
 * fine joke at this project's expense.
 */
export const MAX_LEAN_DEG = 45;

/**
 * How far a face's normal may swing from its seed's and still join the patch.
 *
 * Wide on purpose. At 12 degrees this was the binding constraint on any round
 * part: a 32-sided cone steps 11.25 degrees per facet, so a patch could never
 * grow past its immediate neighbour no matter what the distance budget allowed.
 * The distance band below is the real guard -- every face is measured against
 * the SEED's plane, so nothing can creep -- and this only has to keep the patch
 * on surfaces still facing the fin, since a face turned edge-on would be skimmed
 * by a tine rather than bitten.
 */
export const NORMAL_AGREE_DEG = 35;

/**
 * How far the real surface may stray from the patch's fitted plane, in mm.
 *
 * The budget is ASYMMETRIC, because the two directions fail completely
 * differently and a single number has to be the smaller of them:
 *
 *   - TOWARD the fin, the wall is what gets hurt. Anything bulging past the
 *     standoff puts the wall inside the part; at 0.5mm this was measured 1.7mm
 *     deep in a Voron housing. The budget must stay under the standoff, and
 *     under the obstruction test's own threshold, or a patch blocks its own wall.
 *   - AWAY from the fin, nothing is hurt except tine length. The surface simply
 *     recedes and the tine reaches further, which is free until the tine stops
 *     being a tine: prototype/probe_tines2.py put that limit at 1.5mm of
 *     unsupported span, beyond which it is a bridge.
 *
 * Treating them as one number is what limited fins to flat-faced parts. A round
 * part's facets are 1-2mm tall, so a symmetric tolerance grips exactly one facet
 * -- on hub_post_foot at 70 degrees the best grip available anywhere on the part
 * was 0.86mm. Letting the surface recede lets one flat wall span many facets.
 */
export const FLAT_TOL_IN = 1.20;    // away from the fin; paid for in tine length
export const GROW_SLACK = 0.35;     // outward slack while growing, before the
                                    // supporting plane is known (see fitPatch)

export const MIN_PATCH_H = 4.0;     // mm, measured up the face
export const MIN_PATCH_W = 4.0;     // mm, measured across it
export const MIN_PATCH_AREA = 25.0; // mm^2

/**
 * Find every patch of the part a fin could stand against, in the orientation
 * `rot` with the part seated by `offset`.
 *
 * @param topo    from buildTopology()
 * @param rot     9-element column-major rotation (THREE.Matrix3.elements)
 * @param offset  {x,y,z} seating translation from analyze()
 * @returns patches, largest area first. Each carries its plane, an orthonormal
 *          frame, its extent in that frame, and its triangles projected into
 *          (u, t) so tine placement can test coverage.
 */
export function findWallPatches(topo, rot, offset, stats = null) {
  const { pos, nFaces, nrm, area } = topo;
  // A hair of slack past the exact sine. 45 degrees is the most common tilt a
  // user dials in -- a cube on its edge -- and its face normal lands on sin(45)
  // to the last float bit, so a bare `<=` let winding round-off reject or accept
  // the very same overhang. The slack is far below any real face spacing, so it
  // only pulls that exact-boundary face in; a genuinely flatter 46deg face stays
  // well outside it. Pinned by tests/patches.test.js.
  const leanCut = Math.sin((MAX_LEAN_DEG * Math.PI) / 180) + 1e-6;
  const agreeCut = Math.cos((NORMAL_AGREE_DEG * Math.PI) / 180);

  // rotated face normals, kept because both the grouping test and the plane fit
  // need them and they are not worth recomputing per edge
  const rn = new Float64Array(nFaces * 3);
  const upright = new Uint8Array(nFaces);
  for (let f = 0; f < nFaces; f++) {
    const i = f * 3;
    const x = nrm[i], y = nrm[i + 1], z = nrm[i + 2];
    const nx = rot[0] * x + rot[3] * y + rot[6] * z;
    const ny = rot[1] * x + rot[4] * y + rot[7] * z;
    const nz = rot[2] * x + rot[5] * y + rot[8] * z;
    rn[i] = nx; rn[i + 1] = ny; rn[i + 2] = nz;
    if (Math.abs(nz) <= leanCut && Math.hypot(nx, ny) > 1e-9) upright[f] = 1;
  }

  // Region-grow each patch from a seed face, testing every candidate against the
  // SEED's plane rather than against its neighbour's.
  //
  // The obvious implementation -- union-find over adjacent faces whose normals
  // agree pairwise -- is wrong, and wrong in a way that looks fine until you
  // measure it. Pairwise agreement creeps: a cylindrical boss's faces each differ
  // from the next by a few degrees, so the whole cylinder merges into one "flat"
  // group, and if it touches a real wall the wall is swallowed with it. On a
  // 35,520-face Voron frame that produced ZERO usable sites. Growing from a
  // fixed seed plane cannot creep, because the hundredth face is judged by the
  // same plane as the first.
  const { start, nbr } = faceAdjacency(topo);
  const seeds = [];
  for (let f = 0; f < nFaces; f++) if (upright[f]) seeds.push(f);
  seeds.sort((a, b) => area[b] - area[a]);   // biggest face defines the plane

  const taken = new Uint8Array(nFaces);
  const v = [0, 0, 0];
  const patches = [];
  const queue = [];

  for (const seed of seeds) {
    if (taken[seed]) continue;
    const sx = rn[seed * 3], sy = rn[seed * 3 + 1], sz = rn[seed * 3 + 2];

    let sd = 0;
    for (let i = 0; i < 3; i++) {
      worldVertex(pos, seed * 9 + i * 3, rot, offset, v);
      sd += v[0] * sx + v[1] * sy + v[2] * sz;
    }
    sd /= 3;

    taken[seed] = 1;
    const faces = [seed];
    let total = area[seed];
    queue.length = 0;
    queue.push(seed);

    while (queue.length) {
      const f = queue.pop();
      for (let e = start[f]; e < start[f + 1]; e++) {
        const g = nbr[e];
        if (taken[g] || !upright[g]) continue;
        const dot = rn[g * 3] * sx + rn[g * 3 + 1] * sy + rn[g * 3 + 2] * sz;
        if (dot < agreeCut) continue;
        let outward = -Infinity, inward = Infinity;
        for (let i = 0; i < 3; i++) {
          worldVertex(pos, g * 9 + i * 3, rot, offset, v);
          const dn = v[0] * sx + v[1] * sy + v[2] * sz - sd;
          if (dn > outward) outward = dn;
          if (dn < inward) inward = dn;
        }
        if (outward > GROW_SLACK || inward < -FLAT_TOL_IN) continue;
        taken[g] = 1;
        faces.push(g);
        total += area[g];
        queue.push(g);
      }
    }

    if (stats) stats.grown = (stats.grown ?? 0) + 1;
    if (total < MIN_PATCH_AREA) {
      if (stats) stats.tooSmall = (stats.tooSmall ?? 0) + 1;
      continue;
    }
    const patch = fitPatch(topo, { faces, area: total }, rn, rot, offset, stats);
    if (patch) patches.push(patch);
  }

  patches.sort((a, b) => b.area - a.area);
  return patches;
}

/** Neighbour lists in CSR form, cached on the topology (it is rotation-invariant). */
export function faceAdjacency(topo) {
  if (topo._adjStart) return { start: topo._adjStart, nbr: topo._adjNbr };
  const { nFaces, adjA, adjB } = topo;
  const start = new Int32Array(nFaces + 1);
  for (let e = 0; e < adjA.length; e++) { start[adjA[e] + 1]++; start[adjB[e] + 1]++; }
  for (let f = 0; f < nFaces; f++) start[f + 1] += start[f];
  const nbr = new Int32Array(start[nFaces]);
  const cur = start.slice(0, nFaces);
  for (let e = 0; e < adjA.length; e++) {
    nbr[cur[adjA[e]]++] = adjB[e];
    nbr[cur[adjB[e]]++] = adjA[e];
  }
  topo._adjStart = start;
  topo._adjNbr = nbr;
  return { start, nbr };
}

/** Rotate + seat one raw vertex into print space. */
function worldVertex(pos, o, rot, offset, out) {
  const x = pos[o], y = pos[o + 1], z = pos[o + 2];
  out[0] = rot[0] * x + rot[3] * y + rot[6] * z + offset.x;
  out[1] = rot[1] * x + rot[4] * y + rot[7] * z + offset.y;
  out[2] = rot[2] * x + rot[5] * y + rot[8] * z + offset.z;
  return out;
}

/**
 * Fit a plane to one face group and measure it, or return null if it is not a
 * usable fin site.
 *
 * The plane is `n · q = d`, with `n` the outward 3D normal. Its frame is:
 *
 *   n  out of the part
 *   u  across the face, always HORIZONTAL -- so the fin's length runs level,
 *      and a tine's width lies in the layer plane no matter how the part leans
 *   t  up the face, n x u, which always has a positive z component
 *
 * (n, u, t) is orthonormal and right-handed, which is what lets the extruder in
 * fins.js emit consistent outward winding without a per-solid orientation check.
 */
function fitPatch(topo, g, rn, rot, offset, stats = null) {
  const { pos, area } = topo;

  // area-weighted mean normal: a patch's big faces describe its plane, and a fan
  // of slivers in one corner should not be able to tilt it
  let nx = 0, ny = 0, nz = 0;
  for (const f of g.faces) {
    nx += rn[f * 3] * area[f];
    ny += rn[f * 3 + 1] * area[f];
    nz += rn[f * 3 + 2] * area[f];
  }
  const nl = Math.hypot(nx, ny, nz);
  if (nl < 1e-9) return null;
  nx /= nl; ny /= nl; nz /= nl;

  const h = Math.hypot(nx, ny);           // horizontal share of the normal
  if (h < 1e-6) {                         // a floor or ceiling, not a wall
    if (stats) stats.notUpright = (stats.notUpright ?? 0) + 1;
    return null;
  }
  const ux = -ny / h, uy = nx / h;        // horizontal, across the face

  // t = n x u, up the face. Note it is built from n's OWN horizontal direction
  // (nx/h, ny/h), not from u's components -- those are perpendicular to each
  // other, so using u here silently yields a vector that is not even in the
  // patch plane (t . n = nz*h). It is exactly right whenever nz = 0 and wrong in
  // proportion to the lean otherwise, which made it invisible on upright faces
  // and put a 40-degree face's tines 13.6mm away from their own wall.
  const tx = -nz * (nx / h), ty = -nz * (ny / h), tz = h;

  // The plane is a SUPPORTING plane -- it touches the outermost point of the
  // patch and the whole surface lies behind it -- not a mean plane through the
  // middle. That is what makes one flat wall safe against a curved face: with a
  // mean plane, the middle of the patch bulges toward the fin (about 1.1mm
  // across seven facets of a 9mm cone) and the wall is driven into the part.
  // Behind a supporting plane every deviation is negative by construction, so
  // the standoff is a floor rather than an average and the only thing left to
  // bound is how far the surface recedes.
  const v = [0, 0, 0];
  let d = -Infinity;
  for (const f of g.faces) {
    for (let i = 0; i < 3; i++) {
      worldVertex(pos, f * 9 + i * 3, rot, offset, v);
      const dn = v[0] * nx + v[1] * ny + v[2] * nz;
      if (dn > d) d = dn;
    }
  }

  // flatness, extent, and the (u, t) projection in one pass
  // (u, t, dn) per vertex: the in-plane coordinates plus the SIGNED distance
  // from the fitted plane, which is what lets each tine size itself later.
  const tris = new Float64Array(g.faces.length * 9);
  let devOut = -Infinity, devIn = Infinity;
  let u0 = Infinity, u1 = -Infinity, t0 = Infinity, t1 = -Infinity;
  let z0 = Infinity, z1 = -Infinity;
  for (let k = 0; k < g.faces.length; k++) {
    const f = g.faces[k];
    for (let i = 0; i < 3; i++) {
      worldVertex(pos, f * 9 + i * 3, rot, offset, v);
      const dn = v[0] * nx + v[1] * ny + v[2] * nz - d;
      if (dn > devOut) devOut = dn;
      if (dn < devIn) devIn = dn;
      const u = v[0] * ux + v[1] * uy;
      const t = v[0] * tx + v[1] * ty + v[2] * tz;
      tris[k * 9 + i * 3] = u;
      tris[k * 9 + i * 3 + 1] = t;
      tris[k * 9 + i * 3 + 2] = dn;
      if (u < u0) u0 = u; if (u > u1) u1 = u;
      if (t < t0) t0 = t; if (t > t1) t1 = t;
      if (v[2] < z0) z0 = v[2]; if (v[2] > z1) z1 = v[2];
    }
  }

  const fail = (why) => {
    if (stats) stats[why] = (stats[why] ?? 0) + 1;
    return null;
  };
  if (devIn < -FLAT_TOL_IN) return fail('notFlat');
  if (t1 - t0 < MIN_PATCH_H) return fail('tooShort');
  if (u1 - u0 < MIN_PATCH_W) return fail('tooNarrow');

  // where this site sits, for keeping chosen fins apart in space
  const umid = (u0 + u1) / 2, tmid = (t0 + t1) / 2;
  const mid = {
    x: nx * d + ux * umid + tx * tmid,
    y: ny * d + uy * umid + ty * tmid,
  };

  return {
    faces: g.faces, area: g.area, mid,
    n: { x: nx, y: ny, z: nz },
    u: { x: ux, y: uy },
    t: { x: tx, y: ty, z: tz },
    h, d, u0, u1, t0, t1, z0, z1,
    lean: Math.abs(Math.asin(nz) * 180 / Math.PI),
    flatness: Math.max(devOut, -devIn),
    tris,
  };
}

/**
 * Is (u, t) inside the patch? Used to decide whether a tine at that station has
 * any part to fuse into -- a patch's bounding box is not its shape, and a tine
 * placed in the notch of an L-shaped face would print into thin air.
 */
export function patchCovers(patch, u, t) {
  return patchProbe(patch, u, t) !== null;
}

/**
 * Where the real surface sits at (u, t), as a signed distance from the patch's
 * fitted plane -- negative meaning it has receded away from the fin. Returns
 * null if the patch does not cover that point at all.
 *
 * This is what makes a tine self-sizing. The wall is one flat plane, but the
 * surface it grips is not, so each tine has to know its own local gap rather
 * than assume the standoff.
 */
export function patchProbe(patch, u, t) {
  const tri = patch.tris;
  for (let i = 0; i < tri.length; i += 9) {
    const ax = tri[i], ay = tri[i + 1];
    const bx = tri[i + 3], by = tri[i + 4];
    const cx = tri[i + 6], cy = tri[i + 7];

    // Skip slivers. A triangle with no projected area gives d1 = d2 = d3 = 0,
    // which reads as "inside" and makes the whole coverage test pass for every
    // point -- resurrecting the tine-into-thin-air case this exists to prevent.
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(den) < 1e-9) continue;

    const l1 = ((by - cy) * (u - cx) + (cx - bx) * (t - cy)) / den;
    const l2 = ((cy - ay) * (u - cx) + (ax - cx) * (t - cy)) / den;
    const l3 = 1 - l1 - l2;
    if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;

    return l1 * tri[i + 2] + l2 * tri[i + 5] + l3 * tri[i + 8];
  }
  return null;
}

/** World point at patch-frame coordinates: `w` out of the face, `u` across, `t` up. */
export function patchPoint(p, w, u, t) {
  const dw = p.d + w;
  return [
    p.n.x * dw + p.u.x * u + p.t.x * t,
    p.n.y * dw + p.u.y * u + p.t.y * t,
    p.n.z * dw + p.t.z * t,
  ];
}

/** The `t` at which the plane offset by `w` crosses world z = `z`. */
export const tAtZ = (p, w, z) => (z - p.n.z * (p.d + w)) / p.t.z;

/** World z of a patch-frame point. `u` never contributes: u is horizontal. */
export const zAt = (p, w, t) => p.n.z * (p.d + w) + p.t.z * t;
