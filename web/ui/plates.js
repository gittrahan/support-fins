import { t } from './i18n.js';
/**
 * Plates: several in one tab, each with its models (ui/models.js), its fin settings
 * and its undo, and each model with its own pose, drawn walls, removed fins, section
 * cut and Suggest list -- the way a slicer's plates hold separate jobs. All of them are on
 * screen in a row (ui/plateview.js); a click on one, there or on its tab, makes it
 * the one being edited.
 *
 * Only one model is live: every ui/ module still works on the one part. A switch
 * parks the live model as it stands and brings the other plate's back the way undo
 * restores a state, so nothing is re-read or re-welded (models.js park / unpark).
 * Several files imported at once go one to a plate (ui/io.js). A deleted plate or a
 * removed model is kept for a few seconds behind an Undo toast before it is freed.
 */
import { el } from './dom.js';
import { camera, controls, renderer } from './scene.js';
import { download } from '../stl.js';
import { zipStore } from '../zip.js';
import { checkOverlap } from './arrange.js';
import { part, partName } from './part.js';
import { buildPending, finMesh, padMesh } from './finbuild.js';
import { drawnMesh } from './walls.js';
import { plate3MF, plate3MFLive, plateGeometry, plateReady, whileWaiting } from './export.js';
import { parkedSettled } from './parkedbuild.js';
import { sectionPick } from './section.js';
import { slot, liveXY, park, unpark, disposeSlot, select, takeLive, putBack } from './models.js';
import { drawRow, pitch, plateAt, glide, frameAll } from './plateview.js';
import { watchTaps } from './tap.js';

// One entry per plate: its model slots (models.js) and which of them is live -- or,
// on a plate not being edited, which comes back live when it is -- and, kept when
// its live model parks, its settings and undo history (null until then).
const newPlate = () => ({ models: [slot()], live: 0, settings: null, history: null });
const plates = [newPlate()];
let active = 0;
// Export is switching through the plates or models: the tabs and the row wait for it.
let busy = false;

export const isBusy = () => busy;

/** Run `fn` with the plates held still (an export switching through them); null
 *  when they already are. */
export async function locked(fn) {
  if (busy) return null;
  busy = true;
  render();
  try {
    return await fn();
  } finally {
    busy = false;
    render();
  }
}

/** Put the live model and its state away, leaving the page empty. */
const stashActive = () => park(plates[active]);

/** Edit plate `i`, whose models are parked (or which is empty); the page is empty. */
function show(i) {
  active = i;
  unpark(plates[i]);
  render();
}

/** Switch to plate `i`; the camera glides along the row unless `quiet`. */
function go(i, quiet = false) {
  if (i === active || i < 0 || i >= plates.length) return;
  const from = liveXY();
  stashActive();
  arrive(i, from, quiet);
}

/** Edit plate `i`, the one being edited already stashed, its live model having stood
 *  at `from`: the camera keeps its view of the row, then glides unless `quiet`. */
function arrive(i, from, quiet) {
  const fromPos = camera.position.clone(), fromTarget = controls.target.clone();
  const dx = (i - active) * pitch();
  show(i);
  if (quiet) return;
  // the row slid under the camera by the plates' spacing and the two live models'
  // spots: start from the same view of it
  const to = liveXY();
  fromPos.x -= dx + to[0] - from[0];
  fromTarget.x -= dx + to[0] - from[0];
  fromPos.y -= to[1] - from[1];
  fromTarget.y -= to[1] - from[1];
  glide(fromPos, fromTarget);
}

export function switchPlate(i) {
  if (!busy) go(i);
}

/** A new, empty plate, edited. */
export function addPlate() {
  if (busy) return;
  plates.push(newPlate());
  go(plates.length - 1);
}

/** An import that should not replace a model: a new plate unless this one is empty. */
export function freePlate() {
  if (part) addPlate();
}

/** The plate being edited, for an import to come back to once its file is read. */
export const currentPlate = () => plates[active];

/** How many plates the row has, and which of them is being edited. */
export const plateCount = () => plates.length;
export const activePlate = () => active;

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
  if (!part && plates.length > 1 && plates[active].models.length === 1) {
    plates.splice(active, 1);
    show(Math.min(active, plates.length - 1));
  }
}

// ------------------------------------------------------------ delete, with Undo

// { slots, plate, index, own, timer }: the last removal, until it expires; `own`, a
// deleted plate's settings and history, for an Undo that has to make it again
let trash = null;
const UNDO_MS = 10000;

function expire() {
  if (moved) { clearTimeout(moved.timer); moved = null; el('toast').hidden = true; }
  if (!trash) return;
  clearTimeout(trash.timer);
  trash.slots.forEach(disposeSlot);
  trash = null;
  el('toast').hidden = true;
}

