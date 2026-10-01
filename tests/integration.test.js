// END-TO-END on whole STLs: load a stress model, run the real buildFins pipeline,
// and assert on the SUPPORT IT ACTUALLY PRODUCES -- counts and per-tine dimensions.
//
// Why this file exists (Matthew's call): the unit tests pin emitTines on a
// synthetic block, but they can encode a wrong number as "correct" (they did --
// the tine width was asserted at the wall thickness, 2x Slant3D's spec, for
// weeks). These tests measure the tines that come out of a full build against the
// spec, so a regression in width/height/placement shows up on a real part.

import { fins, analyze, loadModel, insideCount, isClosed, rotX, prop, assert } from './_util.js';

const { PROP } = prop;

function build(name, tilt, opts = {}) {
  const topo = loadModel(name);
  const rot = rotX(tilt);
  const res = analyze(topo, 45, rot);
  const built = fins.buildFins(topo, res, rot, { mode: 'auto', bedPad: true, tines: true, ...opts });
  return { topo, rot, res, built };
}

// Isolate the tine triangles: whatever a tined build adds over a tine-less one.
// emitTines appends each tine as a contiguous 36-vertex block, so chunk by 36.
function tineChunks(name, tilt, opts = {}) {
  const off = build(name, tilt, { ...opts, tines: false }).built.triangles;
  const on = build(name, tilt, { ...opts, tines: true }).built.triangles;
  const key = (t) => t.map((v) => v.map((x) => Math.round(x * 1e4)).join(',')).join('|');
  const offKeys = new Set();
  for (let i = 0; i < off.length; i += 3) offKeys.add(key([off[i], off[i + 1], off[i + 2]]));
  const verts = [];
  for (let i = 0; i < on.length; i += 3) {
    const t = [on[i], on[i + 1], on[i + 2]];
    if (!offKeys.has(key(t))) verts.push(...t);
  }
  const chunks = [];
  for (let i = 0; i + 36 <= verts.length; i += 36) chunks.push(verts.slice(i, i + 36));
  return chunks;
}

const bounds = (c) => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const v of c) for (let k = 0; k < 3; k++) {
    if (v[k] < lo[k]) lo[k] = v[k]; if (v[k] > hi[k]) hi[k] = v[k];
  }
  return { lo, hi };
};

// Tine boxes in emission order, each followed by its WALL STEP when it has one: the
// box that raises the wall to meet a tine snapped above the wall top (local issue
// 005). A step is the box whose top is the box before it's bottom.
function tinesAndSteps(name, tilt, opts = {}) {
  const tines = [], steps = [];
  for (const c of tineChunks(name, tilt, opts)) {
    const b = bounds(c);
    const prev = tines[tines.length - 1];
    if (prev && Math.abs(b.hi[2] - prev.lo[2]) < 1e-6) steps.push({ ...b, tine: prev });
    else tines.push(b);
  }
  return { tines, steps };
}

// (model, tilt) pairs that genuinely need support and place it.
const NEEDS_SUPPORT = [['ramp', 40], ['wedge', 40], ['staircase', 40], ['lbracket', 40]];

for (const [name, tilt] of NEEDS_SUPPORT) {
  Deno.test(`${name}@${tilt}: a part that needs support actually gets some (no silent zero)`, () => {
    const { built } = build(name, tilt);
    const n = built.props ? built.props.length : (built.braceCount ?? 0);
    assert(n >= 1, `${name}@${tilt} produced NO support at all`);
    assert(isClosed(built.triangles), `${name}@${tilt} support is not watertight`);
  });
}

Deno.test('a grippable tilted part gets gripping tines, and the walls never fuse', () => {
  const { built } = build('ramp', 40);
  assert(built.tines >= 1, `ramp@40 got no tines (${built.tines}) -- combined support has no grip`);
  // walls-only: nothing but tines may be inside the part
  const { topo, rot, res, built: wallsOnly } = build('ramp', 40, { tines: false });
  const inside = insideCount(topo, rot, res.offset, wallsOnly.triangles);
  assert(inside === 0, `${inside} wall verts are inside the STL (should clear by the gap)`);
});

Deno.test('every tine on a real part matches Slant’s spec: one layer tall, one bead wide', () => {
  const chunks = tinesAndSteps('ramp', 40).tines;
  assert(chunks.length >= 3, `expected several tines to measure, got ${chunks.length}`);
  // the tine footprint is a rectangle: (bite + overlap) long, tineW wide. Pin the
  // diagonal to THAT -- a th-wide (1.0mm) tine pushes the diagonal from ~0.94 to
  // ~1.28 and trips this. Uses tineW so it tracks the spec, not a loose 0.8.
  const maxDiag = Math.hypot(PROP.tineBite + PROP.tineOverlap, PROP.tineW) + 0.05;
  for (const { lo, hi } of chunks) {
    // one layer tall
    const zExt = hi[2] - lo[2];
    assert(Math.abs(zExt - PROP.tineH) < 1e-4, `a tine is ${zExt.toFixed(3)}mm tall, not one layer (${PROP.tineH})`);
    // one bead wide: the XY footprint diagonal can't exceed bite x tineW's box.
    // A th-wide (1.0mm) tine blows past this -- the exact bug this file guards.
    const diag = Math.hypot(hi[0] - lo[0], hi[1] - lo[1]);
    assert(diag <= maxDiag, `a tine's footprint diagonal is ${diag.toFixed(2)}mm (> ${maxDiag.toFixed(2)}) -- wider than one nozzle bead`);
  }
});

Deno.test('PETG: a tine snapped above the wall top gets a wall step under it, inside its footprint', () => {
  // PETG's 0.3 gap is 1.5 layers, so a one-layer tine snapped to the part's layer can
  // start a full layer above the wall: without the step the slice under it is empty
  // and the tine hangs off the part, not touching the wall (local issue 005).
  const { tines, steps } = tinesAndSteps('cone', 30, { tunables: { propGap: 0.3 } });
  assert(tines.length >= 10, `expected a comb of tines, got ${tines.length}`);
  assert(steps.length >= tines.length / 4, `only ${steps.length} wall steps for ${tines.length} PETG tines`);
  for (const st of steps) {
    const h = st.hi[2] - st.lo[2];
    assert(h > 0 && h <= 1.5 * PROP.tineH + 1e-6, `a wall step is ${h.toFixed(3)} mm tall (max 1.5 layers)`);
    for (let k = 0; k < 2; k++) {   // under the tine, never out past it toward the part
      assert(st.lo[k] >= st.tine.lo[k] - 1e-6 && st.hi[k] <= st.tine.hi[k] + 1e-6,
        'a wall step reaches outside its tine\'s footprint');
    }
  }
});
