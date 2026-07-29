/**
 * Is a point inside the part? Ray-parity, with a grid so it is cheap enough to
 * call while dragging.
 *
 * WHY THIS EXISTS. Fin placement searches with a proximity test: does any part
 * surface cross the slab the fin sweeps (fins.js `chooseSpan`). That is cheap
 * and it is what lets the search consider thousands of windows. It is also not
 * quite the same question as "is this fin inside the part", and the gap between
 * the two showed up as a wall buried 2.6mm into a Voron housing that every
 * cheaper check called clear.
 *
 * So the search stays cheap and the ANSWER gets verified: once a fin's geometry
 * exists, its own vertices are tested for containment, and a fin that is inside
 * the part is thrown away. Broad search, exact confirmation.
 *
 * THE GRID IS BUILT IN THE MESH'S ORIGINAL FRAME, never the rotated one, for the
 * same reason overhangs.js welds only once: rotation cannot change which
 * triangles exist or how they relate, so an acceleration structure built once
 * per file stays valid for every orientation. Query points are rotated back into
 * that frame instead. Rebuilding this per drag frame would cost more than the
 * test saves.
 */

const GRID = 64;          // buckets per axis; 64^2 over a part is plenty
const EPS = 1e-9;

/**
 * Bucket every triangle by its (y, z) extent in the mesh's own frame, so a ray
 * cast along +x only has to consider the triangles in one column.
 */
function buildGrid(topo) {
  if (topo._insideGrid) return topo._insideGrid;
  const { pos, nFaces } = topo;

  let minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let v = 0; v < nFaces * 3; v++) {
    const y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const sy = GRID / Math.max(1e-6, maxY - minY);
  const sz = GRID / Math.max(1e-6, maxZ - minZ);
  const cell = (y, z) => {
    const a = Math.min(GRID - 1, Math.max(0, Math.floor((y - minY) * sy)));
    const b = Math.min(GRID - 1, Math.max(0, Math.floor((z - minZ) * sz)));
    return a * GRID + b;
  };

  // counting sort into CSR, so there is one flat Int32Array rather than 4096
  // little arrays
  const counts = new Int32Array(GRID * GRID + 1);
  const span = (f) => {
    const o = f * 9;
    const y0 = Math.min(pos[o + 1], pos[o + 4], pos[o + 7]);
    const y1 = Math.max(pos[o + 1], pos[o + 4], pos[o + 7]);
    const z0 = Math.min(pos[o + 2], pos[o + 5], pos[o + 8]);
    const z1 = Math.max(pos[o + 2], pos[o + 5], pos[o + 8]);
    return [Math.min(GRID - 1, Math.max(0, Math.floor((y0 - minY) * sy))),
            Math.min(GRID - 1, Math.max(0, Math.floor((y1 - minY) * sy))),
            Math.min(GRID - 1, Math.max(0, Math.floor((z0 - minZ) * sz))),
            Math.min(GRID - 1, Math.max(0, Math.floor((z1 - minZ) * sz)))];
  };

  for (let f = 0; f < nFaces; f++) {
    const [a0, a1, b0, b1] = span(f);
    for (let a = a0; a <= a1; a++) {
      for (let b = b0; b <= b1; b++) counts[a * GRID + b + 1]++;
    }
  }
  for (let i = 0; i < GRID * GRID; i++) counts[i + 1] += counts[i];
  const items = new Int32Array(counts[GRID * GRID]);
  const cur = counts.slice(0, GRID * GRID);
  for (let f = 0; f < nFaces; f++) {
    const [a0, a1, b0, b1] = span(f);
    for (let a = a0; a <= a1; a++) {
      for (let b = b0; b <= b1; b++) items[cur[a * GRID + b]++] = f;
    }
  }

  return (topo._insideGrid = { start: counts, items, cell,
                               minY, minZ, sy, sz });
}

