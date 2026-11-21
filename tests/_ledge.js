// Procedural closed ledges; no geometry from submitted projects.
import { ShapeUtils, Vector2 } from '../web/vendor/three/three.core.js';

export function ledgeFixture({ narrow = false, lower = false, roof = 8, slope = 0 } = {}) {
  const inner = narrow ? -.2 : -3;
  const profile = narrow
    ? [[-5, 0], [0, 0], [0, 5], [inner, 5], [inner, 20], [1.5,20], [1.5,0], [8,0], [8,23], [-5,23]]
    : lower
    ? [[-5, 0], [8, 0], [8, 1], [0, 1], [0, 5], [inner, 5], [inner, 20], [roof, 20], [roof, 23], [-5, 23]]
    : [[-5, 0], [0, 0], [0, 5], [inner, 5], [inner, 20], [roof, 20], [roof, 23], [-5, 23]];
  for (const p of profile) if (p[1] >= 20) p[1] += slope * p[0];
  const rings = [-25, 25].map(y => profile.map(([x, z]) => [x, y, z])), out = [];
  for (const [a, b, c] of ShapeUtils.triangulateShape(profile.map(([x, z]) => new Vector2(x, z)), [])) {
    out.push(rings[0][a], rings[0][b], rings[0][c], rings[1][a], rings[1][c], rings[1][b]);
  }
  for (let a = 0; a < profile.length; a++) {
    const b = (a + 1) % profile.length;
    out.push(rings[0][a], rings[1][a], rings[1][b], rings[0][a], rings[1][b], rings[0][b]);
  }
  return Float64Array.from(out.flat());
}
export const ledgeLine = (x = .6) => Array.from({ length: 31 }, (_, i) => [x, i - 15, 20]);
