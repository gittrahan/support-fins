import { t, tn } from './i18n.js';
/**
 * File import: sniff the format, read STL / 3MF / STEP / OBJ into one flat position
 * array, let the user pick objects from a multi-object file, and hand the
 * geometry to setPart(). Also the file input and drag-and-drop.
 */
import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { readThreeMF, mergeColors } from '../threemf.js';
import { cutNegatives } from '../cut.js';
import { isStep, readStep, warmStep } from '../step.js';
import { isObj, readOBJ } from '../obj.js';
import { el } from './dom.js';
import { part, setPart } from './part.js';
import { partObjectOf, restoreSession } from './session.js';
import { freePlate, currentPlate, returnTo, dropEmptyPlate } from './plates.js';
import { addSlot } from './models.js';

export let importNote = '';
export let lastImportMeta = null;
// A session saved in the 3MF just read (ui/session.js), restored once setPart has
// the part: taken by afterLoad, so it never reaches a later file.
let pendingSession = null;

export function renderImportNote() {
  if (!lastImportMeta) return '';
  const m = lastImportMeta;
  const notes = [];
  if (m.type === '3MF') {
    if (m.objectsLength > 1) {
      notes.push(m.chosenLength === 1
        ? t('imported “{name}” of {total} objects', { name: m.chosenName, total: m.objectsLength })
        : t('merged {n} of {total} objects into one part', { n: m.chosenLength, total: m.objectsLength }));
    } else if (m.meshes > 1) {
      notes.push(t('merged {n} bodies into one part', { n: m.meshes }));
    }
    if (m.skipped) notes.push(tn('ignored {n} support/non-printable body', 'ignored {n} support/non-printable bodies', m.skipped));
    // a slicer's negative parts are cut out, so the fins are for what prints; they
    // and its modifiers / support blockers go back out in the 3MF export (#104)
    if (m.cut) notes.push(tn('cut out {n} negative part', 'cut out {n} negative parts', m.cut));
    // the export carries the negative parts too, and a slicer draws one over the
    // walls standing in its cut until it slices (#104)
    if (m.cut) notes.push(t('in your slicer, walls inside a negative part show once you slice'));
    if (m.why === 'open') notes.push(t('negative parts not cut: the part is not a closed solid, so its fins are for the uncut shape'));
    else if (m.why === 'whole') notes.push(t('negative parts not cut: they would remove the whole part'));
    else if (m.why === 'load') notes.push(t('negative parts not cut: the cutter did not load (try opening the file again)'));
    else if (m.uncut) notes.push(tn('{n} negative part not cut: it is not a closed solid',
      '{n} negative parts not cut: they are not closed solids', m.uncut));
    if (m.extras) notes.push(tn('kept {n} modifier/support blocker for the 3MF export',
      'kept {n} modifiers/support blockers for the 3MF export', m.extras));
    if (m.unit && m.unit !== 'millimeter') notes.push(t('converted from {unit} to mm', { unit: m.unit }));
    if (m.session === 'restored') {
      notes.push(m.restored
        ? tn('restored {n} hand-placed support and the settings', 'restored {n} hand-placed supports and the settings', m.restored)
        : t('restored the settings'));
    } else if (m.session === 'changed') {
      notes.push(t('saved supports not loaded: the part changed since it was exported'));
    } else if (m.session === 'unreadable') {
      notes.push(t('saved supports not loaded: the saved session is damaged'));
    }
    return notes.length ? `3MF: ${notes.join('; ')}.` : '';
  }
  return importNote;
}   // what the 3MF/STEP reader had to decide (merge, unit, skips)

/** The part was taken off the plate (part.js clearPart): its import note goes too. */
export function forgetImport() {
  importNote = '';
  lastImportMeta = null;
  pendingSession = null;
  el('s-import-note').textContent = '';
}

/** The import note, kept with a plate that is not showing (ui/plates.js). */
export const importState = () => ({ importNote, lastImportMeta });
export function setImportState(st) {
  importNote = st.importNote;
  lastImportMeta = st.lastImportMeta;
}

/** The part was rescaled (ui/scale.js): the supports a saved session brought back
 *  are gone with it, so the note no longer says they were restored. */
export function forgetSessionNote() {
  if (!lastImportMeta?.session) return;
  lastImportMeta.session = null;
  lastImportMeta.restored = null;
  importNote = renderImportNote();
  el('s-import-note').textContent = importNote;
}

const loader = new STLLoader();

/**
 * Sniff the format from the CONTENT, not the extension. A 3MF is an OPC package,
 * so it opens with the ZIP magic; an STL never does. Going by bytes means a file
 * saved as .stl by a slicer that actually wrote a 3MF (it happens), or a .3mf the
 * user renamed, still lands in the right parser.
 */
