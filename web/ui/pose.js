/**
 * The pose: the rotate gizmo, the 90-degree and reset buttons, and "Lay a face
 * flat" with its hovered-face highlight. app.js's pointer dispatch calls
 * layHover / layClick while layActive().
 */
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { el } from './dom.js';
import { renderer, scene, camera, controls, raycaster, pointer } from './scene.js';
import { removeActive } from './remove.js';
import { histPush } from './history.js';
import { hideSuggestions, clearSuggestionMark } from './suggest.js';
import { drawActive, clearPreview } from './walls.js';
import { refreshFins } from './finbuild.js';
import { finsVisible } from './settings.js';
import { part, topology, shade } from './part.js';

// The user rotates. Always. Auto-orientation may suggest, never apply -- the
// spike's strength-optimal pose for one hub was 155mm tall balanced on a needle:
// geometrically valid, unprintable.
export const gizmo = new TransformControls(camera, renderer.domElement);
gizmo.setMode('rotate');
gizmo.setSize(0.85);
scene.add(gizmo.getHelper ? gizmo.getHelper() : gizmo);
const dragFrom = new THREE.Quaternion();   // pose at drag start: did the drag turn it?
gizmo.addEventListener('dragging-changed', (e) => {
  controls.enabled = !e.value;
  if (e.value && part) dragFrom.copy(part.quaternion);
  if (!e.value) {
    el('rot-delta').textContent = '';
    if (part && !part.quaternion.equals(dragFrom)) clearSuggestionMark();
    // Drag released: reseat onto the plate now the pivot is allowed to move again
    // (shade() holds part.position steady WHILE dragging -- see the note there --
    // so this is the frame that actually drops the turned part back down).
    shade();
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
 */
let shadeQueued = false;
function requestShade() {
  if (shadeQueued) return;
  shadeQueued = true;
  requestAnimationFrame(() => { shadeQueued = false; shade(); });
}

function showDelta(axis, radians) {
  if (!axis || !radians) return;
  const label = axis.length > 1 ? 'free' : axis;   // 'XYZE' / 'E' are screen-space
  const deg = THREE.MathUtils.radToDeg(radians);
  el('rot-delta').textContent =
    `${label} ${deg >= 0 ? '+' : ''}${deg.toFixed(deg % 1 ? 1 : 0)}°`;
}

export let layPlacing = false;     // true while "lay a face flat" is armed -- gated behind a
                            // button so a stray viewport click can't re-lay the part
export function setLayPlacing(v) { layPlacing = v; }   // undo/redo disarms it directly

/** "Lay a face flat" is armed: a face click lays the part on that face. Off by
 *  default so casual clicks orbit instead of silently re-laying the part. */
export const layActive = () => layPlacing;

/** Enable the rotate gizmo only when NOT drawing or laying a face flat --
 *  its handles would otherwise swallow the clicks those modes need. */
export function setGizmo() {
  const on = !!part && !drawActive() && !layActive() && !removeActive();
  gizmo.enabled = on;
  const helper = gizmo.getHelper ? gizmo.getHelper() : gizmo;
  helper.visible = on;
}

// ---- Lay a face flat (armed behind a button so stray clicks can't re-lay) -------

/** Arm face-lay: the next face click lays the part on that face. Modal so a click
 *  isn't swallowed by the rotate gizmo; hovering highlights the face. */
function beginLay() {
  if (!part || !topology) return;
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
  el('lay-face').textContent = layPlacing ? 'Click a face to lay it flat — Esc cancels'
    : 'Lay a face flat';
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
  polygonOffsetFactor: -4, polygonOffsetUnits: -4,
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
  const hit = raycaster.intersectObject(part, false)[0];
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
