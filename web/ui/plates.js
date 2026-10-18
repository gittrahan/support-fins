import { t } from './i18n.js';
/**
 * Plates: several in one tab, one model each, with its own pose, settings, drawn
 * walls, removed fins, undo, section cut and Suggest list -- the way a slicer's
 * plates hold separate jobs. All of them are on screen in a row (ui/plateview.js);
 * a click on one, there or on its tab, makes it the one being edited.
 *
 * Only that plate is live: every ui/ module still works on the one part. A switch
 * stashes the live part as it stands (part.js stashPart keeps the mesh and its weld;
 * history.js takeState its walls, removals, settings and pose) and brings the other
 * plate's back the way undo restores a state, so nothing is re-read or re-welded.
 * Several files imported at once go one to a plate (ui/io.js). A deleted plate or a
 * removed model is kept for a few seconds behind an Undo toast before it is freed.
 */
import { el } from './dom.js';
import { camera, controls, renderer } from './scene.js';
import { download } from '../stl.js';
import { zipStore } from '../zip.js';
import { part, partName, stashPart, unstashPart } from './part.js';
import { takeState, takeHistory, setHistory, restoreState, VIEWER_IDS } from './history.js';
import { scaleState, setScaleState } from './scale.js';
import { importState, setImportState } from './io.js';
import { activeAdded, buildPending } from './finbuild.js';
import { plate3MF } from './export.js';
import { sectionState, restoreSection } from './section.js';
import { suggestState, restoreSuggestions } from './suggest.js';
import { drawRow, ghostFins, parkMesh, pitch, plateAt, glide, frameAll } from './plateview.js';

// One entry per plate. `stash` holds a plate that is not being edited; the edited
// plate's is null (its state is the live one), and so is an empty plate's.
const plates = [{ stash: null }];
let active = 0;
// Export all is switching through the plates: the tabs and the row wait for it.
let busy = false;

/** Put the live plate's part and state away, leaving the page empty. */
function stashActive() {
  if (!part) { plates[active].stash = null; return; }
  // read before stashPart: it resets the history, scale, import note, cut and list
  const state = takeState(), history = takeHistory(), scale = scaleState(), imp = importState();
  const section = sectionState(), suggest = suggestState();
  const fins = ghostFins(activeAdded());
  const rec = stashPart();
  parkMesh(rec.mesh);
  plates[active].stash = { part: rec, fins, state, history, scale, imp, section, suggest };
}

/** Free what a stash holds (a deleted plate past its Undo). */
function dispose(s) {
  if (!s) return;
  s.part.mesh.removeFromParent();
  s.part.mesh.geometry.dispose();
  if (s.fins) { s.fins.removeFromParent(); s.fins.geometry.dispose(); }
}

/** Edit plate `i`, whose part is stashed (or which is empty); the page is empty. */
function show(i) {
  const s = plates[i].stash;
  active = i;
  if (s) {
    // The viewer's and the printer's settings (the nozzle, the layer view...) are not
    // the plate's: they stay as they are, as a saved session leaves them (history.js).
    const form = { ...s.state.form };
    for (const id of VIEWER_IDS) {
      const f = el(id);
      form[id] = f.type === 'checkbox' ? f.checked : f.value;
    }
    setImportState(s.imp);
    unstashPart(s.part);
    restoreState({ ...s.state, form });
    setHistory(s.history);
    setScaleState(s.scale);
    restoreSection(s.section);
    restoreSuggestions(s.suggest);
    if (s.fins) { s.fins.removeFromParent(); s.fins.geometry.dispose(); }
  }
  plates[i].stash = null;      // only once it is live: a throw above keeps the model
  render();
}

/** Switch to plate `i`; the camera glides along the row unless `quiet`. */
function go(i, quiet = false) {
  if (i === active || i < 0 || i >= plates.length) return;
  const fromPos = camera.position.clone(), fromTarget = controls.target.clone();
  const dx = (i - active) * pitch();
  stashActive();
  show(i);
  if (quiet) return;
  // the row slid by dx under the camera: start from the same view of it
  fromPos.x -= dx;
  fromTarget.x -= dx;
  glide(fromPos, fromTarget);
}

export function switchPlate(i) {
  if (!busy) go(i);
}

/** A new, empty plate, edited. */
export function addPlate() {
  if (busy) return;
  plates.push({ stash: null });
  go(plates.length - 1);
}

/** An import that should not replace a model: a new plate unless this one is empty. */
export function freePlate() {
  if (part) addPlate();
}

/** The plate being edited, for an import to come back to once its file is read. */
export const currentPlate = () => plates[active];

/** Edit `plate` again (a switch while its file was read). False when it was deleted
 *  meanwhile, or Export all is switching: the import then lands nowhere. */
export function returnTo(plate) {
  if (plates[active] === plate) return true;
  const i = plates.indexOf(plate);
  if (i < 0 || busy) return false;
  go(i);
  return true;
}

/** A multi-file import whose last file did not load leaves its new plate empty. */
export function dropEmptyPlate() {
  if (!part && plates.length > 1) {
    plates.splice(active, 1);
    show(Math.min(active, plates.length - 1));
  }
}

// ------------------------------------------------------------ delete, with Undo

let trash = null;      // { stash, plate, index, timer }: the last deletion, until it expires
const UNDO_MS = 10000;

function expire() {
  if (!trash) return;
  clearTimeout(trash.timer);
  dispose(trash.stash);
  trash = null;
  el('toast').hidden = true;
}

