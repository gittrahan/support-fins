// The "Wide-face coverage" slider must actually change how densely a broad
// overhang is lined. It was wired to a dead code path once, so Auto ignored it
// entirely -- coverage 0 and 1 gave byte-identical output. These pin that the
// slider moves density monotonically, and only ever ADDS support (denser is
// never fewer fins, so it can't strand an overhang).

import { tiltedBlockTopo, analyze, fins, assert } from './_util.js';

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

// A broad tilted plate: wide across the overhang so it takes a ROW of fins,
// which is the only place coverage bites (a narrow part keeps its bracing).
function plate() {
  const topo = tiltedBlockTopo(-40, 40, -45, 45, -6, 6, 55);
  const res = analyze(topo, 60, IDENTITY);
  return { topo, res };
}

function finCount(coverage) {
  const { topo, res } = plate();
  const b = fins.buildFins(topo, res, IDENTITY, { mode: 'auto', bedPad: true, tines: true, coverage });
  return b.fins.length;
}

Deno.test('coverage: dense places strictly more fins than sparse', () => {
  const sparse = finCount(0);
  const dense = finCount(1);
  assert(dense > sparse, `slider is inert: coverage 0 -> ${sparse} fins, coverage 1 -> ${dense}`);
});

Deno.test('coverage: density is monotonic and never drops below sparse', () => {
  const c0 = finCount(0), c05 = finCount(0.5), c1 = finCount(1);
  assert(c05 >= c0 && c1 >= c05, `not monotonic: ${c0} -> ${c05} -> ${c1}`);
});
