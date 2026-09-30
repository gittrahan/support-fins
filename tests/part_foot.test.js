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

Deno.test('part foot: a lifted bottom keeps the full wall thickness', () => {
  // two lines over air, not one 0.6 mm tip line that could peel
  const r = drawnWall([-30, 0, 35], [30, 0, 35], L, 0);
  const ys = r.tris.filter((p) => Math.abs(p[2] - 5.2) < 1e-6).map((p) => p[1]);
  const w = Math.max(...ys) - Math.min(...ys);
  assert(Math.abs(w - PROP.th) < 1e-6, `bottom ${w.toFixed(3)} mm wide, expected th ${PROP.th}`);
});

Deno.test('part foot: the gap does not change which walls exist (headroom, not lifted height)', () => {
  // 1.6 mm from the part to the wall's top: past minHeight 1.5 as headroom, 1.4
  // once lifted -- hub_corner X60 lost a 31 mm wall to exactly this
  const top = 5 + 1.6 + PROP.gap;
  const low = new Float32Array([...block(-40, 40, -10, 10, 0, 5), ...block(-40, 40, -10, 10, top, top + 4)]);
  const r = drawnWall([-30, 0, top], [30, 0, top], low, 0);
  assert(r.ok, `a 1.6 mm headroom wall was refused: ${r.reason}`);
});

Deno.test('part foot: footGap 0 still welds, as before', () => {
  const z = lowest(0);
  assert(Math.abs(z - 5) < 1e-6, `lowest point ${z}, expected 5 (on the part)`);
});

// A floor sloping ACROSS the wall (56deg here). The lifted bottom is th wide, not
// the welded tip's width, so the floor must be read across th and footGap past
// it: read across the tip only, the bottom's outer edge sat 0.1 mm INSIDE the slope.
const quad = (a, b, c, d) => [a, b, c, a, c, d];
function ramp(x0, x1, y0, y1, zAt) {       // a block whose top is z = zAt(y)
  const v = [[x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y1, 0],
             [x0, y0, zAt(y0)], [x1, y0, zAt(y0)], [x1, y1, zAt(y1)], [x0, y1, zAt(y1)]];
  return [...quad(v[0], v[3], v[2], v[1]), ...quad(v[4], v[5], v[6], v[7]), ...quad(v[0], v[1], v[5], v[4]),
          ...quad(v[2], v[3], v[7], v[6]), ...quad(v[1], v[2], v[6], v[5]), ...quad(v[0], v[4], v[7], v[3])].flat();
}

Deno.test('part foot: on a floor sloping across the wall, the bottom clears it by footGap', () => {
  const zAt = (y) => 10 + 1.5 * y;
  const tris = new Float32Array([...ramp(-40, 40, -3, 3, zAt), ...block(-40, 40, -10, 10, 35, 39)]);
  const r = drawnWall([-30, 0, 35], [30, 0, 35], tris, 0);
  assert(r.ok, `wall failed: ${r.reason}`);
  // distance SQUARE to the slope, not straight down: read across th alone the
  // bottom cleared it by 0.2 vertically but ~0.1 square to it (the first layer
  // sits beside the rising slope)
  let worst = Infinity;
  for (const p of r.tris) if (p[2] < 20) worst = Math.min(worst, (p[2] - zAt(p[1])) / Math.hypot(1, 1.5));
  assert(worst > PROP.footGap - 0.05, `bottom clears the slope by ${worst.toFixed(3)} mm, expected ~${PROP.footGap}`);
});
