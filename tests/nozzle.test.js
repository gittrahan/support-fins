// Nozzle size (web/nozzle.js): the support widths scale from their 0.4 numbers.
// 0.4 must leave every number exactly as it was; the one-line features (tines,
// tip) scale both ways; the structural widths (wall, wedge, brace rib) only grow.
// It reaches the Worker in opts.tunables.nozzle, like the gap.

import { tiltedBlockTopo, analyze, fins, prop, assert, assertClose, loadModel, rotX, insideCount } from './_util.js';
import { applyNozzle, applyWallLines, wallLinesFit, WALL_LINES } from '../web/nozzle.js';
import { SWAY } from '../web/sway.js';
import { PERP } from '../web/fins/wedges.js';

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const knobs = () => ({ th: prop.PROP.th, tip: prop.PROP.tip, tineW: prop.PROP.tineW,
  perpTh: PERP.th, swayTineW: SWAY.tineW, swayThMin: SWAY.thMin, swayThMax: SWAY.thMax,
  swayThPerMm: SWAY.thPerMm, wallHalf: SWAY.wallHalf });

/** Volume of the supports built for a tilted block (no bed pad), at this nozzle. */
function volumeAt(nozzle, wallLines = 2) {
  const topo = tiltedBlockTopo(-20, 20, -15, 15, 0, 30, 45);
  const res = analyze(topo, 45, IDENTITY);
  const built = fins.buildFins(topo, res, IDENTITY,
    { mode: 'auto', bedPad: false, tines: true, tunables: { nozzle, wallLines } });
  const t = built.triangles;
  assert(t.length > 0, `nothing built at nozzle ${nozzle}`);
  // Overlapping solids count twice -- fine for comparing one part at two nozzles.
  let v = 0;
  for (let i = 0; i < t.length; i += 3) {
    const [a, b, c] = [t[i], t[i + 1], t[i + 2]];
    v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0])
        + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return v;
}

Deno.test('nozzle: 0.4 is the tuned numbers, unchanged', () => {
  const before = knobs();
  applyNozzle(0.6);
  applyNozzle(0.4);
  assert(JSON.stringify(knobs()) === JSON.stringify(before), 'a round trip to 0.4 moved a width');
  assert(prop.PROP.th === 1.0 && prop.PROP.tip === 0.6 && prop.PROP.tineW === 0.5,
         'the 0.4 wall / tip / tine are no longer 1.0 / 0.6 / 0.5');
});

Deno.test('nozzle: a bigger nozzle widens everything, a smaller one only the one-line features', () => {
  const base = knobs();
  try {
    applyNozzle(0.6);
    for (const [k, v] of Object.entries(knobs())) {
      if (k === 'wallHalf') assert(v > base.wallHalf, 'braces keep no further off a wider wedge');
      else assertClose(v, base[k] * 1.5, 1e-9, `${k} at 0.6`);
    }
    applyNozzle(0.2);
    assertClose(prop.PROP.tineW, base.tineW / 2, 1e-9, 'tine at 0.2');
    assertClose(prop.PROP.tip, base.tip / 2, 1e-9, 'tip at 0.2');
    assertClose(SWAY.tineW, base.swayTineW / 2, 1e-9, 'brace tine at 0.2');
    // A free-standing wall gets no stiffer from a finer nozzle: never below 0.4's.
    for (const k of ['th', 'perpTh', 'swayThMin', 'swayThMax', 'swayThPerMm', 'wallHalf']) {
      assert(knobs()[k] === base[k], `${k} shrank at 0.2`);
    }
  } finally { applyNozzle(0.4); }
});

Deno.test('nozzle: junk leaves the widths alone', () => {
  const before = knobs();
  for (const v of [undefined, NaN, 0, -0.4, 5, '0.6']) applyNozzle(v);
  fins.applyTunables({});
  assert(JSON.stringify(knobs()) === JSON.stringify(before), 'junk nozzle moved a width');
});

