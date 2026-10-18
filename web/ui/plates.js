import { t } from './i18n.js';
/**
 * Plates: several in one tab, one model each, with its own pose, settings, drawn
 * walls, removed fins and undo -- the way a slicer's plates hold separate jobs.
 *
 * Only the showing plate is live: every ui/ module still works on the one part. A
 * switch stashes the live part as it stands (part.js stashPart keeps the mesh and
 * its weld; history.js takeState its walls, removals, settings and pose) and brings
 * the other plate's back the way undo restores a state, so nothing is re-read or
 * re-welded. Several files imported at once go one to a plate (ui/io.js).
 */
import { el } from './dom.js';
import { part, partName, stashPart, unstashPart, clearPart } from './part.js';
import { takeState, takeHistory, setHistory, restoreState, VIEWER_IDS } from './history.js';
import { scaleState, setScaleState } from './scale.js';
import { importState, setImportState } from './io.js';
import { buildPending } from './finbuild.js';
import { export3MF } from './export.js';

// One entry per plate. `stash` holds a plate that is not showing; the showing plate's
// is null (its state is the live one), and so is an empty plate's.
const plates = [{ stash: null }];
let active = 0;
// Export all is switching through the plates: the tabs wait for it (render, inert).
let busy = false;

/** Put the showing plate's part and state away, leaving the page empty. */
function stashActive() {
  if (!part) { plates[active].stash = null; return; }
  // read before stashPart: it resets the history, scale and import note
  const state = takeState(), history = takeHistory(), scale = scaleState(), imp = importState();
  plates[active].stash = { part: stashPart(), state, history, scale, imp };
}

/** Show plate `i`, whose part is stashed (or which is empty). */
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
  }
  plates[i].stash = null;      // only once it is live: a throw above keeps the model
  render();
}

function go(i) {
  if (i === active || i < 0 || i >= plates.length) return;
  stashActive();
  show(i);
}

export function switchPlate(i) {
  if (!busy) go(i);
}

/** A new, empty plate, shown. */
export function addPlate() {
  if (busy) return;
  stashActive();
  plates.push({ stash: null });
  active = plates.length - 1;
  render();
}

/** An import that should not replace a model: a new plate unless this one is empty. */
export function freePlate() {
  if (part) addPlate();
}

/** The plate showing, for an import to come back to once its file is read. */
export const currentPlate = () => plates[active];

/** Show `plate` again (a switch while its file was read). False when it was deleted
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
  if (!part && plates.length > 1) deletePlate(active);
}

function deletePlate(i) {
  if (busy) return;
  if (plates.length === 1) { clearPart(); return; }
  if (i === active) {
    clearPart();
    plates.splice(i, 1);
    show(Math.min(i, plates.length - 1));
    return;
  }
  plates[i].stash?.part.mesh.geometry.dispose();
  plates.splice(i, 1);
  if (i < active) active--;
  render();
}

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

/** Export every plate's model as its own 3MF, then come back to the plate showing. */
export async function exportAll() {
  if (busy) return;
  busy = true;
  render();
  const back = active;
  try {
    for (let i = 0; i < plates.length; i++) {
      go(i);
      if (!part) continue;
      // the switch starts a support build (in the worker): export what it builds
      await tick(0);
      while (buildPending()) await tick(50);
      export3MF();
    }
    go(back);
  } finally {
    busy = false;
    render();
  }
}

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
  bar.replaceChildren(...tabs, add);
  bar.inert = busy;
  el('export-all').hidden = plates.length < 2;
}

// A load, a rescale or Remove model changes the showing plate's name.
document.addEventListener('partchange', render);
window.addEventListener('languagechange', render);
// Not at load: this module is in an import cycle (io -> plates -> part -> io), so
// part.js may not have run yet. Module scripts all run before DOMContentLoaded.
document.addEventListener('DOMContentLoaded', render);
