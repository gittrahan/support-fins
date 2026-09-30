// A WALL STANDING ON THE PART stops PROP.footGap above it (local issue 009): the
// welded bottom tip scarred the part on every wall of the slenderness coupon, and
// the foot coupon (prototype/calibration/foot/) printed a 0.2 gap clean.
import { WEB, block, prop, assert } from './_util.js';

const { drawnWall } = await import(`${WEB}draw.js`);
const { PROP } = prop;

// an L: a base block the wall stands on (top z=5), and a shelf 30 mm above it
const L = new Float32Array([...block(-40, 40, -10, 10, 0, 5), ...block(-40, 40, -10, 10, 35, 39)]);
const lowest = (gap) => {
  const was = PROP.footGap;
  PROP.footGap = gap;
  try {
    const r = drawnWall([-30, 0, 35], [30, 0, 35], L, 0);
    assert(r.ok, `wall failed (footGap ${gap}): ${r.reason}`);
    return Math.min(...r.tris.map((p) => p[2]));
  } finally { PROP.footGap = was; }
};

Deno.test('part foot: a wall on the part stops footGap above it', () => {
  assert(PROP.footGap === 0.2, `footGap ${PROP.footGap}: the foot coupon picked 0.2`);
  const z = lowest(PROP.footGap);
  assert(Math.abs(z - 5.2) < 1e-6, `lowest point ${z}, expected 5.2 (the part top + 0.2)`);
});

Deno.test('part foot: footGap 0 still welds, as before', () => {
  const z = lowest(0);
  assert(Math.abs(z - 5) < 1e-6, `lowest point ${z}, expected 5 (on the part)`);
});
