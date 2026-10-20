// FOOTPRINTS + ARRANGE (local issue 052 PR 4): several models on one plate must not
// collide, and Arrange packs them. Pinned here, on the pure grid code under the page
// glue (ui/arrange.js needs a DOM):
//   - a footprint covers every cell a triangle touches, slivers and edges included,
//     and nothing a box would but the shape does not (an L's inner corner is free);
//   - two models touching share a cell; one standing in an L's corner shares none;
//   - off the millimetre grid a footprint widens, so a 0.3 mm gap still warns;
//   - pack keeps every model on the bed and `gap` mm clear of the others, and says
//     null for one there is no room for.

import { WEB, assert } from './_util.js';

const fp = await import(`${WEB}ui/footprint.js`);

// a flat box's two top triangles, x0..x1 by y0..y1 (z matters not)
const box = (x0, y0, x1, y1) => [
  x0, y0, 1, x1, y0, 1, x1, y1, 1,
  x0, y0, 1, x1, y1, 1, x0, y1, 1,
];
const cells = (g) => fp.area(g);

Deno.test('rasterize: a 10 x 4 box covers 10 x 4 cells, no more', () => {
  const g = fp.rasterize(box(0, 0, 10, 4));
  // the far edges sit on cell lines: the cells past them are touched at the line
  assert(cells(g) >= 40 && cells(g) <= 11 * 5, `got ${cells(g)}`);
  const h = fp.rasterize(box(0.2, 0.2, 9.8, 3.8));
  assert(cells(h) === 40, `inside the lines: ${cells(h)}`);
});

Deno.test('rasterize: a thin diagonal sliver still marks its cells', () => {
  // a wall seen from above: a near-zero-width triangle from (0.5,0.5) to (20.5,10.5)
  const g = fp.rasterize([0.5, 0.5, 0, 20.5, 10.5, 0, 20.5, 10.5, 5]);
  assert(cells(g) >= 21, `a 20 mm diagonal crosses at least 21 cells, got ${cells(g)}`);
  // and leaves the far corners of its box alone
  const at = (x, y) => g.bits[(y - g.y0) * g.w + x - g.x0];
  assert(!at(20, 0) && !at(0, 10), 'box corners away from the line stay free');
});

Deno.test('rasterize: a matrix moves the vertices first', () => {
  const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 30, -5, 0, 1];   // translate (30,-5)
  const g = fp.rasterize(box(0.2, 0.2, 2.8, 2.8), m);
  assert(g.x0 === 30 && g.y0 === -5 && g.w === 3 && g.h === 3, JSON.stringify([g.x0, g.y0, g.w, g.h]));
});

// an L: 30 x 10 along X plus 10 x 30 up Y, its inner corner (10..30, 10..30) empty
const L = () => fp.union(fp.rasterize(box(0.2, 0.2, 29.8, 9.8)), fp.rasterize(box(0.2, 0.2, 9.8, 29.8)));

Deno.test('shared: a cube in an L\'s corner is clear; the boxes would clash', () => {
  const cube = fp.rasterize(box(0.2, 0.2, 9.8, 9.8));
  const inCorner = fp.placed(cube, [15, 15]);
  assert(fp.shared(fp.placed(L(), [0, 0]), inCorner).length === 0, 'no shared cell');
  const touching = fp.placed(cube, [5, 5]);
  assert(fp.shared(fp.placed(L(), [0, 0]), touching).length > 0, 'overlapping shares cells');
});

Deno.test('placed: off the mm grid a footprint widens, never narrows', () => {
  const cube = fp.rasterize(box(0.2, 0.2, 9.8, 9.8));   // 10 cells wide
  const a = fp.placed(cube, [0, 0]);
  // 0.3 mm off a whole-mm gap of 0: still the neighbouring cell
  const b = fp.placed(cube, [10.3, 0]);
  assert(b.w === 11 && b.x0 === 10, `widened to ${b.w} from ${b.x0}`);
  assert(fp.shared(a, fp.placed(cube, [9.7, 0])).length > 0, 'a 0.3 mm overlap warns');
  assert(fp.shared(a, fp.placed(cube, [11, 0])).length === 0, 'a 1 mm gap on the grid is clear');
});

Deno.test('dilate: grows by r every way', () => {
  const g = fp.dilate(fp.rasterize(box(0.2, 0.2, 0.8, 0.8)), 3);
  assert(g.w === 7 && g.h === 7 && cells(g) === 49, `${g.w}x${g.h} ${cells(g)}`);
});

Deno.test('pack: five models on a 180 bed, all on it, 10 mm clear of each other', () => {
  const grids = [
    fp.rasterize(box(-20, -20, 20, 20)),
    L(),
    fp.rasterize(box(-30, -5, 30, 5)),
    fp.rasterize(box(-8, -8, 8, 8)),
    fp.rasterize(box(-25, -12, 25, 12)),
  ];
  const at = fp.pack(grids, 180, 180, 10);
  assert(at.every(Boolean), 'room for all');
  const placed = grids.map((g, k) => fp.placed(g, at[k]));
  for (const p of placed) {
    assert(p.x0 >= -90 && p.x0 + p.w <= 90 && p.y0 >= -90 && p.y0 + p.h <= 90, 'on the bed');
  }
  for (let a = 0; a < placed.length; a++) {
    for (let b = a + 1; b < placed.length; b++) {
      // 10 cells of growth on one still leaves them clear: 10 empty cells between
      assert(fp.shared(fp.dilate(placed[a], 10), placed[b]).length === 0, `models ${a},${b} too close`);
    }
  }
  // the biggest takes the middle
  const big = placed[0];
  assert(Math.abs(big.x0 + big.w / 2) <= 1 && Math.abs(big.y0 + big.h / 2) <= 1, 'biggest at the centre');
});

Deno.test('pack: a model the bed has no room left for gets null', () => {
  const g = fp.rasterize(box(-40, -40, 40, 40));
  const at = fp.pack([g, g, g], 100, 100, 10);
  assert(at.filter(Boolean).length === 1, JSON.stringify(at));
  assert(fp.pack([fp.rasterize(box(0, 0, 120, 5))], 100, 100, 10)[0] === null, 'too big for the bed');
});

Deno.test('findSpot: beside what is taken, gap kept', () => {
  const bed = fp.bedGrid(200, 200);
  const g = fp.rasterize(box(-10, -10, 10, 10));
  fp.take(bed, fp.placed(g, [0, 0]));
  const at = fp.findSpot(bed, g, 10);
  assert(at, 'found one');
  assert(fp.shared(fp.dilate(fp.placed(g, [0, 0]), 10), fp.placed(g, at)).length === 0, 'kept clear');
  assert(Math.hypot(...at) <= 33, `near the middle: ${at}`);
});
