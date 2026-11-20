// plugins/shared/engine/tilt.js: the tilt a slicer plugin names when overhangs were left
// too shallow for a fin this way up (#477).
import { readFileSync } from 'node:fs';
import { computeFins } from '../engine/fins_entry.js';
import { downOf, rotate, tiltHint, tiltPhrase } from '../engine/tilt.js';
import { readSTL, MODELS, assert } from '../../../tests/_util.js';

const torus = () => Float64Array.from(readSTL(readFileSync(`${MODELS}torus.stl`)));

Deno.test('tilt: words for each kind of pose', () => {
  const s = Math.SQRT1_2;
  assert(tiltPhrase([0, 0, 1]).phrase === 'turning it upside down');
  assert(tiltPhrase([-1, 0, 0]).phrase === 'laying it on its left side (-X)');
  assert(tiltPhrase([0, 1, 0]).phrase === 'laying it on its back side (+Y)');
  const t = tiltPhrase([0, -s, -s]);
  assert(t.degrees === 45 && t.phrase === 'tilting it 45° toward the front (-Y)', t.phrase);
  assert(tiltPhrase([s * s, s * s, -s]).phrase === 'tilting it 45° toward the back-right (+Y +X)');
});

Deno.test('tilt: the face a pose puts down is the one its rotation sends to the plate', () => {
  const R = [1, 0, 0, 0, 0, 1, 0, -1, 0];   // column-major: +Y -> +Z, +Z -> -Y
  const d = downOf(R);
  // R d must be (0, 0, -1)
  const rz = R[2] * d[0] + R[5] * d[1] + R[8] * d[2];
  assert(Math.abs(rz + 1) < 1e-9, `R d = ${rz}`);
});

Deno.test('tilt: nothing bare, nothing to suggest (and no build spent)', () => {
  assert(tiltHint(torus(), {}, 0) === null);
});

Deno.test('tilt: a torus flat on the plate leaves its inner ceiling bare; on its side it does not', () => {
  const p = torus();
  const before = computeFins(p, {}).stats.unserved;
  assert(before > 0, 'the torus as modelled should leave something bare');
  const hint = tiltHint(p, {}, before);
  assert(hint && hint.unserved < before, JSON.stringify(hint));
  assert(/^laying it on its (left|right|front|back) side/.test(hint.phrase), hint.phrase);
});

Deno.test('tilt: the named side is the one that ends up on the plate, and the count is the build\'s', () => {
  const p = torus();
  const before = computeFins(p, {}).stats.unserved;
  const hint = tiltHint(p, {}, before);
  const turned = rotate(p, hint.rot);
  // every vertex of the named side is at the new bottom: the side whose direction is `down`
  // has the largest projection on it, so after the turn it has the lowest z
  let lo = Infinity, atSide = -Infinity, best = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    const proj = p[i] * hint.down[0] + p[i + 1] * hint.down[1] + p[i + 2] * hint.down[2];
    if (turned[i + 2] < lo) lo = turned[i + 2];
    if (proj > best) { best = proj; atSide = turned[i + 2]; }
  }
  assert(Math.abs(atSide - lo) < 1e-6, `the ${hint.phrase} vertex sits at ${atSide}, bottom ${lo}`);
  const [x, y] = hint.down;
  const word = Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : (y > 0 ? 'back' : 'front');
  assert(hint.phrase.includes(word), `${hint.phrase} for down ${hint.down}`);
  assert(computeFins(turned, {}).stats.unserved === hint.unserved);
});

Deno.test('tilt: a pose that leaves more pieces floating is not named', () => {
  const p = torus();
  const before = computeFins(p, {}).stats;
  // a baseline with fewer floating pieces than any pose can have: nothing qualifies
  assert(tiltHint(p, {}, before.unserved, -1) === null);
});
