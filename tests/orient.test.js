// Orientation + strength logic (web/orient.js). Pure functions in, verdicts and
// ranked poses out -- no DOM, so they test cleanly here. Covers the three things
// the rail leans on: the layer-posture bucket, the load-alignment verdict, and the
// two solvers (minimise-support suggestions, and the load-driven strength pose).

import { WEB, assert, assertClose, blockTopo, tiltedBlockTopo, rotX } from './_util.js';

const { suggestOrientations, suggestStrengthPose, layerVerdict, loadAlignment } =
  await import(`${WEB}orient.js`);
const { analyze } = await import(`${WEB}overhangs.js`);

const IDENT = rotX(0);   // as-loaded pose

// ------------------------------------------------------------ layerVerdict

Deno.test('layerVerdict: a tall part reads weak (long axis up the layers)', () => {
  assert(layerVerdict({ x: 10, y: 10, z: 100 }).posture === 'weak');
});

Deno.test('layerVerdict: a flat slab reads strong (long spans along the layers)', () => {
  assert(layerVerdict({ x: 100, y: 80, z: 5 }).posture === 'strong');
});

Deno.test('layerVerdict: an on-its-side part reads mixed', () => {
  // dims sorted [50,70,100]; z=70 is neither the tallest span nor the shortest.
  assert(layerVerdict({ x: 100, y: 50, z: 70 }).posture === 'mixed');
});

Deno.test('layerVerdict: returns posture ONLY -- the always-on text note was dropped', () => {
  // Locks the simplification: the note field is gone, posture is the whole API now,
  // and the one remaining consumer (the strength caveat) reads posture, not note.
  const v = layerVerdict({ x: 100, y: 80, z: 5 });
  assert(v.note === undefined, 'layerVerdict should no longer return a display note');
  assert(Object.keys(v).length === 1, `expected just {posture}, got ${Object.keys(v)}`);
});

// ------------------------------------------------------------ loadAlignment

Deno.test('loadAlignment: a pull straight up the build axis is poor (across the layers)', () => {
  assert(loadAlignment([0, 0, 1]).quality === 'poor');
});

Deno.test('loadAlignment: a pull in the layer plane is good (along the layers)', () => {
  assert(loadAlignment([1, 0, 0]).quality === 'good');
});

Deno.test('loadAlignment: a 45-degree pull is mixed', () => {
  const al = loadAlignment([1, 0, 1]);
  assert(al.quality === 'mixed');
  assertClose(al.cross, Math.SQRT1_2, 1e-9, 'cross should be |z|/|d| = 1/sqrt(2)');
});

Deno.test('loadAlignment: the good/mixed boundary sits at 60 degrees from the plate', () => {
  // cross = 0.5 is exactly 60deg off in-plane and must still count as good (<= 0.5).
  assert(loadAlignment([Math.sqrt(3), 0, 1]).quality === 'good');
});

Deno.test('loadAlignment: a zero-length direction is null, not a crash', () => {
  assert(loadAlignment([0, 0, 0]) === null);
});

// ------------------------------------------------------------ suggestOrientations

Deno.test('suggestOrientations: finds the flat pose for a part saved tilted', () => {
  // A block whose vertices were tilted 60deg and saved that way: as loaded it has a
  // broad downward overhang, but rotating it back flat needs no support at all. The
  // suggester must surface that pose and rank it on top.
  const topo = tiltedBlockTopo(0, 60, 0, 40, 0, 12, 60);
  const asLoaded = analyze(topo, 45, IDENT);
  assert(asLoaded.overArea > 1, 'the tilted-as-saved block should have an overhang as loaded');

  const { candidates, confidence } = suggestOrientations(topo, { top: 3, threshold: 45 });
  assert(candidates.length >= 1, 'expected at least one candidate');
  assert(['high', 'medium', 'low', 'none'].includes(confidence), `bad confidence ${confidence}`);

  const best = candidates[0];
  assert(best.overArea < asLoaded.overArea, 'the best pose should reduce overhang area');
  assert(best.overArea < 1, `the best pose should be ~support-free, got ${best.overArea} mm^2`);
  assert(best.regions === 0, `the best pose should have no overhang regions, got ${best.regions}`);
});

Deno.test('suggestOrientations: candidates are ranked best-first and well-formed', () => {
  const topo = tiltedBlockTopo(0, 60, 0, 40, 0, 12, 60);
  const { candidates } = suggestOrientations(topo, { top: 3, threshold: 45 });
  for (let i = 1; i < candidates.length; i++) {
    assert(candidates[i - 1].score <= candidates[i].score, 'candidates must be sorted by score');
  }
  for (const c of candidates) {
    assert(Array.isArray(c.rot) && c.rot.length === 9, 'rot must be a 3x3 (9-element) matrix');
    assert(typeof c.seating === 'string', 'each candidate reports a seating kind');
    assert(c.size && typeof c.size.z === 'number', 'each candidate carries its full seated size');
  }
});

// ------------------------------------------------------------ suggestStrengthPose

Deno.test('suggestStrengthPose: lays the load into the layer plane, on a seated pose', () => {
  // A tall square post pulled along its own long axis. As loaded the pull runs
  // straight up the build layers (weak); the fix is to lay the post on its side so
  // the pull runs along the layers -- and that pose still sits flat on the bed.
  const topo = blockTopo(0, 20, 0, 20, 0, 100);
  const pose = suggestStrengthPose(topo, [0, 0, 1], { threshold: 45 });
  assert(pose, 'a strictly better printable pose should exist for an axial pull on a post');
  assert(pose.bedArea >= 1, 'the recommended pose must actually sit on the bed, not balance on a tip');
  assert(pose.cross < 0.5, `the load should end up in-plane (cross ${pose.cross})`);
  assert(pose.quality === 'good', `expected a good alignment verdict, got ${pose.quality}`);
});

Deno.test('suggestStrengthPose: an already in-plane load needs no turn (returns null)', () => {
  // Load already runs across the footprint of a flat slab -- in the layer plane
  // whichever seated pose you pick -- so there's no stronger printable pose to offer.
  const topo = blockTopo(0, 100, 0, 80, 0, 8);
  const pose = suggestStrengthPose(topo, [1, 0, 0], { threshold: 45 });
  // Either nothing beats the flat pose (null), or the best it finds is still in-plane.
  assert(pose === null || pose.cross < 0.5, 'must not turn a flat slab into a worse-aligned pose');
});
