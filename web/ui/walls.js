/**
 * Hand-placed supports: the breakaway walls drawn in Draw mode (or the Suggest
 * "+ Add" augment) and sway braces stood with one click, their preview markers,
 * selecting one to remove it, and the Draw Undo / Clear buttons. app.js's pointer
 * dispatch calls drawHover / drawClick while drawActive().
 */
import * as THREE from 'three';
import { drawnWall } from '../draw.js';
import { swayAtFace, faceIsUpright } from '../sway.js';
import { el } from './dom.js';
import { viewport, renderer, scene, camera, meshFrom, raycaster, pointer } from './scene.js';
import { removedIds } from './remove.js';
import { histPush } from './history.js';
import { updateReadout } from './readout.js';
import { part, topology, rotM3, lastResult, updateFit, pickFace } from '../app.js';
import { finsVisible, finMode, drawAugment } from './settings.js';
import { lastBuilt, swayOpts } from './finbuild.js';

// ---- draw mode: the user places breakaway walls by hand --------------------
// A drawn wall IS the same kind of support the auto-placer emits, so it shares
// the fin material and the green legend swatch. What is different is who chose
// the line: a person, not a PCA fit -- which is the whole reason it comes out
// straight. Endpoints are stored in the part's LOCAL frame so a wall tracks the
// part through later rotations, the same way the auto fins are rebuilt each time
// the orientation changes.
export let drawnWalls = [];        // committed walls: { a: Vector3(local), b: Vector3(local), ok, info }
export function setDrawnWalls(w) { drawnWalls = w; }
export let drawnMesh = null;
export let drawnTris = [];
export let drawStart = null;       // Vector3 (local) -- first click of a wall in progress
export let drawMsg = '';           // last placement result, for the readout
let printTris = null;       // whole part in print space, cached per orientation
let printTrisDirty = true;

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
  finsVisible && (finMode === 'draw' || (finMode === 'auto' && (drawAugment || drawnWalls.length > 0)));

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

/** The whole part in PRINT space (rotated + seated), rebuilt only when the
 *  orientation changes. This is the surface a drawn wall's contact line samples,
 *  the same transform export bakes in. */
function partPrintTriangles() {
  if (printTris && !printTrisDirty) return printTris;
  const { pos, nFaces } = topology;
  const rot = rotM3.elements;
  const { x: dx, y: dy, z: dz } = lastResult.offset;
  const a = new Float64Array(nFaces * 9);
  for (let i = 0; i < a.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    a[i]     = rot[0] * x + rot[3] * y + rot[6] * z + dx;
    a[i + 1] = rot[1] * x + rot[4] * y + rot[7] * z + dy;
    a[i + 2] = rot[2] * x + rot[5] * y + rot[8] * z + dz;
  }
  printTris = a;
  printTrisDirty = false;
  return a;
}

/** Drop any wall-in-progress and hide every transient draw visual. */
export function clearPreview() {
  drawStart = null;
  drawDot.visible = drawCursor.visible = drawBand.visible = false;
  if (ghostMesh) { scene.remove(ghostMesh); ghostMesh.geometry.dispose(); ghostMesh = null; }
}

/** Rebuild the committed drawn walls for the current orientation. */
export function rebuildDrawn() {
  if (drawnMesh) { scene.remove(drawnMesh); drawnMesh.geometry.dispose(); drawnMesh = null; }
  drawnTris = [];
  if (!drawShown() || !topology || !lastResult) { syncSelection(); return; }
  part.updateMatrixWorld();

  // Both Draw and the Suggest "+ Add" augment place the SAME thing now: hand-drawn
  // under-overhang breakaway walls. Each wall is stored as two local endpoints and
  // re-swept against the part's current pose, so a wall that no longer reaches the
  // part (rotated away) is flagged by drawnWall rather than dropped silently.
  const tris = partPrintTriangles();
  // Drawn walls grip with the same tine comb the auto fins use when Tines is on.
  const drawOpts = { tines: el('tines').checked,
                     tineDensity: el('tine-density').valueAsNumber / 100,
                     layerHeight: el('layer-height').valueAsNumber,
                     topo: topology, rot: rotM3.elements, offset: lastResult.offset };
  const wa = new THREE.Vector3(), wb = new THREE.Vector3();
  // Everything a hand-placed brace has to keep clear of: Auto's braces and walls
  // (when Auto's supports are on screen), then each hand-placed brace as it is
  // re-stood, so a rotation that brings two together is reported rather than fused.
  const auto = autoSupports();
  const braces = [...auto.braces];
  for (const w of drawnWalls) {
    // Each support remembers which triangles of the merged mesh are its own, so a
    // click on the mesh can be traced back to the support to select / remove.
    w.triStart = drawnTris.length / 3;
    if (w.kind === 'sway') {
      // A hand-placed sway brace: re-stood on the same face at the same spot, so
      // it follows the part when it turns (and says why if that face no longer
      // stands upright, or now runs into an earlier brace).
      part.localToWorld(wa.copy(w.a));
      const r = swayAtFace(topology, lastResult, rotM3.elements, w.face,
                           [wa.x, wa.y, wa.z], swayOpts(), { braces, walls: auto.walls });
      w.ok = r.ok;
      w.info = r;
      if (r.ok) { braces.push(r); for (const t of r.tris) drawnTris.push(t); }
      w.triEnd = drawnTris.length / 3;
      continue;
    }
    part.localToWorld(wa.copy(w.a));
    part.localToWorld(wb.copy(w.b));
    const r = drawnWall([wa.x, wa.y, wa.z], [wb.x, wb.y, wb.z], tris, 0, drawOpts);
    w.ok = r.ok;
    w.info = r;
    if (r.ok) for (const t of r.tris) drawnTris.push(t);
    w.triEnd = drawnTris.length / 3;
  }
  drawnMesh = meshFrom(drawnTris, drawMaterial);
  syncSelection();
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

/** Show the endpoint / cursor / band, and a live ghost of the wall in progress. */
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

  // Build the ghost wall at most once per frame: one wall over the whole part is
  // a few ms, fine occasionally but not at raw pointer-move rates.
  const already = !!ghostQueued;
  ghostQueued = [aWorld.clone(), hitPoint.clone()];
  if (already) return;
  requestAnimationFrame(() => {
    const q = ghostQueued;
    ghostQueued = null;
    if (!q || !drawStart || !drawActive()) return;
    if (ghostMesh) { scene.remove(ghostMesh); ghostMesh.geometry.dispose(); ghostMesh = null; }
    const tris = partPrintTriangles();
    const r = drawnWall([q[0].x, q[0].y, q[0].z], [q[1].x, q[1].y, q[1].z], tris, 0);
    if (r.ok) ghostMesh = meshFrom(r.tris, ghostMaterial);
  });
}