function trashed(slots, plate, index, text, own = null) {
  if (!slots.length) return;     // an empty plate: nothing to bring back (the last Undo stays)
  expire();
  for (const m of slots) {
    m.stash.part.mesh.removeFromParent();
    m.stash.fins?.removeFromParent();
  }
  trash = { slots, plate, index, own, timer: setTimeout(expire, UNDO_MS) };
  el('toast-text').textContent = text;
  el('toast').hidden = false;
}

const removedText = (slots) => (slots.length === 1
  ? t('Removed {name}', { name: slots[0].stash.part.name })
  : t('Removed {n} models', { n: slots.length }));

/** Remove model: the live one goes, the plate stays (empty, with no other); Undo
 *  puts the model back. */
function removeModel() {
  if (busy || !part) return;
  const plate = plates[active];
  const m = takeLive();
  render();
  trashed([m], plate, active, removedText([m]));
}

function deletePlate(i) {
  if (busy) return;
  if (moved?.from === plates[i]) expire();     // its Undo would have nowhere to go
  if (i === active) stashActive();
  const entry = plates[i];
  const slots = entry.models.filter((m) => m.stash);
  const own = { settings: entry.settings, history: entry.history };
  if (plates.length === 1) {
    // the one plate stays, emptied (the same plate, for an earlier Undo to find)
    Object.assign(entry, newPlate());
    show(0);
    trashed(slots, entry, 0, removedText(slots), own);
    return;
  }
  plates.splice(i, 1);
  if (i === active) {
    show(Math.min(i, plates.length - 1));
  } else {
    if (i < active) active--;
    render();
  }
  trashed(slots, null, i, t('Deleted plate {n}', { n: i + 1 }), own);
}

/** Bring the last removal back: to its plate if that is still there (into its slot
 *  when the plate is empty, beside its models when not), else as a new plate where
 *  it was. */
function undoDelete() {
  if (!trash || busy) return;
  const { slots, plate, index, own } = trash;
  clearTimeout(trash.timer);
  trash = null;
  el('toast').hidden = true;
  let i = plates.indexOf(plate);
  if (i < 0) {
    i = Math.min(index, plates.length);
    plates.splice(i, 0, newPlate());
    if (i <= active) active++;
  }
  stashActive();
  const p = plates[i];
  if (p.models.length === 1 && !p.models[0].stash) {
    p.models = slots;
    // a deleted plate's models come back under its settings and undo
    if (own) Object.assign(p, own);
  } else {
    putBack(p, slots);
  }
  p.live = p.models.indexOf(slots[0]);
  show(i);
}

// ------------------------------------------------------- move to another plate

// { m, from (the plate it left), xy (its spot there), timer }: the last move to
// another plate, for the toast's Undo
let moved = null;

/**
 * Move slot `m` (a model of any plate, usually the one being edited) to plate `j` at
 * `xy` (a drag dropped there, ui/move.js), or the free spot nearest the centre when
 * a model there covers it. Plate `j` is then edited, `m` live, under its settings:
 * its fins rebuild to them, and its walls, removals, pose and scale go with it. Its
 * steps stay in the plate it left, passed over there while it is gone (history.js).
 * The toast's Undo takes it back to `back` (its spot before the drag) unless `back`
 * is null.
 */
export function moveToPlate(m, j, xy, back) {
  const si = plates.findIndex((p) => p.models.includes(m));
  const src = plates[si], dst = plates[j], k = src?.models.indexOf(m);
  if (busy || !src || !dst || src === dst || !(si === active && k === src.live ? part : m.stash)) return false;
  expire();
  const from = liveXY();
  stashActive();
  src.models.splice(k, 1);
  if (!src.models.length) src.models = [slot()];
  if (src.live > k || (src.live === k && k > 0)) src.live--;     // as Remove model goes on
  m.xy = xy.slice();
  const bare = dst.models.length === 1 && !dst.models[0].stash;
  // its own settings only on a plate that has none yet (unpark)
  const own = bare && !dst.settings;
  if (bare) dst.models = [m];
  else putBack(dst, [m]);
  dst.live = dst.models.indexOf(m);
  arrive(j, from, false);
  if (!back) return true;
  moved = { m, from: src, xy: back.slice(), timer: setTimeout(expire, UNDO_MS) };
  el('toast-text').textContent = t(own ? 'Moved {name} to plate {n}' : 'Moved {name} to plate {n}: it takes that plate\'s settings',
    { name: partName, n: j + 1 });
  el('toast').hidden = false;
  return true;
}

/** The toast's Undo of a move: the model back to the plate it left, where it was
 *  (or the free spot nearest, if a model has been put there since), from whichever
 *  plate is being edited -- one glide. */
function undoMove() {
  if (!moved || busy) return;
  const { m, from, xy } = moved;
  expire();
  const to = plates.indexOf(from);
  if (to >= 0) moveToPlate(m, to, xy, null);
}

el('toast-undo').addEventListener('click', () => (moved ? undoMove() : undoDelete()));
el('remove-part').addEventListener('click', removeModel);

