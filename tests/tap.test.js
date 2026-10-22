// Tap vs drag on the canvas (#372, phones): a finger's tap wanders more than a
// mouse click, and a pinch is never a tap, whichever finger lifts first.
import { tapTracker, slop } from '../web/ui/tap.js';
import { assert } from './_util.js';

Deno.test('tap: a mouse keeps the 4 px click, a finger gets 10', () => {
  const t = tapTracker();
  t.press(1, 100, 100);
  assert(t.isTap(1, 103, 102, 'mouse'), 'a 3.6 px mouse click is a click');
  assert(!t.isTap(1, 105, 105, 'mouse'), 'a 7 px mouse move is a drag');
  assert(t.isTap(1, 105, 105, 'touch'), 'a 7 px finger tap is a tap');
  assert(!t.isTap(1, 112, 100, 'touch'), 'a 12 px finger move is a drag');
  assert(slop('pen') === 4, 'a pen keeps the mouse slop');
});

Deno.test('tap: no finger of a pinch is a tap, in either lift order', () => {
  for (const firstUp of [1, 2]) {
    const t = tapTracker();
    t.press(1, 100, 100);
    t.press(2, 200, 200);           // the second finger lands and holds still
    const other = firstUp === 1 ? 2 : 1;
    const at = (id) => (id === 1 ? 100 : 200);   // each finger lifts where it landed
    assert(!t.isTap(firstUp, at(firstUp), at(firstUp), 'touch'), `finger ${firstUp} lifting first read as a tap`);
    t.release(firstUp);
    assert(!t.isTap(other, at(other), at(other), 'touch'), `finger ${other} lifting last read as a tap`);
    t.release(other);
  }
});

Deno.test('tap: a fresh press after a pinch is a tap again; unknown pointers are not', () => {
  const t = tapTracker();
  t.press(1, 0, 0); t.press(2, 50, 50); t.release(1); t.release(2);
  t.press(3, 10, 10);
  assert(t.isTap(3, 12, 11, 'touch'), 'a lone tap after a pinch');
  assert(!t.isTap(9, 0, 0, 'touch'), 'a pointerup with no press here (it started off the canvas)');
});
