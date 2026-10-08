// A WALL STANDING ON THE PART stops PROP.footGap above it (local issue 009): the
// welded bottom tip scarred the part on every wall of the slenderness coupon, and
// the foot coupon (prototype/calibration/foot/) printed a 0.2 gap clean.
import { WEB, block, prop, isClosed, assert } from './_util.js';

const { drawnWall } = await import(`${WEB}draw.js`);
const { PROP } = prop;
const { CUT } = await import(`${WEB}cutout.js`);

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

// A floor sloping ACROSS the wall (56deg here). The lifted bottom is th wide, so
// the floor is read across th and footGap past it (read across the tip only, the
// bottom's outer edge sat 0.1 mm INSIDE the slope), and it TILTS with the floor:
// level, its downhill side hung 2 mm off the slope (gree: up to 2.6 mm, nothing
// to grip). Straight down is the gap that matters -- a slicer's bottom Z distance.
const quad = (a, b, c, d) => [a, b, c, a, c, d];
function ramp(x0, x1, y0, y1, zAt) {       // a block whose top is z = zAt(y)
  const v = [[x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y1, 0],
             [x0, y0, zAt(y0)], [x1, y0, zAt(y0)], [x1, y1, zAt(y1)], [x0, y1, zAt(y1)]];
  return [...quad(v[0], v[3], v[2], v[1]), ...quad(v[4], v[5], v[6], v[7]), ...quad(v[0], v[1], v[5], v[4]),
          ...quad(v[2], v[3], v[7], v[6]), ...quad(v[1], v[2], v[6], v[5]), ...quad(v[0], v[4], v[7], v[3])].flat();
}

Deno.test('part foot: on a floor sloping across the wall, the bottom follows it footGap above', () => {
  const zAt = (y) => 10 + 1.5 * y;
  const tris = new Float32Array([...ramp(-40, 40, -3, 3, zAt), ...block(-40, 40, -10, 10, 35, 39)]);
  const r = drawnWall([-30, 0, 35], [30, 0, 35], tris, 0);
  assert(r.ok, `wall failed: ${r.reason}`);
  let lo = Infinity, hi = -Infinity;
  for (const p of r.tris) {
    if (p[2] > 16) continue;                        // the bottom, not the top
    const d = p[2] - zAt(p[1]);
    lo = Math.min(lo, d); hi = Math.max(hi, d);
  }
  const g = PROP.footGap;
  assert(lo > g - 1e-3, `bottom ${lo.toFixed(3)} mm above the slope, expected >= ${g}`);
  // uphill it clears the slope footGap past the wall's side too: 0.2 + 1.5 x 0.2
  assert(hi < g + 1.5 * g + 1e-3, `bottom hangs ${hi.toFixed(3)} mm off the slope, expected <= ${g + 1.5 * g}`);
});

Deno.test('part foot: a cut-out wall keeps the tilted bottom and stays closed', () => {
  const zAt = (y) => 10 + 1.5 * y;
  const tris = new Float32Array([...ramp(-40, 40, -3, 3, zAt), ...block(-40, 40, -10, 10, 35, 39)]);
  const build = (pattern) => {
    const was = CUT.pattern;
    CUT.pattern = pattern;
    try {
      const r = drawnWall([-30, 0, 35], [30, 0, 35], tris, 0);
      assert(r.ok, `wall failed (${pattern}): ${r.reason}`);
      return r.tris;
    } finally { CUT.pattern = was; }
  };
  // each side's lowest point at every x along the wall
  const lows = (t) => {
    const m = new Map();
    for (const p of t) {
      if (Math.abs(Math.abs(p[1]) - PROP.th / 2) > 1e-3) continue;
      const k = `${p[0].toFixed(3)}|${Math.sign(p[1])}`;
      m.set(k, Math.min(m.get(k) ?? Infinity, p[2]));
    }
    return m;
  };
  const cut = build('diamond'), solid = lows(build('none'));
  assert(isClosed(cut), 'cut wall on a slope is not closed');
  assert(cut.length !== build('none').length, 'no holes were cut -- the test proves nothing');
  let shared = 0;
  for (const [k, z] of lows(cut)) {
    if (!solid.has(k)) continue;
    shared++;
    assert(Math.abs(z - solid.get(k)) < 1e-6, `cut bottom at ${k} is ${z.toFixed(3)}, solid ${solid.get(k).toFixed(3)}`);
  }
  assert(shared > 20, `only ${shared} bottom points compared`);
});