// -------------------------------------------------------------------- export

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

/** Every plate's models as a 3MF, all in one .zip (one plate: the 3MF alone). Each
 * plate's parked models are written as they stand, their fins kept to its settings
 * (ui/parkedbuild.js); a plate left before they were rebuilt is switched to and its
 * models made live in turn, then back to the plate being edited. */
export async function exportAll() {
  if (busy) return;
  const at = plates[active];
  const settled = await whileWaiting(parkedSettled);
  if (settled === null) return;              // an export is already waiting
  // switched plates meanwhile: the one left is judged as any other
  if (plates[active] !== at) return exportAll();
  const files = [], stale = [];
  plates.forEach((p, i) => {
    if (i === active ? !settled : !plateReady(p)) { stale.push(i); return; }
    const f = plate3MF(plateGeometry(p));
    if (f) files[i] = { name: `plate-${i + 1}-${f[1]}`, blob: f[0] };
  });
  if (stale.length) {
    const back = active;
    const ok = await locked(async () => {
      try {
        for (const i of stale) {
          go(i, true);
          if (!part) continue;
          // the switch starts a support build (in the worker): export what it builds
          await tick(0);
          while (buildPending()) await tick(50);
          const f = await plate3MFLive();
          if (f) files[i] = { name: `plate-${i + 1}-${f[1]}`, blob: f[0] };
        }
      } finally {
        go(back, true);
      }
      return true;
    });
    if (!ok) return;
  }
  const out = files.filter(Boolean);
  if (out.length === 1) { download(out[0].blob, out[0].name); return; }
  if (!out.length) return;
  const entries = await Promise.all(out.map(async (f) =>
    ({ name: f.name, data: new Uint8Array(await f.blob.arrayBuffer()) })));
  const zip = zipStore(entries);
  download(new Blob([zip], { type: 'application/zip' }), 'support-fins-plates.zip');
}

// ------------------------------------------------------------- tabs and row

// A click (not a drag) on another plate in the view switches to it, and on a parked
// model edits that model.
let downAt = null;
const isTap = watchTaps(renderer.domElement);   // a finger's tap, never a pinch (tap.js)
renderer.domElement.addEventListener('pointerdown', (e) => {
  downAt = e.button === 0 ? [e.clientX, e.clientY] : null;
});
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt || busy || (plates.length < 2 && plates[0].models.length < 2)) return;
  downAt = null;
  if (!isTap(e)) return;
  const hit = plateAt(e, plates.length, active, [part, finMesh, padMesh, drawnMesh, ...sectionPick()]);
  if (!hit) return;
  if (hit.plate === active) { if (hit.model >= 0) select(hit.model); return; }
  // a model on another plate: that plate, with that model live
  if (hit.model >= 0) plates[hit.plate].live = hit.model;
  go(hit.plate);
});

const stem = (name) => name.replace(/\.(stl|3mf|step|stp|obj)$/i, '');

function render() {
  const bar = el('plates');
  const tabs = plates.map((p, i) => {
    const name = i === active ? (part ? partName : '') : (p.models[p.live].stash?.part.name ?? '');
    const count = p.models.filter((m, k) => (i === active && k === p.live ? part : m.stash)).length;
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
      sub.textContent = count > 1 ? `${stem(name)} +${count - 1}` : stem(name);
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
  all.addEventListener('click', () => frameAll(plates.length, active, liveXY()));
  bar.replaceChildren(...tabs, add, all);
  bar.inert = busy;
  el('export-all').hidden = plates.length < 2;
  // Nothing imported on any plate yet: the part controls, another plate and the
  // view (body.no-part, style.css) have nothing to act on.
  const empty = !plates.some((p, i) => p.models.some((m, k) => (i === active && k === p.live ? part : m.stash)));
  for (const id of ['volume', 'vx', 'vy', 'vz', 'thr', 'fins-toggle', 'export']) el(id).disabled = empty;
  add.disabled = empty;
  document.body.classList.toggle('no-part', empty);
  drawRow(plates, active);
  checkOverlap();      // the red cells are the edited plate's
}
/** The tabs and the row again, after a model swap on the plate (models.js). */
export const redraw = () => render();

// A load, a rescale or Remove model changes the edited plate's name; a new build
// volume, every plate's size and spacing. A new part in the live slot also makes
// the fins it was last parked with wrong for it.
document.addEventListener('partchange', () => {
  const m = plates[active]?.models[plates[active].live];
  if (m?.ghost) { m.ghost.fins?.geometry.dispose(); m.ghost = null; }
  render();
});
document.addEventListener('buildvolumechange', render);
window.addEventListener('languagechange', render);
// Not at load: this module is in an import cycle (io -> plates -> part -> io), so
// part.js may not have run yet. Module scripts all run before DOMContentLoaded.
document.addEventListener('DOMContentLoaded', render);
