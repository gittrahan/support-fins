// The "Wide-face coverage" slider must actually change how densely a broad
// overhang is lined. It was wired to a dead code path once, so Auto ignored it
// entirely -- coverage 0 and 1 gave byte-identical output. These pin that the
// slider moves density monotonically, and only ever ADDS support (denser is
// never fewer fins, so it can't strand an overhang).

import { tiltedBlockTopo, analyze, fins, prop, assert } from './_util.js';

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

function sagRiskAt(coverage) {
  const { topo, res } = plate();
  return fins.buildFins(topo, res, IDENTITY, { mode: 'auto', bedPad: true, tines: true, coverage }).sagRisk;
}

Deno.test('coverage: the neutral default never cries sag on a wide plate', () => {
  // Regression: round(vExt/cap) lands a hair over the cap even at coverage 0.5, so
  // an achieved-spacing test warned on the DEFAULT. The warning must fire only when
  // the user actually dragged BELOW centre, not from rounding at the neutral pitch.
  assert(!sagRiskAt(0.5), 'sag warning fired at the neutral default (0.5) -- false alarm');
  assert(!sagRiskAt(1), 'sag warning fired at the densest setting');
});

Deno.test('coverage: dragging below centre DOES warn on a wide multi-row plate', () => {
  assert(sagRiskAt(0) === true, 'no sag warning at the sparsest setting on a wide plate');
});
// Matthew's screenshot (cube-tines-35deg-RAW-tilted.stl): the walls ran the full
// WIDTH of the face but stopped ~3mm up the slope from the part's bottom edge,
// leaving the lowest band -- where the overhang meets the pad -- in air. Cause:
// stations sit 1mm apart and the wall began at the first one >= minHeight
// (1.5mm), while the squat pass wants 3 stations/4mm of low band -- a slope running
// INTO the bed has ~1 low station, so nobody built it. Pin the wall's low end: every
// wall reaches down to the squat floor (top ~minHeightSquat, overhang <1mm up), not
// the old 1.9mm, and the geometry comes within ~1.2mm of the bottom edge.
Deno.test('coverage: walls run down the slope to the part bottom edge, not stop 3mm short', () => {
  const topo = tiltedBlockTopo(-20, 20, -20, 20, -20, 20, 35);
  const res = analyze(topo, 45, IDENTITY);
  const b = fins.buildFins(topo, res, IDENTITY, { mode: 'auto', bedPad: true, tines: true, coverage: 0.5 });
  // The bottom edge is where the overhang meets z = 0: 35deg tilt about X puts it
  // at y = -20*cos35 + 20*sin35 (the cube's (-20,+20) corner in y,z), ~-4.91.
  const a = (35 * Math.PI) / 180;
  const edgeY = -20 * Math.cos(a) + 20 * Math.sin(a);
  const walls = b.props.filter((p) => !p.squat);
  assert(walls.length >= 3, `expected a row of walls, got ${walls.length}`);
  for (const p of walls) {
    const low = p.line.reduce((m, q) => (q[2] < m[2] ? q : m));
    const lowTop = low[2];                     // props[].line is the wall top (gap already off)
    assert(lowTop <= prop.PROP.minHeightSquat + 0.15,
      `wall at x=${low[0].toFixed(1)} stops with its top ${lowTop.toFixed(2)}mm up -- ` +
      `should run down to ~${prop.PROP.minHeightSquat}mm`);
    assert(low[1] - edgeY < 1.4,
      `wall at x=${low[0].toFixed(1)} ends ${(low[1] - edgeY).toFixed(2)}mm up-slope of the bottom edge`);
  }
});

// EDGE-TO-EDGE. A wide overhang lays its buttress rows out to its own edges (plus
// evenly between), not a centred band that leaves half a spacing bare on each side
// -- the "the fin doesn't cover the whole overhang" gap. Pin that the outermost
// fin geometry reaches near the plate's x-edges (the row axis for a tilt about X).
Deno.test('coverage: wide-face rows reach the overhang edges, not half a pitch inside', () => {
  // A 40mm cube tilted 35deg: its underside is a wide flat overhang whose row runs
  // across X out to the edges at +-20. Old centred layout stopped ~half a pitch
  // inside (outer rows ~+-13, maxAbsX ~16 with the foot). Edge-to-edge lands the
  // outer rows ~+-18, reaching the edge/corner (maxAbsX ~21 with the foot).
  const topo = tiltedBlockTopo(-20, 20, -20, 20, -20, 20, 35);
  const res = analyze(topo, 45, IDENTITY);
  const b = fins.buildFins(topo, res, IDENTITY, { mode: 'auto', bedPad: true, tines: true, coverage: 0.5 });
  let maxAbsX = 0;
  for (const v of b.triangles) if (Math.abs(v[0]) > maxAbsX) maxAbsX = Math.abs(v[0]);
  assert(maxAbsX > 18, `outer fins stop short of the +-20 edge (maxAbsX ${maxAbsX.toFixed(1)}) -- edge not covered`);
});

Deno.test('coverage: a narrow face still gets ONE centred wall, not two edge walls', () => {
  // Edge-to-edge only kicks in on a face wide enough for >1 band; a face that
  // bridges on a single wall must not sprout a wall on each edge (waste + the pair
  // could fuse). One band => one centred row, unchanged.
  const topo = tiltedBlockTopo(-5, 5, -45, 45, -6, 6, 55);   // only 10mm across
  const res = analyze(topo, 60, IDENTITY);
  const b = fins.buildFins(topo, res, IDENTITY, { mode: 'auto', bedPad: true, tines: true, coverage: 0.5 });
  assert(b.fins.length <= 2, `narrow face got ${b.fins.length} fins -- expected ~1 centred wall`);
});