Deno.test('part foot: a ridge between the two sides lifts the bottom clear of it', () => {
  // the part bulges up under the middle of the wall: a straight bottom through
  // the two sides' floors would cut the crest
  const up = (y) => 10 + 1.5 * y, down = (y) => 10 - 1.5 * y;
  const tris = new Float32Array([...ramp(-40, 40, -3, 0, up), ...ramp(-40, 40, 0, 3, down),
                                 ...block(-40, 40, -10, 10, 35, 39)]);
  const r = drawnWall([-30, 0, 35], [30, 0, 35], tris, 0);
  assert(r.ok, `wall failed: ${r.reason}`);
  let lo = Infinity;
  for (const p of r.tris) if (p[2] < 16) lo = Math.min(lo, p[2] - Math.min(up(p[1]), down(p[1])));
  assert(lo > PROP.footGap - 1e-3, `bottom ${lo.toFixed(3)} mm above the ridge, expected >= ${PROP.footGap}`);
  const bottom = Math.min(...r.tris.map((p) => p[2]));
  assert(bottom >= 10 + PROP.footGap - 1e-3, `bottom at ${bottom.toFixed(3)} dips below the crest + gap`);
});

// A rounded bump under the wall, rising along it (gree's leg): stations 1 mm apart
// bridged its curve with straight edges that cut into it between stations. The
// bottom must MOLD to it: clear it everywhere, along every edge, and hug it.
function bumpFloor(R = 6, y0 = -3, y1 = 3) {
  const zAt = (x) => (Math.abs(x) < R ? 5 + Math.sqrt(R * R - x * x) : 5);
  const xs = [];
  for (let x = -40; x <= 40 + 1e-9; x += 0.25) xs.push(+x.toFixed(4));
  const t = [];
  const P = (x, y, z) => [x, y, z];
  for (let i = 0; i + 1 < xs.length; i++) {
    const a = xs[i], b = xs[i + 1], za = zAt(a), zb = zAt(b);
    t.push(...quad(P(a, y0, za), P(a, y1, za), P(b, y1, zb), P(b, y0, zb)));   // top
    t.push(...quad(P(a, y0, 0), P(b, y0, 0), P(b, y1, 0), P(a, y1, 0)));       // bottom
    t.push(...quad(P(a, y0, 0), P(a, y0, za), P(b, y0, zb), P(b, y0, 0)));     // -y side
    t.push(...quad(P(a, y1, 0), P(b, y1, 0), P(b, y1, zb), P(a, y1, za)));     // +y side
  }
  const e0 = xs[0], e1 = xs[xs.length - 1];
  t.push(...quad(P(e0, y0, 0), P(e0, y1, 0), P(e0, y1, 5), P(e0, y0, 5)));
  t.push(...quad(P(e1, y0, 0), P(e1, y0, 5), P(e1, y1, 5), P(e1, y1, 0)));
  return { tris: t.flat(), zAt };
}

Deno.test('part foot: the bottom molds to a rounded bump -- clear along every edge, and close', () => {
  const { tris: floor, zAt } = bumpFloor();
  const tris = new Float32Array([...floor, ...block(-40, 40, -10, 10, 35, 39)]);
  const r = drawnWall([-30, 0, 35], [30, 0, 35], tris, 0);
  assert(r.ok, `wall failed: ${r.reason}`);
  let lo = Infinity, hugging = 0, onBump = 0;
  for (let i = 0; i < r.tris.length; i += 3) {
    const T = [r.tris[i], r.tris[i + 1], r.tris[i + 2]];
    if (Math.max(...T.map((p) => p[2])) > 14) continue;       // bottom region only
    for (let e = 0; e < 3; e++) {
      const a = T[e], b = T[(e + 1) % 3];
      for (let k = 0; k <= 8; k++) {                            // along the edge, not just its ends
        const u = k / 8, x = a[0] + (b[0] - a[0]) * u, z = a[2] + (b[2] - a[2]) * u;
        lo = Math.min(lo, z - zAt(x));
      }
    }
    for (const p of T) {
      if (Math.abs(p[0]) > 5 || p[2] - zAt(p[0]) > 3) continue;  // bottom vertices on the bump
      onBump++;
      if (p[2] - zAt(p[0]) < 0.6) hugging++;
    }
  }
  assert(lo > 0.15, `bottom comes ${lo.toFixed(3)} mm from the bump (straight down), expected ~${PROP.footGap}`);
  assert(onBump > 30 && hugging / onBump > 0.8, `bottom hugs the bump at ${hugging}/${onBump} vertices`);
});

