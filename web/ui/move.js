/**
 * The Move tool: models slide across their plate (ui/models.js). On (the toolbar's
 * Move, or M; Esc leaves it), a drag that starts on a model moves it -- the one being
 * edited or a parked one -- and a drag anywhere else still orbits. Fins are built
 * in the model's own print space, so a move rebuilds nothing: the model's spot on
 * the plate (its slot's `xy`) is all that changes.
 *
 * The live model stays at the origin, where every tool expects it; moving it shifts
 * the bed and the parked models the other way (plateview.js shiftRow), and the camera
 * with them, so on screen the bed stays put and the model moves. A drag never pushes
 * one model into another (footprint.js dragStep): it stops where they would touch.
 * Each drag is one step of the plate's undo (history.js pushMove) -- but one dropped
 * with its middle over another plate's bed moves the model to that plate
 * (plates.js moveToPlate), with an Undo in the toast; that plate is lit meanwhile.
 */
import * as THREE from 'three';
import { camera, controls, renderer, viewport, requestRender } from './scene.js';
import { part, updateFit } from './part.js';
import { finMesh, padMesh } from './finbuild.js';
import { drawnMesh } from './walls.js';
import { addBadge } from './toolbar.js';
import { pushMove } from './history.js';
import { setGizmo } from './pose.js';
import { currentPlate, isBusy, redraw, plateCount, activePlate, moveToPlate } from './plates.js';
import { parkedAt, shiftRow, parkedGroup, markTarget, pitch } from './plateview.js';
import { plateUnder } from './platerow.js';
import { currentVolume } from './volume.js';
import { planeBusy } from './section.js';
import { cancelLay, layActive } from './pose.js';
import { cancelRemove, removeActive } from './remove.js';
import { checkOverlap, clashAt } from './arrange.js';
import { dragStep } from './footprint.js';

let moving = false;
/** The Move tool is on: a press on a model drags it, and no other tool picks. */
export const moveActive = () => moving && !!part;

export function setMove(v) {
  if ((!!v && !!part) === moving) return;   // a picker arming with Move off: its cursor stays
  moving = !!v && !!part;
  if (!moving) endDrag();
  // the armed pickers wait on a click Move would take: one pointer mode at a time
  if (moving && layActive()) cancelLay();
  if (moving && removeActive()) cancelRemove();
  renderer.domElement.style.cursor = '';
  setGizmo();          // the rotate rings would take the press
  syncBadge();
}

const syncBadge = addBadge('move-badge', { isOn: () => moving, setOn: setMove });

const bed = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const hit = new THREE.Vector3();
const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
const round = (v) => Math.round(v * 10) / 10;

/** Where on the plate (its own coordinates: the live model's spot added back) the
 *  pointer is, on the level `bed` is set to (the height the model was grabbed at, so
 *  that point stays under the pointer); null when the ray misses it. */
function plateAtPointer(e) {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  if (!raycaster.ray.intersectPlane(bed, hit)) return null;
  const p = currentPlate(), [lx, ly] = p.models[p.live].xy;
  return [hit.x + lx, hit.y + ly];
}

/** The model of the plate being edited under the pointer, { m (its slot), z (the
 *  height it was hit at) }, or null. */
function modelAt(e) {
  const p = currentPlate();
  const r = renderer.domElement.getBoundingClientRect();
  pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const live = [part, finMesh, padMesh, drawnMesh].filter(Boolean);
  const h = raycaster.intersectObjects(live, true).find((x) => x.object.isMesh);
  if (h) return { m: p.models[p.live], z: h.point.z };
  // a parked one, on this plate only (another plate's is a switch, plates.js)
  const k = parkedAt(e);
  return k.model >= 0 ? { m: p.models[k.model], z: k.z } : null;
}

// { m, from (its xy at the press), grab (the plate point pressed), id (the pointer),
// moved, to (the other plate it is over: plateUnder) }
let drag = null;
/** A model is being dragged: Undo waits for the drop (history.js step). */
export const dragging = () => !!drag;

/** Put live slot `m` at `xy`: the world shifts by the difference, the camera with it. */
function placeLive(m, xy) {
  const dx = xy[0] - m.xy[0], dy = xy[1] - m.xy[1];
  m.xy = xy;
  camera.position.x -= dx; camera.position.y -= dy;
  controls.target.x -= dx; controls.target.y -= dy;
  controls.update();
  shiftRow(xy);
}

