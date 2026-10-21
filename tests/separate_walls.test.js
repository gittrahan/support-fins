// SEPARATE WALLS (GH #309, fins/fill.js `separateWalls`): resin cures walls that
// cross or share a base into one block, so with the option on Full coverage never
// joins a wall to another or its flange. Pinned: the sphere's joined walls are gone
// with it on, no fill wall's base overlaps another's, and off is the build as before.
import { assert, analyze, loadModel, fins } from './_util.js';

const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const build = (name, o = {}) => {
  const topo = loadModel(name);
  return fins.buildFins(topo, analyze(topo, 45, I), I, { mode: 'full', bedPad: true, ...o });
};

/** Pairs of fill walls whose bottom 1 mm (flange, foot) boxes, split per triangle, overlap. */
function touchingBases(b) {
  const fill = b.fins.filter((f) => f.fill);
  const boxes = fill.map((f) => {
    const out = [];
    const [s, e] = f.triRanges[0];
    for (let n = s; n + 2 < e; n += 3) {
      const t = [b.triangles[n], b.triangles[n + 1], b.triangles[n + 2]];
      if (Math.min(t[0][2], t[1][2], t[2][2]) > 1) continue;
      out.push([Math.min(...t.map((v) => v[0])), Math.min(...t.map((v) => v[1])),
                Math.max(...t.map((v) => v[0])), Math.max(...t.map((v) => v[1]))]);
    }
    return out;
  });
  let n = 0;
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    if (boxes[i].some((a) => boxes[j].some((c) => a[0] < c[2] && c[0] < a[2] && a[1] < c[3] && c[1] < a[3]))) n++;
  }
  return n;
}

Deno.test('separate walls: Full joins none, and keeps every fill wall\'s base apart', () => {
  const joined = build('sphere'), apart = build('sphere', { separateWalls: true });
  assert(joined.fill.joined > 0 && touchingBases(joined) > 0, 'the sphere joins walls without the option: the test lost its point');
  assert(apart.fill.joined === 0, `${apart.fill.joined} walls joined with the option on`);
  assert(touchingBases(apart) === 0, `${touchingBases(apart)} pairs of fill-wall bases overlap`);
});

Deno.test('separate walls: off is the build without the option', () => {
  const a = build('torus'), b = build('torus', { separateWalls: false });
  assert(a.triangles.length === b.triangles.length, 'same triangle count');
  for (let i = 0; i < a.triangles.length; i++) {
    for (let k = 0; k < 3; k++) if (a.triangles[i][k] !== b.triangles[i][k]) throw new Error(`vertex ${i} moved`);
  }
});
