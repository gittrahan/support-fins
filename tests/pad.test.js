// The bed pad must read as a clean OVAL, not the boxy grid of rectangles it was
// before (Matthew's report). It also still has to conform -- dip under a tilted
// part's flank -- and stay watertight. These pin all three so a revert to the grid
// (or a broken mesh) fails loudly.

import { loadModel, analyze, fins, isClosed, rotX, assert } from './_util.js';

function padOf(name, rot) {
  const topo = loadModel(name);
  const res = analyze(topo, 45, rot);
  const built = fins.buildFins(topo, res, rot, { mode: 'auto', bedPad: true, tines: true });
  assert(built.padTriangles.length > 0, `expected a bed pad on ${name}`);
  return built;
}

// A cube on its edge (X45) touches the bed on ~nothing, so it gets a pad AND its
// flank hangs over the footprint -- the exact case that used to force the ugly grid.
const CUBE = padOf('cube', rotX(45));

Deno.test('pad: the footprint is a smooth oval, not axis-aligned rectangles', () => {
  // A grid of axis-aligned boxes puts (almost) every edge along one of two
  // perpendicular directions, so folded mod 90deg they pile into a single bin. The
  // radial oval mesh spreads its edges across all directions. Bin every pad edge's
  // XY heading mod 90deg and assert no single direction dominates.
  const tris = CUBE.padTriangles;
  const BINS = 18;                        // 5deg each over [0,90)
  const hist = new Array(BINS).fill(0);
  let total = 0;
  for (let i = 0; i < tris.length; i += 3) {
    for (let e = 0; e < 3; e++) {
      const p = tris[i + e], q = tris[i + (e + 1) % 3];
      const dx = q[0] - p[0], dy = q[1] - p[1];
      if (Math.hypot(dx, dy) < 1e-6) continue;   // a vertical (side-wall) edge: no XY heading
      let a = Math.atan2(dy, dx);                // [-pi, pi]
      a = ((a % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);  // fold to [0, pi/2)
      hist[Math.min(BINS - 1, Math.floor((a / (Math.PI / 2)) * BINS))]++;
      total++;
    }
  }
  const maxFrac = Math.max(...hist) / total;
  // Grid pads land ~1.0 here (one dominant direction); the oval mesh spreads well
  // under. 0.35 is a wide margin that still trips the moment boxes come back.
  assert(maxFrac < 0.35,
    `pad edges cluster on one direction (max bin ${(maxFrac * 100).toFixed(0)}%) -- looks boxy, not oval`);
});

Deno.test('pad: still conforms to the part (top dips under the flank, not a flat slab)', () => {
  let minTop = Infinity, maxTop = -Infinity;
  for (const v of CUBE.padTriangles) { if (v[2] < minTop) minTop = v[2]; if (v[2] > maxTop) maxTop = v[2]; }
  // A flat slab would have a single top height; a conforming pad ducks lower under
  // the part than it stands outboard.
  assert(maxTop - minTop > 0.1, `pad top is flat (${minTop.toFixed(2)}..${maxTop.toFixed(2)}) -- not conforming`);
});

Deno.test('pad: watertight, and flagged as the oval mesh', () => {
  assert(isClosed(CUBE.padTriangles), 'pad geometry is not closed');
  assert(CUBE.pad && CUBE.pad.oval === true, 'pad is not the oval mesh (pad.oval !== true)');
});
