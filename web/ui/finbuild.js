/**
 * Building the supports: the request options, the Worker (with an inline
 * fallback), and turning a finished buildFins result into the fin and pad meshes
 * on screen. Owns the last build and the triangles the export reads.
 */
import * as THREE from 'three';
import { buildFins, FIN, PAD } from '../fins.js';
import { PROP } from '../prop.js';
import { CUT } from '../cutout.js';
import { el } from './dom.js';
import { scene, meshFrom } from './scene.js';
import {
  removeMode, syncRemoveUI, cancelRemove, clearFinHover, adoptFins, forgetFins,
} from './remove.js';
import { updateReadout } from './readout.js';
import {
  drawnTris, drawnMesh, drawMaterial, drawShown, clearPreview, rebuildDrawn,
} from './walls.js';
import { finsVisible, finMode } from './settings.js';
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
  finMesh = meshFrom(finTris, finMaterial);
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
  // Both auto modes bake their geometry into finTris (refreshFins' else branch):
  // Suggest → gripping fins + fallback props, Combined fin → gripping fins only.
  // Only Draw leaves it empty and exports the hand-drawn walls instead.
  const auto = finMode === 'draw' ? [] : finTris;
  const drawn = drawShown() ? drawnTris : [];
  return [...auto, ...drawn, ...padTris];
}

/**
 * Regenerate the fins for the current orientation. Fins live in PRINT space
 * (already rotated and seated), not in the part's local frame, so they are added
 * to the scene rather than parented to the part.
 */
// Support generation used to run inline on the main thread, which froze the whole
// page (orbit, buttons, sliders) for however long a build took -- a couple of
// seconds on a large or badly-posed part. buildFins is pure mesh math with no
// DOM/three.js dependency, so it runs in a Worker instead (web/finworker.js): the
// current fins stay on screen, greyed, while the new ones compute, and the UI
// stays live. A generation counter drops the reply from a pose that has since
// been superseded, and if a Worker can't be created (e.g. the page was opened
// from file://) it falls back to building inline.
let finWorker;               // undefined = not tried yet, null = unavailable, else a Worker
let finGen = 0;              // bumped per request; a reply with a stale id is ignored
let finT0 = 0;               // start time of the in-flight build, for the readout timing
let lastOpts = null;
let finSpinnerTimer = null;  // shows the spinner only if a build runs past ~1s
let finBusy = false;         // a worker build is outstanding (used to supersede it)

// Reveal the spinner only for builds that actually run long, so a sub-second
// rebuild never flashes it. Cleared the moment the build lands (applyBuilt).
function armSpinner() {
  clearTimeout(finSpinnerTimer);
  // Short delay so a quick build never shows it at all; the 0.5s CSS fade-in (the
  // .show class) then eases it on rather than snapping. The spinner is always in
  // the layout, so toggling the class transitions reliably every time -- the
  // earlier display:none/hidden toggle skipped the fade unpredictably.
  finSpinnerTimer = setTimeout(() => el('spinner').classList.add('show'), 300);
}
function clearSpinner() {
  clearTimeout(finSpinnerTimer);
  finSpinnerTimer = null;
  el('spinner').classList.remove('show');
}

function finOpts() {
  return { mode: finMode === 'draw' ? 'prop' : finMode,
           bedPad: el('bed-pad').value !== 'off',
           tines: el('tines').checked,
           tineDensity: el('tine-density').valueAsNumber / 100,
           layerHeight: el('layer-height').valueAsNumber,
           coverage: el('coverage').valueAsNumber / 100,
           // Auto places sway braces itself; in Draw they are clicked on by hand.
           sway: finMode === 'auto' && el('sway').checked ? { on: true, ...swayOpts() } : undefined,
           // The clearances have to travel WITH the request: the build runs in a
           // Worker with its own copy of fins.js / prop.js, which never sees what
           // applyMaterial and the gap fields set on this page's copy (fins.js
           // applyTunables). Without this, Auto mode always built PLA's numbers.
           tunables: { finGap: FIN.gap, tineBite: FIN.tineBite, padH: FIN.padH,
                       padGrab: PAD.grab, padStyle: PAD.style, padCustom: { ...PAD.custom },
                       propGap: PROP.gap,
                       cutout: CUT.pattern } };
}

/** The Sway braces settings. Gap and bite are passed explicitly -- sway.js takes
 *  the material's numbers as options instead of reading FIN/PROP itself. */
export function swayOpts() {
  const num = (id, d) => (Number.isFinite(el(id).valueAsNumber) ? el(id).valueAsNumber : d);
  return { gripFrom: num('sway-from', 0),
           tineSpacing: num('sway-spacing', 6),
           reach: num('sway-depth', 15) / 100,
           gap: PROP.gap, bite: FIN.tineBite,
           tines: el('tines').checked,
           layerHeight: el('layer-height').valueAsNumber };
}

