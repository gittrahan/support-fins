import { boxExtrude } from '../../../web/solids.js';
import { turningRuntime, triangles } from '../project-turning-geometry.js';

export function solid(w, flat) {
  const points = [], ids = new Map(), indices = [];
  for (let i = 0; i < flat.length; i += 3) {
    const point = Array.from(flat.slice(i, i + 3)), key = point.join(',');
    if (!ids.has(key)) { ids.set(key, points.length / 3); points.push(...point); }
    indices.push(ids.get(key));
  }
  const result = new w.Manifold(new w.Mesh({ numProp: 3,
    vertProperties: Float32Array.from(points), triVerts: Uint32Array.from(indices) }));
  if (result.status() !== 'NoError') { result.delete(); throw Error('invalid procedural solid'); }
  return result;
}

/** A roof on two end walls above an inclined seat. Pure procedural source;
 * no user model, saved project, slicer cache or registered test imports. */
export async function roofBody(sx = .5, sy = .8, withSeat = true, roofHeight = 44) {
  const w = await turningRuntime(), soups = [];
  const box = (x0, x1, y0, y1, z0, z1) => {
    const t = []; boxExtrude([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], z0, z1, (x, y, z) => [x, y, z], t); soups.push(t.flat());
  };
  const t = [], curve = Array.from({ length: 49 }, (_, i) => { const y = 6 - i / 4; return [y, 14 + 2 * y]; });
  if (withSeat) { boxExtrude([[-6, 0], [6, 0], ...curve], -10, 10, (y, z, x) => [x, y, z], t); soups.push(t.flat()); }
  box(-10, -8, -6, 6, 0, roofHeight + 2); box(8, 10, -6, 6, 0, roofHeight + 2); box(-10, 10, -6, 6, roofHeight, roofHeight + 2);
  const parts = soups.map((p) => solid(w, p)); let joined;
  try {
    joined = w.Manifold.union(parts);
    return Float64Array.from(triangles(joined).flat(), (v, i) => v * (i % 3 === 0 ? sx : i % 3 === 1 ? sy : 1));
  } finally { joined?.delete(); for (const p of parts) p.delete(); }
}

export const finOptions = { mode: 'auto', nozzle: .8, layerHeight: .4, gap: .3, bedPad: false, tines: true, coverage: .5 };
export const dimensions = { nozzle: .8, lineWidth: .82, layerHeight: .4, firstLayerHeight: .4, sideGap: .35, bridgeAngle: 90 };
