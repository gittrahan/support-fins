import { assert, assertClose } from '../../../tests/_util.js';
import { exactlyCoplanar } from '../exact-geometry.js';
import { uniformPaintRegions } from '../paint-regions.js';
import { remapProjectPaint } from '../project-paint.js';
import { canonicalCutMesh } from '../project-bake-mesh.js';
import { cross, sub, triangle } from '../paint-geometry.js';

const source = (triangles, attrs = triangles.map(() => ({ paint_color: '4' }))) => triangles.map((points, i) => ({
  points, attrs: { channels: [{ leaves: [1] }], regions: [{ attrs: attrs[i] }] },
}));
const a = [[0, 0, 0], [2, 0, 0], [0, 2, 0]], b = [[2, 0, 0], [2, 2, 0], [0, 2, 0]];

Deno.test('paint regions: merge only identical states over an exact coplanar shared edge', () => {
  for (const map of [(p) => p, ([x, y, z]) => [-y + 100, x - 80, z + 3]]) {
    const s = source([a.map(map), b.map(map)]);
    const before = JSON.stringify(s);
    const regions = uniformPaintRegions([0, 1], s);
    assert(regions.length === 1 && regions[0].points.length === 4);
    assert(JSON.stringify(s) === before, 'source geometry mutated');
  }
  for (const changed of [{ paint_color: '8' }, { paint_color: '4', paint_seam: '8' },
    { paint_color: '4', paint_supports: '4' }, { paint_color: '4', pid: '1', p1: '2' }]) {
    assert(uniformPaintRegions([0, 1], source([a, b], [{ paint_color: '4' }, changed])).length === 2);
  }
  const recursive = source([a, b]);
  recursive[1].attrs.channels[0].leaves.push(2);
  assert(uniformPaintRegions([0, 1], recursive).length === 2);
});

Deno.test('paint regions: preserve folds, gaps, concavities and untouched source vertices', () => {
  const folded = b.map((p, i) => i === 1 ? [p[0], p[1], Number.MIN_VALUE] : p);
  assert(!exactlyCoplanar(...a, folded[1]));
  assert(uniformPaintRegions([0, 1], source([a, folded])).length === 2);
  const gapped = b.map(([x, y, z]) => [x + 1e-10, y, z]);
  assert(uniformPaintRegions([0, 1], source([a, gapped])).length === 2);
  const concave = [[2, 0, 0], [3, -0.5, 0], [0, 2, 0]];
  assert(uniformPaintRegions([0, 1], source([a, concave])).length === 2);
  const three = [...a.slice(0, 2), [1, 1, 0]],
    pieces = source([three, [a[1], b[1], three[2]], [three[2], b[1], b[2]], [a[0], three[2], a[2]]]);
  const merged = uniformPaintRegions([0, 1, 2, 3], pieces);
  assert(merged.length === 1 && merged[0].points.length === 4);
});

function diagonalFixture(distinct = false) {
  // Procedural vertical paint bands intersect a thin tetrahedron. Clipping
  // the two state-4 source triangles separately creates a false tiny fragment
  // at their internal diagonal. The adjacent state-8 band has real positive area.
  const tris = [
    [[89.78999999999999, 100, 0], [89.78999999999999, 100, 10], [90.21000000000001, 100, 0]],
    [[89.78999999999999, 100, 10], [90.21000000000001, 100, 10], [90.21000000000001, 100, 0]],
    [[89.78999999999999, 100, 0], [80, 100, 10], [89.78999999999999, 100, 10]],
  ];
  const positions = Float64Array.from(tris.flat(2));
  const component = {
    positions, sourceFaces: Int32Array.of(0, 1, 2), cornerOrder: [0, 1, 2],
    source: { vertices: positions, indices: Uint32Array.from({ length: 9 }, (_, i) => i),
      attributes: {}, properties: [], triangleAttributes: [{ paint_color: '4' },
        { paint_color: distinct ? '0C' : '4' }, { paint_color: '8' }] },
  };
  const [p, q, r, s] = [[89.78999999999999, 100, 10], [89.79839999198913, 100, 9.800000190734863],
    [89.78999999970198, 100, 9.800000190734863], [89.789, 99, 9.9]];
  const cut = { positions: Float64Array.from([p, q, r, p, r, s, r, q, s, q, p, s].flat()),
    sourceFaces: Int32Array.of(0, -1, -1, -1) };
  return { component, cut };
}

Deno.test('paint regions: invisible diagonals do not collapse genuine nearby painting', () => {
  const { component, cut } = diagonalFixture();
  canonicalCutMesh(cut);
  const painted = remapProjectPaint(component, cut, 3, { precision: 'float64' });
  assert(canonicalCutMesh(painted).collapsedFaces === 0);
  const area = (points) => Math.hypot(...cross(sub(points[1], points[0]), sub(points[2], points[0]))) / 2;
  const byState = new Map();
  for (let f = 0; f < painted.triangleAttributes.length; f++) {
    const state = painted.triangleAttributes[f].paint_color;
    if (state) byState.set(state, (byState.get(state) ?? 0) + area(triangle(painted.positions, f)));
  }
  assert(byState.get('4') > 0 && byState.get('8') > 0, 'a distinct painted region disappeared');
  assertClose(byState.get('4') + byState.get('8'), area(triangle(cut.positions, 0)), 1e-15);
  const output = new Set(Array.from({ length: painted.positions.length / 3 },
    (_, i) => Array.from(painted.positions.subarray(i * 3, i * 3 + 3)).join(',')));
  for (let i = 0; i < cut.positions.length; i += 3) {
    assert(output.has(Array.from(cut.positions.subarray(i, i + 3)).join(',')), 'Boolean vertex moved');
  }
});

Deno.test('paint regions: an unrepresentable distinct state still fails', () => {
  const { component, cut } = diagonalFixture(true);
  let rejected = false;
  try {
    remapProjectPaint(component, cut, 3, { precision: 'float64' });
  } catch (e) {
    assert(/smaller than conversion precision/.test(e.message), e.stack);
    rejected = true;
  }
  assert(rejected, 'a distinct paint state was merged or discarded');
});