/** Closest point on triangle `f` to (px, py, pz), all in the mesh's own frame. */
function triClosest(pos, f, px, py, pz) {
  const o = f * 9;
  const ax = pos[o], ay = pos[o + 1], az = pos[o + 2];
  const abx = pos[o + 3] - ax, aby = pos[o + 4] - ay, abz = pos[o + 5] - az;
  const acx = pos[o + 6] - ax, acy = pos[o + 7] - ay, acz = pos[o + 8] - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;

  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return [ax, ay, az];

  const bpx = px - pos[o + 3], bpy = py - pos[o + 4], bpz = pz - pos[o + 5];
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return [pos[o + 3], pos[o + 4], pos[o + 5]];

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const t = d1 / (d1 - d3);
    return [ax + abx * t, ay + aby * t, az + abz * t];
  }

  const cpx = px - pos[o + 6], cpy = py - pos[o + 7], cpz = pz - pos[o + 8];
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return [pos[o + 6], pos[o + 7], pos[o + 8]];

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const t = d2 / (d2 - d6);
    return [ax + acx * t, ay + acy * t, az + acz * t];
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const t = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return [pos[o + 3] + (pos[o + 6] - pos[o + 3]) * t,
            pos[o + 4] + (pos[o + 7] - pos[o + 4]) * t,
            pos[o + 5] + (pos[o + 8] - pos[o + 5]) * t];
  }

  const denom = 1 / (va + vb + vc);
  const v = vb * denom, w = vc * denom;
  return [ax + abx * v + acx * w, ay + aby * v + acy * w, az + abz * v + acz * w];
}

/**
 * The part's closest surface point within `rMax` of a PRINT-space query point,
 * or null if nothing is that close.
 *
 * This is the measurement `insidePart` cannot make: parity says in-or-out, and
 * a surface arriving TANGENT to a wall's face -- or a rib thinner than the gap
 * between two probes -- reads "out" at every probe while sitting 0.005mm away.
 * The prop pipeline burned three rounds of ever-denser parity probing on
 * exactly that (welds at 0.016, 0.005, 0.0005mm survived them all) before
 * conceding the point the checker had been making all along: you cannot
 * bracket a distance with containment tests; you have to measure it.
 *
 * Returns { d, cosUp }: the distance, and the PRINT-space vertical share of
 * the direction toward the surface, so the caller can tell a breakaway
 * interface (above, meant to be `gap` away) from a flank approach (sideways,
 * meant to be clear). Same 0.7 cone the checker uses.
 *
 * Bounded by `rMax` so the grid's 3x3 cell neighbourhood suffices; with 64
 * cells per axis on real parts a cell is well over 0.5mm. Triangles spanning
 * several cells are tested more than once rather than deduplicated -- a repeat
 * distance test is cheaper than the bookkeeping.
 */
export function nearestPart(topo, rot, offset, qx, qy, qz, rMax = 0.45) {
  const { pos } = topo;
  const grid = buildGrid(topo);

  const x = qx - offset.x, y = qy - offset.y, z = qz - offset.z;
  const ox = rot[0] * x + rot[1] * y + rot[2] * z;
  const oy = rot[3] * x + rot[4] * y + rot[5] * z;
  const oz = rot[6] * x + rot[7] * y + rot[8] * z;

  const clamp = (v) => Math.min(GRID - 1, Math.max(0, v));
  const a0 = clamp(Math.floor((oy - rMax - grid.minY) * grid.sy));
  const a1 = clamp(Math.floor((oy + rMax - grid.minY) * grid.sy));
  const b0 = clamp(Math.floor((oz - rMax - grid.minZ) * grid.sz));
  const b1 = clamp(Math.floor((oz + rMax - grid.minZ) * grid.sz));

  let best = rMax * rMax, bx = 0, by = 0, bz = 0, found = false;
  for (let a = a0; a <= a1; a++) {
    for (let b = b0; b <= b1; b++) {
      const c = a * GRID + b;
      for (let i = grid.start[c]; i < grid.start[c + 1]; i++) {
        const q = triClosest(pos, grid.items[i], ox, oy, oz);
        const dx = q[0] - ox, dy = q[1] - oy, dz = q[2] - oz;
        const dd = dx * dx + dy * dy + dz * dz;
        if (dd < best) { best = dd; bx = dx; by = dy; bz = dz; found = true; }
      }
    }
  }
  if (!found) return null;
  const d = Math.sqrt(best);
  // PRINT-space z of a mesh-frame direction: how far "up" the approach points
  const upZ = rot[2] * bx + rot[5] * by + rot[8] * bz;
  return { d, cosUp: d > EPS ? upZ / d : 0 };
}

