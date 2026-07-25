/**
 * Fin generation. Ported from prototype/spike_fins.py, which validated the
 * approach against third-party STLs.
 *
 * A fin is a thin wall swept along the contact line under an overhang: a flared
 * chamfered foot on the plate, a thin body, necking to a narrow tip that stops
 * `GAP` below the part so it breaks away instead of welding on.
 *
 * KNOWN INCOMPLETE, DELIBERATELY: this geometry has no TINES, and a fin without
 * tines only constrains the part in one direction -- Slant3D demos a cube falling
 * away from exactly this support mid-print. See docs/FIN-SPEC.md. This exists to
 * prove the pipeline end to end (detect -> place -> sweep -> export); M4 replaces
 * the placement and adds the tines. Do not ship an export built from this.
 *
 * No boolean kernel: each fin is its own closed solid that overlaps the plate
 * region, and the slicer unions overlapping solids. That is what keeps the whole
 * tool in plain mesh math.
 */

export const FIN = {
  th: 1.2,          // wall thickness
  gap: 0.2,         // breakaway clearance below the part
  tip: 0.6,         // width of the contact tip
  chamfer: 2.5,     // height the foot flares over
  tipH: 1.5,        // height the tip taper runs
  footMax: 7.0,     // widest the foot ever gets
  footMin: 1.6,
  footRatio: 0.35,  // foot width as a fraction of wall height
  minSpan: 7.0,     // a wall shorter than this is not a wall
  samples: 14,      // cross-sections along the contact line
};

/**
 * Foot half-width for a wall of height `h`.
 *
 * The spike used a fixed 7mm foot, which assumes the overhang sits well above
 * the plate. Real parts' overhangs are low -- median wall height 2.5mm -- so 22
 * of 36 fins degenerated into 14mm-wide splayed sheets. The foot has to scale
 * with how tall the wall actually is.
 */
export const footFor = (h) =>
  Math.max(FIN.footMin, Math.min(FIN.footMax, h * FIN.footRatio));

/** Rotate a raw position triple into print space. `rot` is column-major. */
function rp(pos, i, rot, out) {
  const x = pos[i], y = pos[i + 1], z = pos[i + 2];
  out[0] = rot[0] * x + rot[3] * y + rot[6] * z;
  out[1] = rot[1] * x + rot[4] * y + rot[7] * z;
  out[2] = rot[2] * x + rot[5] * y + rot[8] * z;
  return out;
}

/**
 * The lowest-surface polyline under a region: principal horizontal axis, then
 * the minimum-z sample in each bucket along it. This is what the fin is swept
 * along, so it must follow the part's true underside, not its centreline.
 */
function contactLine(pts, nSamples) {
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
  return line.length >= 3 ? line : null;
}

/**
 * Sweep the fin profile along `line`, emitting one closed solid.
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

    const top = p[2] - FIN.gap;
    const h = top - zBed;
    if (h < 0.6) return false;            // nothing to stand on
    const foot = footFor(h);
    const zsh = Math.min(zBed + FIN.chamfer, top - 0.4);
    const ztip = Math.max(top - FIN.tipH, zsh + 0.1);
    const P = (o, z) => [p[0] + sx * o, p[1] + sy * o, z];

    secs.push([
      P(+foot, zBed), P(+FIN.th / 2, zsh), P(+FIN.th / 2, ztip), P(+FIN.tip / 2, top),
      P(-FIN.tip / 2, top), P(-FIN.th / 2, ztip), P(-FIN.th / 2, zsh), P(-foot, zBed),
    ]);
  }

  const k = 8;
  const tri = (a, b, c) => out.push(a, b, c);
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
 * Build a fin for every overhang region that can take one.
 *
 * @returns {{triangles: number[][], skipped: object, placed: number}}
 */
export function buildFins(topo, result, rot, opts = {}) {
  const { pos } = topo;
  const nSamples = opts.samples ?? FIN.samples;
  const zBed = 0;
  // rotated frame -> seated print space; must match how the part itself is
  // placed, or the fins land beside it instead of under it
  const { x: dx, y: dy, z: dz } = result.offset;

  const out = [];
  const skipped = { noLine: 0, stub: 0, degenerate: 0 };
  let placed = 0;
  const v = [0, 0, 0];

  for (const region of result.regions) {
    // densify: every vertex of the region plus each face's centroid, so a flat
    // ledge made of two triangles still yields a usable polyline
    const pts = [];
    for (const f of region.faces) {
      let gx = 0, gy = 0, gz = 0;
      for (let i = 0; i < 3; i++) {
        rp(pos, f * 9 + i * 3, rot, v);
        const p = [v[0] + dx, v[1] + dy, v[2] + dz];
        pts.push(p);
        gx += p[0]; gy += p[1]; gz += p[2];
      }
      pts.push([gx / 3, gy / 3, gz / 3]);
    }

    const line = contactLine(pts, nSamples);
    if (!line) { skipped.noLine++; continue; }

    const span = Math.hypot(line[line.length - 1][0] - line[0][0],
                            line[line.length - 1][1] - line[0][1]);
    if (span < FIN.minSpan) { skipped.stub++; continue; }

    const before = out.length;
    if (!sweep(line, zBed, out)) { out.length = before; skipped.degenerate++; continue; }
    placed++;
  }

  return { triangles: out, skipped, placed };
}
