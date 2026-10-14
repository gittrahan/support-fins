// Tine geometry invariants -- the ones this session kept regressing.
//
// docs/FIN-SPEC.md: a tine is a tiny HORIZONTAL bridge that fuses INTO the part.
// Horizontal so it prints as one continuous layer line; into the part because
// that bite is the grip ("combined support"). The two ways it has broken:
//   - stood PROUD of the wall's flanks -> flat tabs sticking out sideways,
//     "laying on the piece" instead of biting in;
//   - hung BELOW the contact -> a tall tooth, not a one-layer bridge.
// These tests pin emitTines directly on a controlled solid so both stay caught.

import { blockTopo, tiltedBlockTopo, prop, insidePart, bbox, assert, assertClose, tineBoxes } from './_util.js';

const { emitTines, surfaceZAt } = prop;

/**
 * Run emitTines against a solid block whose interior is at y >= 0, with a
 * contact line running along +Y at x=0. The tine must bite in +Y (into the
 * block) and lie flush in X (the wall-thickness axis). Returns the tine soup +
 * its bbox + the frame so each test asserts one thing.
 */
function tinesOnBlock() {
  // block: x[-20,20] y[0,40] z[0,40]; line along +Y at x=0, z=20, y=-5..5
  const topo = blockTopo(-20, 20, 0, 40, 0, 40);
  const rot = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const offset = { x: 0, y: 0, z: 0 };
  const line = [];
  for (let y = -5; y <= 5; y += 1) line.push([0, y, 20]);
  const out = [];
  const n = emitTines(line, null, topo, rot, offset, out);
  return { topo, rot, offset, out, n, box: bbox(out) };
}

Deno.test('emitTines: a grippable overhang yields tines', () => {
  const { n, out } = tinesOnBlock();
  assert(n >= 1, `expected tines, got ${n}`);
  assert(out.length === n * 36, `expected 36 verts/tine, got ${out.length} for ${n}`);
});

Deno.test('emitTines: teeth are one nozzle bead wide, centred on the wall', () => {
  const { box } = tinesOnBlock();
  // X is the width-across-the-run axis = the bead the nozzle lays. Slant3D's spec
  // is 0.4-0.8mm (one nozzle pass to out-and-back), NOT the wall thickness -- a
  // th-wide (1.0mm) tine is ~2x spec, the fat divot Matthew caught by eye.
  const width = box.hi[0] - box.lo[0];
  assertClose(width, prop.PROP.tineW, 0.05,
    `tine width ${width.toFixed(2)}mm != one bead (PROP.tineW ${prop.PROP.tineW})`);
  assert(width <= 0.8 + 1e-6,
    `tine wider than a nozzle out-and-back (${width.toFixed(2)}mm > 0.8) -- fat divot`);
  assertClose((box.lo[0] + box.hi[0]) / 2, 0, 0.02, 'tine is not centred on the wall');
  // Y is the bite axis: teeth must reach well into the block (y>0 is inside).
  assert(box.hi[1] > 1.0, `tine barely reaches into the part (max y ${box.hi[1].toFixed(2)})`);
});

Deno.test('emitTines: teeth are horizontal one-layer bridges, not tall towers', () => {
  const { box } = tinesOnBlock();
  const zExtent = box.hi[2] - box.lo[2];
  // Exactly one layer (PROP.tineH) -- a single continuous bead. A dropped tooth
  // spans ~1.1mm; a >1-layer tine slices into multiple beads and stops being one.
  assertClose(zExtent, prop.PROP.tineH, 1e-6, `tine is not one layer: z-extent ${zExtent.toFixed(2)}mm`);
});

Deno.test('emitTines: most tooth volume actually lands inside the part', () => {
  const { out, topo, rot, offset } = tinesOnBlock();
  let inside = 0;
  for (const v of out) if (insidePart(topo, rot, offset, v[0], v[1], v[2])) inside++;
  // Baseline: ~0.83. A tooth that lies ON the surface instead of biting IN drops
  // this toward zero -- the exact regression to catch.
  assert(inside / out.length >= 0.4, `tines grip weakly: only ${(inside / out.length * 100 | 0)}% of verts inside the part`);
});

