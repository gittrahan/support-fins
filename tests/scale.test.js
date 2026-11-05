// Part scale (web/scale.js, ui/scale.js): uniform, about the part's centre, so the
// part and a slicer's own parts (#104) stay where each other are.

import { assert } from './_util.js';
import {
  IDENTITY, scaleAbout, mul3, stretchOnPlate, uniformOf, sizeOnPlate, fieldValue, stretchFor, MIN_FACTOR,
} from '../web/scale.js';

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

const rotZ = (d) => { const r = d * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
const box = (x, y, z) => new Float32Array([0, 0, 0, x, y, z]);
const nearN = (a, b, e = 1e-4) => assert(Math.abs(a - b) < e, `${a} !== ${b}`);

Deno.test('scale: a matrix scales per axis, a factor still scales alike', () => {
  const src = new Float32Array([1, 2, 3]);
  near(scaleAbout(src, [2, 0, 0, 0, 1, 0, 0, 0, 0.5], [0, 0, 0]), [2, 2, 1.5]);
  near(scaleAbout(src, 2, [0, 0, 0]), scaleAbout(src, [2, 0, 0, 0, 2, 0, 0, 0, 2], [0, 0, 0]));
  near(mul3([2, 0, 0, 0, 3, 0, 0, 0, 4], IDENTITY), [2, 0, 0, 0, 3, 0, 0, 0, 4]);
});

Deno.test('scale: a stretch along the plate grows the box on the plate by exactly that', () => {
  const part = box(40, 10, 5);
  for (const deg of [0, 30, 90, 137]) {
    const R = rotZ(deg);
    const before = sizeOnPlate(part, R);
    const m = stretchOnPlate(IDENTITY, [2, 1, 1], R);              // twice as wide on the plate
    const after = sizeOnPlate(scaleAbout(part, m, [0, 0, 0]), R);
    nearN(after[0], before[0] * 2); nearN(after[1], before[1]); nearN(after[2], before[2]);
  }
  // unrotated, it is the plain diagonal
  near(stretchOnPlate(IDENTITY, [2, 3, 4], IDENTITY), [2, 0, 0, 0, 3, 0, 0, 0, 4]);
  // stretches compose: X then Z is both
  near(stretchOnPlate(stretchOnPlate(IDENTITY, [2, 1, 1], IDENTITY), [1, 1, 3], IDENTITY), [2, 0, 0, 0, 1, 0, 0, 0, 3]);
});

Deno.test('scale: uniform is told apart from a stretch, whatever the pose', () => {
  assert(uniformOf(IDENTITY) === 1);
  assert(uniformOf([1.5, 0, 0, 0, 1.5, 0, 0, 0, 1.5]) === 1.5);
  assert(uniformOf([2, 0, 0, 0, 1, 0, 0, 0, 1]) === null);
  const R = rotZ(37);
  nearN(uniformOf(stretchOnPlate(IDENTITY, [3, 3, 3], R)), 3);       // R^T 3I R is 3I
  assert(uniformOf(stretchOnPlate(IDENTITY, [3, 1, 1], R)) === null);
});

Deno.test('scale: a part written in metres comes back from its size in mm (#440)', () => {
  // 200 x 100 x 50 mm written in metres: it loads 0.2 x 0.1 x 0.05
  const tiny = box(0.2, 0.1, 0.05);
  const cur = sizeOnPlate(tiny, IDENTITY);
  const d = stretchFor(0, 200, cur, cur, true);                     // type 200 in X, Uniform on
  nearN(d[0], 1000, 1e-3); assert(d[0] === d[1] && d[1] === d[2]);
  const back = scaleAbout(tiny, d[0], [0, 0, 0]);
  near(back, [0, 0, 0, 200, 100, 50]);                               // float32 keeps it
  // the same by percent: 100000 % of the 100 % size
  nearN(stretchFor(0, 100000 / 100 * cur[0], cur, cur, true)[0], 1000, 1e-3);
});

Deno.test('scale: one axis on its own, and the 10 % floor per axis', () => {
  const at100 = [100, 50, 20];
  near(stretchFor(2, 30, at100, at100, false), [1, 1, 1.5]);        // Z to 30 mm, X and Y stay
  near(stretchFor(0, 1, at100, at100, false), [MIN_FACTOR, 1, 1]);  // X to 1 mm stops at 10 mm
  // Uniform: a shrink that would take Z under its floor stops there for all three
  const cur = [100, 50, 4];                                          // Z already squashed to 20 %
  const d = stretchFor(0, 10, cur, at100, true);
  nearN(cur[2] * d[2], 2); assert(d[0] === d[2]);
  assert(stretchFor(2, 10, [10, 10, 0], [10, 10, 0], false) === null); // a flat sheet's Z
});

Deno.test('scale: fields take a positive number, junk is refused', () => {
  assert(fieldValue('150') === 150 && fieldValue(2.5) === 2.5 && fieldValue('200000') === 200000);
  for (const v of ['', ' ', 'abc', '0', '-20', NaN, Infinity]) assert(fieldValue(v) === null, String(v));
});
