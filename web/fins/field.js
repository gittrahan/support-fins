/**
 * The model's LENGTH in plan, the heading Full coverage's Long walls run along
 * (fins/rows.js, opts.longWalls). Matthew 2026-10-15: a hand-drawn wall "fits along
 * the model so nicely" because it runs the model's length; the fill pass picked each
 * red patch's best line on its own, so an upright figure got a dozen 3 mm stubs at
 * five headings.
 *
 * The heading at (x, y) is the long axis of the part's surface within FIELD.radius in
 * plan (Gaussian-weighted second moments of the faces' plan centroids, by area). The
 * fill pass asks once, at the bare red's centroid, so the rows share one heading.
 * Where the surface there is about as long as it is wide (FIELD.minRatio) there is no
 * length: null -- a square footprint's eigenvector is arbitrary (the old auto-placer's
 * 45deg walls) -- and the rows run along x. A heading within FIELD.snap of x or y is
 * snapped to it.
 */

export const FIELD = {
  cell: 2.0,        // mm: the plan grid the surface is binned into
  radius: 20.0,     // mm: the Gaussian's sigma -- how far "the model here" reaches
  minRatio: 1.25,   // long axis / short axis (std dev) under this: no heading
  snap: 10,         // deg: a heading this close to x or y is x or y
};

/**
 * headingField(topo, result, rot) -> (x, y) => radians in [0, pi), or null.
 * Gridded once; each query sums the cells within 3 sigma.
 */
export function headingField(topo, result, rot) {
  const { pos, area } = topo, off = result.offset, C = FIELD.cell;
  const cells = new Map();
  for (let f = 0; f < topo.nFaces; f++) {
    const o = f * 9;
    let x = 0, y = 0;
    for (let v = 0; v < 3; v++) {
      const p = o + v * 3;
      x += rot[0] * pos[p] + rot[3] * pos[p + 1] + rot[6] * pos[p + 2];
      y += rot[1] * pos[p] + rot[4] * pos[p + 1] + rot[7] * pos[p + 2];
    }
    x = x / 3 + off.x; y = y / 3 + off.y;
    const a = area[f];
    const k = `${Math.floor(x / C)},${Math.floor(y / C)}`;
    const c = cells.get(k);
    if (c) { c[0] += a; c[1] += a * x; c[2] += a * y; c[3] += a * x * x; c[4] += a * x * y; c[5] += a * y * y; }
    else cells.set(k, [a, a * x, a * y, a * x * x, a * x * y, a * y * y]);
  }
  const list = [...cells.values()].map((c) => ({ c, x: c[1] / c[0], y: c[2] / c[0] }));
  const S = FIELD.radius, cut = 9 * S * S, snap = FIELD.snap * Math.PI / 180;
  return (qx, qy) => {
    let w = 0, mx = 0, my = 0, xx = 0, xy = 0, yy = 0;
    for (const { c, x, y } of list) {
      const d2 = (x - qx) ** 2 + (y - qy) ** 2;
      if (d2 > cut) continue;
      const g = Math.exp(-d2 / (2 * S * S));
      w += g * c[0]; mx += g * c[1]; my += g * c[2]; xx += g * c[3]; xy += g * c[4]; yy += g * c[5];
    }
    if (!(w > 0)) return null;
    mx /= w; my /= w;
    const sxx = xx / w - mx * mx, sxy = xy / w - mx * my, syy = yy / w - my * my;
    // eigenvalues of [[sxx, sxy], [sxy, syy]]
    const tr = (sxx + syy) / 2, dd = Math.sqrt(((sxx - syy) / 2) ** 2 + sxy * sxy);
    const l1 = tr + dd, l2 = Math.max(tr - dd, 1e-9);
    if (Math.sqrt(l1 / l2) < FIELD.minRatio) return null;
    let th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    th = ((th % Math.PI) + Math.PI) % Math.PI;
    for (const axis of [0, Math.PI / 2, Math.PI]) if (Math.abs(th - axis) <= snap) th = axis % Math.PI;
    return th;
  };
}
