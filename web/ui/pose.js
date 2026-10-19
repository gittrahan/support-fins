import { t } from './i18n.js';
/**
 * The pose: the rotate gizmo, the 90-degree and reset buttons, and "Lay a face
 * flat" with its hovered-face highlight. app.js's pointer dispatch calls
 * layHover / layClick while layActive().
 */
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { el } from './dom.js';
import { addBadge } from './toolbar.js';
import { renderer, scene, camera, controls, raycaster, pointer, clip } from './scene.js';
import { keptHit, planeHandleShown } from './section.js';
import { removeActive } from './remove.js';
import { histPush, beginGesture, commitGesture } from './history.js';
import { hideSuggestions, clearSuggestionMark } from './suggest.js';
import { initRingFade } from './ringfade.js';
import { drawActive, clearPreview } from './walls.js';
import { refreshFins } from './finbuild.js';
import { finsVisible } from './settings.js';
import { part, topology, shade } from './part.js';
import { moveActive, setMove } from './move.js';

// The user rotates. Always. Auto-orientation may suggest, never apply -- the
// spike's strength-optimal pose for one hub was 155mm tall balanced on a needle:
// geometrically valid, unprintable.
export const gizmo = new TransformControls(camera, renderer.domElement);
gizmo.setMode('rotate');
gizmo.setSize(0.85);
initRingFade(gizmo);   // faint while a sway brace is aimed (ringfade.js)
scene.add(gizmo.getHelper ? gizmo.getHelper() : gizmo);
const dragFrom = new THREE.Quaternion();   // pose at drag start: did the drag turn it?
let dragSnap = null;                       // undo state at drag start (history.js)
// Did the last ring press turn the part? A press under the 4 px click threshold
// can still snap a ring 5 deg; app.js then won't take it as a click (Sway braces).
let pressTurned = false;
export const ringPressTurned = () => pressTurned;
export function clearRingPress() { pressTurned = false; }
gizmo.addEventListener('dragging-changed', (e) => {
  controls.enabled = !e.value;
  if (e.value && part) { dragFrom.copy(part.quaternion); dragSnap = beginGesture(); }
  ringDrag = e.value;
  if (e.value) showDragAngle();
  if (!e.value) {
    el('rot-delta').textContent = '';
    // a turn by the rings is one undo step, like the 90deg buttons (it never was one)
    const turned = !!part && !part.quaternion.equals(dragFrom);
    pressTurned = turned;
    if (turned) clearSuggestionMark();
    commitGesture(dragSnap, turned);
    dragSnap = null;
    // Drag released: reseat onto the plate now the pivot is allowed to move again
    // (shade() holds part.position steady WHILE dragging -- see the note there --
    // so this is the frame that actually drops the turned part back down).
    shadeQueued = false;     // this full shade stands in for any spaced-out one
    shade();
    endDragAngle();      // the settled angle, then fade
    // Fins are rebuilt when the drag ENDS, not during it. Placement runs the
    // exact confirmation passes -- containment, clearance, per-tine bite -- and
    // costs ~100ms on a 43k-face part, which is fine once and unusable at 60fps.
    // The overhang shading still updates live at 1-6ms, so the diagnosis the
    // user is steering by never stalls.
    if (finsVisible) refreshFins();
  }
});
gizmo.addEventListener('objectChange', () => {
  showDelta(gizmo.axis, gizmo.rotationAngle);
  requestShade();
});

// 5 degrees, not 15: a coarse snap is what makes a drag feel like it is
// juddering rather than turning. Shift releases it entirely for fine work.
const SNAP = THREE.MathUtils.degToRad(5);
gizmo.setRotationSnap(SNAP);
addEventListener('keydown', (e) => { if (e.key === 'Shift') gizmo.setRotationSnap(null); });
addEventListener('keyup', (e) => { if (e.key === 'Shift') gizmo.setRotationSnap(SNAP); });

/**
 * Coalesce re-analysis to one per frame. A high-polling-rate mouse fires
 * pointermove (and so objectChange) well above 60Hz, so an un-throttled drag
 * runs the classify pass several times per displayed frame and stutters.
 *
 * And on a heavy part, leave frames between them. The ring turns the part on
 * pointer move and the scene renders every frame, but a shade that takes 50 ms
 * (a 1.56M-face mini) run every frame held the whole page at ~15 fps. Waiting
 * SHADE_GAP x the last shade's cost before the next keeps the turn smooth and
 * the colours a beat behind; a part whose shade takes under a third of a frame
 * (a few ms at 60 Hz) still shades every frame.
 * Release always shades in full (the dragging-changed handler above).
 */
const SHADE_GAP = 2;
let shadeQueued = false, lastShadeEnd = -Infinity, lastShadeMs = 0;
function requestShade() {
  if (shadeQueued) return;
  shadeQueued = true;
  requestAnimationFrame(function due(now) {
    if (!shadeQueued) return;                      // a release shaded already
    if (now - lastShadeEnd < lastShadeMs * SHADE_GAP) { requestAnimationFrame(due); return; }
    shadeQueued = false;
    const t = performance.now();
    shade();
    syncDragNow();                                 // shade() just wrote the pose
    lastShadeEnd = performance.now();
    lastShadeMs = lastShadeEnd - t;
  });
}

