/**
 * Curved drawn walls (local issue 063): the plan path of a wall drawn with three
 * clicks -- its two ends, then a point it runs through. The path is the circular
 * arc through all three, so one wall can go well past a half circle (push the third
 * click out beyond the ends), and its radius is one number the minimum-radius rule
 * reads exactly.
 *
 * Geometry only: draw.js's drawnLine turns these stations into a contact line (the
 * same surface pick and settle passes as a straight wall), ui/walls.js picks the points.
 */

/**
 * The tightest a drawn curve may bend, in mm of centre-line radius. The wall's foot
 * reaches PROP.footMax (3 mm) either side of the line, so under that its inner edge
 * folds back on itself; the rest is room for the stem and tines on the inside.
 */
export const DRAW_MIN_RADIUS = 5;

/** Past this radius (mm) the "arc" is a straight line to print precision. */
const STRAIGHT_R = 1e4;

/**
 * The circle through a, b and m in plan (each [x, y, ...]), as
 * { cx, cy, r, a0, sweep } -- start angle and signed sweep (rad) from a to b the way
 * that passes m -- or null when the three are (near enough) in line.
 */
export function arcThrough(a, b, m) {
  const d = 2 * (a[0] * (b[1] - m[1]) + b[0] * (m[1] - a[1]) + m[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-9) return null;
  const sa = a[0] * a[0] + a[1] * a[1], sb = b[0] * b[0] + b[1] * b[1], sm = m[0] * m[0] + m[1] * m[1];
  const cx = (sa * (b[1] - m[1]) + sb * (m[1] - a[1]) + sm * (a[1] - b[1])) / d;
  const cy = (sa * (m[0] - b[0]) + sb * (a[0] - m[0]) + sm * (b[0] - a[0])) / d;
  const r = Math.hypot(a[0] - cx, a[1] - cy);
  if (!(r < STRAIGHT_R)) return null;
  const TAU = 2 * Math.PI, ang = (p) => Math.atan2(p[1] - cy, p[0] - cx);
  const a0 = ang(a);
  const toB = ((ang(b) - a0) % TAU + TAU) % TAU, toM = ((ang(m) - a0) % TAU + TAU) % TAU;
  return { cx, cy, r, a0, sweep: toM < toB ? toB : toB - TAU, toM };
}

/**
 * Stations ~`step` apart round the arc from a to b through m, each [x, y, hint]:
 * `hint` the height the clicks imply there (a to m to b, linear in angle), which
 * drawnLine snaps to the nearest surface. At least `minPts` stations. Null when the
 * three are in line -- the caller lays the straight wall.
 */
export function arcStations(a, b, m, step, minPts) {
  const c = arcThrough(a, b, m);
  if (!c) return null;
  const n = Math.max(minPts - 1, Math.ceil(Math.abs(c.sweep) * c.r / step));
  // m's place along the arc, 0..1 (toM is counter-clockwise; a clockwise arc meets m
  // the other way round)
  const fm = c.sweep > 0 ? c.toM / c.sweep : (2 * Math.PI - c.toM) / -c.sweep;
  const out = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n, th = c.a0 + c.sweep * t;
    const hint = t <= fm ? a[2] + (m[2] - a[2]) * (fm > 0 ? t / fm : 1)
                         : m[2] + (b[2] - m[2]) * ((t - fm) / (1 - fm));
    out.push([c.cx + c.r * Math.cos(th), c.cy + c.r * Math.sin(th), hint]);
  }
  // the ends exactly where clicked, not a rounding away
  out[0] = [a[0], a[1], a[2]];
  out[n] = [b[0], b[1], b[2]];
  return out;
}