function isZip(buffer) {
  if (buffer.byteLength < 4) return false;
  const b = new Uint8Array(buffer, 0, 4);
  return b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
}

/** A three.js BufferGeometry from a flat mm position array (the STL layout). */
function geometryFromPositions(positions) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return geometry;
}

/** Concatenate several picked objects' position arrays into one part. */
function mergeObjectPositions(objs) {
  if (objs.length === 1) return objs[0].positions;
  let total = 0;
  for (const o of objs) total += o.positions.length;
  const all = new Float32Array(total);
  let off = 0;
  for (const o of objs) { all.set(o.positions, off); off += o.positions.length; }
  return all;
}

/**
 * A 3MF plate can hold several distinct objects (a Bambu/MakerWorld download
 * usually does) and this tool fins ONE part. Show the list and resolve to the
 * chosen objects, or null on cancel. Largest by triangle count is pre-selected
 * (the model, not its base/skirt); checking several merges them. Esc cancels,
 * Enter loads.
 */
function pickObjects(objects) {
  const modal = el('picker');
  const list = el('picker-list');
  const hint = el('picker-hint');
  const loadBtn = el('picker-load');
  const cancelBtn = el('picker-cancel');

  // Largest first -- but our own 3MF export's "<name> supports" object (the separate
  // form, threemf.js) goes last, so re-importing an export pre-selects the part, not
  // a tine-heavy support object that happens to have more triangles.
  const ours = (o) => / supports$/.test(o.name ?? '') ? 1 : 0;
  const order = objects.map((_, i) => i)
    .sort((a, b) => ours(objects[a]) - ours(objects[b]) || objects[b].tris - objects[a].tris);
  list.replaceChildren();
  const boxes = [];
  order.forEach((idx, rank) => {
    const o = objects[idx];
    const li = document.createElement('li');
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = rank === 0;                   // largest (not our supports) pre-selected
    cb.dataset.idx = String(idx);
    cb.addEventListener('change', refresh);
    const name = document.createElement('span');
    name.className = 'pk-name';
    name.textContent = o.name;
    const meta = document.createElement('span');
    meta.className = 'pk-meta';
    const s = o.bbox.size.map((v) => Math.round(v));
    meta.textContent = `${o.tris.toLocaleString()} ${t('tris')} · ${s[0]}×${s[1]}×${s[2]} mm`;
    label.append(cb, name, meta);
    li.append(label);
    list.append(li);
    boxes.push(cb);
  });

  const selected = () => boxes.filter((b) => b.checked).map((b) => objects[+b.dataset.idx]);
  function refresh() {
    const n = selected().length;
    loadBtn.disabled = n === 0;
    loadBtn.textContent = n > 1 ? t('Merge {n} & load', { n }) : t('Load');
    hint.textContent = n > 1 ? t('{n} selected — merged into one part', { n }) : '';
  }
  refresh();
  modal.hidden = false;

  return new Promise((resolve) => {
    function close(result) {
      modal.hidden = true;
      loadBtn.removeEventListener('click', onLoad);
      cancelBtn.removeEventListener('click', onCancel);
      removeEventListener('keydown', onKey);
      resolve(result);
    }
    function onLoad() { const sel = selected(); if (sel.length) close(sel); }
    function onCancel() { close(null); }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      else if (e.key === 'Enter') { e.preventDefault(); onLoad(); }
    }
    loadBtn.addEventListener('click', onLoad);
    cancelBtn.addEventListener('click', onCancel);
    addEventListener('keydown', onKey);
  });
}

/**
 * The last guess: an STL, or nothing we read. The picker lets any file through on
 * Android (index.html #file), and STLLoader reads junk as a DataView range error
 * or an empty part.
 */
function parseStl(buffer) {
  let geometry = null;
  try { geometry = loader.parse(buffer); } catch { /* not an STL */ }
  if (!geometry?.getAttribute('position')?.count) throw new Error('not an STL, 3MF, STEP or OBJ file');
  return geometry;
}

/**
 * Bytes in, three.js geometry out, for any format (or null if the user cancels
 * the object picker). The 3MF and STEP readers hand back the same flat mm
 * position array STLLoader produces, so everything downstream (setPart, the
 * weld, the whole engine) is unchanged.
 */
