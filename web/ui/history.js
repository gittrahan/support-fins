/**
 * Undo / redo.
 *
 * Until the walls, load arrow and modes have their own modules, their state
 * lives in app.js and restoring a snapshot writes it through app.js setters.
 */
import { el } from './dom.js';
import { controls } from './scene.js';
import { removedSigs, restoreRemovals, syncRemoveUI } from './remove.js';
import { loadDir, replaceLoadDir, updateLoadArrowMesh, syncLoadUI } from './strength.js';
import {
  part, drawnWalls, finMode, finsVisible, drawAugment,
  setDrawnWalls, setLayPlacing, setFinMode, setFinsVisible, setDrawAugment,
  clearPreview, syncFinsToggleUI, syncAugmentUI,
  syncDrawControls, setGizmo, shade, refreshFins,
} from '../app.js';
import { hideSuggestions } from './suggest.js';

// A whole-state snapshot stack, not a command log. The undoable state is small
// -- orientation plus the hand-drawn walls -- and restoring it re-runs the same
// shade + refreshFins the rest of the app already uses, so there is no separate
// inverse-operation path to keep correct. Every mutation calls histPush() first;
// undo/redo swap snapshots between the two stacks.
let undoStack = [];
let redoStack = [];

function snapshot() {
  const q = part.quaternion;
  return {
    quat: [q.x, q.y, q.z, q.w],
    walls: drawnWalls.map((w) => ({ kind: w.kind, face: w.face, a: w.a.clone(), b: w.b?.clone() })),
    load: loadDir ? loadDir.clone() : null,
    finMode, finsVisible, drawAugment,
    removedSigs: [...removedSigs],
  };
}

/** Capture state BEFORE a mutation. A fresh action invalidates the redo stack. */
export function histPush() {
  if (!part) return;
  undoStack.push(snapshot());
  if (undoStack.length > 100) undoStack.shift();
  redoStack.length = 0;
  syncHistButtons();
}

function restoreState(s) {
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
  syncHistButtons();
}

el('undo').addEventListener('click', undo);
el('redo').addEventListener('click', redo);
