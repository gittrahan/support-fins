// Tine SHAPE invariants: one layer tall, perfectly horizontal, and reachable on a
// squat wall. Slant3D's whole argument (FIN-SPEC.md "Why the tines must be
// horizontal") is that a tine has to be a single horizontal layer line so it
// prints as one continuous bead -- fuses in, snaps off. Two ways it drifts:
//   - height != one slicer layer  -> slices into 1.5 layers, no longer one bead;
//   - a face that isn't horizontal -> a ramp/tower, the "worst way" he warns of.
// And the squat bed walls must be able to carry tines at all (the base-height gate
// was skipping every one of them).

import { blockTopo, tiltedBlockTopo, prop, fins, insidePart, assert, assertClose, tineBoxes } from './_util.js';

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

  // No ramps: every tooth vertex sits on its layer's bottom or top, so each triangle
  // is either a flat cap (all three at one height) or a side spanning the whole layer.
  // A side may lean -- the far end follows the part's surface (kissEnds) -- but a
  // ramp would need a face that climbs across the layer partway, i.e. a vertex in
  // between, which this rules out.
  for (let i = 0; i < n; i++) {
    const zs = out.slice(i * 36, (i + 1) * 36).map((v) => v[2]);
    const lo = Math.min(...zs), hi = Math.max(...zs);
    for (const z of zs) {
      assert(Math.abs(z - lo) < 1e-9 || Math.abs(z - hi) < 1e-9,
        `tooth ${i} has a vertex at z ${z.toFixed(4)} inside its layer -- a ramp, not a horizontal bridge`);
    }
    for (let t = i * 36; t < (i + 1) * 36; t += 3) {
      const tz = [out[t][2], out[t + 1][2], out[t + 2][2]];
      if (Math.max(...tz) - Math.min(...tz) < 1e-9) {          // a cap: must face up or down
        const a = out[t], b = out[t + 1], c = out[t + 2];
        const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
        const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
        const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        assert(Math.abs(nz) / (Math.hypot(nx, ny, nz) || 1) > 0.98, `tooth ${i} has a slanted cap`);
      }
    }
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

Deno.test('the tine SNAPS onto the layer grid (one cell), within half a layer of the underside, roots into the wall', () => {
  // Two bugs pinned here at once:
  //  1. The LAYER-STRADDLE bug (Matthew's cube): the tine top was pinned to the part
  //     underside, which is almost never on the layer grid, so a one-layer-tall tine
  //     straddled a boundary and sliced into TWO thin partial layers -- a taller weld
  //     that marks worse and won't bend-snap clean. It now snaps its span DOWN onto
  //     the grid so it fills exactly one layer cell (prints as one bead).
  //  2. The old JOIN bug: the tine must root DOWN into the wall, not cantilever off a
  //     coplanar top seam. Snapping down only sinks the root deeper, so this still holds.
  // Pin: exactly one layer cell; top on the grid at or below the underside (never
  // poking up through the part face); root below the wall top when the layer > gap.
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
    // exactly one layer cell on the plate-origin grid at H -> prints as one bead
    const cells = Math.ceil(hi / H - 1e-4) - Math.floor(lo / H + 1e-4);
    assert(cells === 1, `tooth ${i} spans ${cells} layer cells at H=${H} (z ${lo.toFixed(3)}..${hi.toFixed(3)}) -- the two-layer straddle bug`);
    assertClose(hi - lo, H, 1e-6, `tooth ${i} is ${(hi - lo).toFixed(3)}mm tall, not one layer (${H})`);
    // top snapped onto the NEAREST grid line, within half a layer of the underside so
    // it lands where the part's nearest layer begins (no full missing layer, no deep
    // poke) -- rounding, not flooring, which would drop a near-line tine a full layer.
    assertClose(hi, Math.round(surf / H) * H, 1e-6,
      `tooth ${i} top ${hi.toFixed(3)} not snapped to the nearest layer line to the underside ${surf.toFixed(3)}`);
    assert(Math.abs(hi - surf) <= H / 2 + 1e-6, `tooth ${i} top ${hi.toFixed(3)} is more than half a layer from the underside ${surf.toFixed(3)}`);
    // still roots into the wall (bottom at or below the wall top): with a layer taller
    // than the gap it sinks below, so the join is a volume, not a coplanar seam it
    // cantilevers off.
    assert(lo <= wallTop + 1e-6, `tooth ${i} root ${lo.toFixed(3)} sits above the wall top ${wallTop.toFixed(3)} (would float off the wall)`);
  }
});

Deno.test('REGRESSION: an off-grid underside still yields one-layer tines (the cube 2-layer bug)', () => {
  // The cube reproduction: tilt a block so its underside lands OFF the layer grid and
  // confirm every tine still occupies a single layer cell at the default (gap-height)
  // layer. Before the layer-snap, all of these straddled two layers.
  const topo = tiltedBlockTopo(-15, 15, -20, 20, 0, 30, 45);
  const rot = [1, 0, 0, 0, 1, 0, 0, 0, 1], offset = { x: 0, y: 0, z: 0 };
  const line = [];
  for (let x = -8; x <= 8; x += 1) {
    const z = surfaceZAt(topo.pos, x, 0);
    if (z !== null) line.push([x, 0, z]);
  }
  const out = [];
  const n = emitTines(line, null, topo, rot, offset, out);   // default LAYER-height tine
  assert(n >= 3, `need tines to test, got ${n}`);
  let offGrid = 0, twoLayer = 0;
  const { tines } = tineBoxes(out);   // off the grid, so wall steps come in between
  assert(tines.length === n, `${tines.length} tine boxes for ${n} tines`);
  for (const { verts, lo: [, , lo], hi: [, , hi] } of tines) {
    const cx = verts.reduce((a, v) => a + v[0], 0) / 36;
    const surf = surfaceZAt(topo.pos, cx, 0);
    if (Math.abs((surf / LAYER) - Math.round(surf / LAYER)) > 1e-3) offGrid++;
    const cells = Math.ceil(hi / LAYER - 1e-4) - Math.floor(lo / LAYER + 1e-4);
    if (cells !== 1) twoLayer++;
  }
  assert(offGrid > 0, 'test setup: undersides landed on the grid, not exercising the bug');
  assert(twoLayer === 0, `${twoLayer}/${n} tines still straddle two layers -- the snap regressed`);
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
