/**
 * PROP mode -- a breakaway wall that stands UNDER an overhang.
 *
 * This is a different support from the fin in fins.js, not a variant of it, and
 * the difference is what it leans on:
 *
 *   Stabilize  a wall BESIDE the part, gripping a face with horizontal tines.
 *              Needs a face to grip, so it cannot serve a cone or a sphere.
 *   Prop       a wall UNDER the overhang, rising from the plate and stopping
 *              `gap` short. The part bridges that last layer, so the wall never
 *              fuses and it snaps off. Needs only an underside contact line,
 *              which every shape has.
 *
 * A prop has no tines, deliberately. Tine-less supports were rejected early in
 * this project on Slant3D's demo of a cube falling away from one -- but that is
 * a part balanced on an EDGE with the support as its only restraint. A part
 * sitting down on the plate with an overhang above it has no such failure mode:
 * gravity holds it onto the prop. `tools/support/breakaway.py` in the video repo
 * works exactly this way, has no tines anywhere in it, and produced good fins on
 * real printed shelter hubs -- the parts Stabilize could not touch.
 *
 * The geometry is M3's, which was validated (34/36 regions served, every wall
 * watertight) and then retired for the wrong reason. What is new here is the
 * judgement around it: a prop is only emitted where the wall can actually reach
 * the plate through open air.
 */
import { insidePart } from './inside.js';

export const PROP = {
  th: 1.2,          // wall thickness
  gap: 0.2,         // breakaway clearance below the part
  tip: 0.6,         // width of the contact tip
  chamfer: 2.5,     // height the flared foot rises over
  tipH: 1.5,        // height the tip taper runs
  footMax: 7.0,     // widest the foot ever gets
  footMin: 1.6,
  footRatio: 0.35,  // foot half-width as a fraction of wall height
  minSpan: 7.0,     // a wall shorter than this is not worth the plate space
  minHeight: 1.5,   // nor is one this short
  samples: 14,      // cross-sections along the contact line
  clearProbes: 6,   // points checked down the wall for a clear path to the plate
};

/**
 * Foot half-width for a wall of height `h`.
 *
 * The spike used a fixed 7mm foot, which assumes the overhang sits well above
 * the plate. Real parts' overhangs are low -- median wall height 2.5mm -- so 22
 * of 36 walls degenerated into 14mm-wide splayed sheets. The foot has to scale
 * with how tall the wall actually is.
 */
export const footFor = (h) =>
  Math.max(PROP.footMin, Math.min(PROP.footMax, h * PROP.footRatio));

/** Rotate + seat one raw vertex into print space. */
function seat(pos, i, rot, off, out) {
  const x = pos[i], y = pos[i + 1], z = pos[i + 2];
  out[0] = rot[0] * x + rot[3] * y + rot[6] * z + off.x;
  out[1] = rot[1] * x + rot[4] * y + rot[7] * z + off.y;
  out[2] = rot[2] * x + rot[5] * y + rot[8] * z + off.z;
  return out;
}

/**
 * The lowest surface height of the region directly above (x, y), or null if the
 * region does not cover that point.
 *
 * This is what the wall's top has to clear, and it has to be asked about the
 * wall's OWN path. Taking the lowest point in a cross-slice of the region
 * instead -- which is what bucketing does -- answers about somewhere off to the
 * side, and produced walls sitting 13mm below the surface they were meant to
 * touch.
 */
function surfaceZAt(tris, x, y) {
  let best = Infinity;
  for (let i = 0; i < tris.length; i += 9) {
    const ax = tris[i], ay = tris[i + 1], az = tris[i + 2];
    const bx = tris[i + 3], by = tris[i + 4], bz = tris[i + 5];
    const cx = tris[i + 6], cy = tris[i + 7], cz = tris[i + 8];
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(den) < 1e-12) continue;
    const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / den;
    const l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / den;
    const l3 = 1 - l1 - l2;
    if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
    const z = l1 * az + l2 * bz + l3 * cz;
    if (z < best) best = z;
  }
  return best === Infinity ? null : best;
}

/**
 * The lowest-surface polyline under a region: principal horizontal axis, then
 * the minimum-z sample in each bucket along it.
 *
 * It must follow the part's true UNDERSIDE, not its centreline. For a tilted
 * round tube the lowest point is offset sideways from, and higher than,
 * `centreline - R`; propping the centreline mis-places the wall and can drop it
 * straight into whatever the tube emerges from. `breakaway.py` learned this the
 * same way and says so in its docstring.
 */
