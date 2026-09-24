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

// PETG welds to a support far harder than PLA, so the PETG material profile makes
// the pad THINNER (padH 0.5->0.3) and turns the tack into a GAP (grab +0.05->-0.1):
// the pad stands below the part and snaps off instead of fusing. This pins that a
// negative grab still yields a valid, watertight, thinner-and-lower pad -- so the
// floor in `conform` (which keeps every column positive) can't be dropped and the
// gap path can't silently revert to a bite.
Deno.test('pad: a negative grab (PETG) gives a thinner GAP pad, still watertight', () => {
  const topo = loadModel('cube');
  const res = analyze(topo, 45, rotX(45));
  const build = () => fins.buildFins(topo, res, rotX(45), { mode: 'auto', bedPad: true, tines: true });

  // Highest point of the pad = its outboard rim (open-bed columns rise to padH).
  // The flat bottom sits at z=0, so isClosed carries the "every column positive"
  // guarantee; the rim height is what thins with padH and drops with a gap grab.
  const maxTop = (b) => { let m = -Infinity; for (const v of b.padTriangles) if (v[2] > m) m = v[2]; return m; };

  const g0 = fins.PAD.grab, h0 = fins.FIN.padH;
  try {
    const pla = build();                    // today's PLA defaults (grab +0.05, padH 0.5)
    fins.PAD.grab = -0.10; fins.FIN.padH = 0.30;   // the PETG profile
    const petg = build();

    assert(isClosed(petg.padTriangles), 'PETG (gap) pad is not watertight');
    assert(maxTop(petg) <= 0.30 + 1e-6, `PETG pad is not thinner (rim ${maxTop(petg).toFixed(3)} > padH 0.30)`);
    assert(maxTop(petg) < maxTop(pla) - 1e-6,
      `PETG pad rim (${maxTop(petg).toFixed(3)}) is not below the PLA pad rim (${maxTop(pla).toFixed(3)}) -- the thinner gap pad didn't take`);
  } finally {
    fins.PAD.grab = g0; fins.FIN.padH = h0;   // leave defaults untouched for later tests
  }
});

// The BRIM-STYLE pad (experimental, PAD.brim). The default pad is 2-3 layers and
// merges with the part on the first layers -- a weld. The brim-style pad is ONE
// layer and stands brimGap off the part's first-layer outline (the cube's long
// side AND its vertical end faces), like a slicer brim. These pin the thickness,
// the gap, that it still reaches in close enough to hold, and a closed mesh.
function brimCube(layerHeight) {
  const topo = loadModel('cube');
  const rot = rotX(45);
  const res = analyze(topo, 45, rot);
  fins.PAD.brim = true;
  try { return fins.buildFins(topo, res, rot, { mode: 'prop', bedPad: true, layerHeight }); }
  finally { fins.PAD.brim = false; }
}

Deno.test('pad (brim): one layer thick, whatever the layer height', () => {
  for (const lh of [0.2, 0.28]) {
    const b = brimCube(lh);
    let top = 0; for (const v of b.padTriangles) top = Math.max(top, v[2]);
    assert(Math.abs(top - lh) < 1e-6, `brim pad is ${top.toFixed(3)}mm tall at ${lh}mm layers`);
    assert(isClosed(b.padTriangles), 'brim pad is not closed');
  }
});

Deno.test('pad (brim): stands off the first-layer outline, but close enough to hold', () => {
  const b = brimCube(0.2);
  // Cube on edge along X: the first layer (mid-height 0.1) holds the part where
  // |y| < 0.1 for |x| <= 20. No pad vertex that slices into that layer may sit
  // within 0.05 of it -- on the long side or past the end faces.
  const m = 0.1, c = 0.05;
  let nearest = Infinity;
  for (const v of b.padTriangles) {
    if (v[2] <= m) continue;
    const dx = Math.max(0, Math.abs(v[0]) - 20), dy = Math.max(0, Math.abs(v[1]) - m);
    const d = Math.hypot(dx, dy);
    assert(d >= c, `brim pad reaches the first layer at (${v[0].toFixed(2)}, ${v[1].toFixed(2)}), ${d.toFixed(3)}mm off the part`);
    nearest = Math.min(nearest, d);
  }
  // ...and it is a brim, not a moat: it comes back within ~2 cells of the gap.
  assert(nearest <= fins.PAD.brimGap + 0.2, `brim pad stands ${nearest.toFixed(2)}mm off -- too far to hold`);
});
