/**
 * The tests' tine capture (globalThis.__TINECAP, see prop/tines.js) holds the tines
 * of the walls a build KEPT. The fill pass (fins/fill.js, fins/rows.js) builds a
 * candidate wall, tines and all, and may then drop it (it touches a support, holds no
 * new red, sits on a small hole). A wall built through `heldDrawnWall` takes its tines
 * out of the capture as it is built and carries them as `r.heldTines`; `restoreTines`
 * puts them back when the pass keeps the wall, so a dropped candidate never leaves
 * any. `heldCapture` / `keepTines` do the same for a whole pass built twice with one
 * build kept (the fill's rows vs patch lines).
 *
 * The capture is not only a test seam: judgeDownhill (fins/downhill.js) turns it on
 * around every Auto and Full build and compares the downhill and straight builds on
 * their lowest captured tine. So what the capture holds can move that choice; keeping
 * a dropped candidate's tine out of it makes the lowest tine the real one. With the
 * capture off (no judgeDownhill, no test), nothing here does anything.
 */
import { drawnWall } from '../draw.js';

/** drawnWall, its tines held out of the capture until `restoreTines(r)`. */
export function heldDrawnWall(a, b, tris, zBed, opts) {
  const cap = globalThis.__TINECAP;
  if (!cap) return drawnWall(a, b, tris, zBed, opts);
  const from = cap.length;
  const r = drawnWall(a, b, tris, zBed, opts);
  r.heldTines = cap.splice(from);
  return r;
}

/**
 * run() with the capture swapped for a scratch array: { value, tines }, the capture
 * itself untouched. For a pass built more than once with one build kept (the fill's
 * rows vs patch lines); `keepTines` puts the kept build's tines back.
 */
export function heldCapture(run) {
  const outer = globalThis.__TINECAP;
  if (!outer) return { value: run(), tines: [] };
  const mine = [];
  globalThis.__TINECAP = mine;
  try { return { value: run(), tines: mine }; } finally { globalThis.__TINECAP = outer; }
}

/** The kept build's tines (a heldCapture result) into the capture. */
export function keepTines(held) {
  const cap = globalThis.__TINECAP;
  if (cap) cap.push(...held.tines);
  return held.value;
}

/** One kept wall's tines (its `caps` range, prop/place.js) of a heldCapture build into the capture. */
export function keepSlice(held, caps) {
  const cap = globalThis.__TINECAP;
  if (cap && caps) cap.push(...held.tines.slice(caps[0], caps[1]));
}

/** A kept wall's tines back into the capture. */
export function restoreTines(r) {
  const cap = globalThis.__TINECAP;
  if (cap && r.heldTines) cap.push(...r.heldTines);
}
