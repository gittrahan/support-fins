// Hole-aware wedge placement: a bore in a face must NOT get a fin dropped through
// it (the angle-bracket case -- a tilted bore prints poorly and finning it scars
// the bore). Instead the standable u's split into BANDS on either side of the
// bore, so a drawn/auto fin lands as two fins FLANKING it. This pins perpColumns
// directly on a synthetic patch, where the (u,t) coverage and the hole are exact.

import { fins, holedPlateTopo, analyze, rotX, isClosed, assert } from './_util.js';

// A patch is consumed by perpColumns via patchProbe(patch, u, t), which reads
// patch.tris as flat (u, t, w) triples and returns w (here 0) inside coverage,
// null outside. zAt uses n.z/d/t.z. So a flat down-facing patch whose world z = t
// is all we need; coverage is a rectangle [uLo,uHi] x [0,tTop] minus a hole.
function quad(u0, u1, t0, t1) {
  return [u0, t0, 0, u1, t0, 0, u1, t1, 0,   u0, t0, 0, u1, t1, 0, u0, t1, 0];
}
function patch(tris, uLo, uHi, tTop) {
  return { tris: new Float32Array(tris), u0: uLo, u1: uHi, t0: 0, t1: tTop,
           n: { x: 0, y: 0, z: -1 }, d: 0, u: { x: 1, y: 0 }, t: { x: 0, y: 0, z: 1 } };
}

// Full rectangle, no hole: [-30,30] x [0,40].
function solidPatch() {
  return patch(quad(-30, 30, 0, 40), -30, 30, 40);
}
// Same, with a bore punched through the middle: hole u[-8,8], t[10,30]. Built as
// the four frame strips around the hole (material / void / material up a column
// through the centre = a real bore).
function boredPatch() {
  const t = [...quad(-30, -8, 0, 40), ...quad(8, 30, 0, 40),   // left + right
             ...quad(-8, 8, 0, 10),  ...quad(-8, 8, 30, 40)];  // below + above the hole
  return patch(t, -30, 30, 40);
}

Deno.test('perpColumns: a clean face gives one even row (no regression)', () => {
  const cols = fins.perpColumns(solidPatch(), -28, 28, 24);
  assert(cols.length >= 1, `no columns on a clean face: ${cols.length}`);
  // every column sits within the face, none excluded
  for (const u of cols) assert(u >= -28 - 1e-6 && u <= 28 + 1e-6, `column off the face: ${u}`);
});

Deno.test('perpColumns: a bore splits the row into two fins FLANKING it', () => {
  const cols = fins.perpColumns(boredPatch(), -28, 28, 24);
  assert(cols.length >= 2, `bore should yield >=2 flanking columns, got ${cols.length}: ${cols}`);
  // THE FIX: no column lands inside the bore's u-band (|u| < 8) -- that column
  // would rise from the bed and die at the void.
  const through = cols.filter((u) => Math.abs(u) < 8);
  assert(through.length === 0, `a column was dropped through the bore: ${through}`);
  // and there is a fin on EACH side of it (flanking, not just one side)
  assert(cols.some((u) => u <= -8) && cols.some((u) => u >= 8), `not flanked on both sides: ${cols}`);
});

Deno.test('END-TO-END: a tilted plate with a bore gets flanking fins, none through the bore', () => {
  // The whole pipeline (analyze -> findWallPatches -> buildPerpFins), not just the
  // column picker: a broad plate with a central bore, tilted 45deg. The old code
  // dropped one fin column straight through the bore; the fix flanks it.
  const topo = holedPlateTopo(40, 30, 4, 9, 9);
  const rot = rotX(45);
  const res = analyze(topo, 45, rot);
  const b = fins.buildFins(topo, res, rot, { mode: 'auto', bedPad: true, tines: true });
  assert(b.fins.length >= 2, `bore should yield >=2 flanking fins, got ${b.fins.length}`);
  assert(isClosed(b.triangles), 'flanking fins are not watertight');
  // NO fin material in the bore's x-band (|x| < 7): nothing was stood in the bore.
  const inBore = b.triangles.filter((v) => Math.abs(v[0]) < 7).length;
  assert(inBore === 0, `${inBore} fin verts landed inside the bore band (a fin was dropped through the hole)`);
  // and material exists on BOTH sides, so it really is flanked
  assert(b.triangles.some((v) => v[0] < -9) && b.triangles.some((v) => v[0] > 9), 'fins are not on both sides of the bore');
});
