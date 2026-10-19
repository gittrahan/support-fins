/**
 * The Move tool: models slide across their plate (ui/models.js). On (the toolbar's
 * Move, or M; Esc leaves it), a drag that starts on a model moves it -- the one being
 * edited or a parked one -- and a drag anywhere else still orbits. Fins are built
 * in the model's own print space, so a move rebuilds nothing: the model's spot on
 * the plate (its slot's `xy`) is all that changes.
 *
 * The live model stays at the origin, where every tool expects it; moving it shifts
 * the bed and the parked models the other way (plateview.js shiftRow), and the camera
 * with them, so on screen the bed stays put and the model moves. Each drag is one
 * step of the plate's undo (history.js pushMove).
 */
import * as THREE from 'three';
import { camera, controls, renderer, viewport, requestRender } from './scene.js';
import { part, updateFit } from './part.js';
import { finMesh, padMesh } from './finbuild.js';
import { drawnMesh } from './walls.js';
import { addBadge } from './toolbar.js';
import { pushMove } from './history.js';
import { setGizmo } from './pose.js';
import { currentPlate, isBusy, redraw } from './plates.js';
import { parkedAt, shiftRow, parkedGroup } from './plateview.js';

let moving = false;
/** The Move tool is on: a press on a model drags it, and no other tool picks. */
export const moveActive = () => moving && !!part;

export function setMove(v) {
  moving = !!v && !!part;
  if (!moving) endDrag();
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

let drag = null;     // { m, from (its xy at the press), grab (the plate point pressed), moved }

/** Put live slot `m` at `xy`: the world shifts by the difference, the camera with it. */
function placeLive(m, xy) {
  const dx = xy[0] - m.xy[0], dy = xy[1] - m.xy[1];
  m.xy = xy;
  camera.position.x -= dx; camera.position.y -= dy;
  controls.target.x -= dx; controls.target.y -= dy;
  controls.update();
  shiftRow(xy);
}

/** Put slot `m` of the plate being edited at `xy` (an undo of a move, or a drag's end). */
export function placeSlot(m, xy) {
  const p = currentPlate();
  if (p.models[p.live] === m) placeLive(m, xy);
  else m.xy = xy;
  redraw();
  updateFit();
}

// Before the orbit controls see the press (capture, on an ancestor): a press on a
// model is the move's, and the controls sit it out.
viewport.addEventListener('pointerdown', (e) => {
  if (!moveActive() || e.button !== 0 || isBusy() || e.target !== renderer.domElement) return;
  const at = modelAt(e);
  if (!at) return;
  bed.constant = -at.z;
  const grab = plateAtPointer(e);
  if (!grab) return;
  const { m } = at;
  drag = { m, from: m.xy.slice(), grab, moved: false };
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
  const at = plateAtPointer(e);
  if (!at) return;
  const xy = [round(drag.from[0] + at[0] - drag.grab[0]), round(drag.from[1] + at[1] - drag.grab[1])];
  if (!drag.moved && Math.hypot(xy[0] - drag.from[0], xy[1] - drag.from[1]) < 0.5) return;
  drag.moved = true;
  const p = currentPlate();
  if (p.models[p.live] === drag.m) placeLive(drag.m, xy);
  else {
    drag.m.xy = xy;
    parkedGroup(p.models.indexOf(drag.m))?.position.set(xy[0], xy[1], 0);
  }
  requestRender();
});

function endDrag() {
  if (!drag) return;
  const { m, from, moved } = drag;
  drag = null;
  controls.enabled = true;
  renderer.domElement.style.cursor = '';
  if (!moved) return;
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
  if (e.key === 'Escape' && moving) { setMove(false); return; }
  if (e.key.toLowerCase() === 'm' && !e.repeat) setMove(!moving);
});

// a model removed, or another loaded: the tool stays on only with a model to move
document.addEventListener('partchange', () => { if (moving && !part) setMove(false); });
