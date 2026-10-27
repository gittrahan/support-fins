// web/ui/rest.js: the Sway brace ghost is built once the cursor rests, not per move.

import { assert } from './_util.js';

const { onRest } = await import(new URL('../web/ui/rest.js', import.meta.url).href);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

Deno.test('rest: a burst of moves runs once, with the last target, after the pause', async () => {
  const seen = [];
  const r = onRest((t) => seen.push(t), 30);
  for (let i = 0; i < 6; i++) { r.poke(i); await sleep(8); }   // faster than the pause: nothing yet
  assert(seen.length === 0 && r.pending, 'ran while the cursor was still moving');
  await sleep(60);
  assert(seen.length === 1 && seen[0] === 5, `want one run on the last target, got ${JSON.stringify(seen)}`);
  assert(!r.pending, 'still pending after it ran');
});

Deno.test('rest: cancel drops the pending run (a click, leaving the part)', async () => {
  const seen = [];
  const r = onRest((t) => seen.push(t), 20);
  r.poke('a'); r.cancel();
  await sleep(50);
  assert(seen.length === 0 && !r.pending, 'a cancelled run still fired');
  r.poke('b');
  await sleep(50);
  assert(seen.length === 1 && seen[0] === 'b', 'poke after cancel should run again');
});
