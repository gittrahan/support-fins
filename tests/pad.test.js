// The bed pad must read as a clean OVAL, not the boxy grid of rectangles it was
// before (Matthew's report). It also still has to conform -- dip under a tilted
// part's flank -- and stay watertight. These pin all three so a revert to the grid
// (or a broken mesh) fails loudly.

import { loadModel, analyze, fins, isClosed, rotX, assert } from './_util.js';

// Build with a pad style set for this call only (PAD.style is module state).
function withStyle(style, fn) {
  const s0 = fins.PAD.style;
  fins.PAD.style = style;
  try { return fn(); } finally { fins.PAD.style = s0; }
}

// These first tests pin the 'sure' pad (the conforming radial oval).
function padOf(name, rot) {
  const topo = loadModel(name);
  const res = analyze(topo, 45, rot);
  const built = withStyle('sure', () => fins.buildFins(topo, res, rot, { mode: 'auto', bedPad: true, tines: true }));
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
  const build = () => withStyle('sure', () => fins.buildFins(topo, res, rotX(45), { mode: 'auto', bedPad: true, tines: true }));

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

// The LIGHT pad (PAD.style 'light', the default): brim-style. The default pad is 2-3 layers and
// merges with the part on the first layers -- a weld. The brim-style pad is ONE
// layer and stands brimGap off the part's first-layer outline (the cube's long
// side AND its vertical end faces), like a slicer brim. These pin the thickness,
// the gap, that it still reaches in close enough to hold, and a closed mesh.
function brimCube(layerHeight) {
  const topo = loadModel('cube');
  const rot = rotX(45);
  const res = analyze(topo, 45, rot);
  return withStyle('light', () => fins.buildFins(topo, res, rot, { mode: 'prop', bedPad: true, layerHeight }));
}

Deno.test('pad: Light is the default style', () => {
  assert(fins.PAD.style === 'light', `default pad style is ${fins.PAD.style}`);
});

// Custom runs the brim-style mesh on the user's numbers. Its thickness, grip and
// spread must all reach the geometry -- a field the math ignores is a lie.
Deno.test('pad (custom): thickness, spread and grip all reach the pad', () => {
  const topo = loadModel('cube');
  const rot = rotX(45);
  const res = analyze(topo, 45, rot);
  const c0 = { ...fins.PAD.custom };
  const build = (c) => {
    Object.assign(fins.PAD.custom, c);
    try { return withStyle('custom', () => fins.buildFins(topo, res, rot, { mode: 'prop', bedPad: true })); }
    finally { Object.assign(fins.PAD.custom, c0); }
  };
  const top = (b) => { let m = 0; for (const v of b.padTriangles) m = Math.max(m, v[2]); return m; };
  // Highest pad point within 0.3mm of the edge line (the cube's underside z = |y|).
  const nearTop = (b) => { let m = 0; for (const v of b.padTriangles) if (Math.abs(v[0]) < 19 && Math.abs(v[1]) < 0.3) m = Math.max(m, v[2]); return m; };
  const base = { h: 0.5, gap: 0, grip: 0.05, margin: 4 };
  const a = build(base), thick = build({ ...base, h: 0.8 }), wide = build({ ...base, margin: 8 });
  const bite = build({ ...base, grip: 0.2 });
  assert(isClosed(a.padTriangles), 'custom pad is not closed');
  assert(Math.abs(top(a) - 0.5) < 1e-6 && Math.abs(top(thick) - 0.8) < 1e-6, `thickness ignored (${top(a)}, ${top(thick)})`);
  assert(wide.pad.r2 - a.pad.r2 > 3.9, `spread ignored (r2 ${a.pad.r2} -> ${wide.pad.r2})`);
  assert(nearTop(bite) > nearTop(a) + 0.1, `grip ignored (${nearTop(a).toFixed(2)} -> ${nearTop(bite).toFixed(2)})`);
});

Deno.test('pad (brim): one layer thick, whatever the layer height', () => {
  for (const lh of [0.2, 0.28]) {
    const b = brimCube(lh);
    let top = 0; for (const v of b.padTriangles) top = Math.max(top, v[2]);
    assert(Math.abs(top - lh) < 1e-6, `brim pad is ${top.toFixed(3)}mm tall at ${lh}mm layers`);
    assert(isClosed(b.padTriangles), 'brim pad is not closed');
  }
});

// What the SLICER sees: the pad's and the part's sections at the first layer's
// mid-height. PrusaSlicer / Orca / Bambu merge any gap under 2 x 0.049mm, so the
// sliced gap must clear 0.098 -- at every tilt, not just 45deg: 0.1mm through a
// min-of-underside field came out at exactly 45deg and welded shut at 40deg.
function sectionSegs(tris, z) {
  const segs = [];
  for (let i = 0; i < tris.length; i += 3) {
    const pts = [];
    for (let a = 0; a < 3; a++) {
      const p = tris[i + a], q = tris[i + (a + 1) % 3];
      const za = p[2] - z, zb = q[2] - z;
      if ((za < 0) === (zb < 0)) continue;
      const t = za / (za - zb);
      pts.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
    }
    if (pts.length === 2) segs.push(pts);
  }
  return segs;
}
function segDist([a, b], [c, d]) {
  const pt = (p, [u, v]) => {
    const dx = v[0] - u[0], dy = v[1] - u[1], l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - u[0]) * dx + (p[1] - u[1]) * dy) / l2)) : 0;
    return Math.hypot(u[0] + t * dx - p[0], u[1] + t * dy - p[1]);
  };
  return Math.min(pt(a, [c, d]), pt(b, [c, d]), pt(c, [a, b]), pt(d, [a, b]));
}