/** Closest points between segments p0-p1 and q0-q1; returns [pt on P, pt on Q]. */
function segSegClosest(p0, p1, q0, q1) {
  const dx1 = p1[0] - p0[0], dy1 = p1[1] - p0[1], dz1 = p1[2] - p0[2];
  const dx2 = q1[0] - q0[0], dy2 = q1[1] - q0[1], dz2 = q1[2] - q0[2];
  const rx = p0[0] - q0[0], ry = p0[1] - q0[1], rz = p0[2] - q0[2];
  const a = dx1 * dx1 + dy1 * dy1 + dz1 * dz1;
  const e = dx2 * dx2 + dy2 * dy2 + dz2 * dz2;
  const f = dx2 * rx + dy2 * ry + dz2 * rz;
  let s, t;
  if (a <= EPS && e <= EPS) { s = 0; t = 0; }
  else if (a <= EPS) { s = 0; t = Math.min(1, Math.max(0, f / e)); }
  else {
    const c = dx1 * rx + dy1 * ry + dz1 * rz;
    if (e <= EPS) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
    else {
      const b = dx1 * dx2 + dy1 * dy2 + dz1 * dz2;
      const den = a * e - b * b;
      s = den > EPS ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
      else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
    }
  }
  return [[p0[0] + dx1 * s, p0[1] + dy1 * s, p0[2] + dz1 * s],
          [q0[0] + dx2 * t, q0[1] + dy2 * t, q0[2] + dz2 * t]];
}

/** Closest point on the triangle at `pos[o..o+9]` to p, plus the vertices. */
function triVerts(pos, f) {
  const o = f * 9;
  return [[pos[o], pos[o + 1], pos[o + 2]],
          [pos[o + 3], pos[o + 4], pos[o + 5]],
          [pos[o + 6], pos[o + 7], pos[o + 8]]];
}

const dist2 = (p, q) => {
  const dx = p[0] - q[0], dy = p[1] - q[1], dz = p[2] - q[2];
  return dx * dx + dy * dy + dz * dz;
};

/**
 * The exact minimum clearance between an added solid and the part, or null if
 * it is at least `rMax` everywhere.
 *
 * This closes the hole every sampled check left open: probing the wall's
 * surface -- with parity OR with distances -- can only promise detection where
 * a probe lands, and the last two welds on hub_corner sat between stations,
 * where no probe ever would (a rib thinner than the station pitch, crossing
 * the corridor mid-span). Flip the measurement: the wall's triangles already
 * exist by this point, the part's triangles have a grid over them, so compute
 * real triangle-to-triangle distance -- vertex-vs-face both ways plus all nine
 * edge pairs -- over the grid's broad phase. No sampling, no blind spots wider
 * than float epsilon. This is the same measurement check_stl.py makes; making
 * it here is what lets the generator trim a weld instead of shipping it.
 *
 * `verts` is the solid's triangle soup in PRINT space, three vertices per
 * triangle. Returns { d, cosUp, x, y, z }: the distance, the print-space
 * vertical share of the approach (0.7 cone, same as the checker), and the
 * closest point on the SOLID, so the caller can find the station that owns it.
 */
