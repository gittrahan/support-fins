import { BuildActivity } from '../web/build-activity.js';
import { assert } from './_util.js';

function clock() {
  let next = 0;
  const jobs = new Map(), shown = [];
  const activity = new BuildActivity((v) => shown.push(v),
    (fn) => { jobs.set(++next, fn); return next; }, (id) => jobs.delete(id));
  return { activity, shown, tick: () => { for (const [id, fn] of jobs) { jobs.delete(id); fn(); } } };
}

Deno.test('background notice: a finished pad does not hide a still-running manual fin', () => {
  const { activity, shown, tick } = clock();
  activity.set('auto', true); tick();
  activity.set('draw', true); activity.set('auto', false);
  assert(shown.join() === 'true', 'pad completion hid manual work');
  activity.set('draw', false);
  assert(shown.join() === 'true,false', 'completion left the notice stuck');
});

Deno.test('background notice: quick cancellation never flashes, failure clears the current stage', () => {
  const { activity, shown, tick } = clock();
  activity.set('preview', true); activity.set('preview', false); tick();
  assert(!shown.length, 'a cancelled preview flashed a notice');
  activity.set('draw', true); tick();
  activity.set('draw', true); // Newest request replaces the previous build.
  activity.set('draw', false); tick(); // Failure also releases the stage.
  assert(shown.join() === 'true,false');
  assert(!activity.pending.size);
});

Deno.test('background notice: queued settings hand over to the build without a gap', () => {
  const { activity, shown, tick } = clock();
  activity.set('settings', true); tick();
  activity.set('draw', true); activity.set('settings', false);
  assert(shown.join() === 'true');
  activity.set('draw', false);
  assert(shown.join() === 'true,false');
});
