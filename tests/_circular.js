// A closed turned body with a conical recess on its underside. Body height and
// tessellation can vary independently of the supported recess.
export function recessedBody({ segments = 120, height = 40, opening = 25,
  bore = 15, depth = 10, outer = 35, yaw = 0, translate = [0, 0, 0] } = {}) {
  const profile = [[outer, 0], [outer, height], [bore, height], [bore, depth], [opening, 0]];
  const out = [];
  const point = ([r, z], i) => {
    const a = i * 2 * Math.PI / segments + yaw * Math.PI / 180;
    return [r * Math.cos(a) + translate[0], r * Math.sin(a) + translate[1], z + translate[2]];
  };
  for (let i = 0; i < segments; i++) for (let j = 0; j < profile.length; j++) {
    const p = profile[j], q = profile[(j + 1) % profile.length];
    const a = point(p, i), b = point(p, i + 1), c = point(q, i + 1), d = point(q, i);
    out.push(...a, ...b, ...c, ...a, ...c, ...d);
  }
  return Float64Array.from(out);
}
