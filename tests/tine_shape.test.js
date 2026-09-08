// Tine SHAPE invariants: one layer tall, perfectly horizontal, and reachable on a
// squat wall. Slant3D's whole argument (FIN-SPEC.md "Why the tines must be
// horizontal") is that a tine has to be a single horizontal layer line so it
// prints as one continuous bead -- fuses in, snaps off. Two ways it drifts:
//   - height != one slicer layer  -> slices into 1.5 layers, no longer one bead;
//   - a face that isn't horizontal -> a ramp/tower, the "worst way" he warns of.
// And the squat bed walls must be able to carry tines at all (the base-height gate
// was skipping every one of them).

import { blockTopo, tiltedBlockTopo, prop, fins, insidePart, assert, assertClose } from './_util.js';

const { emitTines, surfaceZAt, PROP } = prop;
const LAYER = 0.2;   // Matthew's slicer layer height; a tine must equal exactly this

Deno.test('tine height is exactly one slicer layer, in both tine builders', () => {
  assertClose(PROP.tineH, LAYER, 1e-9,
    `prop tine height ${PROP.tineH} != one layer (${LAYER}) -- would slice into >1 bead`);
  assertClose(fins.FIN.tineH, LAYER, 1e-9,
    `fin tine height ${fins.FIN.tineH} != one layer (${LAYER})`);
});

/**
 * emitTines on a tilted block, whose underside rises with +Y so the bite has a
 * real horizontal component (a grippable face). Returns the raw tine vertex soup.
 */
function tinesOnTiltedBlock(minTop) {
  const topo = tiltedBlockTopo(-15, 15, -20, 20, 0, 30, 40);
  const rot = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const offset = { x: 0, y: 0, z: 0 };
  const line = [];
  for (let x = -8; x <= 8; x += 1) {
    const z = surfaceZAt(topo.pos, x, 0);
    if (z !== null) line.push([x, 0, z]);
  }
  const out = [];
  const n = emitTines(line, null, topo, rot, offset, out, PROP.tineStep, minTop);
  return { out, n };
}

Deno.test('every tooth is exactly one layer tall and perfectly horizontal', () => {
  const { out, n } = tinesOnTiltedBlock();
  assert(n >= 3, `need tines to test their shape, got ${n}`);
  assert(out.length === n * 36, `expected 36 verts/tine, got ${out.length / n}`);

  // No slanted faces: each tooth is a box, so every triangle is either a
  // horizontal cap (|nz|~1) or a vertical side (|nz|~0) -- never a ramp.
  for (let t = 0; t < out.length; t += 3) {
    const a = out[t], b = out[t + 1], c = out[t + 2];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const m = Math.hypot(nx, ny, nz) || 1;
    const up = Math.abs(nz / m);
    assert(up > 0.98 || up < 0.02,
      `a tine face is slanted (|nz|=${up.toFixed(3)}) -- not a horizontal bridge`);
  }

  // Each tooth spans exactly one layer in Z.
  for (let i = 0; i < n; i++) {
    let lo = Infinity, hi = -Infinity;
    for (let v = i * 36; v < (i + 1) * 36; v++) {
      if (out[v][2] < lo) lo = out[v][2];
      if (out[v][2] > hi) hi = out[v][2];
    }
    assertClose(hi - lo, PROP.tineH, 1e-6,
      `tooth ${i} spans ${(hi - lo).toFixed(3)}mm in Z, not one layer (${PROP.tineH})`);
  }
});

Deno.test('tine height tracks the layer-height setting, not a hardcoded 0.2', () => {
  // The UI's Layer height feeds emitTines a tineH so the tine is always exactly one
  // of the user's real layers (a mismatch tears instead of bending off). Pin that
  // the emitted tooth spans the passed height, at a non-default layer.
  const topo = tiltedBlockTopo(-15, 15, -20, 20, 0, 30, 40);
  const rot = [1, 0, 0, 0, 1, 0, 0, 0, 1], offset = { x: 0, y: 0, z: 0 };
  const line = [];
  for (let x = -8; x <= 8; x += 1) {
    const z = surfaceZAt(topo.pos, x, 0);
    if (z !== null) line.push([x, 0, z]);
  }
  const H = 0.32;                       // a 0.32mm layer, not the 0.2 default
  const out = [];
  const n = emitTines(line, null, topo, rot, offset, out, PROP.tineStep, undefined, H);
  assert(n >= 3, `need tines to test their height, got ${n}`);
  for (let i = 0; i < n; i++) {
    let lo = Infinity, hi = -Infinity;
    for (let v = i * 36; v < (i + 1) * 36; v++) { if (out[v][2] < lo) lo = out[v][2]; if (out[v][2] > hi) hi = out[v][2]; }
    assertClose(hi - lo, H, 1e-6, `tooth ${i} spans ${(hi - lo).toFixed(3)}mm, not the ${H}mm layer`);
  }
});