export function solidClearance(topo, rot, offset, verts, rMax = 0.45) {
  const { pos } = topo;
  const grid = buildGrid(topo);
  const clamp = (v) => Math.min(GRID - 1, Math.max(0, v));

  // un-rotate the solid's vertices into the mesh frame once
  const mv = new Array(verts.length);
  for (let i = 0; i < verts.length; i++) {
    const x = verts[i][0] - offset.x, y = verts[i][1] - offset.y,
          z = verts[i][2] - offset.z;
    mv[i] = [rot[0] * x + rot[1] * y + rot[2] * z,
             rot[3] * x + rot[4] * y + rot[5] * z,
             rot[6] * x + rot[7] * y + rot[8] * z];
  }

  let best = rMax * rMax, bp = null, bq = null;
  for (let t = 0; t < mv.length; t += 3) {
    const A = [mv[t], mv[t + 1], mv[t + 2]];
    let xLo = Infinity, xHi = -Infinity;
    let yLo = Infinity, yHi = -Infinity, zLo = Infinity, zHi = -Infinity;
    for (const q of A) {
      if (q[0] < xLo) xLo = q[0]; if (q[0] > xHi) xHi = q[0];
      if (q[1] < yLo) yLo = q[1]; if (q[1] > yHi) yHi = q[1];
      if (q[2] < zLo) zLo = q[2]; if (q[2] > zHi) zHi = q[2];
    }
    const a0 = clamp(Math.floor((yLo - rMax - grid.minY) * grid.sy));
    const a1 = clamp(Math.floor((yHi + rMax - grid.minY) * grid.sy));
    const b0 = clamp(Math.floor((zLo - rMax - grid.minZ) * grid.sz));
    const b1 = clamp(Math.floor((zHi + rMax - grid.minZ) * grid.sz));

    for (let a = a0; a <= a1; a++) {
      for (let b = b0; b <= b1; b++) {
        const c = a * GRID + b;
        for (let i = grid.start[c]; i < grid.start[c + 1]; i++) {
          const f = grid.items[i];
          const o = f * 9;
          // reject on the axis-aligned boxes before any real geometry -- a
          // triangle appears in every cell its span touches, so most
          // candidates here are nowhere near this particular solid triangle
          const bx0 = Math.min(pos[o], pos[o + 3], pos[o + 6]);
          if (bx0 > xHi + rMax) continue;
          const bx1 = Math.max(pos[o], pos[o + 3], pos[o + 6]);
          if (bx1 < xLo - rMax) continue;
          const by0 = Math.min(pos[o + 1], pos[o + 4], pos[o + 7]);
          if (by0 > yHi + rMax) continue;
          const by1 = Math.max(pos[o + 1], pos[o + 4], pos[o + 7]);
          if (by1 < yLo - rMax) continue;
          const bz0 = Math.min(pos[o + 2], pos[o + 5], pos[o + 8]);
          if (bz0 > zHi + rMax) continue;
          const bz1 = Math.max(pos[o + 2], pos[o + 5], pos[o + 8]);
          if (bz1 < zLo - rMax) continue;

          const B = triVerts(pos, f);

          // INTERSECTION FIRST. Every distance primitive below is only valid
          // for triangles that do not cross: an edge piercing the other
          // triangle's interior is at distance zero while every vertex-face
          // and edge-edge pair measures finite -- which is exactly how a wall
          // whose end cap ran 0.85mm into a part face was certified "0.167mm
          // clear" while the checker read 0.001.
          const pierce = triTriPierce(A, B);
          if (pierce) {
            best = 0; bp = pierce; bq = pierce;
            a = a1 + 1; b = b1 + 1; t = mv.length;   // nothing beats zero
            break;
          }

          // verts of the part tri against the solid tri and vice versa
          for (const q of B) {
            const cp = triClosestP(A, q);
            const dd = dist2(cp, q);
            if (dd < best) { best = dd; bp = cp; bq = q; }
          }
          for (const q of A) {
            const cp = triClosestP(B, q);
            const dd = dist2(q, cp);
            if (dd < best) { best = dd; bp = q; bq = cp; }
          }
          // all nine edge pairs
          for (let ea = 0; ea < 3; ea++) {
            for (let eb = 0; eb < 3; eb++) {
              const [pA, pB] = segSegClosest(A[ea], A[(ea + 1) % 3],
                                             B[eb], B[(eb + 1) % 3]);
              const dd = dist2(pA, pB);
              if (dd < best) { best = dd; bp = pA; bq = pB; }
            }
          }
        }
      }
    }
  }
  if (!bp) return null;
  const d = Math.sqrt(best);
  const dx = bq[0] - bp[0], dy = bq[1] - bp[1], dz = bq[2] - bp[2];
  const upZ = rot[2] * dx + rot[5] * dy + rot[8] * dz;
  // the solid-side point, back in print space
  const px = rot[0] * bp[0] + rot[3] * bp[1] + rot[6] * bp[2] + offset.x;
  const py = rot[1] * bp[0] + rot[4] * bp[1] + rot[7] * bp[2] + offset.y;
  const pz = rot[2] * bp[0] + rot[5] * bp[1] + rot[8] * bp[2] + offset.z;
  return { d, cosUp: d > EPS ? upZ / d : 0, x: px, y: py, z: pz };
}