function contactLine(pts, tris, nSamples) {
  if (pts.length < 3) return null;

  let cx = 0, cy = 0;
  for (const p of pts) { cx += p[0]; cy += p[1]; }
  cx /= pts.length; cy /= pts.length;

  // principal horizontal direction, via the 2x2 covariance of the XY spread
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of pts) {
    const dx = p[0] - cx, dy = p[1] - cy;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  const tr = sxx + syy, det = sxx * syy - sxy * sxy;
  const lam = tr / 2 + Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  let ax = sxy, ay = lam - sxx;
  if (Math.hypot(ax, ay) < 1e-9) { ax = 1; ay = 0; }
  const an = Math.hypot(ax, ay); ax /= an; ay /= an;

  let lo = Infinity, hi = -Infinity;
  for (const p of pts) {
    const t = (p[0] - cx) * ax + (p[1] - cy) * ay;
    if (t < lo) lo = t;
    if (t > hi) hi = t;
  }
  if (hi - lo < 1e-6) return null;

  const buckets = new Array(nSamples).fill(null);
  for (const p of pts) {
    const t = (p[0] - cx) * ax + (p[1] - cy) * ay;
    let k = Math.floor(((t - lo) / (hi - lo)) * nSamples);
    if (k >= nSamples) k = nSamples - 1;
    if (!buckets[k] || p[2] < buckets[k][2]) buckets[k] = p;
  }
  const line = buckets.filter(Boolean);
  if (line.length < 3) return null;

  // Re-fit each station's height to the surface directly above its OWN xy. The
  // bucket only chose where the wall should stand; the z it happened to carry
  // belongs to whichever point in that cross-slice was lowest, which is usually
  // somewhere else entirely.
  for (let i = 0; i < line.length; i++) {
    const zz = surfaceZAt(tris, line[i][0], line[i][1]);
    if (zz !== null) line[i] = [line[i][0], line[i][1], zz];
  }

  // Then lower the ends of any segment that would pass above the surface between
  // them. The wall's top runs STRAIGHT between stations while the underside
  // curves, so a midpoint can end up proud of the part -- measured at 0.005mm of
  // clearance where 0.2mm was intended, which welds. Checking the midpoints and
  // pulling the span down is what turns the gap into a floor.
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (let i = 0; i < line.length - 1; i++) {
      const mx = (line[i][0] + line[i + 1][0]) / 2;
      const my = (line[i][1] + line[i + 1][1]) / 2;
      const zz = surfaceZAt(tris, mx, my);
      if (zz === null) continue;
      const midWall = (line[i][2] + line[i + 1][2]) / 2;
      const over = midWall - zz;
      if (over > 1e-4) {
        line[i] = [line[i][0], line[i][1], line[i][2] - over];
        line[i + 1] = [line[i + 1][0], line[i + 1][1], line[i + 1][2] - over];
        moved = true;
      }
    }
    if (!moved) break;
  }
  return line;
}

/**
 * Can a wall under `line` actually reach the plate, or is the part in the way?
 *
 * The prop attaches to the BED and nothing else -- that is what makes it one
 * clean thing to remove rather than two welds to cut. An overhang tucked above
 * other geometry has no such path, and a wall driven down through the part is
 * worse than no wall at all. Sampled down the centreline of each station.
 */
function pathToPlateIsClear(line, topo, rot, offset) {
  for (let k = 0; k < line.length; k++) {
    const p = line[k];
    const a = line[Math.max(0, k - 1)];
    const b = line[Math.min(line.length - 1, k + 1)];
    let rx = b[0] - a[0], ry = b[1] - a[1];
    const rn = Math.hypot(rx, ry);
    if (rn < 1e-9) continue;
    const sx = ry / rn, sy = -rx / rn;      // across the wall

    const top = p[2] - PROP.gap;
    const foot = footFor(top);
    for (let i = 1; i <= PROP.clearProbes; i++) {
      const z = (top * i) / (PROP.clearProbes + 1);
      // The wall is thin high up and flares into a foot near the plate, so the
      // width to test depends on height. Probing only the centreline let feet
      // plough through the part's own base.
      const half = z < PROP.chamfer
        ? foot - ((foot - PROP.th / 2) * z) / PROP.chamfer
        : PROP.th / 2;
      for (const o of [0, half, -half]) {
        if (insidePart(topo, rot, offset, p[0] + sx * o, p[1] + sy * o, z)) return false;
      }
    }
  }
  return true;
}

/**
 * Sweep the prop profile along `line`, emitting one closed solid.
 * Eight vertices per cross-section: foot, chamfer shoulder, wall, tip, mirrored.
 */