Deno.test('emitTines: on a wall along the level CONTOUR, teeth still bite INTO the face', () => {
  // THE REGRESSION THIS PINS. A leaning face is often supported by a wall running
  // along its level contour (constant height), so the wall's RUN is TANGENT to the
  // surface. The old code took the bite direction from the run and probed +-run
  // only -> a run-aligned nub either lies flat on the piece or, on a pure tilt,
  // finds nothing (the run heads along the gap, never into material) and drops out.
  // The bite must come from the PART: point into the slope, regardless of the run.
  const topo = tiltedBlockTopo(-15, 15, -20, 20, 0, 30, 40);   // ceiling rises with +Y
  const rot = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const offset = { x: 0, y: 0, z: 0 };
  // a contact line running along X (the contour) at y=0, sitting on the underside
  const line = [];
  for (let x = -8; x <= 8; x += 1) {
    const z = surfaceZAt(topo.pos, x, 0);
    if (z !== null) line.push([x, 0, z]);
  }
  const out = [];
  const cap = [];                          // each tine's seed + bite heading (the test seam)
  globalThis.__TINECAP = cap;
  let n;
  try { n = emitTines(line, null, topo, rot, offset, out); } finally { delete globalThis.__TINECAP; }
  // The old run-aligned bite produced ZERO tines here: probing +-run heads along
  // the contour (constant height), never into the material, so every station drops
  // out. A part-derived bite grips the sloped face.
  assert(n >= 3, `contour wall produced too few tines: ${n} (old bug: 0 -- bit along the run)`);
  // the bite runs ACROSS the wall (into the slope, in Y), not ALONG it (X), and each
  // tine KISSES the face: tines end at the part's surface (kissEnds), their end leaning
  // with the slope. So every corner of a tine's far end touches solid, and 0.03 mm back
  // toward the wall is open -- no part of the tine runs on into the part, and a tine
  // lying flat along the contour would end in the gap instead.
  const { tines } = tineBoxes(out);
  assert(tines.length === n, `${tines.length} tine boxes for ${n} tines`);
  for (const [k, t] of tines.entries()) {
    assert(t.hi[0] - t.lo[0] < 0.6, `a tine runs along the contour (x ${t.lo[0].toFixed(2)}..${t.hi[0].toFixed(2)})`);
    const { x, y, biteX, biteY } = cap[k];
    assert(Math.abs(biteY) > 0.99, `tine ${k} bites along ${biteX.toFixed(2)},${biteY.toFixed(2)}, not into the slope`);
    const along = (v) => (v[0] - x) * biteX + (v[1] - y) * biteY;
    const far = t.verts.filter((v) => along(v) > -prop.PROP.tineOverlap + 1e-6);
    assert(far.length > 0, `tine ${k} has no far end`);
    for (const v of far) {
      assert(insidePart(topo, rot, offset, v[0], v[1], v[2]), `tine ${k} corner ${v.map((c) => c.toFixed(2))} ends short of the face`);
      assert(!insidePart(topo, rot, offset, v[0] - biteX * 0.03, v[1] - biteY * 0.03, v[2]),
             `tine ${k} corner ${v.map((c) => c.toFixed(2))} runs on into the part`);
    }
  }
});

Deno.test('emitTines: an overhang the tooth cannot reach into gets no tine (honest)', () => {
  // Same line, but the block is pulled far in +Y so no horizontal bite reaches
  // it. emitTines must emit nothing rather than a tooth gripping air.
  const topo = blockTopo(-20, 20, 50, 90, 0, 40);
  const rot = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const offset = { x: 0, y: 0, z: 0 };
  const line = [];
  for (let y = -5; y <= 5; y += 1) line.push([0, y, 20]);
  const out = [];
  const n = emitTines(line, null, topo, rot, offset, out);
  assert(n === 0 && out.length === 0, `expected no tines gripping air, got ${n}`);
});

// Thick layers (local finding 2026-10-14): the tine's probe sits half a layer under the
// underside, so at a fixed 0.5 mm reach a 0.6 mm layer found no solid under an underside
// within ~31deg of level and every wall built with no tines (0.4 mm: ~22deg). The reach
// now keeps the 0.2 layer's ratio, so a thick layer grips what a 0.2 layer grips.
Deno.test('tines: a thick layer grips a shallow underside like a 0.2 layer', async () => {
  const { analyze } = await import('../web/overhangs.js');
  const { buildFins } = await import('../web/fins.js');
  const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (const tilt of [20, 30]) {
    const topo = tiltedBlockTopo(-20, 20, -15, 15, 0, 30, tilt), res = analyze(topo, 45, I);
    const at = (layerHeight) => buildFins(topo, res, I, { mode: 'auto', bedPad: false, tines: true, layerHeight });
    const thin = at(0.2);
    assert(thin.tines > 0, `tilt ${tilt}: no tines at 0.2`);
    for (const lh of [0.3, 0.4, 0.6]) {
      const b = at(lh);
      assert(b.tines >= thin.tines, `tilt ${tilt}, ${lh} mm layers: ${b.tines} tines vs ${thin.tines} at 0.2`);
    }
  }
});

