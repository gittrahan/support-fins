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
  syncFinsToggleUI, syncAugmentUI,
} from './settings.js';
import { refreshFins } from './finbuild.js';
import { drawnWalls, setDrawnWalls, clearPreview, syncDrawControls } from './walls.js';
import { hideSuggestions } from './suggest.js';

// A whole-state snapshot stack, not a command log. The undoable state is small
// -- orientation, the hand-drawn walls, and every setting -- and restoring it re-runs
// the same shade + refreshFins the rest of the app already uses, so there is no
// separate inverse-operation path to keep correct. Every mutation calls histPush()
// first; undo/redo swap snapshots between the two stacks.
let undoStack = [];
let redoStack = [];

// EVERY SETTING is undoable too (Matthew: "every action should be redo-able"). The
// fields' own handlers apply them, so a restore writes the values back and fires the
// same events a hand edit would. `material` first: choosing one rewrites the gap and
// pad fields, which the snapshot then sets back on top. Not the build volume: that is
// the printer, saved across visits, not an edit to this part.
const FORM_IDS = ['material', 'thr', 'tines', 'tine-density', 'layer-height', 'gap',
  'bed-pad', 'pad-h', 'pad-gap', 'pad-grip', 'pad-margin', 'sway', 'sway-from',
  'sway-spacing', 'sway-depth', 'cutout', 'coverage', 'highlight-small', 'show-layers'];
const readForm = () => Object.fromEntries(FORM_IDS.map((id) => {
  const f = el(id);
  return [id, f.type === 'checkbox' ? f.checked : f.value];
}));
// The settings as of the last recorded state: a 'change' event fires AFTER the field
// already holds its new value, so the snapshot taken then needs the old ones.
let settled = readForm();
let restoring = false;

function snapshot() {
  const q = part.quaternion;
  return {
    quat: [q.x, q.y, q.z, q.w],
    walls: drawnWalls.map((w) => ({ kind: w.kind, face: w.face, a: w.a.clone(), b: w.b?.clone() })),
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
  // after the field's own handlers: choosing a material rewrites other fields
  queueMicrotask(() => { settled = readForm(); });
}, true);

/** A gesture that changes state over many events (a rotate-ring drag): take the
 *  snapshot when it starts, record it only if the gesture changed something. */
export const beginGesture = () => (part ? snapshot() : null);
export function commitGesture(s) {
  if (!s) return;
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

function restoreState(s) {
  restoreForm(s.form);
  part.quaternion.set(s.quat[0], s.quat[1], s.quat[2], s.quat[3]);
  setDrawnWalls(s.walls.map((w) => ({ kind: w.kind, face: w.face, a: w.a.clone(), b: w.b?.clone(),
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
  syncFinsToggleUI();
  syncAugmentUI();
  syncDrawControls();
  syncRemoveUI();
  setGizmo();
  el('rot-delta').textContent = '';
  hideSuggestions();
  shade();
  refreshFins();
  syncHistButtons();
}

export function undo() {
  if (!undoStack.length) return;
  redoStack.push(snapshot());
  restoreState(undoStack.pop());
}

export function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshot());
  restoreState(redoStack.pop());
}

function syncHistButtons() {
  el('undo').disabled = !undoStack.length;
  el('redo').disabled = !redoStack.length;
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
