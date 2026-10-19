import { t } from './i18n.js';
/**
 * Per-fin removal (Auto): click a fin to drop just that one.
 *
 * The fin mesh lives in finbuild.js and the modes in settings.js. Everything
 * the removal feature itself owns -- records, signatures, the hover overlay,
 * remove mode -- lives here, and the other modules only read it.
 */
import * as THREE from 'three';
import { el } from './dom.js';
import { scene, renderer, camera, raycaster, pointer, meshFrom, clip, MODEL } from './scene.js';
import { keptHit } from './section.js';
import { setGizmo } from './pose.js';
import { part, updateFit } from './part.js';
import { finsVisible, autoLike, drawAugment, setDrawAugment, syncAugmentUI } from './settings.js';
import { lastBuilt, finMesh, setFinTris } from './finbuild.js';
import { clearPreview, syncDrawControls } from './walls.js';
import { updateReadout } from './readout.js';
import { histPush } from './history.js';
import { assignKeys, matchRemoved } from './finkeys.js';
import { setMove } from './move.js';

// Auto fins are a flat triangle soup in ONE mesh, but each fin record now carries
// its triangle segment(s) (built.fins[i].triRanges, vertex-indexed into
// built.triangles) and a spatial signature. A removal is remembered by SIGNATURE,
// not by the volatile sequential id, so a fin stays removed across a same-
// orientation rebuild (slider tweak) and even an orientation round-trip: the sig
// matches the fin back to its place, and a different orientation's fins simply
// don't match (so nothing is spuriously removed on a re-pose). removedIds is
// derived per build by matching removedSigs to the nearest current records
// (ui/finkeys.js), so the filter never has to track an id across rebuilds.
let finRecords = [];        // [{id, kind, triRanges, line, height, sig}], one per auto fin
export let removedSigs = new Set(); // spatial signatures of fins the user clicked away
export let removedIds = new Set();  // ids removed in the CURRENT build (derived in applyBuilt)
let removedBy = new Map();          // id -> the removed sig it matched (ui/finkeys.js), for Restore
export let removeMode = false;      // armed: hover highlights a fin red, click removes it
let hoverFinMesh = null;     // red translucent overlay of the fin under the pointer
let hoverFinId = null;       // id of the fin hoverFinMesh currently draws (rebuild cache)
let triToFin = [];           // filtered finMesh triangle index → finRecords index

// Red hover overlay for the fin a removal click would drop. Same depth/offset
// trick as hoverFace so it reads on top of the green fin mesh.
const hoverFinMaterial = new THREE.MeshStandardMaterial({
  color: 0xff4d4d, roughness: 0.6, metalness: 0.0, transparent: true, opacity: 0.55,
  side: THREE.DoubleSide, depthTest: true, polygonOffset: true,
  polygonOffsetFactor: -4, polygonOffsetUnits: -4, clippingPlanes: clip,
});

/** Flatten the KEPT fin records' triangle segments into one vertex array, tagging
 *  each triangle with its owning record so a pick can map faceIndex → fin. */
function filteredTriangles(allTris, records, removed) {
  const tris = [];
  const map = [];   // triangle index → record index
  for (let i = 0; i < records.length; i++) {
    if (removed.has(records[i].id)) continue;
    for (const [lo, hi] of (records[i].triRanges ?? [])) {
      for (let t = lo; t < hi; t += 3) {
        tris.push(allTris[t], allTris[t + 1], allTris[t + 2]);
        map.push(i);
      }
    }
  }
  return { tris, map };
}

/** The original (unfiltered) triangles of one fin record, for the hover overlay. */
function finTrisForRecord(rec) {
  const out = [];
  if (!lastBuilt) return out;
  for (const [lo, hi] of (rec.triRanges ?? []))
    for (let t = lo; t < hi; t++) out.push(lastBuilt.triangles[t]);
  return out;
}

/** Re-filter lastBuilt into finMesh with NO worker round-trip. Called on each
 *  removal / restore -- the geometry already exists, filtering is cheap. */
function rebuildFinMesh() {
  if (!lastBuilt) return;
  matchRecords();
  clearFinHover();   // ids may shift after a rebuild; force the next hover to redraw
  const { tris, map } = filteredTriangles(lastBuilt.triangles, finRecords, removedIds);
  triToFin = map;
  setFinTris(tris);
  updateReadout(lastBuilt);
  updateFit();
}

export const removeActive = () => finsVisible && autoLike() && removeMode;

/** Ray the pointer into the (filtered) fin mesh; returns the owning fin record. */
function pickFin(ev) {
  if (!finMesh) return null;
  const r = renderer.domElement.getBoundingClientRect();
  pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1,
              -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = keptHit(raycaster.intersectObject(finMesh, false));
  if (!hit || hit.faceIndex == null) return null;
  const fi = triToFin[hit.faceIndex];
  return fi != null ? finRecords[fi] : null;
}

