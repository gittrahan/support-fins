import { t } from './i18n.js';
/**
 * Hand-placed supports: the breakaway walls drawn in Draw mode (or the Suggest
 * "+ Add" augment) and sway braces stood with one click, their preview markers,
 * selecting one to remove it, and the Draw Clear button. app.js's pointer
 * dispatch calls drawHover / drawClick while drawActive().
 */
import * as THREE from 'three';
import { faceIsUpright } from '../sway.js';
import { geometryJobs as jobs, hardwareHints } from './geometry-jobs.js';
import { el } from './dom.js';
import { setBuildPending } from './build-status.js';
import { viewport, renderer, scene, camera, meshFrom, ifaceMaterial, raycaster, pointer } from './scene.js';
import { removedIds } from './remove.js';
import { histPush, discardPlacementHistory } from './history.js';
import { updateReadout } from './readout.js';
import { pickFace } from './pose.js';
import { part, topology, rotM3, lastResult, updateFit } from './part.js';
import { finsVisible, finMode, autoLike, drawAugment } from './settings.js';
import { lastBuilt, swayOpts, finOpts } from './finbuild.js';

// ---- draw mode: the user places breakaway walls by hand --------------------
// A drawn wall IS the same kind of support the auto-placer emits, so it shares
// the fin material and the green legend swatch. What is different is who chose
// the line: a person, not a PCA fit -- which is the whole reason it comes out
// straight. Endpoints are stored in the part's LOCAL frame so a wall tracks the
// part through later rotations, the same way the auto fins are rebuilt each time
// the orientation changes.
export let drawnWalls = [];        // committed walls: { a: Vector3(local), b: Vector3(local), ok, info }
export function setDrawnWalls(w) {
  drawnWalls = w; drawGeneration++; jobs.cancel('build');
  setBuildPending('draw', false);
}
export let drawnMesh = null;
export let drawnTris = [];
export let drawStart = null;       // Vector3 (local) -- first click of a wall in progress
export let drawMsg = '';           // last placement result, for the readout
export let drawBusy = false;
export let drawFailed = false;
let drawGeneration = 0, previewGeneration = 0, previewJob = 0;

function geometryJob(kind, fields = {}) {
  return { kind, hardware: hardwareHints(), restricted: document.hidden, rot: [...rotM3.elements], result: { offset: { ...lastResult.offset } },
    options: { tunables: finOpts().tunables, sway: swayOpts(),
      draw: { tines: el('tines').checked, tineDensity: el('tine-density').valueAsNumber / 100,
        layerHeight: el('layer-height').valueAsNumber, plateOnly: el('plate-only').checked } }, ...fields };
}

export const drawMaterial = new THREE.MeshStandardMaterial({
  color: 0x59d98e, roughness: 0.7, metalness: 0.0, side: THREE.DoubleSide,
});
// A live, translucent preview of the wall the current drag would make.
const ghostMaterial = new THREE.MeshStandardMaterial({
  color: 0x8ff0bd, roughness: 0.7, transparent: true, opacity: 0.45,
  side: THREE.DoubleSide,
});
let ghostMesh = null;

// endpoint dot, cursor dot, and the rubber-band line between them. Unit radius;
// sizeMarkers() rescales them every frame to a fixed size ON SCREEN. They used to
// be sized to the part in world mm, which meant zooming in blew the cursor up
// until it hid the very edge you were trying to aim at.
//
// These are a UI overlay, so they draw with depthTest OFF and a high renderOrder:
// the line and dots sit ON the part surface, and an opaque part face (or a fin)
// rendered over them would otherwise win the depth test and hide the guide --
// which is exactly why the band read as "not rendering" on a face seen head-on.
// depthTest off makes them a HUD that is always visible regardless of what's in
// front. transparent:true is set so the renderOrder is honoured in the draw sort.
const guideMat = (color) => new THREE.MeshBasicMaterial(
  { color, depthTest: false, transparent: true });
const drawDot = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), guideMat(0x59d98e));
// The cursor is see-through so the surface under it stays readable; the OS
// crosshair is the precise aim point, this dot just shows the surface hit.
const drawCursor = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14),
  new THREE.MeshBasicMaterial({ color: 0xcffbe4, depthTest: false, transparent: true, opacity: 0.6 }));
const bandGeom = new THREE.BufferGeometry()
  .setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
const drawBand = new THREE.Line(bandGeom,
  new THREE.LineBasicMaterial({ color: 0x6dffab, depthTest: false, transparent: true }));
