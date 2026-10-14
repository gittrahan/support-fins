/**
 * Section view (#250): a plane the user moves and turns that hides everything on
 * one side of it -- the part and the supports -- so the inside of a bore or a pipe
 * can be seen and drawn on. View only: it never reaches the build or the export,
 * and it is not saved in sessions or undo.
 *
 * The cut is three.js local clipping: the model materials share scene.js's `clip`
 * array, and switching the section on puts `plane` in it. Picks skip what the cut
 * hides (keptHit), so a click lands on the surface you can see, not the one cut away.
 *
 * `plane` is in world space, but the cut is held in the PART's frame (followPart):
 * turn the part and the cut turns with it, so it stays on the bore it was opening.
 * Its normal points at the side that is KEPT (three.js discards where the signed
 * distance is < 0).
 */
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { el } from './dom.js';
import { renderer, scene, camera, controls, clip } from './scene.js';
import { part } from './part.js';
import { setGizmo } from './pose.js';

export const plane = new THREE.Plane();
export let sectionOn = false;
let handleMode = 'translate';      // 'translate' | 'rotate' | null (handle hidden)

// The plane's handle: a translucent square plus its outline. Its local +Z is the
// kept side. Not clipped (it is the tool, not the model) and never picked.
const handle = new THREE.Group();
const sheet = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
  color: 0x4da3ff, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false,
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

export const planeGizmo = new TransformControls(camera, renderer.domElement);
planeGizmo.setSize(0.7);
// Local space: Move's one arrow slides the cut along its own normal, straight
// through the part, whatever way it has been turned.
planeGizmo.setSpace('local');
planeGizmo.attach(handle);
const planeHelper = planeGizmo.getHelper ? planeGizmo.getHelper() : planeGizmo;
scene.add(planeHelper);
planeGizmo.addEventListener('dragging-changed', (e) => { controls.enabled = !e.value; });
planeGizmo.addEventListener('objectChange', () => { syncPlane(); holdInPart(); });
// Same 5 degree snap as the part's rings; Shift frees it.
const SNAP = THREE.MathUtils.degToRad(5);
planeGizmo.setRotationSnap(SNAP);
addEventListener('keydown', (e) => { if (e.key === 'Shift') planeGizmo.setRotationSnap(null); });
addEventListener('keyup', (e) => { if (e.key === 'Shift') planeGizmo.setRotationSnap(SNAP); });

const nrm = new THREE.Vector3();
/** Read the handle's pose into the clipping plane. */
function syncPlane() {
  handle.updateMatrixWorld();
  nrm.set(0, 0, 1).applyQuaternion(handle.quaternion);
  plane.setFromNormalAndCoplanarPoint(nrm, handle.position);
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
  if (!sectionOn || !part || planeGizmo.dragging) return;
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

/** Stand the plane through the part's centre with its kept side along `n`. */
function placeThroughCentre(n) {
  partBox().getCenter(handle.position);
  handle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n.clone().normalize());
  syncPlane();
  holdInPart();
}

/** The first hit the cut leaves visible (hits come sorted nearest first). */
export function keptHit(hits) {
  if (!sectionOn) return hits[0];
  return hits.find((h) => plane.distanceToPoint(h.point) >= 0);
}

/** The plane handle is up and live: the part's rings step aside for it. */
export const planeHandleShown = () => sectionOn && handleMode !== null;
/** The pointer is on (or dragging) a plane handle: app.js leaves the click to it. */
export const planeBusy = () => planeHandleShown() && (planeGizmo.dragging || !!planeGizmo.axis);

function syncGizmo() {
  const on = planeHandleShown();
  planeGizmo.enabled = on;
  if (!on) planeGizmo.axis = null;
  if (handleMode) planeGizmo.setMode(handleMode);
  // Move shows only the normal arrow: sliding the cut within its own plane does nothing.
  planeGizmo.showX = planeGizmo.showY = handleMode !== 'translate';
  planeHelper.visible = on;
  handle.visible = sectionOn;
}

function syncUI() {
  el('section').checked = sectionOn;
  el('section-tools').hidden = !sectionOn;
  for (const [id, mode] of [['section-move', 'translate'], ['section-turn', 'rotate']]) {
    const b = el(id);
    b.classList.toggle('primary', handleMode === mode);
    b.setAttribute('aria-pressed', String(handleMode === mode));
  }
}

/** Switch the cut on or off. On starts it upright through the part's centre,
 *  facing the camera, hiding the near half -- the cut a horizontal pipe wants. */
export function setSection(on) {
  sectionOn = !!on && !!part;
  clip.length = 0;
  if (sectionOn) {
    sizeSheet();
    const look = camera.getWorldDirection(new THREE.Vector3());
    look.z = 0;
    if (look.lengthSq() < 1e-6) look.set(0, 1, 0);   // looking straight down
    placeThroughCentre(look);
    handleMode = 'translate';
    clip.push(plane);
  }
  syncGizmo();
  syncUI();
  setGizmo();
}

el('section').addEventListener('change', (e) => setSection(e.target.checked));

// Move / Turn pick the handle; clicking the lit one again puts the handle away,
// leaving the cut in place and the whole view to Draw.
for (const [id, mode] of [['section-move', 'translate'], ['section-turn', 'rotate']]) {
  el(id).addEventListener('click', () => {
    handleMode = handleMode === mode ? null : mode;
    syncGizmo();
    syncUI();
    setGizmo();
  });
}

el('section-flip').addEventListener('click', () => {
  handle.rotateX(Math.PI);
  syncPlane();
  holdInPart();
});

const AXES = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0),
               z: new THREE.Vector3(0, 0, 1) };
for (const a of ['x', 'y', 'z']) {
  el(`section-${a}`).addEventListener('click', () => {
    // keep the side that is kept now: snap to the axis direction nearest the normal
    const n = AXES[a].clone();
    if (plane.normal.dot(n) < 0) n.negate();
    placeThroughCentre(n);
  });
}

