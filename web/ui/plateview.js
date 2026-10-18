import { t } from './i18n.js';
/**
 * The plates on screen together (ui/plates.js): one row along X, each with its bed,
 * a "Plate N" label in front of it, and every model but the live one where it stands
 * on its plate (ui/models.js), with its fins as they were left, dimmed. Display only:
 * the live model is at the origin, as every tool expects, and the row and the
 * edited plate's bed are laid out around it -- shifted by minus its spot -- so a
 * switch slides them and the camera glides after.
 */
import * as THREE from 'three';
import { scene, plate, camera, controls, renderer, requestRender, meshFrom, frame } from './scene.js';
import { currentVolume } from './volume.js';

const row = new THREE.Group();
scene.add(row);

// a parked part keeps its overhang colours, a shade darker, and is never clipped by
// the section cut (that belongs to the plate being edited)
const ghostPart = new THREE.MeshStandardMaterial({
  color: 0x9aa1ad, roughness: 0.7, metalness: 0.05, vertexColors: true, side: THREE.DoubleSide,
});
const ghostFin = new THREE.MeshStandardMaterial({
  color: 0x3d8a64, roughness: 0.7, metalness: 0, side: THREE.DoubleSide,
});

/** Centre to centre between plates along X. */
export const pitch = () => {
  const v = currentVolume();
  return v.x + Math.max(20, 0.12 * v.x);
};

/** A plate's fins as they stand (print space), for its parked copy; null if none. */
export const ghostFins = (tris) => meshFrom(tris, ghostFin);

/** The parked copy is the stashed mesh itself: give it the ghost look. */
export const parkMesh = (mesh) => { mesh.material = ghostPart; };

function label(text, current) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.font = '600 64px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = current ? '#4da3ff' : '#8d95a5';
  g.fillText(text, 256, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const v = currentVolume();
  const w = Math.min(90, v.x * 0.45);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.position.set(0, -v.y / 2 - w / 6, 0.05);
  m.userData.label = true;
  return m;
}

/**
 * Lay the row out for `plates` with `active` being edited. Parked parts and their
 * fins are re-parented here (they belong to the slots' stashes and are not disposed).
 */
export function drawRow(plates, active) {
  for (const g of row.children) {
    for (const c of g.children) {
      if (c.userData.label) { c.geometry.dispose(); c.material.map.dispose(); c.material.dispose(); }
    }
  }
  row.clear();
  const edited = plates[active], [lx, ly] = edited.models[edited.live].xy;
  row.position.set(-lx, -ly, 0);
  plate.position.set(-lx, -ly, 0);
  const p = pitch();
  plates.forEach((pl, i) => {
    const g = new THREE.Group();
    g.position.x = (i - active) * p;
    g.userData.plate = i;
    // one plate on its own needs no label: there is nothing to tell apart
    if (plates.length > 1) g.add(label(t('Plate {n}', { n: i + 1 }), i === active));
    // the bed: grid and outline, not the build-volume box
    if (i !== active) for (const c of plate.children) if (!(c instanceof THREE.Box3Helper)) g.add(c.clone());
    pl.models.forEach((m, k) => {
      const s = m.stash;
      if (!s || (i === active && k === pl.live)) return;
      const at = new THREE.Group();
      at.position.set(m.xy[0], m.xy[1], 0);
      at.userData.model = k;
      at.add(s.part.mesh);
      if (s.fins) at.add(s.fins);
      g.add(at);
    });
    row.add(g);
  });
  requestRender();
}

const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const bed = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const hit = new THREE.Vector3();

/** What a pointer event is on: { plate, model } as indices into the row and that
 *  plate's models (model -1 for its bare bed), or null for nothing -- also when
 *  `live` (the live model, its fins, walls, cut handle) is hit first: that click is
 *  for the model being edited, whatever lies behind it. */
export function plateAt(e, count, active, live) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const near = ray.intersectObjects(live.filter(Boolean), true).find((h) => h.object.isMesh)?.distance ?? Infinity;
  // a parked part standing up off its bed, then the beds themselves
  for (const h of ray.intersectObjects(row.children, true)) {
    if (h.distance > near) return null;
    if (!h.object.isMesh || h.object.userData.label) continue;
    let o = h.object, model = -1;
    while (o && o.parent !== row) {
      if (o.userData.model !== undefined) model = o.userData.model;
      o = o.parent;
    }
    if (o) return { plate: o.userData.plate, model };
  }
  if (!ray.ray.intersectPlane(bed, hit) || ray.ray.origin.distanceTo(hit) > near) return null;
  const v = currentVolume(), p = pitch();
  const x0 = hit.x - row.position.x, y = hit.y - row.position.y;
  const i = Math.round(x0 / p) + active;
  if (i < 0 || i >= count) return null;
  const x = x0 - (i - active) * p;
  return Math.abs(x) <= v.x / 2 && Math.abs(y) <= v.y / 2 + 30 ? { plate: i, model: -1 } : null;
}

/** Ease the camera from `fromPos` / `fromTarget` to where it is now. */
export function glide(fromPos, fromTarget, ms = 450) {
  const toPos = camera.position.clone(), toTarget = controls.target.clone();
  const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / ms);
    const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    camera.position.lerpVectors(fromPos, toPos, e);
    controls.target.lerpVectors(fromTarget, toTarget, e);
    controls.update();
    requestRender();
    if (k < 1) requestAnimationFrame(step);
  };
  camera.position.copy(fromPos);
  controls.target.copy(fromTarget);
  requestAnimationFrame(step);
}

/** Pull the camera back to take in every plate of the row; `xy` is where the live
 *  model stands on its plate (the row is drawn shifted by minus it). */
export function frameAll(count, active, [lx, ly]) {
  const v = currentVolume(), p = pitch();
  const fromPos = camera.position.clone(), fromTarget = controls.target.clone();
  frame(new THREE.Vector3((count - 1) * p / 2 + v.x / 2, v.y / 2, 0));
  const cx = ((count - 1) / 2 - active) * p - lx;
  camera.position.x += cx;
  camera.position.y -= ly;
  controls.target.set(cx, -ly, 0);
  controls.update();
  glide(fromPos, fromTarget);
}