/** Put each slot `who` of the plate being edited at its `xy` (an undo of a move, or
 *  Arrange). */
export function placeSlots(moves) {
  const p = currentPlate();
  for (const { who, xy } of moves) {
    if (p.models[p.live] === who) placeLive(who, xy.slice());
    else who.xy = xy.slice();
  }
  redraw();
  updateFit();
}

// Before the orbit controls see the press (capture, on an ancestor): a press on a
// model is the move's, and the controls sit it out.
viewport.addEventListener('pointerdown', (e) => {
  // one drag at a time (a second finger is the controls' pinch); the section's
  // handle keeps its own press
  if (!moveActive() || drag || e.button !== 0 || isBusy() || planeBusy()
      || e.target !== renderer.domElement) return;
  const at = modelAt(e);
  if (!at) return;
  bed.constant = -at.z;
  const grab = plateAtPointer(e);
  if (!grab) return;
  const { m } = at;
  drag = { m, from: m.xy.slice(), grab, id: e.pointerId, moved: false };
  controls.enabled = false;
  renderer.domElement.setPointerCapture(e.pointerId);
  renderer.domElement.style.cursor = 'grabbing';
}, true);

renderer.domElement.addEventListener('pointermove', (e) => {
  if (!moveActive()) return;
  if (!drag) {
    renderer.domElement.style.cursor = e.buttons ? '' : modelAt(e) ? 'grab' : '';
    return;
  }
  if (e.pointerId !== drag.id) return;
  const at = plateAtPointer(e);
  if (!at) return;
  const to = [round(drag.from[0] + at[0] - drag.grab[0]), round(drag.from[1] + at[1] - drag.grab[1])];
  if (!drag.moved && Math.hypot(to[0] - drag.from[0], to[1] - drag.from[1]) < 0.5) return;
  // never into another model: it stops short, or slides along the other's edge
  const xy = dragStep(drag.m.xy, to, (q) => clashAt(drag.m, q));
  if (xy === drag.m.xy) return;
  drag.moved = true;
  const p = currentPlate();
  if (p.models[p.live] === drag.m) placeLive(drag.m, xy);
  else {
    drag.m.xy = xy;
    parkedGroup(p.models.indexOf(drag.m))?.position.set(xy[0], xy[1], 0);
  }
  if (checkOverlap()) updateFit();     // the clash shows as it goes
  drag.to = over(xy);
  markTarget(drag.to?.plate ?? null, activePlate());
  requestRender();
});

/** The other plate a model at `xy` (the edited plate's coordinates) would be dropped
 *  on, { plate, xy }, or null. */
function over(xy) {
  const v = currentVolume();
  return plateUnder(xy, activePlate(), plateCount(), pitch(), v.x, v.y);
}

function endDrag(e) {
  if (!drag || (e?.pointerId !== undefined && e.pointerId !== drag.id)) return;
  const { m, from, moved, to } = drag;
  drag = null;
  controls.enabled = true;
  renderer.domElement.style.cursor = '';
  markTarget(null);
  if (!moved) return;
  // dropped over another plate: the model goes to it, with an Undo in the toast
  // (the switch emptied the page a moment, which turned Move off: it stays on)
  if (to && moveToPlate(m, to.plate, to.xy, from)) { setMove(true); return; }
  pushMove(m, from);
  redraw();
  updateFit();
}
renderer.domElement.addEventListener('pointerup', endDrag);
renderer.domElement.addEventListener('pointercancel', endDrag);

addEventListener('keydown', (e) => {
  if (!part || e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  // Esc closes an open menu or popover first (its own handler); only then Move
  if (e.key === 'Escape' && moving) {
    if (!document.querySelector('[aria-expanded="true"]')) setMove(false);
    return;
  }
  if (e.key.toLowerCase() === 'm' && !e.repeat) setMove(!moving);
}, true);     // capture: before a menu's own Esc has closed it

// a model removed, or another loaded: the tool stays on only with a model to move
document.addEventListener('partchange', () => { if (moving && !part) setMove(false); });