Deno.test('the tine tops out at the underside and roots DOWN into the wall (not up off it)', () => {
  // The join bug: the tine used to seat its BOTTOM on the wall top and grow UP, so a
  // taller tine (bigger layer height) rose off the wall top into the breakaway gap
  // and overshot past the part -- connected to the wall only on a coplanar seam. It
  // now seats its TOP at the underside and grows DOWN, so its root embeds into the
  // wall by (tineH - gap). Pin both: top flush with the local surface, root below the
  // wall top when the layer exceeds the gap.
  const topo = tiltedBlockTopo(-15, 15, -20, 20, 0, 30, 40);
  const rot = [1, 0, 0, 0, 1, 0, 0, 0, 1], offset = { x: 0, y: 0, z: 0 };
  const line = [];
  for (let x = -8; x <= 8; x += 1) {
    const z = surfaceZAt(topo.pos, x, 0);
    if (z !== null) line.push([x, 0, z]);
  }
  const H = 0.4;                        // deliberately > gap (0.2), so the root must sink
  const out = [];
  const n = emitTines(line, null, topo, rot, offset, out, PROP.tineStep, undefined, H);
  assert(n >= 3, `need tines to test the seating, got ${n}`);
  for (let i = 0; i < n; i++) {
    let lo = Infinity, hi = -Infinity, cx = 0;
    for (let v = i * 36; v < (i + 1) * 36; v++) {
      if (out[v][2] < lo) lo = out[v][2];
      if (out[v][2] > hi) hi = out[v][2];
      cx += out[v][0];
    }
    cx /= 36;
    const surf = surfaceZAt(topo.pos, cx, 0);
    const wallTop = surf - PROP.gap;
    assertClose(hi, surf, 1e-6, `tooth ${i} top ${hi.toFixed(3)} not flush with the underside ${surf.toFixed(3)} (would poke through the part)`);
    assertClose(wallTop - lo, H - PROP.gap, 1e-6,
      `tooth ${i} root embeds ${(wallTop - lo).toFixed(3)}mm, not the expected ${(H - PROP.gap).toFixed(3)}mm into the wall`);
  }
});

Deno.test('a squat wall (low contact) carries tines only with the brim-height floor', () => {
  // A grippable vertical face (the block's y=0 plane) with the contact line LOW --
  // wallTop ~0.6mm, under the flanged base floor (baseH+0.2) but above the brim.
  const topo = blockTopo(-20, 20, 0, 40, 0, 40);
  const rot = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const offset = { x: 0, y: 0, z: 0 };
  const line = [];
  for (let y = -5; y <= 5; y += 1) line.push([0, y, 0.6 + PROP.gap]);   // wallTop 0.6

  const outFlanged = [];
  const nFlanged = emitTines(line, null, topo, rot, offset, outFlanged); // default minTop
  assert(nFlanged === 0,
    `a squat wall must be skipped by the flanged floor, got ${nFlanged} tines`);

  const outSquat = [];
  const nSquat = emitTines(line, null, topo, rot, offset, outSquat,
                           PROP.tineStep, PROP.squatBrimH);   // squat floor
  assert(nSquat >= 1,
    `a squat wall got no tines even with the brim floor (regression: base-height gate)`);
  // and they actually bite into the part
  let inside = 0;
  for (const v of outSquat) if (insidePart(topo, rot, offset, v[0], v[1], v[2])) inside++;
  assert(inside / outSquat.length >= 0.35,
    `squat tines lie flat: only ${(inside / outSquat.length * 100 | 0)}% of verts inside`);
});