async function parseModel(buffer) {
  importNote = '';
  if (!isZip(buffer)) {
    const geometry = isStep(buffer) ? await parseStep(buffer)
      : isObj(buffer) ? await parseObj(buffer)
      : parseStl(buffer);
    // A 3MF read before this one no longer speaks for the part (a language switch
    // re-renders its note); a cancelled picker keeps the part, and its note.
    if (geometry) lastImportMeta = null;
    return geometry;
  }

  const { objects, unit, skipped, session } = await readThreeMF(new Uint8Array(buffer));

  // One object loads straight in; a plate of several goes to the picker so the
  // user chooses which body to fin rather than us merging distinct models. A file
  // the site exported (it carries a session) is the part and its supports: the part
  // loads, and the supports come back from the session, not as a mesh.
  const own = session ? partObjectOf(objects) : null;
  let chosen = own ? [own] : objects;
  if (!own && objects.length > 1) {
    chosen = await pickObjects(objects);
    if (!chosen) return null;               // cancelled: keep the current part
  }

  const cuts = await cutChosen(chosen);
  const geometry = geometryFromPositions(mergeObjectPositions(cuts.objects));
  // the part's painted/material colours, by triangle, for the 3MF export (#236);
  // the triangles keep their order all the way there
  geometry.userData.colors = mergeColors(cuts.objects);
  // A slicer's own parts go back out in the 3MF export, beside the part AS THE FILE
  // HAD IT: the slicer makes the cut again, so moving or deleting a negative part
  // there does what it says, and no paint is lost to the cut (#104).
  const extras = chosen.flatMap((o) => o.extras ?? []);
  if (extras.length) {
    geometry.userData.slicer = { positions: mergeObjectPositions(chosen), colors: mergeColors(chosen), extras };
  }
  chosen = cuts.objects;

  // Say what we decided for them: which/how many bodies, any support bodies left
  // on the plate, and any unit conversion.
  const notes = [];
  if (objects.length > 1) {
    notes.push(chosen.length === 1
      ? t('imported “{name}” of {total} objects', { name: chosen[0].name, total: objects.length })
      : t('merged {n} of {total} objects into one part', { n: chosen.length, total: objects.length }));
  } else if (chosen[0].meshes > 1) {
    notes.push(t('merged {n} bodies into one part', { n: chosen[0].meshes }));
  }
  if (skipped) notes.push(tn('ignored {n} support/non-printable body', 'ignored {n} support/non-printable bodies', skipped));
  if (unit && unit !== 'millimeter') notes.push(t('converted from {unit} to mm', { unit }));
  lastImportMeta = {
    type: '3MF',
    objectsLength: objects.length,
    chosenLength: chosen.length,
    chosenName: chosen[0]?.name,
    meshes: chosen[0]?.meshes ?? 1,
    skipped,
    extras: chosen.reduce((n, o) => n + (o.extras?.filter((e) => e.kind !== 'negative').length ?? 0), 0),
    cut: cuts.cut,
    uncut: cuts.uncut,
    why: cuts.why,
    unit,
    session: own ? 'pending' : null,
  };
  pendingSession = own ? session : null;
  importNote = renderImportNote();

  return geometry;
}

/**
 * Cut each chosen object's negative parts out of it (cut.js), so the fins are
 * built for the shape that prints. Up to a few seconds on a scanned negative,
 * so under the spinner; a file with none costs nothing.
 */
async function cutChosen(chosen) {
  const tally = { objects: chosen, cut: 0, uncut: 0, why: null };
  if (!chosen.some((o) => o.extras?.some((e) => e.kind === 'negative'))) return tally;
  const spinner = el('spinner');
  const label = spinner.lastChild.textContent;
  spinner.lastChild.textContent = t('cutting negative parts…');
  spinner.classList.add('show');
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r)));   // let it paint first
  try {
    tally.objects = [];
    for (const o of chosen) {
      const c = await cutNegatives(o);
      tally.cut += c.cut; tally.uncut += c.uncut; tally.why ||= c.why;
      tally.objects.push({ ...o, positions: c.positions, colors: c.colors });
    }
  } finally {
    spinner.classList.remove('show');
    spinner.lastChild.textContent = label;
  }
  return tally;
}

/**
 * STEP goes through the CAD kernel (lazy: the first STEP of a session pays for
 * a ~7.6 MB download), then through the same picker as a multi-object 3MF.
 */
async function parseStep(buffer) {
  const spinner = el('spinner');
  const label = spinner.lastChild.textContent;
  spinner.lastChild.textContent = t('reading STEP…');
  spinner.classList.add('show');
  let objects;
  try {
    ({ objects } = await readStep(new Uint8Array(buffer)));
  } finally {
    spinner.classList.remove('show');
    spinner.lastChild.textContent = label;
  }

  let chosen = objects;
  if (objects.length > 1) {
    chosen = await pickObjects(objects);
    if (!chosen) return null;
  }
  const notes = [t('tessellated at 0.01 mm')];
  if (objects.length > 1) {
    notes.unshift(chosen.length === 1
      ? t('imported “{name}” of {total} objects', { name: chosen[0].name, total: objects.length })
      : t('merged {n} of {total} objects into one part', { n: chosen.length, total: objects.length }));
  }
  importNote = `STEP: ${notes.join('; ')}.`;
  return geometryFromPositions(mergeObjectPositions(chosen));
}

