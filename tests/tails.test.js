// Low TAILS: a tall wall now runs on down the slope to the squat floor instead of
// stopping at the first station >= minHeight (see prop.js withLowTails). That fix
// reached the part's bottom edge on the first try, but a sweep of every model x
// pose x coverage against the pre-tail build turned up six side effects -- each
// pinned here so it can't creep back. Values are what the pre-tail build did; the
// tail may only ADD coverage and grip, never take any away.
import { tiltedBlockTopo, loadModel, analyze, fins, assert, rotX, rotY } from './_util.js';

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const mul = (a, b) => {           // 3x3 col-major, as prototype/stress/run.js
  const m = new Array(9).fill(0);
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++)
    for (let k = 0; k < 3; k++) m[c * 3 + r] += a[k * 3 + r] * b[c * 3 + k];
  return m;
};
function build(topo, rot, coverage = 0.5) {
  globalThis.__TINECAP = [];
  const b = fins.buildFins(topo, analyze(topo, 45, rot), rot, { mode: 'auto', bedPad: true, tines: true, coverage });
  const caps = globalThis.__TINECAP;
  globalThis.__TINECAP = undefined;
  return { b, lowTine: caps.length ? Math.min(...caps.map((t) => t.z)) : Infinity };
}

Deno.test('tails: the tine comb stays on the body and the tail adds a base nub (35deg cube)', () => {
  // Spacing the comb over body+tail shifted every row into the tail, where a nub
  // can't attach: 14 -> 13 tines per wall. Body-anchored + tail base nub: 14, and
  // the lowest tine drops from 2.16 to ~1.25mm. (Per wall, so the row layout can
  // change without touching this.)
  const { b, lowTine } = build(tiltedBlockTopo(-20, 20, -20, 20, -20, 20, 35), IDENTITY);
  const walls = b.props.filter((p) => !p.squat).length;
  assert(b.tines >= 14 * walls, `tail cost tines: ${b.tines} on ${walls} walls (< 14 each)`);
  assert(lowTine < 1.5, `lowest tine ${lowTine.toFixed(2)}mm -- the tail's base nub didn't land`);
});

Deno.test('tails: a tail tip does not count as a wall under a neighbouring face (wedge kept)', () => {
  // The same cube rotated a further 45deg: the tails reach into the corner where
  // the underside meets the steep face, and propServesPatch read the tail tip as
  // a wall under that face -- dropping its wedge (5 -> 0 tines, no brace beyond
  // the walls).
  const { b } = build(tiltedBlockTopo(-20, 20, -20, 20, -20, 20, 35), rotX(45));
  assert(b.fins.length > b.props.length, `wedge dropped: ${b.fins.length} fins for ${b.props.length} walls`);
  assert(b.tines >= 5, `wedge tines lost: ${b.tines}`);
});

Deno.test('tails: the squat pass only yields stations the built wall covers (torus X45)', () => {
  // The squat ledge at x -11.7..-6.7 sits next to a BLOCKED tall station, not a
  // built wall; deferring it to a "tail" that never got built left it bare.
  const { b } = build(loadModel('torus'), rotX(45));
  const squat = b.props.filter((p) => p.squat && p.line[0][0] < -6);
  assert(squat.length >= 1, 'torus lost its squat wall on the low ledge');
});

Deno.test('tails: a tail never promotes a stub past minSpan (tube X25, sparse)', () => {
  // Counting the tail toward minSpan built a short wall that then "served" a
  // face and dropped its wedge: 37 -> 20 tines. minSpan measures the body only.
  const { b } = build(loadModel('tube'), rotX(25), 0);
  assert(b.tines >= 37, `tube lost its wedge tines: ${b.tines}`);
});

Deno.test('tails: body membership is judged before settling (sphere X45Y30)', () => {
  // The wall's lowest body station sat at 1.51mm; settling beside its new tail
  // lowered it a hair under 1.5, re-read as tail, and the body fell under minSpan
  // -- the sphere's only wall was dropped as a stub.
  const { b } = build(loadModel('sphere'), mul(rotY(30), rotX(45)));
  assert(b.props.length >= 1 && b.tines >= 6, `sphere wall dropped: ${b.props.length} walls, ${b.tines} tines`);
});

Deno.test('tines: an exact nearest-face tie tries every tied face (staircase Y35)', () => {
  // A step's underside and the side face were EXACTLY equidistant; which one won
  // hung on 1e-15 of float noise, so any upstream nudge flipped 3 tines between
  // biting and missing. Every tied face is now tried. (main: 33 on this pose.)
  const { b } = build(loadModel('staircase'), rotY(35));
  assert(b.tines >= 40, `staircase lost tines at an inside corner: ${b.tines}`);
});