function makeFinWorker() {
  const w = new Worker(new URL('../finworker.js', import.meta.url), { type: 'module' });
  w.onmessage = (e) => {
    if (e.data.id !== finGen) return;              // a newer pose already superseded this build
    finBusy = false;
    if (e.data.error) {                            // worker failed -- build inline so support still appears
      applyBuilt(buildFins(topology, lastResult, rotM3.elements, lastOpts));
      return;
    }
    applyBuilt(e.data.built);
  };
  // A worker-level error must not leave the UI wedged (spinner up, fins greyed):
  // drop to inline for next time and release the in-flight state now.
  w.onerror = () => { finWorker = null; finBusy = false; clearSpinner(); };
  return w;
}

function getFinWorker() {
  if (finWorker === undefined) {
    try { finWorker = makeFinWorker(); } catch { finWorker = null; }
  }
  return finWorker;
}

// Abandon an in-flight build when a newer pose arrives. Without this, rapid pose
// changes (Suggest → lay flat → rotate) queued 2-3 slow builds behind each other
// in the single worker, so the fresh result only landed many seconds later --
// the spinner looked stuck and the stale fins lingered. Terminating discards the
// running + queued work so only the latest pose computes.
function supersedeBuild() {
  if (finBusy && finWorker) { finWorker.terminate(); finWorker = undefined; }
  finBusy = false;
}

export function refreshFins() {
  if (!finsVisible || !lastResult || !topology) {
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
  lastOpts = finOpts();
  supersedeBuild();                    // discard any older in-flight pose before starting this one
  const worker = getFinWorker();
  if (!worker) {                       // no worker available: build inline (old behaviour)
    for (const m of [finMesh, padMesh]) { if (m) { scene.remove(m); m.geometry.dispose(); } }
    finMesh = padMesh = null;
    finTris = padTris = [];
    applyBuilt(buildFins(topology, lastResult, rotM3.elements, lastOpts));
    return;
  }

  // Leave the current fins on screen (greyed) until the fresh build lands, so the
  // viewport never blanks mid-recalc. markFinsStale also shows "generating supports…";
  // the spinner joins it only if the build runs past the arm delay.
  finGen++;
  finBusy = true;
  markFinsStale();
  armSpinner();

  // inside.js caches its spatial grid on topology._insideGrid, and that grid holds
  // a CLOSURE (`cell`) which structured-clone cannot copy. The grid only exists
  // once something has queried the part on the main thread -- which Suggest
  // orientation does -- so before that postMessage(topology) worked and after it
  // threw DataCloneError, leaving the build wedged. Send a shallow copy without
  // the cache (the worker rebuilds its own grid), and if a clone ever fails
  // anyway, build inline so the UI can never get stuck waiting on a reply.
  const topoMsg = { ...topology };
  delete topoMsg._insideGrid;
  try {
    worker.postMessage({ id: finGen, topology: topoMsg, result: lastResult, rot: rotM3.elements, opts: lastOpts });
  } catch (err) {
    console.warn('support worker postMessage failed; building inline', err);
    finBusy = false;
    for (const m of [finMesh, padMesh]) { if (m) { scene.remove(m); m.geometry.dispose(); } }
    finMesh = padMesh = null;
    finTris = padTris = [];
    applyBuilt(buildFins(topology, lastResult, rotM3.elements, lastOpts));
  }
}

// Turn a finished buildFins result into meshes + readout. Shared by the worker
// reply and the inline fallback. buildFins runs in BOTH modes: in Suggest it
// places the walls; in Draw it is called only for the bed pad + seating verdict
// (a tilted part rests on an edge and needs a pad however its walls are placed,
// and that logic lives in fins.js), so Draw ignores the suggested walls and shows
// the hand-drawn ones instead.
function applyBuilt(built) {
  finBusy = false;
  clearSpinner();
  for (const m of [finMesh, padMesh]) { if (m) { scene.remove(m); m.geometry.dispose(); } }
  finMesh = padMesh = null;
  clearFinHover();
  finTris = padTris = [];
  // Undo the grey markFinsStale applied to the shared materials.
  finMaterial.transparent = padMaterial.transparent = false;
  finMaterial.opacity = padMaterial.opacity = 1;

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
    finMesh = meshFrom(finTris, finMaterial);
    // In Suggest, also (re)build any hand-drawn walls layered on top. rebuildDrawn
    // self-gates on drawShown(), so it clears them when none apply.
    rebuildDrawn();
  }
  updateReadout(built, performance.now() - finT0);
  updateFit();
  // Restore-all visibility keys off removedIds (this orientation's removals), which
  // is only known after the reconcile above -- refresh it once the build lands.
  syncRemoveUI();
}

/**
 * Stabilize mode does NOT claim to serve every overhang -- it claims to keep a
 * tilted part standing. So the readout reports the fins AND what is still red,
 * rather than implying the red went away. Overstating this is how a tool loses
 * someone on their first print.
 */
/** Grey the fins while a drag is in flight, so nothing on screen is a lie. */
export function markFinsStale() {
  for (const m of [finMesh, padMesh, drawnMesh]) if (m) m.material.opacity = 0.25;
  finMaterial.transparent = padMaterial.transparent = drawMaterial.transparent = true;
  el('s-fins').textContent = 'generating supports…';
}
