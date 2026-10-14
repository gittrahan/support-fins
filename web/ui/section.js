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
 * The sheet itself pushes too: grab it anywhere outside the part's outline (over
 * the part, a click is the part's) and drag.
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
import { addBadge } from './toolbar.js';

export const plane = new THREE.Plane();
const ghostPlane = new THREE.Plane();     // the same cut, keeping the other side
export let sectionOn = false;
const GHOST_KEY = 'sf.sectionGhost';
let ghost = true;
try { ghost = localStorage.getItem(GHOST_KEY) !== '0'; } catch { /* storage off */ }

// The plane's handle: a translucent square plus its outline. Its local +Z is the
// kept side. Not clipped (it is the tool, not the model); no pick lands on it,
// but it can be grabbed and dragged (below).
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
  // Hidden until the section is on: attached to the (hidden) handle, its rings
  // would otherwise draw at the origin over the empty page.
  const helper = g.getHelper ? g.getHelper() : g;
  helper.visible = false;
  scene.add(helper);
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
export const planeBusy = () => sectionOn && (!!sheetDrag || grips.some((g) => g.dragging || !!g.axis));

// ---- the sheet: grab it and drag to push the cut ---------------------------
// Only where the sheet is NOT over the solid part: there a press is the part's
// (Draw, select, Lay flat), and clicks go through the glass to it. Nor near the
// handle's centre, where the arrow and rings are -- on touch there is no hover to
// tell, so a margin keeps the sheet from stealing a press meant for them.
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const SHEET = 0.08, SHEET_HOT = 0.18;
const HANDLE_PX = 80;
let sheetDrag = null;          // { id, p0, h0, n, y0, wpp } while dragging
let hot = false, cursorWas = '';

function aim(e) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
  ray.setFromCamera(ndc, camera);
  return r;
}

/** Where a press would grab the sheet, or null (off it, over the part, at the handle). */
function sheetPoint(e) {
  if (!sectionOn || grips.some((g) => g.dragging || g.axis)) return null;
  const r = aim(e);
  const c = handle.position.clone().project(camera);
  const cx = r.left + (c.x + 1) / 2 * r.width, cy = r.top + (1 - c.y) / 2 * r.height;
  if (Math.hypot(e.clientX - cx, e.clientY - cy) < HANDLE_PX) return null;
  ray.layers.set(0);
  const hit = ray.intersectObject(sheet)[0];
  if (!hit) return null;
  ray.layers.set(MODEL);
  if (keptHit(ray.intersectObjects(scene.children, true))) return null;
  return hit.point;
}

function setHot(v) {
  if (v === hot) return;
  hot = v;
  sheet.material.opacity = v ? SHEET_HOT : SHEET;
  const st = renderer.domElement.style;
  if (v) { cursorWas = st.cursor; st.cursor = 'grab'; } else st.cursor = cursorWas;
}

// Capture phase, ahead of OrbitControls, TransformControls and app.js's picks: a
// press that grabs the sheet is the sheet's alone.
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const p0 = sheetPoint(e);
  if (!p0) return;
  e.stopImmediatePropagation();
  e.preventDefault();
  const r = renderer.domElement.getBoundingClientRect();
  const dist = camera.position.distanceTo(p0);
  sheetDrag = {
    id: e.pointerId, p0, h0: handle.position.clone(), n: plane.normal.clone(), y0: e.clientY,
    // mm per pixel at the sheet, for the face-on case below
    wpp: 2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / r.height,
  };
  renderer.domElement.setPointerCapture(e.pointerId);
  setHot(true);
  renderer.domElement.style.cursor = 'grabbing';
}, { capture: true });

const dragPlane = new THREE.Plane();
const v3 = new THREE.Vector3();
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!sheetDrag) { setHot(!e.buttons && !!sheetPoint(e)); return; }   // not mid-orbit
  if (e.pointerId !== sheetDrag.id) return;
  const { p0, h0, n } = sheetDrag;
  const look = camera.getWorldDirection(new THREE.Vector3());
  // Slide along the normal: on the plane through it that faces the camera most.
  // Looking (nearly) square at the sheet there is no such plane -- then up the
  // screen pushes it away from you, like Shift + scroll.
  const across = look.clone().addScaledVector(n, -look.dot(n));
  let t;
  if (across.length() > 0.25) {
    aim(e);
    dragPlane.setFromNormalAndCoplanarPoint(across.normalize(), p0);
    if (!ray.ray.intersectPlane(dragPlane, v3)) return;
    t = v3.sub(p0).dot(n);
  } else {
    t = (sheetDrag.y0 - e.clientY) * sheetDrag.wpp * Math.sign(look.dot(n));
  }
  handle.position.copy(h0).addScaledVector(n, t);
  syncPlane();
  holdInPart();
}, { capture: true });

function endSheetDrag(e) {
  if (!sheetDrag || e.pointerId !== sheetDrag.id) return;
  sheetDrag = null;
  renderer.domElement.style.cursor = 'grab';
  setHot(!!sheetPoint(e));
}
renderer.domElement.addEventListener('pointerup', endSheetDrag, { capture: true });
renderer.domElement.addEventListener('pointercancel', endSheetDrag, { capture: true });

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
  if (!sectionOn) { sheetDrag = null; setHot(false); }
}

function syncUI() {
  syncBadge();
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

// Its badge in the view toolbar (toolbar.js): on aims the cut at the view and
// opens Ghost/Hide, Flip and Re-aim above it.
const syncBadge = addBadge('section', {
  pop: 'section-pop', isOn: () => sectionOn, setOn: (v) => setSection(v),
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
