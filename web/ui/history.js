/**
 * Undo / redo.
 *
 * Restoring a snapshot writes each piece of state through its owner's setters
 * (walls.js, strength.js, settings.js, pose.js); history never assigns to them.
 */
import { el } from './dom.js';
import { controls } from './scene.js';
import { removedSigs, restoreRemovals, syncRemoveUI } from './remove.js';
import { loadDir, replaceLoadDir, updateLoadArrowMesh, syncLoadUI } from './strength.js';
import { setLayPlacing, setGizmo } from './pose.js';
import { part, shade } from './part.js';
import {
  finMode, finsVisible, drawAugment, setFinMode, setFinsVisible, setDrawAugment,
  syncFinsToggleUI, syncAugmentUI, syncCoverageUI, syncModeButtons,
} from './settings.js';
import { refreshFins } from './finbuild.js';
import { drawnWalls, setDrawnWalls, clearPreview, syncDrawControls } from './walls.js';
import { hideSuggestions } from './suggest.js';
// an export switching through the models (ui/plates.js locked) holds them still
import { isBusy } from './plates.js';
import { liveSlot, focusSlot } from './models.js';

// A whole-state snapshot stack, not a command log. The undoable state is small
// -- orientation, the hand-drawn walls, and every setting -- and restoring it re-runs
// the same shade + refreshFins the rest of the app already uses, so there is no
// separate inverse-operation path to keep correct. Every mutation calls histPush()
// first; undo/redo swap snapshots between the two stacks.
//
// One history per plate, across its models (ui/models.js): the settings are the
// plate's, so undoing a pose step on one model with each model's own history would
// have put back the gap it had then, undoing a later change made on another. A
// snapshot names its model (`who`, its slot); undo edits that model first, and a
// step whose model has been removed is passed over.
let undoStack = [];
let redoStack = [];

// EVERY SETTING is undoable too (Matthew: "every action should be redo-able"). The
// fields' own handlers apply them, so a restore writes the values back and fires the
// same events a hand edit would. Not the build volume: that is the printer, saved
// across visits, not an edit to this part.
const FORM_IDS = ['nozzle', 'thr', 'tines', 'tine-density', 'tine-dir', 'pin-depth', 'layer-height', 'gap',
  'bed-pad', 'pad-h', 'pad-gap', 'pad-grip', 'pad-margin', 'sway', 'sway-from',
  'sway-spacing', 'sway-depth', 'sway-cross-height', 'full-brace-depth', 'wall-lines', 'cutout', 'iface', 'coverage', 'plate-only', 'long-walls', 'tall-ribs', 'tall-ribs-height', 'curved-walls', 'highlight-small', 'show-islands', 'show-layers',
  'show-rings', 'nav-preset'];
const readForm = () => Object.fromEntries(FORM_IDS.map((id) => {
  const f = el(id);
  return [id, f.type === 'checkbox' ? f.checked : f.value];
}));
// The settings as of the last recorded state: a 'change' event fires AFTER the field
// already holds its new value, so the snapshot taken then needs the old ones.
let settled = readForm();
let restoring = false;

// Not this part's settings but the viewer's own (how it is drawn, the mouse) or the
// printer's (the nozzle): a session saved in a 3MF (ui/session.js) neither saves them
// nor, from an older file that has them, applies them. Layer height and support gap
// are remembered across visits too, but a session keeps them: it comes back as it was
// left, and the removed fins it lists are matched by heights the gap shifts (remove.js).
export const VIEWER_IDS = new Set(['highlight-small', 'show-islands', 'show-layers', 'show-rings', 'nav-preset', 'nozzle']);
/** The settings a support build follows, as one string: a parked model's fins built
 *  under another are out of date (ui/parkedbuild.js). The nozzle counts; how the
 *  viewer draws does not. */
export const settingsKey = () => JSON.stringify([Object.entries(readForm())
  .filter(([id]) => id === 'nozzle' || !VIEWER_IDS.has(id)), finMode, finsVisible]);

/** The part's settings as they stand, for a saved session. */
export const sessionForm = () => Object.fromEntries(Object.entries(settled).filter(([id]) => !VIEWER_IDS.has(id)));

function snapshot() {
  const q = part.quaternion;
  return {
    who: liveSlot(),
    quat: [q.x, q.y, q.z, q.w],
    walls: drawnWalls.map((w) => ({ kind: w.kind, face: w.face, capped: w.capped, a: w.a.clone(), b: w.b?.clone() })),
    load: loadDir ? loadDir.clone() : null,
    finMode, finsVisible, drawAugment,
    removedSigs: [...removedSigs],
    form: { ...settled },
  };
}

/** A setting edited by hand: one undo step, holding the values from before it (a
 *  slider fires 'change' once, on release, so a drag is one step). */
