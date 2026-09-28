// Bores get supported (Matthew's print tests, 2026-09-27, reversing the old
// never-fin-a-bore rule). A part-attached wall stands on the bore's floor under
// its ceiling, runs ALONG the bore so it pulls out an open end, and is flagged
// inBore for Suggest orientation. A refusal is counted under its real reason --
// there is no `bore` skip any more.

import { holedPlateTopo, analyze, fins, rotY, assert } from './_util.js';

// A 40 x 40 block, 30 thick, with a 10 x 10 bore through it; turned on its side
// (rotY 90) the bore runs along X, with a flat 30 x 10 ceiling 10 mm above its floor.
const topo = holedPlateTopo(20, 20, 30, 5, 5);
const rot = rotY(90);
const res = analyze(topo, 45, rot);
const built = fins.buildFins(topo, res, rot, { mode: 'auto', bedPad: true });

Deno.test('bores: the bore ceiling gets a wall on the bore floor, flagged inBore', () => {
  const inBore = built.props.filter((q) => q.inBore);
  assert(inBore.length >= 1, `no wall in the bore: ${JSON.stringify(built.skipped)}`);
  for (const w of inBore) assert(w.partAttached, 'a bore wall must stand on the bore floor');
});

Deno.test('bores: the wall runs along the bore axis, so it slides out an open end', () => {
  for (const w of built.props.filter((q) => q.inBore)) {
    const a = w.line[0], b = w.line[w.line.length - 1];
    const along = Math.abs(b[0] - a[0]), across = Math.abs(b[1] - a[1]);
    assert(along > 3 * across, `wall runs across the bore: dx ${along.toFixed(1)} dy ${across.toFixed(1)}`);
  }
});

Deno.test('bores: no `bore` skip reason is reported', () => {
  assert(!('bore' in built.skipped), `skipped still carries bore: ${JSON.stringify(built.skipped)}`);
});
