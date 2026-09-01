// A part tilted to exactly 45 degrees -- a cube on its edge, the single most
// common pose -- must offer its down-facing overhang as a grip site. The face
// normal lands on |nz| = sin(MAX_LEAN_DEG) to the last float bit, so a bare
// `<=` let winding round-off reject the obvious overhang with "can't stand a fin
// on that face." findWallPatches carries a tiny slack past the sine to pull the
// boundary face in reliably.

import { tiltedBlockTopo, analyze, fins, assert } from './_util.js';

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

Deno.test('a 45-degree tilted face is offered as a grip site', () => {
  // baked 45-degree tilt, rot stays identity (STL saved tilted)
  const topo = tiltedBlockTopo(-20, 20, -30, 30, -20, 20, 45);
  const res = analyze(topo, 60, IDENTITY);
  const grip = fins.gripPatches(topo, res, IDENTITY);
  assert(grip.patches.length >= 1,
    `a 45deg overhang offered no grip site (${grip.patches.length}) -- the leanCut boundary rejected it`);
  // and the offered patch is genuinely down-facing
  assert(grip.patches.every((p) => p.n.z < -0.05),
    'a grip patch is not down-facing');
});

Deno.test('a slightly steeper (46deg) overhang still grips', () => {
  const topo = tiltedBlockTopo(-20, 20, -30, 30, -20, 20, 46);
  const res = analyze(topo, 60, IDENTITY);
  const grip = fins.gripPatches(topo, res, IDENTITY);
  assert(grip.patches.length >= 1, `46deg overhang offered no grip site (${grip.patches.length})`);
});