for (const deg of [45, 40, 30]) {
  Deno.test(`pad (light): the sliced first-layer gap clears the slicer's closing at X${deg}`, () => {
    const topo = loadModel('cube');
    const rot = rotX(deg);
    const res = analyze(topo, 45, rot);
    const b = withStyle('light', () => fins.buildFins(topo, res, rot, { mode: 'prop', bedPad: true, layerHeight: 0.2 }));
    const part = [];
    const o = res.offset;
    for (let f = 0; f < topo.nFaces * 3; f++) {
      const x = topo.pos[f * 3], y = topo.pos[f * 3 + 1], z = topo.pos[f * 3 + 2];
      part.push([rot[0] * x + rot[3] * y + rot[6] * z + o.x, rot[1] * x + rot[4] * y + rot[7] * z + o.y,
                 rot[2] * x + rot[5] * y + rot[8] * z + o.z]);
    }
    const ps = sectionSegs(part, 0.1), pad = sectionSegs(b.padTriangles, 0.1);
    let min = Infinity;
    for (const s of pad) for (const q of ps) min = Math.min(min, segDist(s, q));
    assert(min > 0.1, `sliced pad-part gap at X${deg} is ${min.toFixed(3)}mm -- a slicer closes that`);
    // ...and it is a brim, not a moat: the pad comes back within ~a bead of the part.
    assert(min < fins.PAD.brimGap + 0.05, `pad stands ${min.toFixed(3)}mm off at X${deg} -- too far to hold`);
  });
}

// A wedge's foot flange used to reach footHalf past the wedge's LOW end too --
// on the cube stood on its edge that ran the 0.6mm foot straight across the
// edge and under the far flank, so the slicer printed foot and cube as one
// solid region for three layers. The flange now stops where the part hangs
// lower than footH + gap over it. The cube's underside is z = |y| for |x| <= 20.
Deno.test('wedge foot: stays out from under the part it braces', () => {
  const topo = loadModel('cube');
  const rot = rotX(45);
  const res = analyze(topo, 45, rot);
  const b = fins.buildFins(topo, res, rot, { mode: 'auto', bedPad: false, tines: true });
  assert(b.fins.some((f) => f.kind === 'wedge'), 'expected a wedge on the cube on its edge');
  const FOOT_H = 0.6, NEED = 0.8;   // PERP.footH, footH + gap
  // Judge each triangle of the foot's top cap by the band it covers: its corners
  // can all sit on open bed while the cap itself runs across the edge.
  const t = b.triangles;
  let tops = 0;
  for (let i = 0; i < t.length; i += 3) {
    const tri = [t[i], t[i + 1], t[i + 2]];
    if (tri.some((v) => Math.abs(v[2] - FOOT_H) > 1e-9)) continue;
    tops++;
    const x0 = Math.min(...tri.map((v) => v[0])), x1 = Math.max(...tri.map((v) => v[0]));
    const y0 = Math.min(...tri.map((v) => v[1])), y1 = Math.max(...tri.map((v) => v[1]));
    if (x1 < -20.2 || x0 > 20.2) continue;        // past the cube's end: open bed
    assert(y0 >= NEED - 1e-6 || y1 <= -NEED + 1e-6,
      `foot top spans y ${y0.toFixed(2)}..${y1.toFixed(2)}, under the cube's edge (needs |y| >= ${NEED})`);
  }
  assert(tops > 0, 'found no foot top cap');
});
