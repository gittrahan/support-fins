// Tine geometry invariants -- the ones this session kept regressing.
//
// docs/FIN-SPEC.md: a tine is a tiny HORIZONTAL bridge that fuses INTO the part.
// Horizontal so it prints as one continuous layer line; into the part because
// that bite is the grip ("combined support"). The two ways it has broken:
//   - stood PROUD of the wall's flanks -> flat tabs sticking out sideways,
//     "laying on the piece" instead of biting in;
//   - hung BELOW the contact -> a tall tooth, not a one-layer bridge.
// These tests pin emitTines directly on a controlled solid so both stay caught.

import { blockTopo, prop, insidePart, bbox, assert, assertClose } from './_util.js';

const { emitTines } = prop;

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

Deno.test('emitTines: teeth point INTO the part, not out its flanks', () => {
  const { out, box } = tinesOnBlock();
  // X is the wall-thickness (across) axis here. A flush tooth stays within the
  // wall half-thickness (PROP.th/2 = 0.5). A "proud" tab blows past it.
  assertClose(box.lo[0], -0.5, 0.05, 'tine juts past the -X flank (proud tab)');
  assertClose(box.hi[0], 0.5, 0.05, 'tine juts past the +X flank (proud tab)');
  // Y is the bite axis: teeth must reach well into the block (y>0 is inside).
  assert(box.hi[1] > 1.0, `tine barely reaches into the part (max y ${box.hi[1].toFixed(2)})`);
});

Deno.test('emitTines: teeth are horizontal one-layer bridges, not tall towers', () => {
  const { box } = tinesOnBlock();
  const zExtent = box.hi[2] - box.lo[2];
  // tineH is 0.3mm; allow slack but nothing like the 1.1mm a dropped tooth spans.
  assert(zExtent <= 0.5, `tine is not a thin horizontal bridge: z-extent ${zExtent.toFixed(2)}mm`);
});

Deno.test('emitTines: most tooth volume actually lands inside the part', () => {
  const { out, topo, rot, offset } = tinesOnBlock();
  let inside = 0;
  for (const v of out) if (insidePart(topo, rot, offset, v[0], v[1], v[2])) inside++;
  // Baseline: ~0.83. A tooth that lies ON the surface instead of biting IN drops
  // this toward zero -- the exact regression to catch.
  assert(inside / out.length >= 0.4, `tines grip weakly: only ${(inside / out.length * 100 | 0)}% of verts inside the part`);
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
