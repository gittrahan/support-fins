/**
 * Section view (#250): a plane the user moves and turns that hides everything on
 * one side of it -- the part and the supports -- so the inside of a bore or a pipe
 * can be seen and drawn on. View only: it never reaches the build or the export,
 * and it is not saved in sessions or undo.
 *
 * The cut is three.js local clipping: the model materials share scene.js's `clip`
 * array, and switching the section on puts `plane` in it. Picks skip what the cut
 * hides (keptHit), so a click lands on the surface you can see, not the one cut away.
 * Ghost (the default) draws the cut-away half again as faint glass (renderGhost),
 * so the part keeps its context; Hide leaves it out. Clicks go through the glass.
 *
 * One handle, no modes: an arrow pushes the cut along its normal, two rings tilt
 * it. Spinning it about its own normal changes nothing, so that ring is left off.
 *
 * `plane` is in world space, but the cut is held in the PART's frame (followPart):
 * turn the part and the cut turns with it, so it stays on the bore it was opening.
 * Its normal points at the side that is KEPT (three.js discards where the signed
 * distance is < 0).
 */
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { el } from './dom.js';
import { renderer, scene, camera, controls, clip, MODEL } from './scene.js';
import { part } from './part.js';
import { setGizmo } from './pose.js';

export const plane = new THREE.Plane();
const ghostPlane = new THREE.Plane();     // the same cut, keeping the other side
export let sectionOn = false;
const GHOST_KEY = 'sf.sectionGhost';
let ghost = true;
try { ghost = localStorage.getItem(GHOST_KEY) !== '0'; } catch { /* storage off */ }

// The plane's handle: a translucent square plus its outline. Its local +Z is the
// kept side. Not clipped (it is the tool, not the model) and never picked.
const handle = new THREE.Group();
const sheet = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
  color: 0x4da3ff, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false,
}));
const rim = new THREE.LineLoop(
  new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-0.5, -0.5, 0), new THREE.Vector3(0.5, -0.5, 0),
    new THREE.Vector3(0.5, 0.5, 0), new THREE.Vector3(-0.5, 0.5, 0),
  ]),
  new THREE.LineBasicMaterial({ color: 0x4da3ff, transparent: true, opacity: 0.7 }));
handle.add(sheet, rim);
handle.visible = false;
scene.add(handle);

/** One TransformControls per job, both on the handle, both in its local frame. */
function grip(mode) {
  const g = new TransformControls(camera, renderer.domElement);
  g.setMode(mode);
  g.setSpace('local');
  g.setSize(0.7);
  g.attach(handle);
  g.enabled = false;
  scene.add(g.getHelper ? g.getHelper() : g);
  g.addEventListener('dragging-changed', (e) => { controls.enabled = !e.value; });
  g.addEventListener('objectChange', () => { syncPlane(); holdInPart(); });
  return g;
}
const push = grip('translate');            // the normal arrow only
push.showX = push.showY = false;
const tilt = grip('rotate');               // the two in-plane rings only
tilt.showZ = false;
tilt.showXYZE = false;
const grips = [push, tilt];
// Same 5 degree snap as the part's rings; Shift frees it.
const SNAP = THREE.MathUtils.degToRad(5);
tilt.setRotationSnap(SNAP);
addEventListener('keydown', (e) => { if (e.key === 'Shift') tilt.setRotationSnap(null); });
addEventListener('keyup', (e) => { if (e.key === 'Shift') tilt.setRotationSnap(SNAP); });
// Where the arrow crosses a ring, the arrow wins. `push` was created first, so its
// pointerdown runs first; once it has grabbed the arrow, the rings sit this press
// out. (Read from its own event, not a hover axis: touch never hovers.)
push.addEventListener('mouseDown', () => { tilt.enabled = false; });
for (const type of ['pointerup', 'pointercancel']) {
  renderer.domElement.addEventListener(type, () => { tilt.enabled = sectionOn; }, { capture: true });
}

// Shift + scroll pushes the cut 1 mm a notch, scrolling away pushing it deeper.
// The arrow can't do it when you look square at the cut (TransformControls hides
// an axis pointing at the eye) -- the very view the default aim gives a bore seen
// from the side. Captured ahead of OrbitControls so it doesn't zoom as well.
renderer.domElement.addEventListener('wheel', (e) => {
  if (!sectionOn || !e.shiftKey) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const d = e.deltaY || e.deltaX;            // macOS turns Shift+scroll sideways
  if (!d) return;
  const away = camera.getWorldDirection(new THREE.Vector3()).dot(plane.normal) >= 0 ? 1 : -1;
  handle.translateZ(-Math.sign(d) * away);   // scrolling up/away: deeper
  syncPlane();
  holdInPart();
}, { capture: true, passive: false });

const nrm = new THREE.Vector3();
/** Read the handle's pose into the clipping plane (and its ghost twin). */
function syncPlane() {
  handle.updateMatrixWorld();
  nrm.set(0, 0, 1).applyQuaternion(handle.quaternion);
  plane.setFromNormalAndCoplanarPoint(nrm, handle.position);
  ghostPlane.copy(plane).negate();
}

// The handle's pose in the part's frame, so the cut follows the part when it turns.
const inPart = new THREE.Matrix4();
const m4 = new THREE.Matrix4();

