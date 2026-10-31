// Draw's shapes (web/ui/drawshape.js, used by ui/walls.js): each one's clicks in order,
// and switching Line -> Curve -> Gusset -> Stabilizer and back leaves every shape working -- nothing
// half drawn as one shape is finished by a click in another.

import { assert } from './_util.js';

const { DRAW_SHAPES, shapeOr, clickStep } = await import('../web/ui/drawshape.js');

/** Draw as ui/walls.js does: picking a shape drops what was half drawn (clearPreview),
 *  a click takes the step clickStep names. Returns the steps the clicks took. */
function session() {
  let shape = 'line', wip = { start: null, end: null, side: null };
  const steps = [];
  return {
    pick(s) { const next = shapeOr(s); if (next !== shape) { shape = next; wip = { start: null, end: null, side: null }; } },
    click(face = 7) {
      const step = clickStep(shape, wip);
      steps.push(step);
      if (step === 'start') wip = { ...wip, start: {} };
      else if (step === 'end') wip = { ...wip, end: {} };
      else if (step === 'side') wip = { start: {}, end: null, side: face };
      else wip = { start: null, end: null, side: null };   // placed
    },
    steps,
  };
}

const CLICKS = { line: ['start', 'place'], curve: ['start', 'end', 'place'], gusset: ['side', 'reach'], stabilizer: ['stand'] };

Deno.test('draw shapes: each shape takes its own clicks', () => {
  for (const shape of DRAW_SHAPES) {
    const d = session();
    d.pick(shape);
    for (let i = 0; i < CLICKS[shape].length * 2; i++) d.click();
    assert(d.steps.join() === [...CLICKS[shape], ...CLICKS[shape]].join(), `${shape}: ${d.steps.join()}`);
  }
  // face 0 is a face: a gusset on the part's first triangle still takes its reach
  const d = session();
  d.pick('gusset');
  d.click(0);
  d.click();
  assert(d.steps.join() === 'side,reach', `gusset off face 0: ${d.steps.join()}`);
});

Deno.test('draw shapes: switching mid-wall, in every order and back, starts the new shape afresh', () => {
  for (const a of DRAW_SHAPES) {
    for (const b of DRAW_SHAPES) {
      if (a === b) continue;
      const d = session();
      d.pick(a);
      d.click();               // half drawn as `a`
      d.pick(b);
      for (let i = 0; i < CLICKS[b].length; i++) d.click();
      d.pick(a);               // ...and back
      for (let i = 0; i < CLICKS[a].length; i++) d.click();
      const want = [CLICKS[a][0], ...CLICKS[b], ...CLICKS[a]].join();
      assert(d.steps.join() === want, `${a} -> ${b} -> ${a}: ${d.steps.join()}, want ${want}`);
    }
  }
  // the one that would go wrong: a gusset's side, then Line -- the next click starts a
  // wall rather than placing one from the gusset's side point
  assert(clickStep('line', { start: {}, end: null, side: 3 }) === 'place', 'test setup');
  const d = session();
  d.pick('gusset');
  d.click();
  d.pick('line');
  d.click();
  assert(d.steps.join() === 'side,start', `gusset side then Line: ${d.steps.join()}`);
});

Deno.test('draw shapes: a remembered shape this version doesn’t know is Line', () => {
  for (const s of DRAW_SHAPES) assert(shapeOr(s) === s, s);
  for (const s of [null, undefined, '', 'arc', 'Gusset']) assert(shapeOr(s) === 'line', String(s));
});

Deno.test('draw shapes: the page drops what was half drawn when the shape changes', async () => {
  // session() above stands in for ui/walls.js, which needs a page: pin the two lines
  // of it the walk relies on
  const src = await Deno.readTextFile(new URL('../web/ui/walls.js', import.meta.url));
  assert(/drawStart = drawEnd = drawFace = null;/.test(src), 'clearPreview no longer drops all three of a wall’s clicks');
  const handler = src.slice(src.indexOf("for (const b of el('draw-shape')"), src.indexOf("el('draw-back').addEventListener"));
  assert(/drawShape = shapeOr\(b\.dataset\.shape\);[\s\S]*clearPreview\(\);/.test(handler), 'picking a shape no longer clears the wall in progress');
  assert(/clickStep\(drawShape, \{ start: drawStart, end: drawEnd, side: drawFace \}\)/.test(src), 'drawClick no longer asks clickStep');
});
