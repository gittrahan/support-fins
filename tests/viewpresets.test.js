// Camera view presets (#350): each view looks square at its side of the part, keeps
// the target and distance, and Top/Bottom keep a heading OrbitControls can orbit from.
import { VIEWS, viewPosition } from '../web/ui/viewpresets.js';
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
