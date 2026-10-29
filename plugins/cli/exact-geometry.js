// Predicates on the supplied IEEE-754 coordinates. The fallback evaluates the
// original coordinates as dyadic integers, including their subtraction; it
// neither rounds to a grid nor moves an intersection to a nearby surface.
const view = new DataView(new ArrayBuffer(8));
function integers(values) {
  const parts = values.map((value) => {
    view.setFloat64(0, value);
    const bits = view.getBigUint64(0), exponent = Number((bits >> 52n) & 2047n);
    const significand = (bits & ((1n << 52n) - 1n)) | (exponent ? 1n << 52n : 0n);
    return { n: bits >> 63n ? -significand : significand, e: exponent ? exponent - 1075 : -1074 };
  });
  const exponent = Math.min(...parts.filter((p) => p.n !== 0n).map((p) => p.e));
  return parts.map((p) => p.n === 0n ? 0n : p.n << BigInt(p.e - exponent));
}

/** Sign of a projected triangle's exact signed area, never its magnitude. */
export function orientation(a, b, c, x = 0, y = 1) {
  const values = [a[x], a[y], b[x], b[y], c[x], c[y]];
  if (!values.every(Number.isFinite)) throw new Error('nonfinite predicate coordinate');
  if ((a[x] === b[x] && b[x] === c[x]) || (a[y] === b[y] && b[y] === c[y])) return 0;
  const left = (b[x] - a[x]) * (c[y] - a[y]);
  const right = (b[y] - a[y]) * (c[x] - a[x]);
  const determinant = left - right, magnitude = Math.abs(left) + Math.abs(right);
  // A conservative filter for normal finite arithmetic. Cancellation,
  // underflow and overflow go through the exact path, including a rounded zero.
  if (Number.isFinite(magnitude) && magnitude >= 2 ** -1022 &&
    Math.abs(determinant) > 16 * Number.EPSILON * magnitude + 16 * Number.MIN_VALUE) {
    return Math.sign(determinant);
  }
  const [ax, ay, bx, by, cx, cy] = integers(values);
  const exact = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  return exact > 0n ? 1 : exact < 0n ? -1 : 0;
}

export function exactlyCollinear(a, b, c) {
  return orientation(a, b, c, 0, 1) === 0 && orientation(a, b, c, 1, 2) === 0 &&
    orientation(a, b, c, 2, 0) === 0;
}

/** Exact coplanarity of four supplied points; no distance tolerance or snapping. */
export function exactlyCoplanar(a, b, c, d) {
  const values = [...a, ...b, ...c, ...d];
  if (values.length !== 12 || !values.every(Number.isFinite)) throw new Error('invalid plane coordinate');
  const p = integers(values);
  const u = p.slice(3, 6).map((v, i) => v - p[i]),
    v = p.slice(6, 9).map((v, i) => v - p[i]),
    q = p.slice(9, 12).map((v, i) => v - p[i]);
  return (u[1] * v[2] - u[2] * v[1]) * q[0] + (u[2] * v[0] - u[0] * v[2]) * q[1] +
      (u[0] * v[1] - u[1] * v[0]) * q[2] === 0n;
}