/** Remember where the handle sits on the part (after the user or a button moved it). */
function holdInPart() {
  if (!part) return;
  part.updateMatrixWorld();
  handle.updateMatrix();
  inPart.copy(part.matrixWorld).invert().multiply(handle.matrix);
}

/** The part turned or reseated (part.js shade): carry the cut along with it. */
export function followPart() {
  if (!sectionOn || !part || grips.some((g) => g.dragging)) return;
  part.updateMatrixWorld();
  m4.multiplyMatrices(part.matrixWorld, inPart);
  m4.decompose(handle.position, handle.quaternion, handle.scale);
  syncPlane();
}

/** The part's world-space box: where the plane starts and how big it draws. */
function partBox() {
  return new THREE.Box3().setFromObject(part);
}

/** Size the square to the part, so it reads as a cut through it at any scale. */
function sizeSheet() {
  const s = partBox().getSize(new THREE.Vector3()).length() * 1.2;
  sheet.scale.set(s, s, 1);
  rim.scale.set(s, s, 1);
}

/**
 * Aim the cut at the view: through the part's centre, square to whichever of the
 * PART's own axes points most nearly where the camera looks, keeping the far half.
 * Bores in a CAD part run along its axes, so looking at the side of one and
 * switching the section on opens it lengthwise -- not the slice across it that a
 * cut square to the screen would make.
 */
function aimAtView() {
  const look = camera.getWorldDirection(new THREE.Vector3());
  part.updateMatrixWorld();
  let best = null, most = -1;
  for (let i = 0; i < 3; i++) {
    const a = new THREE.Vector3().setFromMatrixColumn(part.matrixWorld, i).normalize();
    const d = a.dot(look);
    if (Math.abs(d) > most) { most = Math.abs(d); best = d < 0 ? a.negate() : a; }
  }
  partBox().getCenter(handle.position);
  handle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), best);
  syncPlane();
  holdInPart();
}

/** The first hit the cut leaves visible (hits come sorted nearest first). */
export function keptHit(hits) {
  if (!sectionOn) return hits[0];
  return hits.find((h) => plane.distanceToPoint(h.point) >= 0);
}

/** The plane's handle is up: the part's rings step aside for it. */
export const planeHandleShown = () => sectionOn;
/** The pointer is on (or dragging) a plane handle: app.js leaves the click to it. */
export const planeBusy = () => sectionOn && grips.some((g) => g.dragging || !!g.axis);

// ---- ghost: the cut-away half as glass --------------------------------------
// A second pass over the model only (scene.js's MODEL layer: part, fins, pad, walls),
// clipped to the other side, translucent, not writing depth -- so the solid half
// still hides what is behind it and the glass never blocks a later pick.
const ghostMat = new THREE.MeshStandardMaterial({
  color: 0xb9c2d0, roughness: 0.7, transparent: true, opacity: 0.14,
  depthWrite: false, side: THREE.DoubleSide, clippingPlanes: [ghostPlane],
});

/** After the main render: draw the cut-away half as glass, if Ghost is on. */
export function renderGhost() {
  if (!sectionOn || !ghost) return;
  const bg = scene.background, autoClear = renderer.autoClear;
  scene.background = null;
  renderer.autoClear = false;
  scene.overrideMaterial = ghostMat;
  camera.layers.set(MODEL);
  renderer.render(scene, camera);
  camera.layers.set(0);
  scene.overrideMaterial = null;
  renderer.autoClear = autoClear;
  scene.background = bg;
}

// ---- the controls -----------------------------------------------------------

function syncGizmo() {
  for (const g of grips) {
    g.enabled = sectionOn;
    if (!sectionOn) g.axis = null;
    (g.getHelper ? g.getHelper() : g).visible = sectionOn;
  }
  handle.visible = sectionOn;
}

function syncUI() {
  const b = el('section');
  b.classList.toggle('primary', sectionOn);
  b.setAttribute('aria-pressed', String(sectionOn));
  el('section-tools').hidden = !sectionOn;
  for (const [id, on] of [['section-ghost', ghost], ['section-hide', !ghost]]) {
    el(id).classList.toggle('primary', on);
    el(id).setAttribute('aria-pressed', String(on));
  }
}

/** Switch the cut on (aimed at the current view) or off. */
export function setSection(on) {
  sectionOn = !!on && !!part;
  clip.length = 0;
  if (sectionOn) {
    sizeSheet();
    aimAtView();
    clip.push(plane);
  }
  syncGizmo();
  syncUI();
  setGizmo();
}

// The button sits in the Display header: a click on it must not fold the section,
// and switching on opens it, so the cut's own controls are in view.
el('section').addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  setSection(!sectionOn);
  if (sectionOn) el('section').closest('details').open = true;
});

for (const [id, v] of [['section-ghost', true], ['section-hide', false]]) {
  el(id).addEventListener('click', () => {
    ghost = v;
    try { localStorage.setItem(GHOST_KEY, ghost ? '1' : '0'); } catch { /* storage off */ }
    syncUI();
  });
}

el('section-flip').addEventListener('click', () => {
  handle.rotateX(Math.PI);
  syncPlane();
  holdInPart();
});

el('section-reset').addEventListener('click', () => { if (sectionOn) aimAtView(); });
