/**
 * The tests' tine capture (globalThis.__TINECAP, see prop/tines.js) holds the tines
 * of the walls a build KEPT. The fill pass (fins/fill.js, fins/rows.js) builds a
 * candidate wall, tines and all, and may then drop it (it touches a support, holds no
 * new red, sits on a small hole). A wall built through `heldDrawnWall` takes its tines
 * out of the capture as it is built and carries them as `r.heldTines`; `restoreTines`
 * puts them back when the pass keeps the wall, so a dropped candidate never leaves
 * any. With the capture off (the app), nothing here does anything.
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

/** A kept wall's tines back into the capture. */
export function restoreTines(r) {
  const cap = globalThis.__TINECAP;
  if (cap && r.heldTines) cap.push(...r.heldTines);
}