/** OBJ: text, no unit (read as mm), and a file of several `o` objects goes
 *  through the same picker as a multi-object 3MF. */
async function parseObj(buffer) {
  const { objects } = readOBJ(new Uint8Array(buffer));
  let chosen = objects;
  if (objects.length > 1) {
    chosen = await pickObjects(objects);
    if (!chosen) return null;
  }
  if (objects.length > 1) {
    importNote = chosen.length === 1
      ? `OBJ: ${t('imported “{name}” of {total} objects', { name: chosen[0].name, total: objects.length })}.`
      : `OBJ: ${t('merged {n} of {total} objects into one part', { n: chosen.length, total: objects.length })}.`;
  }
  return geometryFromPositions(mergeObjectPositions(chosen));
}

/** setPart, then the saved session if the file carried one (the import note says
 *  how many supports came back, or why none did). */
function afterLoad(geometry, name) {
  const s = pendingSession;
  pendingSession = null;
  setPart(geometry, name);
  if (!s || !lastImportMeta) return;
  let r = { why: 'unreadable' };
  try { r = restoreSession(s); } catch (err) { console.error(err); }
  lastImportMeta.restored = r.n ?? null;
  lastImportMeta.session = r.why ?? 'restored';
  importNote = renderImportNote();
  el('s-import-note').textContent = importNote;    // the load's report already ran
}

/** Load `file` onto the plate being edited: in place of its model, or with `add`
 *  beside its models (ui/models.js). */
async function loadFile(file, add = false) {
  if (!file) return;
  // the plate it was imported to, which a click on another tab may have left while
  // the file was read (a STEP kernel download, a 3MF's object picker)
  const plate = currentPlate();
  try {
    const geometry = await parseModel(await file.arrayBuffer());
    if (!geometry || !returnTo(plate)) return;
    if (add) addSlot(geometry);
    afterLoad(geometry, file.name);
  } catch (err) {
    console.error(err);
    alert(`Could not read ${file.name}:\n${err.message}`);
  }
}

/** One file replaces the showing plate's model, as it always has; several go one to
 *  a plate (ui/plates.js), starting on this one if it is empty. In turn: a 3MF's
 *  object picker waits for its answer before the next file is read. */
async function loadFiles(files) {
  if (files.length === 1) return loadFile(files[0]);
  for (const file of files) {
    freePlate();
    await loadFile(file);
  }
  dropEmptyPlate();
}

// Clear the input once the file is taken: otherwise choosing the SAME file again
// (after cancelling its object picker, say) changes nothing and fires no change.
el('file').addEventListener('change', (e) => {
  loadFiles([...e.target.files]);
  e.target.value = '';
});
// The stats card's Add model: every file chosen goes onto this plate, beside the
// models already on it, in turn (a 3MF's object picker waits for its answer).
el('file-add').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  for (const file of files) await loadFile(file, true);
});
el('file-add').addEventListener('click', warmStep);
el('add-part').addEventListener('click', () => el('file-add').click());
// Reaching for a file is the cue to start loading the STEP kernel: it downloads
// while the user is still in the file dialog (or mid-drag), not after they drop.
el('file').addEventListener('click', warmStep);
// the empty plate's own Import button (index.html #drop .empty)
el('empty-import').addEventListener('click', () => el('file').click());

/** Load a model that is already on the web (the sample model, a demo link). */
export async function loadURL(url) {
  const plate = currentPlate();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const geometry = await parseModel(await res.arrayBuffer());
  if (!geometry || !returnTo(plate)) return;   // picker cancelled, or its plate deleted
  afterLoad(geometry, url.split('/').pop());
  // Drop ?stl= once it has been consumed: the path is nobody's business but the
  // user's, and a stale one in the address bar is misleading after they open a
  // different file.
  history.replaceState(null, '', location.pathname);
}

const drop = el('drop');
let dragDepth = 0;
addEventListener('dragenter', (e) => {
  e.preventDefault();
  warmStep();
  if (dragDepth++ === 0) drop.classList.remove('hidden'), drop.classList.add('armed');
});
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('dragleave', () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    drop.classList.remove('armed');
    if (part) drop.classList.add('hidden');
  }
});
addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  drop.classList.remove('armed');
  if (part) drop.classList.add('hidden');
  loadFiles([...e.dataTransfer.files]);
});
