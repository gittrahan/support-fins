// Camera view presets (#350): each view looks square at its side of the part, keeps
// the target and distance, and Top/Bottom keep a heading OrbitControls can orbit from.
import {
  VIEWS, viewPosition, orbitLerp, dirPosition, CUBE_FACES, cubeCellDir, HOME_DIR,
} from '../web/ui/viewpresets.js';
import { assert } from './_util.js';

const near = (a, b, eps = 1e-3) => a.every((v, i) => Math.abs(v - b[i]) < eps);

Deno.test('viewpresets: each view sits on its own side, at the same distance', () => {
  const tgt = [10, -5, 20], d = 150;
  const want = {
    front: [10, -155, 20], back: [10, 145, 20], left: [-140, -5, 20],
    right: [160, -5, 20], top: [10, -5, 170], bottom: [10, -5, -130],
  };
  for (const [key, w] of Object.entries(want)) {
    const p = viewPosition(key, tgt, d);
    assert(near(p, w, 0.05), `${key}: ${p}`);
    assert(Math.abs(Math.hypot(...p.map((v, i) => v - tgt[i])) - d) < 1e-9, `${key}: distance`);
  }
});

Deno.test('viewpresets: Top and Bottom lean off the up axis toward the front', () => {
  for (const key of ['top', 'bottom']) {
    const [x, y] = viewPosition(key, [0, 0, 0], 100);
    assert(x === 0 && y < 0, `${key}: straight down Z leaves OrbitControls no heading`);
  }
});

Deno.test('viewpresets: every view has a label and a tooltip', () => {
  assert(Object.keys(VIEWS).length === 6);
  for (const [key, v] of Object.entries(VIEWS)) assert(v.label && v.hint, key);
});

Deno.test('viewpresets: a glide to the opposite view swings round, never through the target', () => {
  const pos = (k) => viewPosition(k, [0, 0, 0], 100);
  for (const [a, b] of [['front', 'back'], ['left', 'right'], ['top', 'bottom'], ['front', 'top']]) {
    for (let e = 0; e <= 1.0001; e += 0.05) {
      const p = orbitLerp(pos(a), pos(b), e);
      assert(Math.abs(Math.hypot(...p) - 100) < 1e-6, `${a}->${b} at ${e.toFixed(2)}: radius ${Math.hypot(...p)}`);
    }
    assert(near(orbitLerp(pos(a), pos(b), 0), pos(a)) && near(orbitLerp(pos(a), pos(b), 1), pos(b)),
      `${a}->${b}: ends`);
  }
  // the zoom eases with it when the distances differ
  assert(Math.abs(Math.hypot(...orbitLerp([0, -50, 0], [100, 0, 0], 0.5)) - 75) < 1e-9);
});

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

Deno.test('viewcube: each face reads upright from outside, in its own view', () => {
  for (const [key, { n, u, v }] of Object.entries(CUBE_FACES)) {
    // CSS's y runs down, so a face drawn the right way round has u x v = -n
    assert(near(cross(u, v), n.map((c) => -c)), `${key}: mirrored or inside out`);
    // its middle cell is the matching button's view
    const d = cubeCellDir(key, 0, 0);
    assert(near(dirPosition(d, [0, 0, 0], 1), viewPosition(key, [0, 0, 0], 1)), `${key}: centre`);
  }
  // Top's "down" is the front (back of the plate at the top), Bottom's the back
  assert(near(CUBE_FACES.top.v, [0, -1, 0]) && near(CUBE_FACES.bottom.v, [0, 1, 0]));
});

Deno.test('viewcube: 26 targets -- a corner on 3 faces, an edge on 2, a face on 1', () => {
  const seen = new Map();
  for (const key of Object.keys(CUBE_FACES)) {
    for (const r of [-1, 0, 1]) for (const c of [-1, 0, 1]) {
      const d = cubeCellDir(key, c, r).join(',');
      seen.set(d, (seen.get(d) ?? 0) + 1);
    }
  }
  assert(seen.size === 26, `${seen.size} distinct views`);
  for (const [d, k] of seen) {
    const nonzero = d.split(',').filter((x) => +x !== 0).length;
    assert(k === nonzero, `${d}: on ${k} faces, wants ${nonzero}`);
    assert(d.split(',').every((x) => [-1, 0, 1].includes(+x)), `${d}: off the cube`);
  }
});

Deno.test('viewcube: straight up / down leans to the front; Home is front right, above', () => {
  for (const z of [1, -1]) {
    const [x, y] = dirPosition([0, 0, z], [0, 0, 0], 50);
    assert(x === 0 && y < 0 && y > -0.01, `z ${z}: ${x},${y}`);
  }
  const [x, y, z] = dirPosition(HOME_DIR, [0, 0, 0], 1);
  assert(x > 0 && y < 0 && z > 0);
});
