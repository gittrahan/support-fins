/**
 * Strength: the load arrow (a direction the part is pulled in use), its verdict
 * and the "turn to the strongest printable pose" button, plus the layer-line view.
 */
import * as THREE from 'three';
import { loadAlignment, suggestStrengthPose } from '../orient.js';
import { el } from './dom.js';
import { scene } from './scene.js';
import { histPush } from './history.js';
import { part, topology, threshold, setGizmo, applySuggestion } from '../app.js';

// ------------------------------------------------------------------- load arrow
//
// The user shows which way the part is loaded in use, and the tool says whether
// the print layers run WITH that load or across it (the weak plane), and offers a
// stronger pose. It drives a QUALITATIVE readout, never a fake "Nx stronger"
// number (see loadAlignment in orient.js).
//
// We store a DIRECTION only, in the part's local frame, because the pull model
// only cares which way the load points -- not where on the part it lands. (A
// cantilever/lever load WOULD care where it lands, since it snaps at the root; if
// that toggle is ever built, this becomes a point + direction. Until then, storing
// a bare direction keeps the UI honest: the arrow is drawn through the part's
// centre so no spot on the surface looks load-bearing when it isn't.) Local so it
// rotates and re-seats with the part; parenting the helper to `part` gives that.
export let loadDir = null;         // THREE.Vector3 unit direction in local space, or null
/** Undo/redo put this back directly (setLoadDir below is the user action, with
 *  its own undo step). */
export function replaceLoadDir(v) { loadDir = v; }
const loadArrowHelper = new THREE.ArrowHelper(
  new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 10, 0xffb454, 4, 2.6);
loadArrowHelper.visible = false;
loadArrowHelper.renderOrder = 12;   // over the part and the draw guides
for (const m of [loadArrowHelper.line, loadArrowHelper.cone]) {
  m.material.depthTest = false;      // a HUD arrow, always visible like the draw guides
  m.material.transparent = true;
  m.renderOrder = 12;
}

/** A new part starts with no load direction: drop it and take the arrow off the old part. */
export function resetLoad() {
  loadDir = null;
  loadArrowHelper.visible = false;
  if (loadArrowHelper.parent) loadArrowHelper.parent.remove(loadArrowHelper);
}

// ------------------------------------------------------------------- layer view
//
// A faint stack of horizontal frames around the part, world-aligned, that shows
// how the print is layered: they stay horizontal while the part turns INSIDE them,
// so you see which way the layers slice it and (with the note) where it's weak.
// Purely illustrative -- no input, no effect on geometry. This is the automatic
// "what does this orientation do to strength" view; the load arrow is the optional
// add-on for when you know the actual load. Rebuilt each shade() to fit the part.
let layersOn = false;
const MAX_LAYER_FRAMES = 16;
const layerGeom = new THREE.BufferGeometry();
layerGeom.setAttribute('position',
  new THREE.BufferAttribute(new Float32Array(MAX_LAYER_FRAMES * 8 * 3), 3));
// depthTest OFF so the horizontal frames read as layer lines ACROSS the part (a
// HUD, like the draw guides) instead of being hidden inside its bounding box.
const layerViz = new THREE.LineSegments(layerGeom,
  new THREE.LineBasicMaterial({ color: 0x9ecbf5, transparent: true, opacity: 0.4, depthTest: false }));
layerViz.frustumCulled = false;    // the frames resize every pose; stale bounds would cull it
layerViz.renderOrder = 10;         // over the part, under the load arrow (12)
layerViz.visible = false;
scene.add(layerViz);

/** Refit the layer frames to the seated bounding box `size` (part is centred on
 *  XY origin, resting on z=0). Density is adaptive -- roughly a frame every 8mm,
 *  clamped -- so a flat part isn't a cramped smear and a tall one isn't sparse. */
function rebuildLayerViz(size) {
  const count = Math.max(3, Math.min(MAX_LAYER_FRAMES, Math.round(size.z / 8) + 1));
  // Extend the frames a little past the silhouette so the layer lines clearly poke
  // out either side of the part instead of hiding along its edge.
  const m = Math.max(4, 0.12 * Math.max(size.x, size.y));
  const hx = size.x / 2 + m, hy = size.y / 2 + m;
  const pos = layerGeom.getAttribute('position').array;
  let o = 0;
  const edge = (ax, ay, bx, by, z) => {
    pos[o++] = ax; pos[o++] = ay; pos[o++] = z;
    pos[o++] = bx; pos[o++] = by; pos[o++] = z;
  };
  for (let k = 0; k < count; k++) {
    const z = (size.z * k) / (count - 1);
    edge(-hx, -hy,  hx, -hy, z);
    edge( hx, -hy,  hx,  hy, z);
    edge( hx,  hy, -hx,  hy, z);
    edge(-hx,  hy, -hx, -hy, z);
  }
  layerGeom.setDrawRange(0, count * 8);
  layerGeom.getAttribute('position').needsUpdate = true;
  layerGeom.computeBoundingSphere();
}

/** Rebuild the layer-line frames for the current pose (the toggle-able 3D viz).
 *  The prose strength note that used to live here was dropped -- the Strength
 *  arrow below covers load, and the always-on line mostly stated the obvious. */
export function updateLayerView(size) {
  rebuildLayerViz(size);
  layerViz.visible = layersOn && !!part;
}

// ---------------------------------------------------------------- load arrow UI

/**
 * Redraw the arrow from `loadDir`, parented to the part so it follows the pose.
 * The part geometry is centred on its own origin (see setPart), so the load axis
 * is drawn THROUGH that centre -- it reads as "the part is pulled this way", not
 * as a force pinned to some spot, which is the honest picture for the pull model.
 */
