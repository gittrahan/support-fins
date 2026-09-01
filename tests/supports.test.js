// End-to-end support invariants on the stress models, in poses that produce
// fins. These lock the promises the tool makes about a printed part:
//   - the fin WALL never fuses into the STL (it stands off by the breakaway gap);
//   - the fin FUSES to the bed pad (a wall lifted off its pad is unsupported);
//   - every added solid is watertight;
//   - a tilted part that needs holding gets a tined, gripping fin.

import { loadModel, analyze, fins, insideCount, isClosed, bbox, rotX, rotY, assert } from './_util.js';

// (model, pose) pairs that reliably place fins in this project's test set.
const CASES = [
  ['cube', 'X45', rotX(45)],
  ['ramp', 'X45', rotX(45)],
  ['wedge', 'X45', rotX(45)],
];

function build(name, rot, opts = {}) {
  const topo = loadModel(name);
  const res = analyze(topo, 45, rot);
  const built = fins.buildFins(topo, res, rot, { mode: 'auto', bedPad: true, tines: true, ...opts });
  return { topo, res, rot, built };
}

for (const [name, pose, rot] of CASES) {
  Deno.test(`${name}/${pose}: the fin wall never fuses into the STL`, () => {
    const { topo, res, built } = build(name, rot, { tines: false }); // walls only, no grip teeth
    const inside = insideCount(topo, rot, res.offset, built.triangles);
    // Only the tines are allowed to bite in; the wall itself must clear the part.
    assert(inside === 0, `${inside} wall verts are inside the STL (the wall should stand off by the gap)`);
  });

  Deno.test(`${name}/${pose}: added support is watertight`, () => {
    const { built } = build(name, rot);
    assert(isClosed(built.triangles), 'fin geometry is not closed');
    assert(isClosed(built.padTriangles), 'pad geometry is not closed');
  });

  Deno.test(`${name}/${pose}: a tilted part gets a tined, gripping fin`, () => {
    const { topo, res, built } = build(name, rot);
    assert(built.braceCount >= 1, `no fins placed (braceCount ${built.braceCount})`);
    assert(built.tines >= 1, `fin has no grip tines (${built.tines})`);
    // tines on adds interior bite the walls-only build did not have
    const wallsOnly = fins.buildFins(topo, res, rot, { mode: 'auto', bedPad: true, tines: false });
    const inWith = insideCount(topo, rot, res.offset, built.triangles);
    const inWithout = insideCount(topo, rot, res.offset, wallsOnly.triangles);
    assert(inWith > inWithout, 'turning tines on added no bite into the part');
  });
}

Deno.test('point-seated tilt: fin feet fuse into the bed pad, not lifted off it', () => {
  // A cube on its edge touches the bed on ~nothing, so it gets a pad; the fins
  // must run down and weld to that pad. The pad-trim regression pulled them up.
  const { topo, res, built } = build('cube', rotX(45));
  assert(built.padTriangles.length > 0, 'expected a bed pad on a point-seated part');

  // pad XY footprint
  const pad = bbox(built.padTriangles);
  // support feet = fin verts near the plate
  const feet = built.triangles.filter((v) => v[2] < 0.7);
  const inPad = feet.filter((v) => v[0] >= pad.lo[0] && v[0] <= pad.hi[0] &&
                                   v[1] >= pad.lo[1] && v[1] <= pad.hi[1]);
  // Baseline overlaps the pad heavily (>1000 verts); a trimmed-off fin drops to
  // a handful. Anything comfortably above the trimmed regime proves fusion.
  assert(inPad.length > 100,
    `fins barely touch the pad (${inPad.length} foot verts in the pad footprint) -- they look lifted off it`);

  // and the support actually reaches the plate
  let minZ = Infinity;
  for (const v of built.triangles) minZ = Math.min(minZ, v[2]);
  assert(minZ <= 0.1, `support does not reach the plate (min z ${minZ.toFixed(2)})`);
});
