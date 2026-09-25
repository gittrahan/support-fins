/**
 * Per-fin removal (Auto): click a fin to drop just that one.
 *
 * Until the fin build has its own module, the fin mesh, the modes and the
 * readout still live in app.js, so this reaches back there for them. Everything
 * the removal feature itself owns -- records, signatures, the hover overlay,
 * remove mode -- lives here, and app.js only reads it.
 */
import * as THREE from 'three';
import { el } from './dom.js';
import { scene, renderer, camera, raycaster, pointer, meshFrom } from './scene.js';
import {
  part, finsVisible, finMode, drawAugment, setDrawAugment,
  updateFit, setGizmo, syncAugmentUI,
} from '../app.js';
import { lastBuilt, finMesh, setFinTris } from './finbuild.js';
import { clearPreview, syncDrawControls } from './walls.js';
import { updateReadout } from './readout.js';
import { histPush } from './history.js';

// Auto fins are a flat triangle soup in ONE mesh, but each fin record now carries
// its triangle segment(s) (built.fins[i].triRanges, vertex-indexed into
// built.triangles) and a spatial signature. A removal is remembered by SIGNATURE,
// not by the volatile sequential id, so a fin stays removed across a same-
// orientation rebuild (slider tweak) and even an orientation round-trip: the sig
// matches the fin back to its place, and a different orientation's fins simply
// don't match (so nothing is spuriously removed on a re-pose). removedIds is
// derived per build from removedSigs ∩ the current records, so the filter never
// has to track an id across rebuilds.
let finRecords = [];        // [{id, kind, triRanges, line, height, sig}], one per auto fin
export let removedSigs = new Set(); // spatial signatures of fins the user clicked away
export let removedIds = new Set();  // ids removed in the CURRENT build (derived in applyBuilt)
export let removeMode = false;      // armed: hover highlights a fin red, click removes it
let hoverFinMesh = null;     // red translucent overlay of the fin under the pointer
let hoverFinId = null;       // id of the fin hoverFinMesh currently draws (rebuild cache)
let triToFin = [];           // filtered finMesh triangle index → finRecords index

// Red hover overlay for the fin a removal click would drop. Same depth/offset
// trick as hoverFace so it reads on top of the green fin mesh.
const hoverFinMaterial = new THREE.MeshStandardMaterial({
  color: 0xff4d4d, roughness: 0.6, metalness: 0.0, transparent: true, opacity: 0.55,
  side: THREE.DoubleSide, depthTest: true, polygonOffset: true,
  polygonOffsetFactor: -4, polygonOffsetUnits: -4,
});

/** Spatial signature: kind + rounded line midpoint + height + bearing. A content
 *  key, not the sequential id, so the same fin matches across rebuilds. */
function finSig(r) {
  if (!r || !r.line || !r.line.length) return null;
  const mid = r.line[Math.floor(r.line.length / 2)];
  const a = r.line[0], b = r.line[r.line.length - 1];
  const r1 = (v) => Math.round(v * 10) / 10;   // 0.1 mm
  return `${r.kind ?? 'prop'}:${r1(mid[0])},${r1(mid[1])},${r1(mid[2])}`
       + `:${r1(r.height ?? 0)}:${r1(Math.atan2(b[1] - a[1], b[0] - a[0]))}`;
}

/** Assign each record a UNIQUE sig. finSig is content-derived, so two fins on a
 *  symmetric/mirrored part can hash identically; a bare collision would make one
 *  removal click drop both and leave neither individually restorable. Disambiguate
 *  colliding sigs with an occurrence suffix -- deterministic build order keeps it
 *  stable within an orientation, and the first occurrence keeps the bare sig. */
function assignSigs(records) {
  const seen = new Map();
  for (const r of records) {
    const base = finSig(r);
    if (base == null) { r.sig = null; continue; }
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    r.sig = n === 0 ? base : `${base}#${n}`;
  }
  return records;
}

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
  removedIds = new Set(finRecords.filter((r) => removedSigs.has(r.sig)).map((r) => r.id));
  clearFinHover();   // ids may shift after a rebuild; force the next hover to redraw
  const { tris, map } = filteredTriangles(lastBuilt.triangles, finRecords, removedIds);
  triToFin = map;
  setFinTris(tris);
  updateReadout(lastBuilt);
  updateFit();
}

export const removeActive = () => finsVisible && finMode === 'auto' && removeMode;

/** Ray the pointer into the (filtered) fin mesh; returns the owning fin record. */
function pickFin(ev) {
  if (!finMesh) return null;
  const r = renderer.domElement.getBoundingClientRect();
  pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1,
              -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(finMesh, false)[0];
  if (!hit || hit.faceIndex == null) return null;
  const fi = triToFin[hit.faceIndex];
  return fi != null ? finRecords[fi] : null;
}

/** Show the Remove/Restore buttons only in Auto mode with fins on screen. */
export function syncRemoveUI() {
  const show = finsVisible && finMode === 'auto';
  el('remove-fins-controls').hidden = !show;
  el('remove-fins-toggle').hidden = !show;
  el('remove-fins-toggle').classList.toggle('primary', removeMode);
  el('remove-fins-toggle').textContent = removeMode ? 'Click a fin — Esc done' : 'Remove fins';
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
  removedSigs.add(rec.sig);
  rebuildFinMesh();
  syncRemoveUI();
}

/**
 * Take a fresh build's fin records (now carrying triRanges + line) and reconcile
 * the removed set against them, so a removal survives a same-orientation rebuild.
 * Returns the KEPT triangles -- the fin mesh shows the filtered set.
 */
export function adoptFins(built) {
  finRecords = assignSigs((built.fins ?? []).map((f) => ({ ...f })));
  removedIds = new Set(finRecords.filter((r) => removedSigs.has(r.sig)).map((r) => r.id));
  const { tris, map } = filteredTriangles(built.triangles, finRecords, removedIds);
  triToFin = map;
  return tris;
}

/** No auto fins on screen (fins off, or Draw mode): no records to pick from. */
export function forgetFins() {
  finRecords = []; triToFin = []; removedIds = new Set();
}

/** A new part: signatures can coincidentally match a different model's fins. */
export function resetRemovals() {
  removedSigs = new Set();
  removedIds = new Set();
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
  // Restore only THIS orientation's removals: drop the sigs of the fins present
  // in the current build, leaving removals made in other poses intact (deleting a
  // missing sig is a harmless no-op).
  if (!removedIds.size) return;
  histPush();
  for (const r of finRecords) removedSigs.delete(r.sig);
  rebuildFinMesh();
  syncRemoveUI();
});
