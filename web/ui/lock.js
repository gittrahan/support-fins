/**
 * THE BUILD LOCK: while a live Full coverage build runs (ui/livebuild.js), nothing
 * that would change it can be touched -- the settings, the part's pose, the plates,
 * undo -- and the view stays free: orbit, zoom, the View and Section tools.
 * Matthew 2026-11-04: "not lock the UI except don't let them change key settings but
 * maybe they can rotate the view and stuff (not the part)".
 *
 * Locked regions go `inert` (no clicks, no focus); a key guard, registered before
 * any other (app.js imports this module first), keeps shortcuts (undo, M for Move,
 * Delete) from reaching their handlers. It doesn't preventDefault: the browser's own
 * keys still work. Modules with a pointer mode on the canvas (the rotate rings, Move,
 * Lay a face flat, Remove) drop it through onLockChange.
 *
 * No imports: everything else imports this.
 */

/** The regions a live build locks: the top bar, the settings, the plates, the model
 *  card and the pose / history tools. Not the View or Section tools. */
export const LOCKED_IDS = ['topbar', 'fin-opts', 'plates', 'stats', 'undo', 'redo', 'move-badge', 'arrange-btn',
  'rotate-badge', 'rotate-pop', 'scale-badge', 'scale-pop', 'suggest-badge', 'suggest-pop',
  'strength-badge', 'strength-pop'];

/** Keys a locked page still takes: focus moves, Escape (folds menus), Shift (snap). */
const PASS = new Set(['Tab', 'Escape', 'Shift']);

let locked = false;
const listeners = [];

export const uiLocked = () => locked;

/** fn(locked) on every change. */
export function onLockChange(fn) { listeners.push(fn); }

export function setLocked(v) {
  v = !!v;
  if (v === locked) return;
  locked = v;
  for (const id of LOCKED_IDS) {
    const node = document.getElementById(id);
    if (node) node.inert = v;
  }
  document.body.classList.toggle('build-locked', v);
  for (const fn of listeners) fn(v);
}

if (typeof addEventListener === 'function') {
  addEventListener('keydown', (e) => {
    // (a focused field is in a free region -- an inert one can't take focus -- so the
    // Section tool's fields still type)
    const field = ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target?.tagName);
    if (locked && !PASS.has(e.key) && !field) e.stopImmediatePropagation();
  }, true);
}
