// A wide wall's neck on a low wall (local issue 044). nozzle.js grows the tip taper so
// a wide wall (Wall lines, a big nozzle) necks into its tip no flatter than
// PROP.neckDeg, but a wall lower than that taper squeezed the neck into what was left:
// its shoulder leant flatter -- an overhang on the wall's own side. Now the body
// narrows to what the height can neck (sweep.js stemHalf); the 2-line wall's shoulder
// (under half a line) never narrows.

import { prop, assert } from './_util.js';
const { applyNozzle, applyWallLines } = await import('../web/nozzle.js');
const { PROP, profileHalf, sweep } = prop;

// the neck's lean from level, in degrees, over its overhanging part (past half a line)
function neckDeg(top) {
  const ztip = Math.max(top - PROP.tipH, PROP.baseH + 0.1);
  const step = profileHalf(ztip + 1e-6, top) - PROP.tip / 2 - PROP.tip / 3;
  return step <= 0 ? 90 : Math.atan2(top - ztip, step) * 180 / Math.PI;
}

Deno.test('neck: a low wide wall leans its shoulder no flatter than neckDeg', () => {
  try {
    for (const [d, n] of [[0.4, 8], [0.4, 6], [1.2, 4], [2.0, 2]]) {
      applyNozzle(d); applyWallLines(n);
      for (const top of [1.5, 2, 2.5, 3, 4, 6]) {
        const a = neckDeg(top);
        assert(a >= PROP.neckDeg - 1e-6, `${d} x${n} at top ${top}: the neck leans ${a.toFixed(1)}deg`);
      }
      // a tall wall keeps its full body
      assert(Math.abs(profileHalf(PROP.baseH + 0.5, 20) - PROP.th / 2) < 1e-12, `${d} x${n}: a tall wall narrowed`);
    }
  } finally { applyNozzle(0.4); applyWallLines(2); }
});

Deno.test('neck: the 2-line 0.4 wall never narrows, even on a low tail', () => {
  for (const top of [0.5, 0.8, 1.2, 1.5, 3]) {
    assert(profileHalf(PROP.baseH + 0.05, top) === PROP.th / 2 || top < PROP.baseH + 0.1,
      `top ${top}: the default wall narrowed`);
  }
});

Deno.test('neck: the swept low wide wall matches the profile (body narrowed in the mesh)', () => {
  try {
    applyNozzle(0.4); applyWallLines(8);
    const line = [[0, 0, 2.2], [10, 0, 2.2]], out = [];
    assert(sweep(line, 0, out), 'no wall swept');
    // the stem's widest |y| below the flange-free band (z > baseH) is the narrowed body
    let w = 0;
    for (const v of out) if (v[2] > PROP.baseH + 1e-6) w = Math.max(w, Math.abs(v[1]));
    assert(w < PROP.th / 2 - 0.1, `the low wall kept its full ${PROP.th} mm body (half ${w})`);
  } finally { applyWallLines(2); }
});