drawBand.frustumCulled = false;   // its endpoints move every frame; stale bounds would cull it
for (const o of [drawDot, drawCursor, drawBand]) {
  o.visible = false;
  o.renderOrder = 11;             // above the hoverFace (renderOrder 1) and the part
  scene.add(o);
}

// Pointer is in wall-placement mode (draw mode, or Suggest with the add toggle on).
// Gates the draw interaction, the gizmo, and face-lay.
export const drawActive = () => finsVisible && (finMode === 'draw' || drawAugment);
// Hand-drawn walls contribute to the display and the export. In Draw mode that's
// always; in Suggest it's whenever the user has drawn any (they persist after the
// add toggle is switched off, so you can orbit and export without losing them).
export const drawShown = () =>
  finsVisible && (finMode === 'draw' || (autoLike() && (drawAugment || drawnWalls.length > 0)));

// Marker radii in CSS pixels, whatever the zoom.
const DOT_PX = 5, CURSOR_PX = 4;
/** Scale the draw markers so they keep a fixed on-screen size at any zoom. */
export function sizeMarkers() {
  // World mm per CSS pixel at a point's depth, for the perspective camera.
  const mmPerPx = (p) => 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
    * camera.position.distanceTo(p) / Math.max(1, viewport.clientHeight);
  if (drawDot.visible) drawDot.scale.setScalar(DOT_PX * mmPerPx(drawDot.position));
  if (drawCursor.visible) drawCursor.scale.setScalar(CURSOR_PX * mmPerPx(drawCursor.position));
}

/** Drop the wall-in-progress and invalidate any pending ghost. */
export function clearPreview() {
  drawStart = null;
  previewGeneration++;
  jobs.cancel('preview');
  previewJob++;
  setBuildPending('preview', false);
  drawDot.visible = drawCursor.visible = drawBand.visible = false;
  if (ghostMesh) { scene.remove(ghostMesh); ghostMesh.geometry.dispose(); ghostMesh = null; }
}

/** Queue committed supports; model queries and tines run in a Worker. */
export function rebuildDrawn() {
  const generation = ++drawGeneration;
  jobs.cancel('build');
  drawFailed = false;
  if (!drawShown() || !topology || !lastResult || !drawnWalls.length) {
    drawBusy = false;
    setBuildPending('draw', false);
    if (drawnMesh) { scene.remove(drawnMesh); drawnMesh.geometry.dispose(); drawnMesh = null; }
    drawnTris = [];
    syncSelection();
    updateReadout(lastBuilt);
    return;
  }
  drawBusy = true;
  setBuildPending('draw', true);
  const started = performance.now();
  const snapshot = [...drawnWalls];
  part.updateMatrixWorld();
  const requests = snapshot.map((w) => ({ kind: w.kind, face: w.face,
    a: part.localToWorld(w.a.clone()).toArray(),
    b: w.b ? part.localToWorld(w.b.clone()).toArray() : undefined }));
  const job = geometryJob('build', { requests, avoid: autoSupports() });
  updateReadout(lastBuilt);
  jobs.run('build', topology, job).then((reply) => {
    if (!reply || generation !== drawGeneration) return;
    drawBusy = false;
    const failedNew = [];
    snapshot.forEach((w, i) => {
      Object.assign(w, reply.built.items[i]);
      if (w.justPlaced && !w.ok) {
        discardPlacementHistory(w.pendingHistory, w.historyKey);
        failedNew.push(w);
        drawMsg = `couldn't place that support: ${w.info.reason}`;
      }
      delete w.justPlaced;
      delete w.pendingHistory;
    });
    drawnWalls = drawnWalls.filter((w) => !failedNew.includes(w));
    if (drawnMesh) { scene.remove(drawnMesh); drawnMesh.geometry.dispose(); }
    drawnTris = reply.built.triangles;
    drawnMesh = meshFrom(drawnTris, drawMaterial, ifaceMaterial);
    syncSelection();
    updateReadout(lastBuilt);
    el('s-time').textContent = el('s-time').textContent.replace(/ · Draw \d+ ms/g, '')
      + ` · Draw ${(performance.now() - started).toFixed(0)} ms`;
    updateFit();
    setBuildPending('draw', false);
  }).catch((error) => {
    if (generation !== drawGeneration) return;
    drawBusy = false; drawFailed = true;
    drawMsg = `Support generation failed: ${error.message}. Try changing a setting or reload.`;
    updateReadout(lastBuilt);
    setBuildPending('draw', false);
  });
}

