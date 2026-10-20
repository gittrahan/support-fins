// MOVE TO ANOTHER PLATE (local issue 052): a model dragged across the row lands on
// the plate its middle is over, at the same spot on screen. Pinned here, on the pure
// row maths under the page glue (ui/move.js needs a DOM):
//   - over another plate's bed: that plate, the spot measured from its middle;
//   - over the plate being edited, the gap between beds or past the row: nothing.

import { WEB, assert } from './_util.js';

const { plateUnder } = await import(`${WEB}ui/platerow.js`);

// three 250 x 220 beds, 280 mm apart, the middle one edited
const under = (xy) => plateUnder(xy, 1, 3, 280, 250, 220);

Deno.test('plateUnder: over the next plate, its spot from that plate\'s middle', () => {
  const r = under([300.5, -40]);
  assert(r.plate === 2 && r.xy[0] === 20.5 && r.xy[1] === -40, JSON.stringify(r));
  const l = under([-280, 0]);
  assert(l.plate === 0 && l.xy[0] === 0, JSON.stringify(l));
});

Deno.test('plateUnder: the edited plate, a gap or past the row is nothing', () => {
  assert(under([100, 0]) === null, 'own plate');
  assert(under([140, 0]) === null, 'the gap between beds');
  assert(under([290, 115]) === null, 'off the next bed\'s far side');
  assert(under([560, 0]) === null, 'past the last plate');
});