function trashed(stash, plate, index, text) {
  expire();
  if (!stash) return;            // an empty plate: nothing to bring back
  stash.part.mesh.removeFromParent();
  stash.fins?.removeFromParent();
  trash = { stash, plate, index, timer: setTimeout(expire, UNDO_MS) };
  el('toast-text').textContent = text;
  el('toast').hidden = false;
}

/** Remove model: the plate stays, empty; Undo puts the model back. */
function removeModel() {
  if (busy || !part) return;
  stashActive();
  const s = plates[active].stash;
  plates[active].stash = null;
  render();
  trashed(s, plates[active], active, t('Removed {name}', { name: s.part.name }));
}

function deletePlate(i) {
  if (busy) return;
  if (plates.length === 1) { removeModel(); return; }
  if (i === active) stashActive();
  const entry = plates[i];
  plates.splice(i, 1);
  if (i === active) {
    show(Math.min(i, plates.length - 1));
  } else {
    if (i < active) active--;
    render();
  }
  trashed(entry.stash, null, i, t('Deleted plate {n}', { n: i + 1 }));
}

/** Bring the last deletion back: to its plate if that is still there and empty,
 *  else as a new plate where it was. */
function undoDelete() {
  if (!trash || busy) return;
  const { stash, plate, index } = trash;
  clearTimeout(trash.timer);
  trash = null;
  el('toast').hidden = true;
  let i = plates.indexOf(plate);
  if (i < 0 || (i === active ? part : plates[i].stash)) {
    i = Math.min(index, plates.length);
    plates.splice(i, 0, { stash: null });
    if (i <= active) active++;
  }
  stashActive();
  plates[i].stash = stash;
  show(i);
}

el('toast-undo').addEventListener('click', undoDelete);
el('remove-part').addEventListener('click', removeModel);

// -------------------------------------------------------------------- export

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

/** Every plate's model as a 3MF, all in one .zip (one plate: the 3MF alone), then
 *  back to the plate being edited. */
export async function exportAll() {
  if (busy) return;
  busy = true;
  render();
  const back = active;
  const files = [];
  try {
    for (let i = 0; i < plates.length; i++) {
      go(i, true);
      if (!part) continue;
      // the switch starts a support build (in the worker): export what it builds
      await tick(0);
      while (buildPending()) await tick(50);
      const f = plate3MF();
      if (f) files.push({ name: `plate-${i + 1}-${f[1]}`, blob: f[0] });
    }
    go(back, true);
  } finally {
    busy = false;
    render();
  }
  if (files.length === 1) { download(files[0].blob, files[0].name); return; }
  if (!files.length) return;
  const entries = await Promise.all(files.map(async (f) =>
    ({ name: f.name, data: new Uint8Array(await f.blob.arrayBuffer()) })));
  const zip = zipStore(entries);
  download(new Blob([zip], { type: 'application/zip' }), 'support-fins-plates.zip');
}

// ------------------------------------------------------------- tabs and row

// A click (not a drag) on another plate in the view switches to it.
let downAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => {
  downAt = e.button === 0 ? [e.clientX, e.clientY] : null;
});
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt || busy || plates.length < 2) return;
  const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
  downAt = null;
  if (moved > 4) return;
  const i = plateAt(e, plates.length, active);
  if (i >= 0 && i !== active) go(i);
});

const stem = (name) => name.replace(/\.(stl|3mf|step|stp|obj)$/i, '');

function render() {
  const bar = el('plates');
  const tabs = plates.map((p, i) => {
    const name = i === active ? (part ? partName : '') : (p.stash?.part.name ?? '');
    const wrap = document.createElement('span');
    wrap.className = 'plate';
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'plate-tab';
    tab.setAttribute('aria-pressed', String(i === active));
    tab.title = name || t('Empty plate');
    const label = document.createElement('span');
    label.textContent = t('Plate {n}', { n: i + 1 });
    tab.append(label);
    if (name) {
      const sub = document.createElement('span');
      sub.className = 'plate-name';
      sub.textContent = stem(name);
      tab.append(sub);
    }
    tab.addEventListener('click', () => switchPlate(i));
    wrap.append(tab);
    // one empty plate has nothing to delete
    if (plates.length > 1 || name) {
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'plate-x';
      x.textContent = '×';
      x.title = x.ariaLabel = t('Delete plate {n}', { n: i + 1 });
      x.addEventListener('click', () => deletePlate(i));
      wrap.append(x);
    }
    return wrap;
  });
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'plate-add';
  add.textContent = '+';
  add.title = add.ariaLabel = t('Add a plate');
  add.addEventListener('click', addPlate);
  const all = document.createElement('button');
  all.type = 'button';
  all.className = 'plate-all';
  all.hidden = plates.length < 2;
  all.textContent = t('See all');
  all.title = t('Pull the view back to show every plate');
  all.addEventListener('click', () => frameAll(plates.length, active));
  bar.replaceChildren(...tabs, add, all);
  bar.inert = busy;
  el('export-all').hidden = plates.length < 2;
  drawRow(plates, active);
}

// A load, a rescale or Remove model changes the edited plate's name; a new build
// volume, every plate's size and spacing.
document.addEventListener('partchange', render);
document.addEventListener('buildvolumechange', render);
window.addEventListener('languagechange', render);
// Not at load: this module is in an import cycle (io -> plates -> part -> io), so
// part.js may not have run yet. Module scripts all run before DOMContentLoaded.
document.addEventListener('DOMContentLoaded', render);
