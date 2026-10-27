/**
 * "Run this once the pointer has rested." A hover preview that costs tens of ms (the
 * Sway brace ghost builds a whole brace per new spot) would stall every frame of a
 * sweep across a face if it ran per move. poke() records the latest target and
 * restarts a short timer; `fn` runs once with that target when no poke has come for
 * `ms`. cancel() drops a pending run (a click, the pointer leaving the part).
 */
export const REST_MS = 80;

export function onRest(fn, ms = REST_MS) {
  let timer = 0, latest = null;
  return {
    poke(target) {
      latest = target;
      clearTimeout(timer);
      timer = setTimeout(() => { timer = 0; const t = latest; latest = null; fn(t); }, ms);
    },
    cancel() { clearTimeout(timer); timer = 0; latest = null; },
    get pending() { return timer !== 0; },
  };
}