Deno.test('nozzle: reaches the build through tunables', () => {
  try {
    const v4 = volumeAt(0.4), v8 = volumeAt(0.8), v2 = volumeAt(0.2);
    assert(v8 > v4 * 1.3, `0.8 nozzle built ${v8.toFixed(0)} mm3, not wider than 0.4's ${v4.toFixed(0)}`);
    assert(v2 <= v4, `0.2 nozzle built more (${v2.toFixed(0)}) than 0.4 (${v4.toFixed(0)})`);
  } finally { applyNozzle(0.4); }
});

// Wall lines (after GitHub #210): the walls, wedges and braces thicken; the tip and
// tines stay one line; the feet keep their margin and the neck stays steep.
Deno.test('wall lines: 2 is the tuned wall, more lines thicken only the structure', () => {
  const base = knobs();
  const feet = () => [prop.PROP.footMin, prop.PROP.footMax, prop.PROP.squatBrimW, prop.PROP.tipH];
  const feet0 = feet();
  try {
    applyWallLines(4);
    assertClose(prop.PROP.th, 2 * base.th, 1e-9, 'wall at 4 lines');
    assertClose(PERP.th, 2 * base.perpTh, 1e-9, 'wedge at 4 lines');
    assert(prop.PROP.tip === base.tip && prop.PROP.tineW === base.tineW && SWAY.tineW === base.swayTineW,
           'the tip or a tine widened with the wall lines');
    assert(SWAY.thMin >= prop.PROP.th, 'a brace rib is thinner than the wall');
    applyWallLines(8);
    assertClose(prop.PROP.footMin - prop.PROP.th / 2, feet0[0] - base.th / 2, 1e-9, 'foot margin past the face');
    const lean = Math.atan2(prop.PROP.tipH, (prop.PROP.th - prop.PROP.tip) / 2) * 180 / Math.PI;
    assert(lean >= 55 - 1e-9, `an 8-line neck leans ${lean.toFixed(1)}deg`);
    for (const v of [3, 0, NaN, '4', undefined]) applyWallLines(v);
    assertClose(prop.PROP.th, 4 * base.th, 1e-9, 'junk wall lines moved the wall');
    applyWallLines(2);
    assert(JSON.stringify(knobs()) === JSON.stringify(base) && JSON.stringify(feet()) === JSON.stringify(feet0),
           'back to 2 lines is not the tuned numbers');
  } finally { applyWallLines(2); }
});

Deno.test('wall lines: reach the build through tunables', () => {
  try {
    const v2 = volumeAt(0.4, 2), v4 = volumeAt(0.4, 4);
    assert(v4 > v2 * 1.5, `4 lines built ${v4.toFixed(0)} mm3, not thicker than 2's ${v2.toFixed(0)}`);
  } finally { applyNozzle(0.4); applyWallLines(2); }
});

// Review: a thick wedge's flat top rode the centreline's contact, so on a curved face
// its edges dug into the part (0.45 mm at 8 lines on a tilted cylinder).
Deno.test('wall lines: a thick wedge stays out of a curved face', () => {
  try {
    for (const name of ['cylinder', 'tube']) {
      const topo = loadModel(name), rot = rotX(45), res = analyze(topo, 45, rot);
      const b = fins.buildFins(topo, res, rot,
        { mode: 'auto', bedPad: false, tines: false, tunables: { nozzle: 0.4, wallLines: 8 } });
      assert(b.fins.some((f) => f.kind === 'wedge'), `${name}: no wedge built`);
      const n = insideCount(topo, rot, res.offset, b.triangles);
      assert(n === 0, `${name}: ${n} wedge vertices inside the part at 8 lines`);
    }
  } finally { applyWallLines(2); }
});

Deno.test('wall lines: a squat brim stays under half the row spacing', () => {
  try {
    applyNozzle(0.8); applyWallLines(8);
    assert(prop.PROP.squatBrimW < prop.PROP.maxUnsupportedSpan / 2,
           `brim half-width ${prop.PROP.squatBrimW} fuses neighbouring rows`);
  } finally { applyNozzle(0.4); applyWallLines(2); }
});


