// Camera view presets (#350): each view looks square at its side of the part, keeps
// the target and distance, and Top/Bottom keep a heading OrbitControls can orbit from.
import { VIEWS, viewPosition, orbitLerp } from '../web/ui/viewpresets.js';
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