/** Commit the wall from `drawStart` to the just-clicked point, if it can build. */
function placeSecondPoint(hitPoint) {
  part.updateMatrixWorld();
  const aWorld = part.localToWorld(drawStart.clone());
  const bWorld = hitPoint.clone();
  const tris = partPrintTriangles();
  const r = drawnWall([aWorld.x, aWorld.y, aWorld.z],
                      [bWorld.x, bWorld.y, bWorld.z], tris, 0);
  if (!r.ok) {
    drawMsg = `couldn’t place that wall: ${r.reason}`;
    clearPreview();
    updateReadout(lastBuilt);
    return;
  }
  drawMsg = '';
  histPush();
  drawnWalls.push({ a: drawStart.clone(), b: part.worldToLocal(bWorld.clone()) });
  clearPreview();
  rebuildDrawn();
  updateReadout(lastBuilt);
  updateFit();
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
  if (!finsVisible || finMode !== 'auto' || !lastBuilt) return { braces: [], walls: [] };
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

/** Stand a sway brace on the upright face the user clicked. One click, no second point. */
function placeSway(hit) {
  const auto = autoSupports();
  const standing = [...auto.braces,
                    ...drawnWalls.filter((w) => w.kind === 'sway' && w.ok).map((w) => w.info)];
  const r = swayAtFace(topology, lastResult, rotM3.elements, hit.faceIndex,
                       [hit.point.x, hit.point.y, hit.point.z], swayOpts(),
                       { braces: standing, walls: auto.walls });
  if (!r.ok) {
    drawMsg = `couldn’t place that brace: ${r.reason}`;
    updateReadout(lastBuilt);
    return;
  }
  drawMsg = '';
  histPush();
  part.updateMatrixWorld();
  drawnWalls.push({ kind: 'sway', face: hit.faceIndex, a: part.worldToLocal(hit.point.clone()) });
  rebuildDrawn();
  updateReadout(lastBuilt);
  updateFit();
}

/** Show the Draw controls (hint + Undo/Clear) only while hand-placement is live,
 *  and word the hint for what the click does: a support fin in Draw, a two-point
 *  wall in the Suggest "+ Add" augment. */
export function syncDrawControls() {
  el('draw-controls').hidden = !drawShown();
  el('draw-hint').innerHTML = 'Click <strong>two points</strong> across an overhang '
    + '— straight onto the red faces — to lay a breakaway wall along that line. '
    + (el('sway').checked
      ? 'Click an <strong>upright side</strong> once to stand a sway brace against it. '
      : '')
    + '<kbd>Esc</kbd> or right-click cancels.';
}

// Undo/Clear act on the hand-drawn breakaway walls -- the thing both Draw and the
// Suggest "+ Add" augment now place.
el('draw-undo').addEventListener('click', () => {
  if (!drawnWalls.length) return;
  histPush();
  drawnWalls.pop();
  drawMsg = '';
  clearPreview();
  rebuildDrawn();
  updateReadout(lastBuilt);
  updateFit();
});
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
export function markPrintTrisDirty() { printTrisDirty = true; }

// ---- the draw pointer (app.js dispatches here while drawActive()) ----------

/** Pointer move: the cursor, band and ghost wall track the surface under it. */
export function drawHover(ev) {
  const hit = pickFace(ev);
  if (hit) {
    updatePreview(hit.point);
    renderer.domElement.style.cursor = 'crosshair';
  } else {
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
  // With Sway braces on, a single click on an UPRIGHT side stands a brace there;
  // a click on anything else still starts a two-point wall as before.
  if (!drawStart && el('sway').checked
      && faceIsUpright(topology, rotM3.elements, hit.faceIndex)) {
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
