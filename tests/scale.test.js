// Part scale (web/scale.js, ui/scale.js): uniform, about the part's centre, so the
// part and a slicer's own parts (#104) stay where each other are.

import { assert } from './_util.js';
import { scaleAbout, scaleFromPercent } from '../web/scale.js';

const near = (a, b) => assert(a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-5),
  `${[...a]} !== ${[...b]}`);

Deno.test('scale: about a point, landing on another, source untouched', () => {
  const src = new Float32Array([1, 2, 3, -1, 0, 5]);
  near(scaleAbout(src, 2, [0, 0, 0]), [2, 4, 6, -2, 0, 10]);
  // the centred part back in the file frame: c + s * p
  near(scaleAbout(src, 1.5, [0, 0, 0], [10, 20, 30]), [11.5, 23, 34.5, 8.5, 20, 37.5]);
  // a slicer part in the file frame, about the same centre: the centre stays put
  near(scaleAbout(new Float32Array([10, 20, 30, 12, 20, 30]), 3, [10, 20, 30]), [10, 20, 30, 16, 20, 30]);
  near(src, [1, 2, 3, -1, 0, 5]);
});

Deno.test('scale: centred part and file-frame extras agree after scaling', () => {
  const c = [5, -3, 7];
  const file = new Float32Array([5, -3, 7, 6, -1, 8]);              // the part as the file had it
  const centred = file.map((v, i) => v - c[i % 3]);                  // as setPart leaves it
  near(scaleAbout(centred, 2.5, [0, 0, 0], c), scaleAbout(file, 2.5, c));
});

Deno.test('scale: percent field -> factor, clamped, junk refused', () => {
  assert(scaleFromPercent('150') === 1.5);
  assert(scaleFromPercent(100) === 1);
  assert(scaleFromPercent('0.5') === 0.01);
  assert(scaleFromPercent('5000') === 10);
  for (const v of ['', 'abc', '0', '-20', NaN]) assert(scaleFromPercent(v) === null, String(v));
});