/** Show the Remove/Restore buttons only in Auto mode with fins on screen. */
export function syncRemoveUI() {
  const show = finsVisible && autoLike();
  el('remove-fins-controls').hidden = !show;
  el('remove-fins-toggle').hidden = !show;
  el('remove-fins-toggle').classList.toggle('primary', removeMode);
  el('remove-fins-toggle').textContent = t(removeMode ? 'Click a fin — Esc done' : 'Remove fins');
  // Gate on removedIds (fins removed in THIS orientation), not the global
  // removedSigs -- otherwise a removal made in another pose shows a Restore button
  // that maps to nothing here (and whose tooltip promises "this orientation").
  el('restore-fins').hidden = !(show && removedIds.size > 0);
}

/** Arm click-to-remove. Cancels hand-placement (the two pointer modes are exclusive). */
function beginRemove() {
  // Only `part` is required -- finMesh is null once every fin is removed, and
  // gating on it there would leave the armed button dead (hover/pick already
  // null-guard finMesh, so remove mode is simply a harmless no-op until a rebuild
  // repopulates fins).
  if (!part) return;
  if (drawAugment) { setDrawAugment(false); syncAugmentUI(); syncDrawControls(); }
  setMove(false);      // its press would take the fin click
  removeMode = true;
  clearPreview();
  setGizmo();
  syncRemoveUI();
}

/** Disarm remove mode (Esc / right-click / re-toggle / mode switch). */
export function cancelRemove() {
  removeMode = false;
  clearFinHover();
  renderer.domElement.style.cursor = '';
  setGizmo();
  syncRemoveUI();
}

/** Drop the red hover overlay. */
export function clearFinHover() {
  if (hoverFinMesh) { scene.remove(hoverFinMesh); hoverFinMesh.geometry.dispose(); hoverFinMesh = null; }
  hoverFinId = null;
}

/** Remove-fins mode: hover lights the fin a click would drop, in red. */
export function hoverRemove(ev) {
  const rec = pickFin(ev);
  if (rec) {
    // Rebuild the overlay only when the hovered fin actually changes -- pointermove
    // fires dozens of times a second, and disposing + rebuilding a BufferGeometry
    // (with computeVertexNormals) for the same fin every time is pure churn.
    if (rec.id !== hoverFinId) {
      if (hoverFinMesh) { scene.remove(hoverFinMesh); hoverFinMesh.geometry.dispose(); }
      hoverFinMesh = meshFrom(finTrisForRecord(rec), hoverFinMaterial);
      hoverFinMesh?.layers.disable(MODEL);   // an overlay: the section's glass draws the fin once
      hoverFinId = rec.id;
    }
    renderer.domElement.style.cursor = 'pointer';
  } else {
    clearFinHover();
    renderer.domElement.style.cursor = '';
  }
}

/** Remove-fins mode: one click drops just the fin under the pointer. */
export function clickRemove(ev) {
  const rec = pickFin(ev);
  if (!rec || !rec.sig) return;
  histPush();
  // a stored sig from an earlier build can read the same as this fin's while it
  // names another fin (matched by nearness): keep each stored sig unique
  let sig = rec.sig;
  for (let n = 1; removedSigs.has(sig); n++) sig = `${rec.sig}~${n}`;
  removedSigs.add(sig);
  rebuildFinMesh();
  syncRemoveUI();
}

/**
 * Take a fresh build's fin records (now carrying triRanges + line) and reconcile
 * the removed set against them, so a removal survives a same-orientation rebuild.
 * Returns the KEPT triangles -- the fin mesh shows the filtered set.
 */
export function adoptFins(built) {
  finRecords = assignKeys((built.fins ?? []).map((f) => ({ ...f })));
  matchRecords();
  const { tris, map } = filteredTriangles(built.triangles, finRecords, removedIds);
  triToFin = map;
  return tris;
}

/** Which of this build's fins the removed sigs name: the nearest fin to each, not
 *  an exact sig match, so a removal holds when a gap change moves the wall tops
 *  (ui/finkeys.js). */
function matchRecords() {
  removedBy = matchRemoved(finRecords, removedSigs);
  removedIds = new Set(removedBy.keys());
}

/** No auto fins on screen (fins off, or Draw mode): no records to pick from. */
export function forgetFins() {
  finRecords = []; triToFin = []; removedIds = new Set(); removedBy = new Map();
}

/** A new part: signatures can coincidentally match a different model's fins. */
export function resetRemovals() {
  removedSigs = new Set();
  removedIds = new Set();
  removedBy = new Map();
}

/** Undo/redo: put back a snapshot's removals, disarmed. */
export function restoreRemovals(sigs) {
  removedSigs = new Set(sigs ?? []);
  removeMode = false;
}

el('remove-fins-toggle').addEventListener('click', () => {
  if (removeMode) cancelRemove();
  else beginRemove();
});
el('restore-fins').addEventListener('click', () => {
  // Restore only THIS orientation's removals: drop the sigs that matched a fin in
  // the current build, leaving removals made in other poses intact.
  if (!removedIds.size) return;
  histPush();
  for (const sig of removedBy.values()) removedSigs.delete(sig);
  rebuildFinMesh();
  syncRemoveUI();
});

window.addEventListener('languagechange', () => { if (typeof syncRemoveUI === 'function') syncRemoveUI(); });