function showDelta(axis, radians) {
  if (!axis || !radians) return;
  const label = axis.length > 1 ? 'free' : axis;   // 'XYZE' / 'E' are screen-space
  const deg = THREE.MathUtils.radToDeg(radians);
  el('rot-delta').textContent =
    `${label} ${deg >= 0 ? '+' : ''}${deg.toFixed(deg % 1 ? 1 : 0)}°`;
  if (ringDrag) showDragAngle();     // the 90deg buttons write the delta too
}

// The angle readout lives in the Rotate popover; a ring drag with it folded showed
// no angle at all. This small label above the Rotate badge mirrors it (the turn so
// far, then the pose) while the rings move, and fades a moment after release. Not
// shown when the popover is open: the readout there already says it.
const DRAG_FADE_MS = 1200;
let dragFadeTimer = 0;
let ringDrag = false;              // the rings are being dragged right now
function showDragAngle() {
  clearTimeout(dragFadeTimer);
  const tip = el('drag-angle');
  if (!el('rotate-pop').hidden) { tip.classList.remove('show'); return; }
  el('drag-delta').textContent = el('rot-delta').textContent;
  el('drag-now').textContent = el('rot-now').textContent;
  const badge = el('rotate-badge');   // the row scrolls sideways on a phone
  tip.style.left = `${Math.max(0, badge.offsetLeft - badge.parentElement.scrollLeft)}px`;
  tip.classList.add('show');
}
function syncDragNow() {
  if (el('drag-angle').classList.contains('show')) el('drag-now').textContent = el('rot-now').textContent;
}
function endDragAngle() {
  if (!el('drag-angle').classList.contains('show')) return;
  syncDragNow();       // the pose it settled at
  dragFadeTimer = setTimeout(() => el('drag-angle').classList.remove('show'), DRAG_FADE_MS);
}

export let layPlacing = false;     // true while "lay a face flat" is armed -- gated behind a
                            // button so a stray viewport click can't re-lay the part
/** Undo/redo and a new part disarm lay-flat directly (no setGizmo: they re-run it
 *  themselves). Drops the hover highlight and cursor only if it WAS armed, so a
 *  Draw crosshair is left alone, and puts the button back either way. */
export function setLayPlacing(v) {
  if (layPlacing && !v) { hoverFace.visible = false; renderer.domElement.style.cursor = ''; }
  layPlacing = v;
  syncLayUI();
}

/** "Lay a face flat" is armed: a face click lays the part on that face. Off by
 *  default so casual clicks orbit instead of silently re-laying the part. */
export const layActive = () => layPlacing;

// The Rotate badge in the view toolbar (toolbar.js) holds the 90deg steps, Reset,
// Lay a face flat and the rings switch below. Folding it disarms Lay a face flat:
// its button is the only sign it is armed, and an armed click re-lays the part.
addBadge('rotate-badge', { pop: 'rotate-pop', onFold: () => { if (layPlacing) cancelLay(); } });

// "Show rotate rings": off hides the rings until turned back on (they cover the
// part, #53); the 90deg buttons, Reset and Lay a face flat still turn it.
// Remembered, storage optional, like "Highlight small overhangs".
const RINGS_KEY = 'sf.showRings';
let showRings = true;
try { showRings = localStorage.getItem(RINGS_KEY) !== '0'; } catch { /* storage off */ }
el('show-rings').checked = showRings;
el('rings-hint').hidden = !showRings;
el('show-rings').addEventListener('change', (e) => {
  showRings = e.target.checked;
  try { localStorage.setItem(RINGS_KEY, showRings ? '1' : '0'); } catch { /* storage off */ }
  el('rings-hint').hidden = !showRings;
  setGizmo();
});

/** Enable the rotate gizmo only when NOT drawing or laying a face flat --
 *  its handles would otherwise swallow the clicks those modes need -- and
 *  only while "Show rotate rings" is on. The section plane's handle takes
 *  its place while that is up: two sets of handles on one part is a misclick. */
export function setGizmo() {
  const on = showRings && !!part && !drawActive() && !layActive() && !removeActive()
    && !planeHandleShown() && !moveActive();
  gizmo.enabled = on;
  // A disabled gizmo stops tracking hover, so a ring hovered last would stay
  // "under the pointer" and app.js would swallow the next pick for it.
  if (!on) gizmo.axis = null;
  const helper = gizmo.getHelper ? gizmo.getHelper() : gizmo;
  helper.visible = on;
}

// ---- Lay a face flat (armed behind a button so stray clicks can't re-lay) -------

/** Arm face-lay: the next face click lays the part on that face. Modal so a click
 *  isn't swallowed by the rotate gizmo; hovering highlights the face. */
