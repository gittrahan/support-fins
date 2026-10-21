// Procedural closed block with a circular through-bore along X. No customer
// model is needed to reproduce automatic supports trapped in a small opening.
export function circularBore({ diameter = 5, length = 30, segments = 96, half = 10 } = {}) {
  const triangles = [];
  const quad = (a, b, c, d) => triangles.push(...a, ...b, ...c, ...a, ...c, ...d);
  const ring = (x, outer) => Array.from({ length: segments }, (_, i) => {
    const a = i * 2 * Math.PI / segments, c = Math.cos(a), s = Math.sin(a);
    const r = outer ? half / Math.max(Math.abs(c), Math.abs(s)) : diameter / 2;
    return [x, r * c, half + r * s];
  });
  const lo = ring(-length / 2, true), li = ring(-length / 2, false);
  const ro = ring(length / 2, true), ri = ring(length / 2, false);
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    quad(lo[i], lo[j], ro[j], ro[i]);
    quad(li[i], ri[i], ri[j], li[j]);
    quad(li[i], li[j], lo[j], lo[i]);
    quad(ri[i], ro[i], ro[j], ri[j]);
  }
  return Float64Array.from(triangles);
}