function sweep(line, zBed, out) {
  const secs = [];
  for (let i = 0; i < line.length; i++) {
    const p = line[i];
    const a = line[Math.max(0, i - 1)];
    const b = line[Math.min(line.length - 1, i + 1)];
    let rx = b[0] - a[0], ry = b[1] - a[1];
    const rn = Math.hypot(rx, ry);
    if (rn < 1e-9) return false;
    rx /= rn; ry /= rn;
    const sx = ry, sy = -rx;              // horizontal, across the wall

    const top = p[2] - PROP.gap;
    const h = top - zBed;
    if (h < PROP.minHeight) return false;
    const foot = footFor(h);
    const zsh = Math.min(zBed + PROP.chamfer, top - 0.4);
    const ztip = Math.max(top - PROP.tipH, zsh + 0.1);
    const P = (o, z) => [p[0] + sx * o, p[1] + sy * o, z];

    secs.push([
      P(+foot, zBed), P(+PROP.th / 2, zsh), P(+PROP.th / 2, ztip), P(+PROP.tip / 2, top),
      P(-PROP.tip / 2, top), P(-PROP.th / 2, ztip), P(-PROP.th / 2, zsh), P(-foot, zBed),
    ]);
  }

  const k = 8;
  // Wound OUTWARD. Inherited from M3, where this emitted every triangle
  // backwards: the shell was closed and consistent -- euler 2, no boundary
  // edges -- but its volume came out NEGATIVE, so every normal faced into the
  // solid. M3's own check only asked whether the mesh was watertight, which it
  // was, so this survived being called validated. A slicer would read it as a
  // hole rather than a wall.
  const tri = (a, b, c) => out.push(a, c, b);
  for (let i = 0; i < secs.length - 1; i++) {
    for (let j = 0; j < k; j++) {
      const j2 = (j + 1) % k;
      tri(secs[i][j], secs[i][j2], secs[i + 1][j2]);
      tri(secs[i][j], secs[i + 1][j2], secs[i + 1][j]);
    }
  }
  for (let j = 1; j < k - 1; j++) {                        // end caps
    tri(secs[0][0], secs[0][j + 1], secs[0][j]);
    const e = secs[secs.length - 1];
    tri(e[0], e[j], e[j + 1]);
  }
  return true;
}

/**
 * Build a breakaway prop under every overhang region that can take one.
 *
 * @returns {{triangles, props, skipped}}
 */
export function buildProps(topo, result, rot, opts = {}) {
  const { pos } = topo;
  const nSamples = opts.samples ?? PROP.samples;
  const zBed = 0;
  const off = result.offset;

  const out = [];
  const props = [];
  const skipped = { noLine: 0, stub: 0, blocked: 0, degenerate: 0, buried: 0 };
  const v = [0, 0, 0];

  for (const region of result.regions) {
    // Densify: every vertex of the region plus each face's centroid, so a flat
    // ledge made of two triangles still yields a usable polyline.
    const pts = [];
    const tris = new Float64Array(region.faces.length * 9);
    for (let k = 0; k < region.faces.length; k++) {
      const f = region.faces[k];
      let gx = 0, gy = 0, gz = 0;
      for (let i = 0; i < 3; i++) {
        seat(pos, f * 9 + i * 3, rot, off, v);
        const p = [v[0], v[1], v[2]];
        pts.push(p);
        tris[k * 9 + i * 3] = v[0];
        tris[k * 9 + i * 3 + 1] = v[1];
        tris[k * 9 + i * 3 + 2] = v[2];
        gx += p[0]; gy += p[1]; gz += p[2];
      }
      pts.push([gx / 3, gy / 3, gz / 3]);
    }

    const line = contactLine(pts, tris, nSamples);
    if (!line) { skipped.noLine++; continue; }

    const span = Math.hypot(line[line.length - 1][0] - line[0][0],
                            line[line.length - 1][1] - line[0][1]);
    if (span < PROP.minSpan) { skipped.stub++; continue; }

    if (!pathToPlateIsClear(line, topo, rot, off)) { skipped.blocked++; continue; }

    const before = out.length;
    if (!sweep(line, zBed, out)) {
      out.length = before;
      skipped.degenerate++;
      continue;
    }

    // Confirm the finished solid, the same way fins.js confirms a wall: the
    // clearance probes above are a sparse sample of an unbounded question, and
    // anything they miss welds the prop to the part. A prop that fails here is
    // dropped rather than shipped -- "no prop" is a fixable disappointment,
    // a fused prop is a ruined print.
    let buried = false;
    for (let i = before; i < out.length && !buried; i++) {
      const q = out[i];
      if (insidePart(topo, rot, off, q[0], q[1], q[2])) buried = true;
    }
    if (buried) {
      out.length = before;
      skipped.buried = (skipped.buried ?? 0) + 1;
      continue;
    }
    const top = Math.min(...line.map((p) => p[2])) - PROP.gap;
    props.push({ span, height: top - zBed, area: region.area });
  }

  return { triangles: out, props, skipped };
}