export function updateLoadArrowMesh() {
  if (!loadDir || !part) { loadArrowHelper.visible = false; return; }
  if (loadArrowHelper.parent !== part) part.add(loadArrowHelper);
  const bb = part.geometry.boundingBox;
  const maxDim = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z);
  const len = Math.max(10, maxDim * 0.6);
  // Centre the whole arrow on the origin: tail at -dir*len/2 so it spans the part.
  loadArrowHelper.position.copy(loadDir).multiplyScalar(-len / 2);
  loadArrowHelper.setDirection(loadDir);
  loadArrowHelper.setLength(len, Math.min(len * 0.28, 12), Math.min(len * 0.18, 7));
  loadArrowHelper.visible = true;
}

/** Commit a load direction (part-LOCAL, so it tracks the pose). Every pad button
 *  lands here via setLoadWorld. */
function setLoadDir(local) {
  if (!part || local.lengthSq() < 1e-9) return;
  histPush();
  loadDir = local.normalize();
  updateLoadArrowMesh();
  updateLoadReadout();
  setGizmo();
  syncLoadUI();
}

/**
 * The qualitative strength verdict for the CURRENT pose. World +Z is the build
 * axis once the part is seated, so the load direction in world space is all
 * loadAlignment needs. Re-run on every orientation change (from shade()) so the
 * verdict tracks the part as it turns.
 */
export function updateLoadReadout() {
  const note = el('load-note');
  const suggestBtn = el('load-suggest');
  if (!loadDir || !part) {
    note.hidden = true;
    suggestBtn.hidden = true;
    return;
  }
  const w = loadDir.clone().applyQuaternion(part.quaternion);
  const al = loadAlignment([w.x, w.y, w.z]);
  if (!al) { note.hidden = true; suggestBtn.hidden = true; return; }
  note.textContent = al.text;
  note.className = `load-verdict ${al.quality}`;
  note.hidden = false;
  // Offer a stronger pose only when this one isn't already good. Wired in the
  // suggest section below; here we just decide whether to show the button.
  suggestBtn.hidden = al.quality === 'good';
}

// The Strength-arrow pad: pick a world direction and the load points that way.
// The strength math only wants a unit direction (it discards any anchor point), so
// a handful of buttons is the honest input -- no 3D aiming, no face-hunting, and
// nothing that collides with click-to-lay-flat. Directions are WORLD-relative (as
// the part sits on the bed); stored local so the arrow tracks the pose as it turns.
const PAD_DIRS = {
  up:    [0, 0, 1],  down:  [0, 0, -1],
  right: [1, 0, 0],  left:  [-1, 0, 0],
  back:  [0, 1, 0],  front: [0, -1, 0],
};

/** Point the load along a world direction (one pad button). */
function setLoadWorld(key) {
  if (!part) return;
  const [x, y, z] = PAD_DIRS[key];
  const local = new THREE.Vector3(x, y, z).applyQuaternion(part.quaternion.clone().invert());
  setLoadDir(local);
}

/** Remove the load arrow entirely. */
function clearLoad() {
  if (!loadDir) return;
  histPush();
  loadDir = null;
  loadArrowHelper.visible = false;
  updateLoadReadout();
  syncLoadUI();
}

/** Show Clear once a load is set, and light the pad button whose world direction the
 *  arrow currently points along. Stateless -- recomputed from the live pose, so the
 *  highlight clears itself when you rotate the part off that axis. */
export function syncLoadUI() {
  const has = !!loadDir;
  let activeKey = null;
  if (has && part) {
    const w = loadDir.clone().applyQuaternion(part.quaternion);
    for (const [key, [x, y, z]] of Object.entries(PAD_DIRS)) {
      if (w.x * x + w.y * y + w.z * z > 0.999) { activeKey = key; break; }
    }
  }
  for (const key of Object.keys(PAD_DIRS)) {
    el(`load-${key}`).classList.toggle('active', key === activeKey);
  }
  el('load-clear').hidden = !has;
}

// --------------------------------------------------------------- load arrow

el('show-layers').addEventListener('change', (e) => {
  layersOn = e.target.checked;
  layerViz.visible = layersOn && !!part;
});

// Strength-arrow pad: each button points the load along a world direction.
for (const key of Object.keys(PAD_DIRS)) {
  el(`load-${key}`).addEventListener('click', () => setLoadWorld(key));
}
el('load-clear').addEventListener('click', clearLoad);

// Turn the part to the strongest PRINTABLE pose for the placed load. Unlike
// "Suggest orientation" (which minimises support), this is strength-driven: it
// lays the load most in-plane, but only among poses that actually sit on the bed,
// so it can't produce the needle-tower. If the current pose is already about as
// good as it gets, say so instead of turning to an equivalent orientation.
el('load-suggest').addEventListener('click', () => {
  if (!part || !topology || !loadDir) return;
  const pose = suggestStrengthPose(topology, [loadDir.x, loadDir.y, loadDir.z], { threshold });
  const w = loadDir.clone().applyQuaternion(part.quaternion);
  const cur = loadAlignment([w.x, w.y, w.z]);
  const note = el('load-note');
  if (!pose || (cur && pose.cross >= cur.cross - 0.05)) {
    note.textContent = 'This is about the strongest printable orientation for this '
      + 'load — a better-aligned pose wouldn’t sit on the bed.';
    note.className = `load-verdict ${cur ? cur.quality : 'mixed'}`;
    note.hidden = false;
    el('load-suggest').hidden = true;
    return;
  }
  applySuggestion(pose.rot);   // turns the part; shade() refreshes the verdict + button
});
