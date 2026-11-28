// #504: the ring under a downward counterbore. Auto's lines across the ring are cut
// to stubs by the screw hole and the recess's side walls ('blocked'), so the normal
// and last-resort passes both refused it and Auto left it bare. A region refused that
// way now gets one fill wall (fins/fill.js), there only -- every other bare region
// stays Full's job.

import { buildTopology, analyze, fins, readSTL, insideCount, assert } from './_util.js';

const pos = readSTL(Deno.readFileSync(new URL('./fixtures/counterbore_down.stl', import.meta.url)));
const topo = buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
const rot = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const res = analyze(topo, 45, rot);
const built = fins.buildFins(topo, res, rot, { mode: 'auto', bedPad: true });

Deno.test('counterbore: Auto holds the ring with one wall on the plate', () => {
  assert(res.regions.length >= 1, 'the ring is an overhang');
  assert(built.fins.length === 1, `one wall, got ${built.fins.length}: ${JSON.stringify(built.skipped)}`);
  assert(built.unserved === 0, `ring left unserved: ${built.unserved}`);
  const w = built.fins[0];
  // under the step (z 5), inside the 11 mm recess
  for (const p of w.line) {
    assert(Math.abs(p[2] - 5) < 0.5, `contact off the step: z ${p[2]}`);
    assert(Math.hypot(p[0], p[1]) < 5.5, `contact outside the recess: ${p}`);
  }
});

Deno.test('counterbore: the wall stays out of the part', () => {
  const [a, b] = built.fins[0].triRanges[0];
  const n = insideCount(topo, rot, res.offset, built.triangles.slice(a, b));
  assert(n === 0, `${n} wall vertices inside the part`);
});

Deno.test('counterbore: the tests\' Auto baseline (lastResort: false) still leaves it bare', () => {
  const base = fins.buildFins(topo, res, rot, { mode: 'auto', bedPad: true, lastResort: false });
  assert(base.fins.length === 0, `baseline built ${base.fins.length} walls`);
});