function beginLay() {
  if (!part || !topology) return;
  setMove(false);      // its press would take the face click
  layPlacing = true;
  clearPreview();
  setGizmo();          // hides the rotate rings so they don't eat the pick
  syncLayUI();
}

/** Disarm face-lay (Esc / right-click / re-toggle / after a lay). */
export function cancelLay() {
  layPlacing = false;
  hoverFace.visible = false;
  renderer.domElement.style.cursor = '';
  setGizmo();
  syncLayUI();
}

function syncLayUI() {
  el('lay-face').textContent = layPlacing ? t('Click a face to lay it flat — Esc cancels')
    : t('Lay a face flat');
  el('lay-face').classList.toggle('active', layPlacing);
}

/** Rotate 90 degrees about a world axis, keeping the part seated. */
function rotate90(name, axis) {
  if (!part) return;
  histPush();
  const q = new THREE.Quaternion().setFromAxisAngle(axis, Math.PI / 2);
  part.quaternion.premultiply(q);   // premultiply = about the WORLD axis
  showDelta(name.toUpperCase(), Math.PI / 2);
  clearSuggestionMark();
  shade();
}

/**
 * Click a face to lay it flat on the plate. This is the fastest way to reach a
 * sane orientation -- far quicker than hunting for it on the rings -- and it is
 * how you actually think about the problem: "put THAT face down".
 */
const DOWN = new THREE.Vector3(0, 0, -1);
const layQuat = new THREE.Quaternion();
const faceNormal = new THREE.Vector3();

/**
 * The hovered face, drawn as a single highlighted triangle. Without this,
 * click-to-lay is invisible: nothing on screen suggests the part is clickable,
 * so a first-time user never discovers the fastest control in the app.
 * Parented to the part so it inherits the orientation for free.
 */
const hoverGeom = new THREE.BufferGeometry();
hoverGeom.setAttribute(
  'position', new THREE.BufferAttribute(new Float32Array(9), 3));
export const hoverFace = new THREE.Mesh(hoverGeom, new THREE.MeshBasicMaterial({
  color: 0x4da3ff, transparent: true, opacity: 0.6, side: THREE.DoubleSide,
  depthTest: true, polygonOffset: true,
  polygonOffsetFactor: -4, polygonOffsetUnits: -4, clippingPlanes: clip,
}));
hoverFace.visible = false;
hoverFace.renderOrder = 1;

/** Ray the pointer into the part; returns the intersection or null. */
export function pickFace(ev) {
  if (!part || !topology) return null;
  const r = renderer.domElement.getBoundingClientRect();
  pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1,
              -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = keptHit(raycaster.intersectObject(part, false));
  return hit && hit.faceIndex != null ? hit : null;
}

const AXES = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0),
               z: new THREE.Vector3(0, 0, 1) };
for (const a of ['x', 'y', 'z']) {
  el(`rot-${a}`).addEventListener('click', () => rotate90(a, AXES[a]));
}
el('rot-reset').addEventListener('click', () => {
  if (!part) return;
  histPush();
  part.quaternion.identity();
  el('rot-delta').textContent = '';
  hideSuggestions();   // a manual turn invalidates the ranking's "active" mark
  shade();
});

// Lay a face flat -- armed behind a button so a stray click can't re-lay the part.
el('lay-face').addEventListener('click', () => {
  if (layPlacing) cancelLay();
  else beginLay();
});

// ---- the lay-flat pointer (app.js dispatches here while layActive()) -------

/** Pointer move while armed: highlight the face a click would lay down. */
export function layHover(ev) {
  const hit = pickFace(ev);
  hoverFace.visible = !!hit;
  hoverFace.material.color.setHex(0x4da3ff);   // reset from Draw's green/grey tint
  renderer.domElement.style.cursor = hit ? 'pointer' : '';
  if (!hit) return;

  const pos = hoverGeom.getAttribute('position');
  const src = part.geometry.getAttribute('position').array;
  const o = hit.faceIndex * 9;
  for (let i = 0; i < 9; i++) pos.array[i] = src[o + i];
  pos.needsUpdate = true;
  hoverGeom.computeBoundingSphere();
}

/** A click while armed: lay the part on that face, then disarm. */
export function layClick(e) {
  const hit = pickFace(e);
  if (!hit) return;

  // Snapshot before laying so Ctrl-Z brings the old pose back.
  histPush();
  // Use OUR winding-derived normal, not the STL's stored one, for the same
  // reason the analysis does: exported normals are not trustworthy.
  const i = hit.faceIndex * 3;
  faceNormal.set(topology.nrm[i], topology.nrm[i + 1], topology.nrm[i + 2])
            .applyQuaternion(part.quaternion);
  layQuat.setFromUnitVectors(faceNormal, DOWN);
  part.quaternion.premultiply(layQuat);
  clearSuggestionMark();
  cancelLay();            // one-shot: disarm after a lay so the next click is safe
  shade();
}

window.addEventListener('languagechange', () => { el('lay-face').textContent = layPlacing ? t(t('Click a face to lay it flat — Esc cancels')) : t(t('Lay a face flat')); });