// A wall standing at a LEDGE's edge, the ledge ending under it (local issue 032):
// one side reads no floor at all (open to the plate) or a step far below. It used
// to tilt down MAX_DROP (2.75) toward it anyway -- a corner starting mid-air, over
// nothing (a slicer island; Auto built these on the lighthouse, gree, artichoke...).
// It stays level on the ledge; a step within MAX_DROP still gets the tilt. The
// edge sits under the wall between its centre and one face (y -0.4 of th 1.0): an
// edge past the centre makes the straight bottom clear the ledge, level anyway.
const ledge = (step) => new Float32Array([...block(-40, 40, -10, -0.4, 0, 5),
  ...(step > 0 ? block(-40, 40, -0.4, 10, 0, step) : []), ...block(-40, 40, -10, 10, 35, 39)]);

Deno.test('part foot: at a ledge edge over open air the bottom stays level on the ledge', () => {
  for (const step of [0, 1]) {                   // nothing beside the ledge; a step 4 mm down
    const r = drawnWall([-30, 0, 35], [30, 0, 35], ledge(step), 0);
    assert(r.ok, `wall failed (step ${step}): ${r.reason}`);
    const z = Math.min(...r.tris.map((p) => p[2]));
    assert(Math.abs(z - (5 + PROP.footGap)) < 1e-6,
      `step ${step}: lowest point ${z.toFixed(3)}, expected ${5 + PROP.footGap} (level on the ledge, not hanging past it)`);
  }
});

Deno.test('part foot: at a ledge edge over a step within MAX_DROP the bottom still tilts to it', () => {
  const r = drawnWall([-30, 0, 35], [30, 0, 35], ledge(3.5), 0);
  assert(r.ok, `wall failed: ${r.reason}`);
  const z = Math.min(...r.tris.map((p) => p[2]));
  assert(Math.abs(z - (3.5 + PROP.footGap)) < 1e-6, `lowest point ${z.toFixed(3)}, expected ${3.5 + PROP.footGap} (footGap over the step)`);
});

Deno.test('part foot: a floor just past MAX_DROP keeps the capped tilt, its corner just over it', () => {
  // 3.25 mm down (MAX_DROP 2.75 + 0.5): a steep slope, not an open edge -- levelled,
  // the corner sat 3 mm over it (bore_bracket x30y60's bore)
  // (and 3.7, just inside MAX_DROP + MAX_HANG 3.75, still tilts)
  for (const down of [3.25, 3.7]) {
    const r = drawnWall([-30, 0, 35], [30, 0, 35], ledge(5 - down), 0);
    assert(r.ok, `wall failed (${down} down): ${r.reason}`);
    const z = Math.min(...r.tris.map((p) => p[2]));
    assert(Math.abs(z - (5 - 2.75 + PROP.footGap)) < 1e-6,
      `${down} down: lowest point ${z.toFixed(3)}, expected ${5 - 2.75 + PROP.footGap} (tilted MAX_DROP)`);
  }
});

Deno.test('part foot: where the floor is open plate the bottom stands on the plate, not footGap over it', () => {
  // the base block under only the left half: the wall stands on the part there,
  // and runs down to the plate past its edge -- lifted, that end floated 0.2 mm
  // over the plate with nothing for the slicer to start it on (a figure's hands)
  const half = new Float32Array([...block(-40, 0, -10, 10, 0, 5), ...block(-40, 40, -10, 10, 35, 39)]);
  const r = drawnWall([-30, 0, 35], [30, 0, 35], half, 0);
  assert(r.ok && r.partAttached, `expected a part-attached wall: ${r.reason}`);
  const lowAt = (keep) => Math.min(...r.tris.filter(keep).map((p) => p[2]));
  const plate = lowAt((p) => p[0] > 2), part = lowAt((p) => p[0] < -2);
  assert(Math.abs(plate) < 1e-6, `over the plate the lowest point is ${plate.toFixed(3)}, expected 0`);
  assert(Math.abs(part - 5.2) < 1e-6, `over the part the lowest point is ${part.toFixed(3)}, expected 5.2`);
});
