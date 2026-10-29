import { assert, assertClose } from '../../../tests/_util.js';
import { decodePaint, encodePaintState } from '../bambu-paint.js';

const area = ([a, b, c]) => ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
const fails = (fn, pattern) => {
  try {
    fn();
  } catch (e) {
    assert(pattern.test(e.message), e.message);
    return;
  }
  throw new Error('invalid paint accepted');
};

Deno.test('paint: known whole-face codes retain slot identity, including extended slots', () => {
  for (
    const [code, state] of [['0', 0], ['4', 1], ['8', 2], ['0C', 3], ['1C', 4], ['DC', 16], ['0FC', 18], [
      '2FC',
      20,
    ], ['0FFC', 33]]
  ) {
    const leaf = decodePaint(code, 33);
    assert(leaf.length === 1 && leaf[0].state === state, code);
    assert(encodePaintState(state) === code, `slot ${state}`);
    assertClose(area(leaf[0].triangle), 0.5, 1e-15);
  }
  assert(decodePaint('', 0)[0].state === 0);
});

Deno.test('paint: one-side split states belong to the original corners, not the stored string order', () => {
  const leaves = decodePaint('481', 2);
  assert(
    JSON.stringify(leaves) === JSON.stringify([
      { triangle: [[0.5, 0.5], [0, 1], [0, 0]], state: 2 },
      { triangle: [[0, 0], [1, 0], [0.5, 0.5]], state: 1 },
    ]),
  );
  for (const code of ['481', '485', '489']) {
    const leaves = decodePaint(code, 2);
    assert(leaves.length === 2);
    for (const l of leaves) assertClose(area(l.triangle), 0.25, 1e-15);
  }
});

Deno.test('paint: two- and three-side subdivisions retain distinct regions and inherited leaves', () => {
  const three = decodePaint('480C2', 3);
  assert(three.map((l) => l.state).join(',') === '3,2,1');
  assert(three.map((l) => area(l.triangle)).join(',') === '0.25,0.125,0.125');
  const four = decodePaint('480C03', 3);
  assert(four.map((l) => l.state).join(',') === '0,3,2,1');
  assert(four.every((l) => area(l.triangle) === 0.125));
  assert(JSON.stringify(four[0].triangle) === '[[0.5,0],[0.5,0.5],[0,0.5]]');
});

Deno.test('paint: nested splits cover exactly the original triangle', () => {
  // Root: split one side, child 1 state 2, child 0 split three sides with
  // children 3..0 = inherited,3,2,1. Reverse nibble stream: 1,8,3,0,C,0,8,4.
  const leaves = decodePaint('480C0381', 3);
  assert(leaves.length === 5);
  assertClose(leaves.reduce((s, l) => s + area(l.triangle), 0), 0.5, 1e-15);
  assert(leaves.every((l) => l.triangle.every(([u, v]) => u >= 0 && v >= 0 && u + v <= 1)));
});

Deno.test('paint: malformed trees and missing filament slots fail, without default-color fallback', () => {
  for (const code of ['G', '12z', ' 4', '-4']) fails(() => decodePaint(code), /hexadecimal/);
  for (const code of ['1', 'C', 'FC', '4811']) fails(() => decodePaint(code), /truncated/);
  for (const code of ['7', 'B', 'F', 'D']) fails(() => decodePaint(code), /orientation/);
  for (const code of ['00', '48']) fails(() => decodePaint(code), /trailing/);
  fails(() => decodePaint('1C', 3), /unavailable state 4/);
  fails(() => decodePaint('0C', 2), /unavailable state 3/);
  for (const n of [-1, 1.5, NaN, Infinity]) fails(() => encodePaintState(n), /invalid paint state/);
});
