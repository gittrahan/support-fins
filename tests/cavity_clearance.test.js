// The local feeding-stand experiment uses three independent clearances. A
// part-attached wall can lift its body off the cavity floor only if it keeps
// printable contacts at intervals along that floor.
import { assert, blockTopo, isClosed, fins, prop } from './_util.js';
import { sweepBetween } from '../web/prop/sweep.js';
import { stationIsClear } from '../web/prop/clearance.js';

Deno.test('larger side clearance rejects a wall close to the cavity side', () => {
  const before = prop.PROP.sideClear;
  const side = blockTopo(1.2, 2.2, -2, 12, 0, 9);
  const line = [[0, 0, 10], [0, 5, 10], [0, 10, 10]];
  const rot = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  try {
    prop.PROP.sideClear = 0.35;
    assert(stationIsClear(line, 1, side, rot, { x: 0, y: 0, z: 0 }), 'baseline wall should fit');
    prop.PROP.sideClear = 0.8;
    assert(!stationIsClear(line, 1, side, rot, { x: 0, y: 0, z: 0 }), 'larger gap should exclude wall');
  } finally {
    prop.PROP.sideClear = before;
  }
});

Deno.test('part-attached wall: bottom relief leaves printable anchor feet', () => {
  const before = prop.PROP.bottomGap;
  const top = Array.from({ length: 21 }, (_, x) => [x, 0, 12]);
  const floor = top.map(([x, y]) => [x, y, 2]);
  try {
    const base = [];
    prop.PROP.bottomGap = 0;
    assert(sweepBetween(top, floor, base), 'baseline wall failed');
    assert(isClosed(base), 'baseline wall is open');

    const relieved = [];
    prop.PROP.bottomGap = 0.2;
    assert(sweepBetween(top, floor, relieved), 'relieved wall failed');
    assert(isClosed(relieved), 'relieved wall is open');
    const lowAt = (tris, x) => Math.min(...tris.filter((v) => Math.abs(v[0] - x) < 1e-6).map((v) => v[2]));
    assert(lowAt(base, 3) === 2, 'baseline should touch the floor throughout');
    assert(lowAt(relieved, 3) > 2.19, 'body should clear the floor between feet');
    for (const x of [0, 6, 12, 18, 20])
      assert(lowAt(relieved, x) === 2, `missing anchor foot at ${x} mm`);
  } finally {
    prop.PROP.bottomGap = before;
  }
});

Deno.test('clearance controls travel into the build independently', () => {
  const before = { gap: prop.PROP.gap, side: prop.PROP.sideClear, bottom: prop.PROP.bottomGap };
  try {
    fins.applyTunables({ propGap: 0.25, sideClear: 0.6, bottomGap: 0.2 });
    assert(prop.PROP.gap === 0.25, 'top gap missing');
    assert(prop.PROP.sideClear === 0.6, 'side clearance missing');
    assert(prop.PROP.bottomGap === 0.2, 'bottom relief missing');
  } finally {
    fins.applyTunables({ propGap: before.gap, sideClear: before.side, bottomGap: before.bottom });
  }
});