// ---- selecting a hand-placed support, to remove it -------------------------
// A click on a drawn wall or sway brace selects it (drawn in amber); Delete /
// Backspace or the "Remove selected" button takes it out, and Undo brings it back.
// Held as the wall OBJECT, not an index, so an undo/clear that replaces the list
// simply drops a selection that no longer exists.
export let selectedWall = null;
let selMesh = null;
const selMaterial = new THREE.MeshStandardMaterial({
  color: 0xffb347, roughness: 0.6, metalness: 0.0, side: THREE.DoubleSide,
  polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
});

/** Re-draw the highlight for the current selection, or clear a stale one. */
function syncSelection() {
  if (selMesh) { scene.remove(selMesh); selMesh.geometry.dispose(); selMesh = null; }
  if (selectedWall && (!drawShown() || !drawnWalls.includes(selectedWall) || !selectedWall.ok)) {
    selectedWall = null;
  }
  if (selectedWall) {
    selMesh = meshFrom(drawnTris.slice(selectedWall.triStart * 3, selectedWall.triEnd * 3), selMaterial);
  }
  el('draw-remove').hidden = !selectedWall;
}

/** The hand-placed support under the pointer, if it is nearer than the part. */
function pickSupport(ev) {
  if (!drawnMesh) return null;
  const r = renderer.domElement.getBoundingClientRect();
  pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1,
              -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(drawnMesh, false)[0];
  if (!hit || hit.faceIndex == null) return null;
  const onPart = part ? raycaster.intersectObject(part, false)[0] : null;
  if (onPart && onPart.distance < hit.distance) return null;   // the part is in front
  return drawnWalls.find((w) => w.ok && hit.faceIndex >= w.triStart && hit.faceIndex < w.triEnd) ?? null;
}

/** One readout line naming what is selected and how to remove it. */
export function selectedNote() {
  const i = selectedWall.info ?? {};
  const what = selectedWall.kind === 'sway'
    ? `sway brace ${Math.round(i.height ?? 0)}mm tall`
    : `wall ${Math.round(i.length ?? 0)}mm long`;
  return `selected: ${what}${i.tines ? `, ${i.tines} tines` : ''}. Press Delete or `
    + 'Remove selected to take it out (Esc to keep it)';
}

export function selectWall(w) {
  selectedWall = selectedWall === w ? null : w;   // a second click deselects
  drawMsg = '';
  syncSelection();
  updateReadout(lastBuilt);
}

export function removeSelected() {
  if (!selectedWall) return;
  histPush();
  drawnWalls = drawnWalls.filter((w) => w !== selectedWall);
  selectedWall = null;
  drawMsg = '';
  rebuildDrawn();
  updateReadout(lastBuilt);
  updateFit();
}

/** Pointer feedback is cheap; only the ghost's geometry goes to the Worker. */
let ghostQueued = null;
function updatePreview(hitPoint) {
  drawCursor.position.copy(hitPoint);
  drawCursor.visible = true;
  if (!drawStart) { drawBand.visible = false; return; }
  part.updateMatrixWorld();
  const aWorld = part.localToWorld(drawStart.clone());
  drawDot.position.copy(aWorld);
  drawDot.visible = true;
  bandGeom.setFromPoints([aWorld, hitPoint]);
  bandGeom.attributes.position.needsUpdate = true;
  drawBand.visible = true;
  const already = !!ghostQueued;
  ghostQueued = [aWorld.toArray(), hitPoint.toArray()];
  if (already) return;
  requestAnimationFrame(() => {
    const q = ghostQueued;
    ghostQueued = null;
    if (!q || !drawStart || !drawActive()) return;
    const generation = previewGeneration;
    const token = ++previewJob;
    setBuildPending('preview', true);
    jobs.run('preview', topology, geometryJob('preview', { a: q[0], b: q[1] })).then((reply) => {
      if (!reply || generation !== previewGeneration || !drawStart || !drawActive()) return;
      if (ghostMesh) { scene.remove(ghostMesh); ghostMesh.geometry.dispose(); ghostMesh = null; }
      if (reply.built.ok) ghostMesh = meshFrom(reply.built.tris, ghostMaterial);
    }).catch(() => { /* committed jobs report errors; a ghost never enables export */ })
      .finally(() => { if (token === previewJob) setBuildPending('preview', false); });
  });
}

/** Store the request immediately; certify it asynchronously before export. */
function placeSecondPoint(hitPoint) {
  const pendingHistory = histPush(true);
  part.updateMatrixWorld();
  drawnWalls.push({ a: drawStart.clone(), b: part.worldToLocal(hitPoint.clone()),
    justPlaced: true, pendingHistory, historyKey: Symbol() });
  drawMsg = '';
  clearPreview();
  rebuildDrawn();
}

