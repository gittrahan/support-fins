import { t, tn } from './i18n.js';
/**
 * Island starts on screen (web/islands.js, local issue 041): a red cone under each
 * spot whose first layer starts in midair, a count in the Overhangs readout, and a
 * card saying what they are. No face there is red, so without this the user sees
 * a clean part and the print starts that spot on nothing (GitHub #18, #257).
 *
 * Found after a drag, not during it: the starts move with the pose, so the cones,
 * count and card go while the rings turn the part and come back on release.
 */
import * as THREE from 'three';
import { findIslands } from '../islands.js';
import { el } from './dom.js';
import { scene, requestRender } from './scene.js';

const RED = new THREE.Color().setHex(0xff5a4d, THREE.SRGBColorSpace);
// drawn over the part: the starts are on its underside, out of sight from above
const coneMat = new THREE.MeshBasicMaterial({ color: RED, depthTest: false, transparent: true, opacity: 0.9 });
const lineMat = new THREE.LineBasicMaterial({ color: RED, depthTest: false, transparent: true, opacity: 0.9 });
const markers = new THREE.Group();
markers.renderOrder = 10;
scene.add(markers);

export let islands = [];
let settled = 0;     // the count at the last release: a drag shows none, but had some
/** Did the last pose the part settled in have island starts? (part.js's flat note
 *  mid-drag, so a turn doesn't flash "No supports needed".) */
export const hadIslands = () => settled > 0;

function clearMarkers() {
  for (const m of markers.children) m.geometry.dispose();
  markers.clear();
}

/**
 * Re-find the starts for analyze()'s `res` in pose `rot` and redraw the cones
 * (the text is paintOverhangs' job: it rewrites the readout). `dragging`: the ring
 * gizmo is mid-turn -- none until release.
 */
export function updateIslands(topology, res, rot, size, dragging) {
  islands = topology && !dragging ? findIslands(topology, res, rot) : [];
  if (!dragging) settled = islands.length;
  clearMarkers();
  // the cone's tip on the start, its base under it: "this needs holding up"
  const s = Math.min(6, Math.max(1.5, 0.03 * Math.max(size.x, size.y, size.z)));
  for (const isl of islands) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.45 * s, s, 16), coneMat);
    cone.rotation.x = Math.PI / 2;                // ConeGeometry points +Y; turn it to +Z
    cone.position.set(isl.x, isl.y, isl.z - s / 2);
    cone.renderOrder = 10;
    markers.add(cone);
    // a level edge (a knife edge, a boss rim) starts along its length: draw it
    let a = isl.points[0], b = a, far = 0;
    for (const p of isl.points) for (const q of isl.points) {
      const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (d > far) { far = d; a = p; b = q; }
    }
    if (far > s) {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(
        [new THREE.Vector3(...a), new THREE.Vector3(...b)]), lineMat);
      line.renderOrder = 10;
      markers.add(line);
    }
  }
  requestRender();
  return islands;
}

/** The Overhangs readout's suffix and the card. Call after the readout is rewritten. */
export function renderIslandText() {
  const n = islands.length;
  const card = el('island-warn');
  if (card) {
    card.textContent = n
      ? '⚠ ' + tn('{n} spot starts in midair (red cone): its first layer has nothing under it, though no face there is steep enough to show red. Nothing holds it up yet — add a wall by hand under it, or tilt the part.',
        '{n} spots start in midair (red cones): their first layer has nothing under it, though no face there is steep enough to show red. Nothing holds them up yet — add a wall by hand under each, or tilt the part.', n)
      : '';
  }
  const sOver = el('s-over');
  if (sOver && n) {
    sOver.classList.remove('good');
    const sw = document.createElement('i');
    sw.className = 'sw sw-over';
    sw.title = t('Red cones: spots that start in midair');
    sOver.append(' (+', sw, `${tn('{n} midair start', '{n} midair starts', n)})`);
  }
}
