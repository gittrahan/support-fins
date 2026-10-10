/**
 * Building the supports: request options, background generation, and turning
 * a finished buildFins result into the fin and pad meshes
 * on screen. Owns the last build and the triangles the export reads.
 */
import * as THREE from 'three';
import { FIN, PAD } from '../fins.js';
import { PROP } from '../prop.js';
import { CUT } from '../cutout.js';
import { el } from './dom.js';
import { geometryJobs } from './geometry-jobs.js';
import { setBuildPending, settingsPending } from './build-status.js';
import { scene, meshFrom, ifaceMaterial } from './scene.js';
import {
  removeMode, syncRemoveUI, cancelRemove, clearFinHover, adoptFins, forgetFins,
} from './remove.js';
import { updateReadout } from './readout.js';
import {
  drawnTris, drawnMesh, drawMaterial, drawShown, clearPreview, rebuildDrawn, drawBusy, drawFailed, setDrawMsg,
} from './walls.js';
import { finsVisible, finMode, autoLike } from './settings.js';
import { topology, rotM3, lastResult, updateFit } from './part.js';

export let finMesh = null;
let padMesh = null;
export let finTris = [];
export let padTris = [];

/** Show `tris` as the auto fin mesh, replacing the one on screen (used by per-fin
 *  removal, which re-filters the last build without a worker round-trip). */
export function setFinTris(tris) {
  if (finMesh) { scene.remove(finMesh); finMesh.geometry.dispose(); }
  finTris = tris;
  finMesh = meshFrom(finTris, finMaterial, ifaceMaterial);
}

export const finMaterial = new THREE.MeshStandardMaterial({
  color: 0x59d98e, roughness: 0.7, metalness: 0.0, side: THREE.DoubleSide,
});
// The pad is not a fin -- it is a modification to how the part meets the plate,
// and the user has to be able to see at a glance which is which before they
// commit to an export.
export const padMaterial = new THREE.MeshStandardMaterial({
  color: 0xe8b64c, roughness: 0.8, metalness: 0.0, side: THREE.DoubleSide,
});

export let lastBuilt = null;       // last buildFins result, kept for the bed pad + seating readout
/** The walls + pad the CURRENT mode contributes to the export and the fit check. */
export function activeAdded() {
  return [...activeWalls(), ...padTris];
}

/** The walls alone (activeAdded without the pad). */
export function activeWalls() {
  // Both auto modes bake their geometry into finTris (refreshFins' else branch):
  // Suggest → gripping fins + fallback props, Combined fin → gripping fins only.
  // Only Draw leaves it empty and exports the hand-drawn walls instead.
  const auto = finMode === 'draw' ? [] : finTris;
  const drawn = drawShown() ? drawnTris : [];
  return [...auto, ...drawn];
}

/**
 * Regenerate the fins for the current orientation. Fins live in PRINT space
 * (already rotated and seated), not in the part's local frame, so they are added
 * to the scene rather than parented to the part.
 */
// Support generation used to run inline on the main thread, which froze the whole
// page (orbit, buttons, sliders) for however long a build took -- a couple of
// seconds on a large or badly-posed part. buildFins is pure mesh math with no
// DOM/three.js dependency, so it runs in the shared background coordinator: the
// current fins stay on screen, greyed, while the new ones compute, and the UI
// stays live. A generation counter drops the reply from a pose that has since
// been superseded. Auto/seating gets one fresh-worker retry; a second failure
// reports an error and blocks export. Heavy support generation stays off-thread.
let finGen = 0;              // bumped per request; a reply with a stale id is ignored
let finT0 = 0;               // start time of the in-flight build, for the readout timing
let lastOpts = null;
let finBusy = false;         // a worker build is outstanding (used to supersede it)
let finFailed = false;
export const geometryPending = () => finsVisible && (settingsPending() || finBusy || finFailed || drawBusy || drawFailed);

function generationFailed(error) {
  finBusy = false; finFailed = true; clearSpinner();
  setDrawMsg(`Support generation failed: ${error}. Try again or reload.`);
  updateReadout(lastBuilt);
  el('s-fins').textContent = 'support generation failed';
  el('s-fin-note').textContent = `Support generation failed: ${error}. Try again or reload.`;
}

const armSpinner = () => setBuildPending('auto', true);
const clearSpinner = () => setBuildPending('auto', false);

export function finOpts() {
  return { mode: finMode,
           bedPad: el('bed-pad').value !== 'off',
           plateOnly: el('plate-only').checked,
           tines: el('tines').checked,
           tineDensity: el('tine-density').valueAsNumber / 100,
           layerHeight: el('layer-height').valueAsNumber,
           // Full coverage aims at every reachable overhang: the slider is Auto's
           coverage: finMode === 'full' ? FIN.coverDefault : el('coverage').valueAsNumber / 100,
           // Auto places sway braces itself; in Draw they are clicked on by hand.
           sway: autoLike() && el('sway').checked ? { on: true, ...swayOpts() } : undefined,
           // The clearances have to travel WITH the request: the build runs in a
           // Worker with its own copy of fins.js / prop.js, which never sees what
           // applyMaterial and the gap fields set on this page's copy (fins.js
           // applyTunables). Without this, Auto mode always built PLA's numbers.
           tunables: { padH: FIN.padH,
                       padGrab: PAD.grab, padStyle: PAD.style, padCustom: { ...PAD.custom },
                       propGap: PROP.gap,
                       cutout: CUT.pattern,
                       iface: PROP.iface } };
}

