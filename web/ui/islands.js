import { t, tn } from './i18n.js';
/**
 * Island starts on screen (web/islands.js, local issue 041): a count in the
 * Overhangs readout and a card saying what they are and whether anything holds
 * them, always; a red cone under each spot whose first layer starts in midair,
 * when Settings > Display > Show midair starts is ticked (off by default). No face
 * there is red, so without the count the user sees a clean part and the print
 * starts that spot on nothing (GitHub #18, #257). Full coverage walls them
 * (fins/fill.js); the card then names only the ones it couldn't.
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

// Show midair starts: the cones only (display, never a rebuild); remembered
const SHOW_KEY = 'sf.showIslands';
try { markers.visible = localStorage.getItem(SHOW_KEY) === '1'; } catch { markers.visible = false; }
el('show-islands').checked = markers.visible;
el('show-islands').addEventListener('change', (e) => {
  markers.visible = e.target.checked;
  try { localStorage.setItem(SHOW_KEY, markers.visible ? '1' : '0'); } catch { /* storage off */ }
  renderIslandCard();
  requestRender();
});

export let islands = [];
let settled = 0;     // the count at the last release: a drag shows none, but had some
let bare = null;     // how many Full coverage left without a wall (null: no Full build for this pose)
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
  bare = null;        // the pose moved: the last build's walls are for the old one
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

/** A build landed (ui/readout.js): null when this isn't a Full build, else
 *  { bare, capped } -- the starts Full coverage left without a wall, and whether its
 *  island pass stopped on its budget -- or { all: true } (no fill pass: none walled).
 *  Rewrites the card only: the readout suffix is paintOverhangs' (it rewrites the line). */
export function islandsBuilt(info) {
  bare = info === null ? null : info.all ? { bare: islands.length, capped: false } : info;
  renderIslandCard();
}

/** The card: what the starts are, and how many nothing holds. */
function renderIslandCard() {
  const n = islands.length;
  const card = el('island-warn');
  if (!card) return;
  // (where they are: the cones, or the box that shows them)
  const where = markers.visible ? t('red cones') : t('tick Show midair starts in Settings › Display to see them');
  card.textContent = !n || bare?.bare === 0 ? ''
    : bare === null
      ? '⚠ ' + tn('{n} spot starts in midair ({where}): its first layer has nothing under it, though no face there is steep enough to show red. Full coverage puts a wall under it if it can reach it; in Auto or Draw, add a wall by hand under it or tilt the part.',
        '{n} spots start in midair ({where}): their first layer has nothing under it, though no face there is steep enough to show red. Full coverage puts a wall under each one it can reach; in Auto or Draw, add a wall by hand under each or tilt the part.', n, { where })
      : bare.capped
        ? '⚠ ' + tn('{n} of {total} spots that start in midair got no wall: Full coverage ran out of walls before it ({where}). Add a wall by hand under it, or tilt the part.',
          '{n} of {total} spots that start in midair got no wall: Full coverage ran out of walls before them ({where}). Add a wall by hand under each, or tilt the part.', bare.bare, { total: n, where })
        : '⚠ ' + tn('{n} of {total} spots that start in midair got no wall: Full coverage couldn’t fit one under it ({where}). Add a wall by hand under it, or tilt the part.',
          '{n} of {total} spots that start in midair got no wall: Full coverage couldn’t fit one under them ({where}). Add a wall by hand under each, or tilt the part.', bare.bare, { total: n, where });
}

/** The Overhangs readout's suffix and the card. Call only right after the readout
 *  line is rewritten (paintOverhangs, a language change): the suffix appends. */
export function renderIslandText() {
  renderIslandCard();
  const n = islands.length;
  const sOver = el('s-over');
  if (sOver && n) {
    sOver.classList.remove('good');
    const sw = document.createElement('i');
    sw.className = 'sw sw-over';
    sw.title = t('Spots that start in midair');
    sOver.append(' (+', sw, `${tn('{n} midair start', '{n} midair starts', n)})`);
  }
}
