import { assert } from '../../../tests/_util.js';
import { exactlyCollinear, orientation } from '../exact-geometry.js';

Deno.test('exact geometry: cancellation, underflow and overflow preserve winding', () => {
  const d = 2 ** -27;
  for (const scale of [2 ** -600, 1, 2 ** 600]) {
    const a = [0, 0, 0], b = [scale, (1 - d) * scale, 0], c = [(1 + d) * scale, scale, 0];
    assert(orientation(a, b, c) === 1);
    assert(orientation(a, c, b) === -1);
    assert(!exactlyCollinear(a, b, c));
    for (const axes of [[0, 1], [1, 2], [2, 0]]) {
      const points = [a, b, c].map((p) => {
        const q = [0, 0, 0];
        q[axes[0]] = p[0]; q[axes[1]] = p[1];
        return q;
      });
      assert(orientation(...points, ...axes) === 1);
      assert(!exactlyCollinear(...points));
    }
  }
});

Deno.test('exact geometry: truly collinear and repeated coordinates stay zero', () => {
  for (const scale of [Number.MIN_VALUE, 2 ** -600, 1, 2 ** 600]) {
    const a = [0, 0, 0], b = [scale, scale, scale], c = [2 * scale, 2 * scale, 2 * scale];
    assert(exactlyCollinear(a, b, c));
    assert(exactlyCollinear(a, b, b));
    assert(orientation(a, b, c) === 0);
  }
  assert(exactlyCollinear([0, -0, 0], [-0, 0, -0], [0, 0, 0]));
});

Deno.test('exact geometry: filtered signs match independent integer determinants', () => {
  let seed = 193;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed & 0xfffff) - 0x80000;
  };
  for (let i = 0; i < 1000; i++) {
    const p = Array.from({ length: 3 }, () => [next(), next()]);
    const q = p.map((p) => p.map(BigInt));
    const exact = (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) -
      (q[1][1] - q[0][1]) * (q[2][0] - q[0][0]);
    const expected = exact > 0n ? 1 : exact < 0n ? -1 : 0;
    for (const scale of [2 ** -600, 2 ** -20, 1, 2 ** 600]) {
      assert(orientation(...p.map((point) => point.map((v) => v * scale))) === expected);
    }
  }
});

Deno.test('exact geometry: nonfinite coordinates are rejected', () => {
  for (const v of [NaN, Infinity, -Infinity]) {
    let rejected = false;
    try { orientation([v, 0], [1, 1], [2, 2]); } catch (e) {
      rejected = /nonfinite predicate coordinate/.test(e.message);
    }
    assert(rejected);
  }
});