/** The Sway braces settings. The gap is passed explicitly -- sway.js takes the
 *  material's number as an option instead of reading FIN/PROP itself. */
export function swayOpts() {
  const num = (id, d) => (Number.isFinite(el(id).valueAsNumber) ? el(id).valueAsNumber : d);
  return { gripFrom: num('sway-from', 0),
           tineSpacing: num('sway-spacing', 6),
           reach: num('sway-depth', 15) / 100,
           gap: PROP.gap,
           tines: el('tines').checked,
           iface: PROP.iface,
           layerHeight: el('layer-height').valueAsNumber };
}

// The shared queue serializes Auto, Draw and previews. Superseded results are
// discarded; keep only the latest pending Auto instead of cloning the mesh again.
function supersedeBuild() {
  finGen++;
  geometryJobs.cancel('auto');
  finBusy = false;
  clearSpinner();
}

export function refreshFins() {
  if (!finsVisible || !lastResult || !topology) {
    finFailed = false;
    supersedeBuild();                  // no build wanted now: drop any in-flight one so it can't re-add fins
    clearSpinner();
    for (const m of [finMesh, padMesh]) { if (m) { scene.remove(m); m.geometry.dispose(); } }
    finMesh = padMesh = null;
    clearFinHover();
    finTris = padTris = [];
    forgetFins();
    if (removeMode) cancelRemove();
    clearPreview();
    rebuildDrawn();
    updateReadout(null);
    return;
  }

  finT0 = performance.now();
  finFailed = false;
  lastOpts = finOpts();
  supersedeBuild();                    // discard any older in-flight pose before starting this one
  // Leave the current fins on screen (greyed) until the fresh build lands, so the
  // viewport never blanks mid-recalc. markFinsStale also shows "generating supports…";
  // the spinner joins it only if the build runs past the arm delay.
  finGen++;
  finBusy = true;
  markFinsStale();
  armSpinner();

  const generation = finGen;
  geometryJobs.run('auto', topology, { kind: 'auto', result: lastResult,
    rot: [...rotM3.elements], opts: lastOpts }).then((reply) => {
    if (!reply || generation !== finGen) return;
    applyBuilt(reply.built);
  }).catch((error) => {
    if (generation === finGen) generationFailed(error.message);
  });
}

// Turn a finished worker result into meshes + readout. In Suggest buildFins
// places the walls; in Draw it is called only for the bed pad + seating verdict
// (a tilted part rests on an edge and needs a pad however its walls are placed,
// and that logic lives in fins/pad.js + fins/seating.js). Draw does not generate
// automatic walls; it shows the hand-drawn ones instead.
function applyBuilt(built) {
  finBusy = false;
  for (const m of [finMesh, padMesh]) { if (m) { scene.remove(m); m.geometry.dispose(); } }
  finMesh = padMesh = null;
  clearFinHover();
  finTris = padTris = [];
  // Undo the grey markFinsStale applied to the shared materials.
  finMaterial.transparent = padMaterial.transparent = ifaceMaterial.transparent = false;
  finMaterial.opacity = padMaterial.opacity = ifaceMaterial.opacity = 1;

  lastBuilt = built;
  padTris = built.padTriangles;
  padMesh = meshFrom(padTris, padMaterial);

  if (finMode === 'draw') {
    // Draw exports the hand-placed walls, not auto fins -- no per-fin records.
    forgetFins();
    rebuildDrawn();
  } else {
    clearPreview();
    // Per-fin records are rebuilt and the removals re-applied (ui/remove.js), so a
    // removal survives a same-orientation rebuild. The fin mesh is the FILTERED
    // triangle set; exporters read finTris unchanged.
    finTris = adoptFins(built);
    finMesh = meshFrom(finTris, finMaterial, ifaceMaterial);
    // In Suggest, also (re)build any hand-drawn walls layered on top. rebuildDrawn
    // self-gates on drawShown(), so it clears them when none apply.
    rebuildDrawn();
  }
  updateReadout(built, performance.now() - finT0);
  updateFit();
  // Restore-all visibility keys off removedIds (this orientation's removals), which
  // is only known after the reconcile above -- refresh it once the build lands.
  syncRemoveUI();
  clearSpinner(); // Draw may still be building; its stage keeps the notice up.
}

/**
 * Stabilize mode does NOT claim to serve every overhang -- it claims to keep a
 * tilted part standing. So the readout reports the fins AND what is still red,
 * rather than implying the red went away. Overstating this is how a tool loses
 * someone on their first print.
 */
/** Grey the fins while a drag is in flight, so nothing on screen is a lie. */
export function markFinsStale() {
  for (const m of [finMesh, padMesh, drawnMesh]) if (m) for (const mat of [m.material].flat()) mat.opacity = 0.25;
  finMaterial.transparent = padMaterial.transparent = drawMaterial.transparent = ifaceMaterial.transparent = true;
  el('s-fins').textContent = 'generating supports…';
}
