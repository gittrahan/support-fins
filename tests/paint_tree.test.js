import { assert, assertEquals, assertThrows } from 'jsr:@std/assert';
import { decodePaint, encodePaintState } from '../web/paint-tree.js';

Deno.test('paint tree: Prusa extended slots use their own escape and retain categorical identity', () => {
  const prusa = { format: 'prusa' };
  for (const [state, code] of [[0, '0'], [1, '4'], [2, '8'], [3, '0C'], [16, 'DC'],
    [17, '00EC'], [18, '01EC'], [20, '03EC'], [255, 'EEEC']]) {
    assertEquals(encodePaintState(state, prusa), code);
    assertEquals(decodePaint(code, 255, prusa)[0].state, state);
  }
  assertEquals(decodePaint('EC', 255)[0].state, 17, 'Bambu encoding changed');
  assertThrows(() => decodePaint('EC', 255, prusa), Error, 'truncated');
  assertEquals(decodePaint('FC', 255, prusa)[0].state, 18, 'native-compatible legacy leaf');
  assertThrows(() => decodePaint('FFEC', 300, prusa), Error, 'supported range');
  assertThrows(() => encodePaintState(256, prusa), Error, 'supported range');
});

Deno.test('paint tree: both formats retain exact original-corner regions through nested splits', () => {
  for (const code of ['481', '485', '489', '480C2', '480C03', '480C0381']) {
    const bambu = decodePaint(code, 3), prusa = decodePaint(code, 3, { format: 'prusa' });
    assertEquals(prusa, bambu);
    const area = prusa.reduce((sum, { triangle: [a, b, c] }) => sum
      + ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2, 0);
    assertEquals(area, .5);
    assert(prusa.every(({ triangle }) => triangle.every(([u, v]) => u >= 0 && v >= 0 && u + v <= 1)));
  }
  const regions = decodePaint('400EC1', 17, { format: 'prusa' });
  assertEquals(regions.map((r) => r.state), [17, 1]);
});

Deno.test('paint tree: malformed and out-of-palette Prusa data never becomes a guessed state', () => {
  for (const code of ['G', 'EC', '0EC', '1', 'D', '00']) {
    assertThrows(() => decodePaint(code, 255, { format: 'prusa' }));
  }
  assertThrows(() => decodePaint('01EC', 17, { format: 'prusa' }), Error, 'unavailable state');
  assertThrows(() => decodePaint('4', 2, { format: 'unknown' }), Error, 'unknown paint format');
  assertThrows(() => encodePaintState(1, { format: 'unknown' }), Error, 'unknown paint format');
});
