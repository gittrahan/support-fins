/**
 * File import: sniff the format, read STL / 3MF / STEP into one flat position
 * array, let the user pick objects from a multi-object file, and hand the
 * geometry to setPart(). Also the file input and drag-and-drop.
 */
import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { readThreeMF } from '../threemf.js';
import { isStep, readStep, warmStep } from '../step.js';
import { el } from './dom.js';
import { part, setPart } from './part.js';

export let importNote = '';   // what the 3MF/STEP reader had to decide (merge, unit, skips)

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

  const order = objects.map((_, i) => i).sort((a, b) => objects[b].tris - objects[a].tris);
  list.replaceChildren();
  const boxes = [];
  order.forEach((idx, rank) => {
    const o = objects[idx];
    const li = document.createElement('li');
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = rank === 0;                   // largest pre-selected
    cb.dataset.idx = String(idx);
    cb.addEventListener('change', refresh);
    const name = document.createElement('span');
    name.className = 'pk-name';
    name.textContent = o.name;
    const meta = document.createElement('span');
    meta.className = 'pk-meta';
    const s = o.bbox.size.map((v) => Math.round(v));
    meta.textContent = `${o.tris.toLocaleString()} tris · ${s[0]}×${s[1]}×${s[2]} mm`;
    label.append(cb, name, meta);
    li.append(label);
    list.append(li);
    boxes.push(cb);
  });

  const selected = () => boxes.filter((b) => b.checked).map((b) => objects[+b.dataset.idx]);
  function refresh() {
    const n = selected().length;
    loadBtn.disabled = n === 0;
    loadBtn.textContent = n > 1 ? `Merge ${n} & load` : 'Load';
    hint.textContent = n > 1 ? `${n} selected — merged into one part` : '';
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
 * Bytes in, three.js geometry out, for any format (or null if the user cancels
 * the object picker). The 3MF and STEP readers hand back the same flat mm
 * position array STLLoader produces, so everything downstream (setPart, the
 * weld, the whole engine) is unchanged.
 */
async function parseModel(buffer) {
  importNote = '';
  if (isStep(buffer)) return parseStep(buffer);
  if (!isZip(buffer)) return loader.parse(buffer);

  const { objects, unit, skipped } = await readThreeMF(new Uint8Array(buffer));

  // One object loads straight in; a plate of several goes to the picker so the
  // user chooses which body to fin rather than us merging distinct models.
  let chosen = objects;
  if (objects.length > 1) {
    chosen = await pickObjects(objects);
    if (!chosen) return null;               // cancelled: keep the current part
  }

  const geometry = geometryFromPositions(mergeObjectPositions(chosen));

  // Say what we decided for them: which/how many bodies, any support bodies left
  // on the plate, and any unit conversion.
  const notes = [];
  if (objects.length > 1) {
    notes.push(chosen.length === 1
      ? `imported “${chosen[0].name}” of ${objects.length} objects`
      : `merged ${chosen.length} of ${objects.length} objects into one part`);
  } else if (chosen[0].meshes > 1) {
    notes.push(`merged ${chosen[0].meshes} bodies into one part`);
  }
  if (skipped) notes.push(`ignored ${skipped} support/non-printable ${skipped === 1 ? 'body' : 'bodies'}`);
  if (unit && unit !== 'millimeter') notes.push(`converted from ${unit} to mm`);
  importNote = notes.length ? `3MF: ${notes.join('; ')}.` : '';

  return geometry;
}

/**
 * STEP goes through the CAD kernel (lazy: the first STEP of a session pays for
 * a ~7.6 MB download), then through the same picker as a multi-object 3MF.
 */
async function parseStep(buffer) {
  const spinner = el('spinner');
  const label = spinner.lastChild.textContent;
  spinner.lastChild.textContent = 'reading STEP…';
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
  const notes = ['tessellated at 0.01 mm'];
  if (objects.length > 1) {
    notes.unshift(chosen.length === 1
      ? `imported “${chosen[0].name}” of ${objects.length} objects`
      : `merged ${chosen.length} of ${objects.length} objects into one part`);
  }
  importNote = `STEP: ${notes.join('; ')}.`;
  return geometryFromPositions(mergeObjectPositions(chosen));
}

async function loadFile(file) {
  if (!file) return;
  try {
    const geometry = await parseModel(await file.arrayBuffer());
    if (geometry) setPart(geometry, file.name);
  } catch (err) {
    console.error(err);
    alert(`Could not read ${file.name}:\n${err.message}`);
  }
}

// Clear the input once the file is taken: otherwise choosing the SAME file again
// (after cancelling its object picker, say) changes nothing and fires no change.
el('file').addEventListener('change', (e) => {
  loadFile(e.target.files[0]);
  e.target.value = '';
});
// Reaching for a file is the cue to start loading the STEP kernel: it downloads
// while the user is still in the file dialog (or mid-drag), not after they drop.
el('file').addEventListener('click', warmStep);

/** Load a model that is already on the web (the sample model, a demo link). */
export async function loadURL(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const geometry = await parseModel(await res.arrayBuffer());
  if (!geometry) return;                       // picker cancelled
  setPart(geometry, url.split('/').pop());
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
  loadFile(e.dataTransfer.files[0]);
});