// Large-format nozzles (after #210): the same rule, up to 2.0 mm.
Deno.test('nozzle: large-format sizes scale like the rest, up to 2.0 mm', () => {
  const base = knobs();
  try {
    applyNozzle(2.0);
    assertClose(prop.PROP.th, base.th * 5, 1e-9, 'wall at 2.0');
    assertClose(prop.PROP.tineW, base.tineW * 5, 1e-9, 'tine at 2.0');
    assertClose(prop.PROP.tip, base.tip * 5, 1e-9, 'tip at 2.0');
    applyNozzle(2.5);
    assertClose(prop.PROP.tip, base.tip * 5, 1e-9, 'a 2.5 nozzle was taken');
    const v4 = volumeAt(0.4), v20 = volumeAt(2.0);
    assert(v20 > v4 * 2, `2.0 nozzle built ${v20.toFixed(0)} mm3 vs 0.4's ${v4.toFixed(0)}`);
  } finally { applyNozzle(0.4); }
});

// Review: rows of walls are maxUnsupportedSpan (12 mm) apart, so a wall over TH_MAX
// (a 2.0 nozzle at 4 lines: 10 mm) and its feet would fuse a row into one block.
Deno.test('nozzle: every offered nozzle x wall lines stays under half the row spacing', () => {
  try {
    for (const d of [0.2, 0.25, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0]) {
      applyNozzle(d);
      for (const n of WALL_LINES) {
        applyWallLines(n);
        const half = prop.PROP.maxUnsupportedSpan / 2;
        assert(prop.PROP.th <= half && PERP.th <= half, `${d} x ${n}: wall ${prop.PROP.th}, wedge ${PERP.th}`);
        assert(prop.PROP.footMin < half - 0.5, `${d} x ${n}: foot ${prop.PROP.footMin} fuses the row`);
        if (wallLinesFit(n, d)) assertClose(prop.PROP.th, 0.5 * Math.max(1, d / 0.4) * n, 1e-9, `${d} x ${n} offered but capped`);
      }
    }
  } finally { applyNozzle(0.4); applyWallLines(2); }
});

// Review: the contact tip grows with the nozzle (1.5 mm at 1.0, 3 at 2.0) past the 0.5
// reach, so on a curved underside the tines all but vanished (sphere 30 -> 6 at 2.0).
Deno.test('nozzle: a large nozzle still grips a curved underside, nothing inside the part', () => {
  try {
    const topo = loadModel('sphere'), rot = rotX(45), res = analyze(topo, 45, rot);
    const at = (nozzle, tines) => fins.buildFins(topo, res, rot,
      { mode: 'auto', bedPad: false, tines, tunables: { nozzle, wallLines: 2 } });
    const t4 = at(0.4, true).tines, t20 = at(2.0, true).tines;
    assert(t20 >= t4 * 0.7, `sphere X45: ${t20} tines at 2.0 vs ${t4} at 0.4`);
    const bare = at(2.0, false);
    const n = insideCount(topo, rot, res.offset, bare.triangles);
    assert(n === 0, `${n} support vertices inside the sphere at 2.0 (tines off)`);
  } finally { applyNozzle(0.4); }
});

// Matthew's cube at X30, 2.0: the edge rows stood 0.6 mm in, as at 0.4, so the 3 mm tip
// and its 2.5 mm tines hung past the cube's sides -- tabs out of the wall, not under the
// part. The edge inset grows with the tip; every tine stays inside the cube's 40 mm.
Deno.test('nozzle: an edge row keeps its tip and tines under the part', () => {
  try {
    const topo = loadModel('cube'), rot = rotX(30), res = analyze(topo, 45, rot);
    for (const nozzle of [0.4, 1.0, 2.0]) {
      globalThis.__TINECAP = [];
      fins.buildFins(topo, res, rot, { mode: 'auto', bedPad: false, tines: true, tunables: { nozzle, wallLines: 2 } });
      const cap = globalThis.__TINECAP;
      assert(cap.length > 0, `no tines at ${nozzle}`);
      const out = Math.max(...cap.map((t) => Math.abs(t.x))) + Math.max(prop.PROP.tip, prop.PROP.tineW) / 2;
      assert(out < 20, `${nozzle}: an edge tip reaches x ${out.toFixed(2)}, past the cube's side at 20`);
    }
  } finally { globalThis.__TINECAP = undefined; applyNozzle(0.4); }
});