/** Segment p-q against triangle A-B-C (Moller-Trumbore); the hit point or null. */
function segTriHit(p, q, A, B, C) {
  const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2];
  const e1x = B[0] - A[0], e1y = B[1] - A[1], e1z = B[2] - A[2];
  const e2x = C[0] - A[0], e2y = C[1] - A[1], e2z = C[2] - A[2];
  const hx = dy * e2z - dz * e2y;
  const hy = dz * e2x - dx * e2z;
  const hz = dx * e2y - dy * e2x;
  const a = e1x * hx + e1y * hy + e1z * hz;
  if (Math.abs(a) < 1e-12) return null;   // parallel; grazing is distance work
  const f = 1 / a;
  const sx = p[0] - A[0], sy = p[1] - A[1], sz = p[2] - A[2];
  const u = f * (sx * hx + sy * hy + sz * hz);
  if (u < 0 || u > 1) return null;
  const qx = sy * e1z - sz * e1y;
  const qy = sz * e1x - sx * e1z;
  const qz = sx * e1y - sy * e1x;
  const v = f * (dx * qx + dy * qy + dz * qz);
  if (v < 0 || u + v > 1) return null;
  const t = f * (e2x * qx + e2y * qy + e2z * qz);
  if (t < 0 || t > 1) return null;
  return [p[0] + dx * t, p[1] + dy * t, p[2] + dz * t];
}

/** Do triangles A and B cross? The piercing point if so, else null. */
function triTriPierce(A, B) {
  for (let e = 0; e < 3; e++) {
    const hit = segTriHit(A[e], A[(e + 1) % 3], B[0], B[1], B[2])
             || segTriHit(B[e], B[(e + 1) % 3], A[0], A[1], A[2]);
    if (hit) return hit;
  }
  return null;
}

/** triClosest, but for a triangle given as three vertex arrays. */
function triClosestP(T, p) {
  const [A, B, C] = T;
  const abx = B[0] - A[0], aby = B[1] - A[1], abz = B[2] - A[2];
  const acx = C[0] - A[0], acy = C[1] - A[1], acz = C[2] - A[2];
  const apx = p[0] - A[0], apy = p[1] - A[1], apz = p[2] - A[2];

  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return A;

  const bpx = p[0] - B[0], bpy = p[1] - B[1], bpz = p[2] - B[2];
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return B;

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const t = d1 / (d1 - d3);
    return [A[0] + abx * t, A[1] + aby * t, A[2] + abz * t];
  }

  const cpx = p[0] - C[0], cpy = p[1] - C[1], cpz = p[2] - C[2];
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return C;

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const t = d2 / (d2 - d6);
    return [A[0] + acx * t, A[1] + acy * t, A[2] + acz * t];
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const t = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return [B[0] + (C[0] - B[0]) * t, B[1] + (C[1] - B[1]) * t,
            B[2] + (C[2] - B[2]) * t];
  }

  const denom = 1 / (va + vb + vc);
  const v = vb * denom, w = vc * denom;
  return [A[0] + abx * v + acx * w, A[1] + aby * v + acy * w,
          A[2] + abz * v + acz * w];
}

/**
 * Containment by ray parity along +x, for a query point given in PRINT space.
 *
 * `rot` is the column-major orientation and `offset` the seating translation, so
 * the point is un-seated and un-rotated back into the mesh's own frame before
 * the test -- which is what lets the grid be orientation-independent.
 */
export function insidePart(topo, rot, offset, qx, qy, qz) {
  const { pos } = topo;
  const grid = buildGrid(topo);

  // inverse of an orthonormal rotation is its transpose
  const x = qx - offset.x, y = qy - offset.y, z = qz - offset.z;
  const ox = rot[0] * x + rot[1] * y + rot[2] * z;
  const oy = rot[3] * x + rot[4] * y + rot[5] * z;
  const oz = rot[6] * x + rot[7] * y + rot[8] * z;

  const c = grid.cell(oy, oz);
  let crossings = 0;
  for (let i = grid.start[c]; i < grid.start[c + 1]; i++) {
    const o = grid.items[i] * 9;
    const ay = pos[o + 1], az = pos[o + 2];
    const by = pos[o + 4], bz = pos[o + 5];
    const cy = pos[o + 7], cz = pos[o + 8];

    // barycentric of (oy, oz) within the triangle projected onto the y-z plane
    const d = (bz - cz) * (ay - cy) + (cy - by) * (az - cz);
    if (Math.abs(d) < EPS) continue;
    const l1 = ((bz - cz) * (oy - cy) + (cy - by) * (oz - cz)) / d;
    const l2 = ((cz - az) * (oy - cy) + (ay - cy) * (oz - cz)) / d;
    const l3 = 1 - l1 - l2;
    if (l1 < 0 || l2 < 0 || l3 < 0) continue;

    // x where the ray meets the triangle's plane; only forward hits count
    const hx = l1 * pos[o] + l2 * pos[o + 3] + l3 * pos[o + 6];
    if (hx > ox) crossings++;
  }
  return (crossings & 1) === 1;
}
