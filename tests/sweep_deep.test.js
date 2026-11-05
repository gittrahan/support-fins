// prototype/sweep/deep.js: the Full sweep's own depth check, which has to find a wall
// inside the part with no help from the engine, in any pose.
import { assertEquals } from 'jsr:@std/assert';
import { deepWalls } from '../prototype/sweep/deep.js';

// A closed 20 mm box from (0,0,0) to (20,20,20), as flat floats.
function box() {
  const v = [[0, 0, 0], [20, 0, 0], [20, 20, 0], [0, 20, 0], [0, 0, 20], [20, 0, 20], [20, 20, 20], [0, 20, 20]];
  const q = (a, b, c, d) => [v[a], v[b], v[c], v[a], v[c], v[d]];
  return Float32Array.from([...q(0, 3, 2, 1), ...q(4, 5, 6, 7), ...q(0, 1, 5, 4), ...q(2, 3, 7, 6), ...q(1, 2, 6, 5), ...q(0, 4, 7, 3)].flat());
}
const FLAT = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const AT_ZERO = { x: 0, y: 0, z: 0 };
const fin = (lo, hi) => ({ triRanges: [[lo, hi]] });

Deno.test('deepWalls: a vertex past the depth counts, a shallower or outside one does not', () => {
  const tris = [[10, 10, 0.5], [10, 10, 0.1], [10, 10, -3]];
  assertEquals(deepWalls(box(), FLAT, AT_ZERO, [fin(0, 1)], tris), { walls: 1, max: 0.5 });
  assertEquals(deepWalls(box(), FLAT, AT_ZERO, [fin(1, 2)], tris), { walls: 0, max: 0 });
  assertEquals(deepWalls(box(), FLAT, AT_ZERO, [fin(2, 3)], tris), { walls: 0, max: 0 });
});

Deno.test('deepWalls: counts walls, not vertices, and reports the deepest', () => {
  const tris = [[10, 10, 0.5], [10, 10, 2], [5, 5, 1]];
  assertEquals(deepWalls(box(), FLAT, AT_ZERO, [fin(0, 2), fin(2, 3)], tris), { walls: 2, max: 2 });
});

Deno.test('deepWalls: undoes the pose and offset before measuring', () => {
  const a = Math.PI / 6, c = Math.cos(a), s = Math.sin(a);
  const rot = [1, 0, 0, 0, c, s, 0, -s, c];        // column-major, as analyze uses it
  const offset = { x: 3, y: -4, z: 7 };
  const world = ([x, y, z]) => [x + offset.x, c * y - s * z + offset.y, s * y + c * z + offset.z];
  const tris = [world([10, 10, 1]), world([10, 10, -1])];
  assertEquals(deepWalls(box(), rot, offset, [fin(0, 1)], tris), { walls: 1, max: 1 });
  assertEquals(deepWalls(box(), rot, offset, [fin(1, 2)], tris), { walls: 0, max: 0 });
});