// ...and at the slice a slicer reads (the layer's mid-height), a thick-layer tine stays
// out of the part: its top is snapped to the layer line and can sit above the underside,
// but each top corner carried down to the mid-layer is clear of the part.
Deno.test('tines: a thick-layer tine is clear of the part at its mid-layer', async () => {
  const { analyze } = await import('../web/overhangs.js');
  const { buildFins } = await import('../web/fins.js');
  const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (const tilt of [20, 35]) {
    const topo = tiltedBlockTopo(-20, 20, -15, 15, 0, 30, tilt), res = analyze(topo, 45, I);
    const line = buildFins(topo, res, I, { mode: 'auto', bedPad: false, tines: false }).fins[0].line;
    const out = [];
    const n = emitTines(line, null, topo, I, res.offset, out, prop.PROP.tineStep, prop.PROP.baseH + 0.2, 0.6);
    assert(n > 0, `tilt ${tilt}: no tines at 0.6 mm layers`);
    for (const t of tineBoxes(out).tines) {
      const mid = (t.lo[2] + t.hi[2]) / 2, cx = (t.lo[0] + t.hi[0]) / 2, cy = (t.lo[1] + t.hi[1]) / 2;
      for (const v of t.verts.filter((q) => q[2] > t.hi[2] - 1e-6)) {
        // 0.02 back toward the tine's centre: the end overlaps the part by 0.01 on purpose
        const dx = cx - v[0], dy = cy - v[1], d = Math.hypot(dx, dy) || 1;
        assert(!insidePart(topo, I, res.offset, v[0] + (dx / d) * 0.02, v[1] + (dy / d) * 0.02, mid),
               `tilt ${tilt}: a tine top corner is inside the part at its mid-layer (z ${mid.toFixed(2)})`);
      }
    }
  }
});

// A wedge's tines are one layer tall too (local issue 043's follow-up): they were
// always 0.2, a third of a 0.6 layer, which the slicer drops or merges. And like a
// wall's, each is clear of the part at its mid-layer, where the slicer reads it.
Deno.test('tines: a wedge tine is one layer tall and clear of the part at its mid-layer', async () => {
  const { analyze } = await import('../web/overhangs.js');
  const { buildFins } = await import('../web/fins.js');
  const { loadModel, rotX } = await import('./_util.js');
  const topo = loadModel('portal'), rot = rotX(45), res = analyze(topo, 45, rot);
  for (const lh of [0.2, 0.6]) {
    const b = buildFins(topo, res, rot, { mode: 'auto', bedPad: true, tines: true, layerHeight: lh });
    // a tine is a small box; the wedge's blade and foot are not
    const tines = b.fins.filter((f) => f.kind === 'wedge')
      .flatMap((w) => w.triRanges.flatMap(([s, e]) => tineBoxes(b.triangles.slice(s, e)).tines))
      .filter((t) => t.hi[2] - t.lo[2] < 1 && Math.max(t.hi[0] - t.lo[0], t.hi[1] - t.lo[1]) < 3);
    assert(tines.length >= 10, `${lh}: portal X45 wedges have ${tines.length} tines`);
    for (const t of tines) {
      assertClose(t.hi[2] - t.lo[2], lh, 1e-6, `${lh}: a wedge tine is ${(t.hi[2] - t.lo[2]).toFixed(2)} tall`);
      const mid = (t.lo[2] + t.hi[2]) / 2, cx = (t.lo[0] + t.hi[0]) / 2, cy = (t.lo[1] + t.hi[1]) / 2;
      for (const v of t.verts.filter((q) => q[2] > t.hi[2] - 1e-6)) {
        const dx = cx - v[0], dy = cy - v[1], d = Math.hypot(dx, dy) || 1;
        assert(!insidePart(topo, rot, res.offset, v[0] + (dx / d) * 0.02, v[1] + (dy / d) * 0.02, mid),
               `${lh}: a wedge tine top corner is inside the part at its mid-layer (z ${mid.toFixed(2)})`);
      }
    }
  }
});
