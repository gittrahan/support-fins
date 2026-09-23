// Low TAILS: a tall wall now runs on down the slope to the squat floor instead of
// stopping at the first station >= minHeight (see prop.js withLowTails). That fix
// reached the part's bottom edge on the first try, but a sweep of every model x
// pose x coverage against the pre-tail build turned up six side effects -- each
// pinned here so it can't creep back. Values are what the pre-tail build did; the
// tail may only ADD coverage and grip, never take any away.
import { tiltedBlockTopo, loadModel, analyze, fins, assert, rotX, rotY } from './_util.js';
import { PROP } from '../web/prop.js';

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

Deno.test('tails: the comb reaches the base without losing tines (35deg cube)', () => {
  // A comb spaced blindly over body+tail shifted rows into the tail, where a nub
  // can't attach, and lost tines. Anchored at the lowest nub that grips, each wall
  // keeps main's 11 and the lowest tine drops from 2.69 (main) to ~1.25mm. (Per
  // wall, so the row layout can change without touching this.)
  const { b, lowTine } = build(tiltedBlockTopo(-20, 20, -20, 20, -20, 20, 35), IDENTITY);
  const walls = b.props.filter((p) => !p.squat).length;
  assert(b.tines >= 11 * walls, `tail cost tines: ${b.tines} on ${walls} walls (< 11 each)`);
  assert(lowTine < 1.5, `lowest tine ${lowTine.toFixed(2)}mm -- the comb didn't reach the base`);
});

Deno.test('tines: one evenly spaced comb from the bottom, none jammed at the top (35deg cube)', () => {
  // Stacking a body comb, a forced nub at EACH end and a tail pass bunched the
  // bottom tines (gaps 1.3, 0.8, then 2mm) and jammed one 0.5mm from the TOP end,
  // hanging past the overhang's edge (Matthew's 35deg cube print). Every gap must
  // be a real comb step (dense 2mm or edge-biased 4mm), and the top end keeps
  // PROP.tineTopClear bare.
  globalThis.__TINECAP = [];
  const topo = tiltedBlockTopo(-20, 20, -20, 20, -20, 20, 35);
  const b = fins.buildFins(topo, analyze(topo, 45, IDENTITY), IDENTITY, { mode: 'auto', bedPad: true, tines: true, coverage: 0.5 });
  const caps = globalThis.__TINECAP;
  globalThis.__TINECAP = undefined;
  const walls = b.props.filter((p) => !p.squat && p.line.length > 1);
  assert(walls.length >= 1, 'no walls to test');
  for (const w of walls) {
    const L = w.line;
    const lo = L[0][2] <= L.at(-1)[2] ? L[0] : L.at(-1), hi = lo === L[0] ? L.at(-1) : L[0];
    const len = Math.hypot(hi[0] - lo[0], hi[1] - lo[1]);
    const ux = (hi[0] - lo[0]) / len, uy = (hi[1] - lo[1]) / len;
    const along = caps
      .filter((t) => Math.abs((t.x - lo[0]) * -uy + (t.y - lo[1]) * ux) < 1.5)
      .map((t) => (t.x - lo[0]) * ux + (t.y - lo[1]) * uy)
      .sort((a, c) => a - c);
    assert(along.length >= 3, `wall got ${along.length} tines`);
    for (let i = 1; i < along.length; i++) {
      const g = along[i] - along[i - 1];
      assert(Math.abs(g - 2) < 0.05 || Math.abs(g - 4) < 0.05,
        `uneven comb: gap ${g.toFixed(2)}mm between tines ${i - 1} and ${i}`);
    }
    assert(len - along.at(-1) >= PROP.tineTopClear - 0.05,
      `tine jammed ${(len - along.at(-1)).toFixed(2)}mm from the wall's top end`);
  }
});

Deno.test('tails: a tail tip does not count as a wall under a neighbouring face (wedge kept)', () => {
  // The same cube rotated a further 45deg: the tails reach into the corner where
  // the underside meets the steep face, and propServesPatch read the tail tip as
  // a wall under that face -- dropping its wedge (5 -> 0 tines, no brace beyond
  // the walls).
  const { b } = build(tiltedBlockTopo(-20, 20, -20, 20, -20, 20, 35), rotX(45));
  assert(b.fins.length > b.props.length, `wedge dropped: ${b.fins.length} fins for ${b.props.length} walls`);
  assert(b.tines >= 3, `wedge tines lost: ${b.tines}`);   // main: 3
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
  // face and dropped its wedge. minSpan measures the body only -- pinned directly
  // now: the row fallback legitimately trades that wedge for real walls here
  // (1 -> 4 walls, overhang coverage 51% -> 76%), so a tine count no longer
  // tells a stub from a wall.
  const { b } = build(loadModel('tube'), rotX(25), 0);
  const walls = b.props.filter((p) => p.line && !p.squat);
  assert(walls.length >= 1, 'tube lost its walls');
  for (const p of walls) {
    const body = p.line.filter((q) => q[2] >= PROP.minHeight);
    const span = body.length ? Math.hypot(body.at(-1)[0] - body[0][0], body.at(-1)[1] - body[0][1]) : 0;
    assert(span >= PROP.minSpan - 1e-6, `tail promoted a stub: body span ${span.toFixed(2)} < ${PROP.minSpan}`);
  }
});

Deno.test('tails: body membership is judged before settling (sphere X45Y30)', () => {
  // The wall's lowest body station sat at 1.51mm; settling beside its new tail
  // lowered it a hair under 1.5, re-read as tail, and the body fell under minSpan
  // -- the sphere's only wall was dropped as a stub.
  const { b } = build(loadModel('sphere'), mul(rotY(30), rotX(45)));
  assert(b.props.length >= 1 && b.tines >= 4, `sphere wall dropped: ${b.props.length} walls, ${b.tines} tines`);   // main: 4
});

Deno.test('tines: an exact nearest-face tie tries every tied face (staircase Y35)', () => {
  // A step's underside and the side face were EXACTLY equidistant; which one won
  // hung on 1e-15 of float noise, so any upstream nudge flipped 3 tines between
  // biting and missing. Every tied face is now tried. (main: 33 on this pose.)
  const { b } = build(loadModel('staircase'), rotY(35));
  assert(b.tines >= 33, `staircase lost tines at an inside corner: ${b.tines}`);
});