/**
 * The supports Auto has ALREADY placed, as things a hand-placed brace must avoid.
 *
 * Auto builds in the Worker, so the page has no other way to know where its braces
 * and walls stand: without this, a brace you click can land on top of an Auto one
 * (or face it across a channel) and the two fuse into one piece that won't break
 * away. Empty unless Auto's supports are actually on screen, and fins the user has
 * removed are left out -- they aren't there to hit.
 */
function autoSupports() {
  if (!finsVisible || !autoLike() || !lastBuilt) return { braces: [], walls: [] };
  const outlines = lastBuilt.sway?.braces ?? [];
  const braces = [], walls = [];
  let k = 0;   // sway records and their outlines are emitted in the same order
  for (const rec of lastBuilt.fins ?? []) {
    const gone = removedIds.has(rec.id);
    if (rec.kind === 'sway') {
      const outline = outlines[k++];
      if (outline && !gone) braces.push(outline);
    } else if (!gone && Array.isArray(rec.line) && rec.line.length) {
      walls.push(rec.line);
    }
  }
  return { braces, walls };
}

/** One click queues a sway brace; geometry and certification run off-thread. */
function placeSway(hit) {
  const pendingHistory = histPush(true);
  part.updateMatrixWorld();
  drawnWalls.push({ kind: 'sway', face: hit.faceIndex,
    a: part.worldToLocal(hit.point.clone()),
    justPlaced: true, pendingHistory, historyKey: Symbol() });
  drawMsg = '';
  rebuildDrawn();
}

/** Show Clear whenever hand-drawn walls are shown (they stay in Suggest after
 *  "+ Add" is switched off), but the click hint only while a click places one. */
export function syncDrawControls() {
  el('draw-controls').hidden = !drawShown();
  el('draw-hint').hidden = !drawActive();
  el('draw-hint').textContent = t('Click two points across an overhang — straight onto the red faces — to lay a breakaway wall along that line. Click an upright side once to stand a sway brace against it. Esc or right-click cancels.');
}

// Clear acts on the hand-drawn breakaway walls -- the thing both Draw and the
// Suggest "+ Add" augment now place. Undo is the sidebar's (and Ctrl-Z).
el('draw-clear').addEventListener('click', () => {
  if (!drawnWalls.length) return;
  histPush();
  drawnWalls = [];
  drawMsg = '';
  clearPreview();
  rebuildDrawn();
  updateReadout(lastBuilt);
  updateFit();
});
el('draw-remove').addEventListener('click', removeSelected);

export function setDrawMsg(v) { drawMsg = v; }
/** The part turned or changed: the cached print-space triangles are stale. */
export function markPrintTrisDirty() {
  drawGeneration++; previewGeneration++;
  jobs.cancel('build'); jobs.cancel('preview');
  drawBusy = drawShown() && drawnWalls.length > 0;
  previewJob++;
  setBuildPending('preview', false);
  // The old job was cancelled; refreshFins/rebuildDrawn arms the replacement.
  // An Auto failure must not leave a notice for a Draw job that never started.
  setBuildPending('draw', false);
}

// ---- the draw pointer (app.js dispatches here while drawActive()) ----------

/** Pointer move: the cursor, band and ghost wall track the surface under it. */
export function drawHover(ev) {
  const hit = pickFace(ev);
  if (hit) {
    updatePreview(hit.point);
    renderer.domElement.style.cursor = 'crosshair';
  } else {
    previewGeneration++;
    jobs.cancel('preview');
    previewJob++;
    setBuildPending('preview', false);
    drawCursor.visible = drawBand.visible = false;
    if (ghostMesh) { scene.remove(ghostMesh); ghostMesh.geometry.dispose(); ghostMesh = null; }
    renderer.domElement.style.cursor = '';
  }
}

/** A click: select a placed support, stand a sway brace, or set / commit a wall end. */
export function drawClick(e) {
  // A click on a support you placed selects it (for Delete / Remove selected),
  // unless a wall is half-drawn -- then the click is its second point.
  if (!drawStart) {
    const sup = pickSupport(e);
    if (sup) { selectWall(sup); return; }
  }
  const hit = pickFace(e);
  if (!hit) return;
  if (selectedWall) { selectedWall = null; syncSelection(); }
  // Preserve the upright-face gate; only generation moves off-thread.
  if (!drawStart && el('sway').checked && faceIsUpright(topology, rotM3.elements, hit.faceIndex)) {
    placeSway(hit);
    return;
  }
  if (!drawStart) {
    drawStart = part.worldToLocal(hit.point.clone());
    drawMsg = '';
    updatePreview(hit.point);
    updateReadout(lastBuilt);
  } else {
    placeSecondPoint(hit.point);
  }
}