document.addEventListener('change', (e) => {
  if (restoring || !FORM_IDS.includes(e.target?.id)) return;
  histPush();
}, true);
// ...and the values to compare the NEXT edit against, read once the field's own
// handlers have run (bubbling up to window comes after them), in case a handler
// rewrites other fields. Not a microtask -- a real event runs microtasks between
// listeners, before the field's own handler.
addEventListener('change', (e) => {
  if (restoring || !FORM_IDS.includes(e.target?.id)) return;
  settled = readForm();
});

/** A gesture that changes state over many events (a rotate-ring drag): take the
 *  snapshot when it starts, record it only if the gesture changed something. */
let gesture = false;     // a gesture is open: undo/redo wait for it
export const beginGesture = () => { gesture = true; return part ? snapshot() : null; };
/** End the gesture; `s` (its start snapshot) is recorded when it changed something. */
export function commitGesture(s, changed) {
  gesture = false;
  if (!s || !changed) return;
  undoStack.push(s);
  if (undoStack.length > 100) undoStack.shift();
  redoStack.length = 0;
  syncHistButtons();
}

/** Capture state BEFORE a mutation. A fresh action invalidates the redo stack. */
export function histPush() {
  if (!part) return;
  undoStack.push(snapshot());
  if (undoStack.length > 100) undoStack.shift();
  redoStack.length = 0;
  syncHistButtons();
}

/** Write a snapshot's settings back through the fields' own handlers. */
function restoreForm(form) {
  if (!form) return;
  restoring = true;
  try {
    for (const id of FORM_IDS) {
      const f = el(id), v = form[id];
      if (v === undefined) continue;
      if (f.type === 'checkbox' ? f.checked === v : f.value === v) continue;
      if (f.type === 'checkbox') f.checked = v; else f.value = v;
      f.dispatchEvent(new Event('input', { bubbles: true }));
      f.dispatchEvent(new Event('change', { bubbles: true }));
    }
  } finally {
    restoring = false;
    settled = readForm();
  }
}

/** Apply a whole state, as undo does (ui/session.js builds one from a saved 3MF). */
export function restoreState(s) {
  part.quaternion.set(s.quat[0], s.quat[1], s.quat[2], s.quat[3]);
  setDrawnWalls(s.walls.map((w) => ({ kind: w.kind, face: w.face, capped: w.capped, a: w.a.clone(), b: w.b?.clone(),
                                       ok: false, info: null })));
  replaceLoadDir(s.load ? s.load.clone() : null);
  restoreRemovals(s.removedSigs);
  setLayPlacing(false);
  controls.enabled = true;
  updateLoadArrowMesh();
  syncLoadUI();
  setFinMode(s.finMode);
  setFinsVisible(s.finsVisible);
  setDrawAugment(s.drawAugment ?? false);
  clearPreview();         // also drops a wall-in-progress (drawStart)
  // Re-sync every control that mirrors the restored state, then rebuild the
  // scene the same way a normal edit would.
  el('fin-mode').value = finMode;
  syncModeButtons();
  syncCoverageUI();       // the slider follows the restored mode (hidden in Draw, disabled in Full)
  syncFinsToggleUI();
  syncAugmentUI();
  syncDrawControls();
  syncRemoveUI();
  setGizmo();
  el('rot-delta').textContent = '';
  hideSuggestions();
  // settings last, so the builds their handlers start already see the restored pose
  restoreForm(s.form);
  shade();
  refreshFins();
  syncHistButtons();
}

/** Step back along `from`, pushing the state it leaves onto `to`: edit the step's
 *  model first, passing over the steps of models no longer on the plate. */
function step(from, to) {
  if (gesture || isBusy()) return;
  while (from.length) {
    const s = from[from.length - 1];
    if (s.who && !focusSlot(s.who)) { from.pop(); continue; }
    from.pop();
    to.push(snapshot());
    restoreState(s);
    return;
  }
  syncHistButtons();
}

export const undo = () => step(undoStack, redoStack);
export const redo = () => step(redoStack, undoStack);

function syncHistButtons() {
  el('undo').disabled = !undoStack.length;
  el('redo').disabled = !redoStack.length;
}

/** The whole state, kept with a model that is not showing, and its plate's undo /
 *  redo (ui/models.js), put back by restoreState + setHistory when it shows again. */
export const takeState = () => snapshot();
export const takeHistory = () => ({ undo: undoStack, redo: redoStack });
export function setHistory(h) {
  undoStack = h.undo;
  redoStack = h.redo;
  settled = readForm();
  syncHistButtons();
}

/** A new part: undo history does not carry across parts. */
export function resetHistory() {
  undoStack = [];
  redoStack = [];
  settled = readForm();
  syncHistButtons();
}

el('undo').addEventListener('click', undo);
el('redo').addEventListener('click', redo);
