import { t } from './i18n.js';
/**
 * Hand-placed supports: the breakaway walls drawn in Draw mode (or the Suggest
 * "+ Add" augment) and sway braces stood with one click, their preview markers,
 * selecting one to remove it, and the Draw Clear button. app.js's pointer
 * dispatch calls drawHover / drawClick while drawActive().
 */
import * as THREE from 'three';
import { geometryQueue, reportTask } from './drawstatus.js';
import { faceIsUpright } from '../sway.js';
import { initBraceGhost, showBrace, moveTip, hideBrace, dropBrace, braceGrace } from './braceghost.js';
import { el } from './dom.js';
import { viewport, renderer, scene, camera, meshFrom, ifaceMaterial, raycaster, pointer, clip, MODEL } from './scene.js';
import { keptHit } from './section.js';
import { removedIds } from './remove.js';
import { histPush, settingsKey } from './history.js';
import { updateReadout } from './readout.js';
import { pickFace } from './pose.js';
import { part, topology, rotM3, lastResult, updateFit } from './part.js';
import { finsVisible, finMode, autoLike, drawAugment } from './settings.js';
import { lastBuilt, swayOpts, finOpts } from './finbuild.js';

// ---- draw mode: the user places breakaway walls by hand --------------------
// A drawn wall IS the same kind of support the auto-placer emits, so it shares
// the fin material and the green legend swatch. What is different is who chose
// the line: a person, not a PCA fit -- which is the whole reason it comes out
// straight. Endpoints are stored in the part's LOCAL frame so a wall tracks the
// part through later rotations, the same way the auto fins are rebuilt each time
// the orientation changes.
export let drawnWalls = [];        // committed walls: { a: Vector3(local), b: Vector3(local), ok, info }
export function setDrawnWalls(w) { drawnWalls = w; reportTask('place', false); }
export let drawnMesh = null;
export let drawnTris = [];
export let drawStart = null;       // Vector3 (local) -- first click of a wall in progress
export let drawMsg = '';           // last placement result, for the readout

export const drawMaterial = new THREE.MeshStandardMaterial({
  color: 0x59d98e, roughness: 0.7, metalness: 0.0, side: THREE.DoubleSide,
  clippingPlanes: clip,
});
// A live, translucent preview of the wall the current drag would make.
const ghostMaterial = new THREE.MeshStandardMaterial({
  color: 0x8ff0bd, roughness: 0.7, transparent: true, opacity: 0.45,
  side: THREE.DoubleSide, clippingPlanes: clip,
});
let ghostMesh = null;

// endpoint dot, cursor dot, and the rubber-band line between them. Unit radius;
// sizeMarkers() rescales them every frame to a fixed size ON SCREEN. They used to
// be sized to the part in world mm, which meant zooming in blew the cursor up
// until it hid the very edge you were trying to aim at.
//
// These are a UI overlay, so they draw with depthTest OFF and a high renderOrder:
// the line and dots sit ON the part surface, and an opaque part face (or a fin)
// rendered over them would otherwise win the depth test and hide the guide --
// which is exactly why the band read as "not rendering" on a face seen head-on.
// depthTest off makes them a HUD that is always visible regardless of what's in
// front. transparent:true is set so the renderOrder is honoured in the draw sort.
const guideMat = (color) => new THREE.MeshBasicMaterial(
  { color, depthTest: false, transparent: true });
const drawDot = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), guideMat(0x59d98e));
// The cursor is see-through so the surface under it stays readable; the OS
// crosshair is the precise aim point, this dot just shows the surface hit.
const CURSOR_OK = 0xcffbe4;   // braceghost.js eases it to amber on a refused brace spot
const drawCursor = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14),
  new THREE.MeshBasicMaterial({ color: CURSOR_OK, depthTest: false, transparent: true, opacity: 0.6 }));
const bandGeom = new THREE.BufferGeometry()
  .setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
const drawBand = new THREE.Line(bandGeom,
  new THREE.LineBasicMaterial({ color: 0x6dffab, depthTest: false, transparent: true }));
drawBand.frustumCulled = false;   // its endpoints move every frame; stale bounds would cull it
initBraceGhost(drawCursor.material);
for (const o of [drawDot, drawCursor, drawBand]) {
  o.visible = false;
  o.renderOrder = 11;             // above the hoverFace (renderOrder 1) and the part
  scene.add(o);
}

// Pointer is in wall-placement mode (draw mode, or Suggest with the add toggle on).
// Gates the draw interaction, the gizmo, and face-lay.
export const drawActive = () => finsVisible && (finMode === 'draw' || drawAugment);
// Auto / Full with Sway braces on: the pointer stands braces on upright sides
// (hover previews, a click stands one) without "+ Add walls by hand". Every other
// click still just orbits -- the ghost shows before the click, and Ctrl-Z takes
// a brace back, so a stray click is never a silent change.
export const braceActive = () => finsVisible && autoLike() && !drawAugment && el('sway').checked;
// Hand-drawn walls contribute to the display and the export. In Draw mode that's
// always; in Suggest it's whenever the user has drawn any (they persist after the
// add toggle is switched off, so you can orbit and export without losing them).
export const drawShown = () =>
  finsVisible && (finMode === 'draw' || (autoLike() && (drawAugment || drawnWalls.length > 0)));

// Marker radii in CSS pixels, whatever the zoom.
const DOT_PX = 5, CURSOR_PX = 4;
/** Scale the draw markers so they keep a fixed on-screen size at any zoom. */
export function sizeMarkers() {
  // World mm per CSS pixel at a point's depth, for the perspective camera.
  const mmPerPx = (p) => 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
    * camera.position.distanceTo(p) / Math.max(1, viewport.clientHeight);
  if (drawDot.visible) drawDot.scale.setScalar(DOT_PX * mmPerPx(drawDot.position));
  if (drawCursor.visible) drawCursor.scale.setScalar(CURSOR_PX * mmPerPx(drawCursor.position));
}

/** Drop any wall-in-progress and hide every transient draw visual. */
export function clearPreview() {
  previewGeneration++; geometryQueue.cancel('preview');
  drawStart = null;
  drawDot.visible = drawCursor.visible = drawBand.visible = false;
  dropGhost();
}

function dropGhost() {
  if (ghostMesh) { scene.remove(ghostMesh); ghostMesh.geometry.dispose(); ghostMesh = null; }
  braceShown = null;
  dropBrace();
}

/** Rebuild the committed drawn walls for the current orientation. */
let drawGeneration = 0, drawBusy = false, placing = false, previewGeneration = 0;
export const manualPending = () => drawBusy || placing;
export function manualOptions() {
  return {
    sway: swayOpts(),
    tunables: finOpts().tunables,
    draw: {
      tines: el('tines').checked,
      tineDensity: el('tine-density').valueAsNumber / 100,
      layerHeight: el('layer-height').valueAsNumber,
      plateOnly: el('plate-only').checked,
      braceTall: el('tall-ribs').checked,
    },
  };
}
export function requestsFor(walls, toWorld) {
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  return walls.map((w) => {
    toWorld(w.a, a);
    if (w.b) toWorld(w.b, b);
    return {
      kind: w.kind,
      face: w.face,
      capped: w.capped,
      a: a.toArray(),
      b: w.b ? b.toArray() : undefined,
    };
  });
}
export function applyDrawItems(walls, items) {
  walls.forEach((w, i) => {
    const item = items[i];
    if (item) {
      Object.assign(w, {
        ok: item.ok,
        info: item.info,
        triStart: item.triStart,
        triEnd: item.triEnd,
      });
    }
  });
}
export async function sweepDrawn(
  { topology: topo, res, rot, walls, toWorld, auto: built, gone, queue = geometryQueue },
) {
  const options = manualOptions();
  options.auto = built;
  options.gone = [...(gone ?? [])];
  const reply = await queue.run('build', topo, {
    kind: 'build',
    rot: [...rot],
    result: res,
    requests: requestsFor(walls, toWorld),
    options,
  });
  return reply?.built ?? null;
}
export async function rebuildDrawn() {
  const generation = ++drawGeneration, model = topology, mesh = part, records = drawnWalls;
  if (geometryQueue.model && geometryQueue.model !== model) {
    geometryQueue.dispose(); geometryQueue.model = null;
  }
  geometryQueue.cancel('place');
  previewGeneration++; geometryQueue.cancel('preview');
  if (drawnMesh) {
    scene.remove(drawnMesh);
    drawnMesh.geometry.dispose();
    drawnMesh = null;
  }
  drawnTris = [];
  drawBusy = false;
  reportTask('build', false);
  braceMemo.stamp = null;
  if (braceShown) dropGhost();
  if (!drawShown() || !topology || !lastResult || !drawnWalls.length) {
    geometryQueue.cancel('build');
    if (!topology) {
      geometryQueue.dispose();
      geometryQueue.model = null;
    }
    syncSelection();
    return;
  }
  part.updateMatrixWorld();
  drawBusy = true;
  reportTask('build', true);
  let failure = null;
  try {
    const built = await sweepDrawn({
      topology,
      res: lastResult,
      rot: rotM3.elements,
      walls: records,
      toWorld: (v, out) => mesh.localToWorld(out.copy(v)),
      auto: finsVisible && autoLike() ? lastBuilt : null,
      gone: removedIds,
    });
    if (
      generation !== drawGeneration || topology !== model || part !== mesh || drawnWalls !== records
    ) return;
    if (!built) return;
    applyDrawItems(records, built.items);
    drawnTris = built.triangles;
    drawMaterial.transparent = false;
    drawMaterial.opacity = 1;
    drawnMesh = meshFrom(drawnTris, drawMaterial, ifaceMaterial);
    reportTask('build', false);
    syncSelection();
    updateReadout(lastBuilt);
    updateFit();
  } catch (error) {
    if (generation !== drawGeneration) return;
    console.error('Background manual support build failed', error);
    failure = error;
    reportTask('build', false, error);
    for (const w of records) {
      w.ok = false;
      w.info = { reason: 'background support calculation failed — retry' };
    }
    syncSelection();
    updateReadout(lastBuilt);
  } finally {
    if (generation === drawGeneration) {
      drawBusy = false;
      reportTask('build', false, failure);
    }
  }
}

// ---- selecting a hand-placed support, to remove it -------------------------
// A click on a drawn wall or sway brace selects it (drawn in amber); Delete /
// Backspace or the "Remove selected" button takes it out, and Undo brings it back.
// Held as the wall OBJECT, not an index, so an undo/clear that replaces the list
// simply drops a selection that no longer exists.
export let selectedWall = null;
let selMesh = null;
const selMaterial = new THREE.MeshStandardMaterial({
  color: 0xffb347, roughness: 0.6, metalness: 0.0, side: THREE.DoubleSide,
  polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  clippingPlanes: clip,
});

/** Re-draw the highlight for the current selection, or clear a stale one. */
function syncSelection() {
  if (selMesh) { scene.remove(selMesh); selMesh.geometry.dispose(); selMesh = null; }
  if (selectedWall && (!drawShown() || !drawnWalls.includes(selectedWall) || !selectedWall.ok)) {
    selectedWall = null;
  }
  if (selectedWall) {
    selMesh = meshFrom(drawnTris.slice(selectedWall.triStart * 3, selectedWall.triEnd * 3), selMaterial);
    selMesh?.layers.disable(MODEL);   // an overlay: the section's glass draws the wall once
  }
  el('draw-remove').hidden = !selectedWall;
}

/** The hand-placed support under the pointer, if it is nearer than the part. */
function pickSupport(ev) {
  if (!drawnMesh) return null;
  const r = renderer.domElement.getBoundingClientRect();
  pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1,
              -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = keptHit(raycaster.intersectObject(drawnMesh, false));
  if (!hit || hit.faceIndex == null) return null;
  const onPart = part ? keptHit(raycaster.intersectObject(part, false)) : null;
  if (onPart && onPart.distance < hit.distance) return null;   // the part is in front
  return drawnWalls.find((w) => w.ok && hit.faceIndex >= w.triStart && hit.faceIndex < w.triEnd) ?? null;
}

/** One readout line naming what is selected and how to remove it. */
export function selectedNote() {
  const i = selectedWall.info ?? {};
  const what = selectedWall.kind === 'sway'
    ? t('sway brace {mm}mm tall', { mm: Math.round(i.height ?? 0) })
    : t('wall {mm}mm long', { mm: Math.round(i.length ?? 0) });
  const tines = i.tines ? `, ${t('{n} tines', { n: i.tines })}` : '';
  return t('selected: {what}{tines}. Press Delete or Remove selected to take it out (Esc to keep it)', { what, tines });
}

export function selectWall(w) {
  selectedWall = selectedWall === w ? null : w;   // a second click deselects
  drawMsg = '';
  syncSelection();
  updateReadout(lastBuilt);
}

export function removeSelected() {
  if (!selectedWall) return;
  histPush();
  drawnWalls = drawnWalls.filter((w) => w !== selectedWall);
  selectedWall = null;
  drawMsg = '';
  rebuildDrawn();
  syncDrawControls();   // the last one gone in Auto hides Clear again
  updateReadout(lastBuilt);
  updateFit();
}

/** Show the endpoint / cursor / band, and a live ghost of the wall in progress. */
let ghostQueued = null;
function updatePreview(hitPoint) {
  previewGeneration++;
  drawCursor.position.copy(hitPoint);
  drawCursor.visible = true;
  if (!drawStart) {
    drawBand.visible = false;
    return;
  }
  part.updateMatrixWorld();
  const aWorld = part.localToWorld(drawStart.clone());
  drawDot.position.copy(aWorld);
  drawDot.visible = true;
  bandGeom.setFromPoints([aWorld, hitPoint]);
  bandGeom.attributes.position.needsUpdate = true;
  drawBand.visible = true;

  // Build the ghost wall at most once per frame: one wall over the whole part is
  // a few ms, fine occasionally but not at raw pointer-move rates.
  const already = !!ghostQueued;
  ghostQueued = [aWorld.clone(), hitPoint.clone()];
  if (already) return;
  requestAnimationFrame(async () => {
    const q = ghostQueued;
    ghostQueued = null;
    if (!q || !drawStart || !drawActive()) return;
    if (ghostMesh) {
      scene.remove(ghostMesh);
      ghostMesh.geometry.dispose();
      ghostMesh = null;
    }
    try {
      const model = topology,
        start = drawStart,
        stamp = settingsKey(),
        options = manualOptions(),
        revision = previewGeneration;
      options.auto = finsVisible && autoLike() ? lastBuilt : null;
      options.gone = [...removedIds];
      const reply = await geometryQueue.run('preview', model, {
        kind: 'build',
        rot: [...rotM3.elements],
        result: lastResult,
        requests: [{ a: q[0].toArray(), b: q[1].toArray() }],
        options,
      });
      if (
        !reply || revision !== previewGeneration || topology !== model || drawStart !== start ||
        settingsKey() !== stamp
      ) return;
      if (ghostMesh) {
        scene.remove(ghostMesh);
        ghostMesh.geometry.dispose();
        ghostMesh = null;
      }
      if (reply.built.items[0]?.ok) {
        ghostMesh = meshFrom(reply.built.triangles, ghostMaterial);
        ghostMesh?.layers.disable(MODEL);
      }
    } catch (error) {
      console.warn('Support preview unavailable', error);
    }
  });
}

/** Commit the wall from `drawStart` to the just-clicked point, if it can build. */
async function placeSecondPoint(hitPoint) {
  if (placing || !drawStart) return;
  const start = drawStart,
    model = topology,
    mesh = part,
    pose = rotM3.elements.join(),
    stamp = settingsKey(),
    analysis = lastResult,
    records = drawnWalls;
  mesh.updateMatrixWorld();
  const aw = mesh.localToWorld(start.clone()), bw = hitPoint.clone();
  placing = true;
  reportTask('place', true);
  let failure = null;
  try {
    const options = manualOptions();
    options.auto = finsVisible && autoLike() ? lastBuilt : null;
    options.gone = [...removedIds];
    const reply = await geometryQueue.run('place', model, {
      kind: 'build',
      rot: [...rotM3.elements],
      result: lastResult,
      requests: [{ a: aw.toArray(), b: bw.toArray() }],
      options,
    });
    if (
      !reply || topology !== model || part !== mesh || drawStart !== start ||
      drawnWalls !== records || rotM3.elements.join() !== pose || lastResult !== analysis || settingsKey() !== stamp
    ) return;
    const r = reply.built.items[0]?.info;
    if (!r?.ok) {
      drawMsg = t('couldn’t place that wall: {reason}', {
        reason: t(r?.reason ?? 'no printable wall'),
      });
      clearPreview();
      updateReadout(lastBuilt);
      return;
    }
    drawMsg = '';
    histPush();
    drawnWalls.push({ a: start.clone(), b: mesh.worldToLocal(bw.clone()) });
    clearPreview();
    rebuildDrawn();
    updateReadout(lastBuilt);
    updateFit();
  } catch (error) {
    if (topology === model && part === mesh && drawnWalls === records &&
      rotM3.elements.join() === pose && lastResult === analysis && settingsKey() === stamp) {
      console.error(error);
      failure = error;
      reportTask('place', false, error);
    }
  } finally {
    placing = false;
    reportTask('place', false, failure);
  }
}

// ---- sway brace preview: hover an upright side to see what a click stands ----
// The ghost IS the brace the click builds (both go through braceAt). Its top follows
// the cursor; in the top quarter of what a brace could reach there it snaps to the
// whole face, the height a brace always had before the clicked-height cap. A spot
// that can't take one turns the cursor amber and says why, before any click.
// braceghost.js fades and eases what this shows, so moving about doesn't flash.
const MEMO_MAX = 200;
let braceMemo = { stamp: null, map: new Map() };
let braceShown = null;   // the braceAt key the ghost and tip show now
let braceQueued = null;

/**
 * The brace a click at print-space point `p` on face `faceIndex` stands, as
 * { r: swayAtFace's result, full, point, key }: `point` is the spot it stands at
 * (x, y to the mm, a capped top to 1 mm), which placeSway stores. Memoised until
 * the pose, the settings or the supports it stands clear of change.
 */
async function braceAt(faceIndex, p, channel = 'preview') {
  const options = manualOptions();
  options.auto = finsVisible && autoLike() ? lastBuilt : null;
  options.gone = [...removedIds];
  const stamp = [
    topology,
    lastResult,
    lastBuilt,
    drawnWalls,
    drawnWalls.length,
    removedIds,
    rotM3.elements.join(),
    JSON.stringify(options.tunables),
    JSON.stringify(options.sway),
  ];
  if (!braceMemo.stamp || braceMemo.stamp.some((v, i) => v !== stamp[i])) {
    braceMemo = { stamp, map: new Map() };
  }
  const n = topology.nrm, r = rotM3.elements, f = faceIndex * 3;
  const nx = r[0] * n[f] + r[3] * n[f + 1] + r[6] * n[f + 2],
    ny = r[1] * n[f] + r[4] * n[f + 1] + r[7] * n[f + 2];
  const rx = Math.round(p[0]),
    ry = Math.round(p[1]),
    off = ((rx - p[0]) * nx + (ry - p[1]) * ny) / (nx * nx + ny * ny || 1);
  const point = [rx - off * nx, ry - off * ny, p[2]],
    key = channel + '|' + faceIndex + '|' + point.map((v) => Math.round(v * 1000) / 1000).join();
  const map = braceMemo.map;
  if (!map.has(key)) {
    const avoid = {
      braces: drawnWalls.filter((w) => w.kind === 'sway' && w.ok).map((w) => w.info),
      walls: [],
    };
    const promise = geometryQueue.run(channel, topology, {
      kind: 'brace',
      face: faceIndex,
      point,
      rot: [...rotM3.elements],
      result: lastResult,
      options,
      avoid,
    }).then((reply) => {
      if (!reply) {
        map.delete(key);
        return null;
      }
      return { ...reply.built, key };
    }).catch((error) => {
      map.delete(key);
      throw error;
    });
    map.set(key, promise);
    if (map.size > MEMO_MAX) map.delete(map.keys().next().value);
  }
  return map.get(key);
}

/** Hovering an upright side with Sway braces on: ghost + tip for the brace a click there stands. */
function updateBracePreview(hit, ev) {
  previewGeneration++;
  drawCursor.position.copy(hit.point);
  drawCursor.visible = true;
  drawBand.visible = drawDot.visible = false;
  moveTip(ev.clientX + 16, ev.clientY + 16);
  // at most one brace build per frame, as the wall ghost
  const already = !!braceQueued;
  braceQueued = { face: hit.faceIndex, p: [hit.point.x, hit.point.y, hit.point.z] };
  if (already) return;
  requestAnimationFrame(async () => {
    const q = braceQueued;
    braceQueued = null;
    if (!q || drawStart || !(drawActive() || braceActive())) return;
    const revision = previewGeneration;
    let b;
    try {
      b = await braceAt(q.face, q.p);
    } catch (error) {
      console.warn(error);
      return;
    }
    if (!b || revision !== previewGeneration || drawStart || !(drawActive() || braceActive())) {
      return;
    }
    if (b.key === braceShown) return;
    braceShown = b.key;
    const mm = Math.round(b.r.height ?? 0);
    showBrace(
      b.r.ok ? b.r.tris : null,
      b.r.height ?? 0,
      !b.r.ok
        ? t(b.r.reason)
        : b.r.fitted
        ? t('Fitted brace · {mm} mm · check plate space', { mm })
        : b.full
        ? t('Brace · full height {mm} mm', { mm })
        : t('Brace · {mm} mm · move up for full height', { mm }),
      !b.r.ok,
    );
  });
}

renderer.domElement.addEventListener('pointerleave', () => {
  previewGeneration++; geometryQueue.cancel('preview');
  braceQueued = null;
  if (!drawStart) { drawCursor.visible = false; braceShown = null; hideBrace(false); }
});

/** The pointer is on the part but off an upright side: the dot follows it, and the
 *  brace stays a moment (an edge or a small facet on the way) before it fades. */
function slipOff(hit, keepCursor) {
  previewGeneration++; geometryQueue.cancel('preview');
  braceQueued = null;
  // back on the part inside a grace begun off it: Draw's cursor stays after all
  if (!braceShown && keepCursor && braceGrace()) hideBrace(true, null);
  if (!braceShown) return false;
  braceShown = null;
  drawCursor.position.copy(hit.point);
  hideBrace(true, keepCursor ? null : () => { drawCursor.visible = false; });
  return true;
}

/** Stand a sway brace on the upright face the user clicked: the one its preview showed. */
async function placeSway(hit) {
  if (placing) return;
  braceQueued = null;
  const model = topology,
    mesh = part,
    pose = rotM3.elements.join(),
    stamp = settingsKey(),
    analysis = lastResult,
    records = drawnWalls;
  placing = true;
  reportTask('place', true);
  let failure = null;
  try {
    const built = await braceAt(hit.faceIndex, hit.point.toArray(), 'place');
    if (
      !built || topology !== model || part !== mesh || drawnWalls !== records ||
      rotM3.elements.join() !== pose || lastResult !== analysis || settingsKey() !== stamp
    ) return;
    const { r, full, point } = built;
    dropGhost();
    if (!r.ok) {
      drawMsg = t('couldn’t place that brace: {reason}', { reason: t(r.reason) });
      updateReadout(lastBuilt);
      return;
    }
    drawMsg = '';
    histPush();
    mesh.updateMatrixWorld();
    drawnWalls.push({
      kind: 'sway',
      face: hit.faceIndex,
      ...(full ? {} : { capped: true }),
      a: mesh.worldToLocal(new THREE.Vector3(...point)),
    });
    rebuildDrawn();
    syncDrawControls();
    updateReadout(lastBuilt);
    updateFit();
  } catch (error) {
    if (topology === model && part === mesh && drawnWalls === records &&
      rotM3.elements.join() === pose && lastResult === analysis && settingsKey() === stamp) {
      console.error(error);
      failure = error;
      reportTask('place', false, error);
    }
  } finally {
    placing = false;
    reportTask('place', false, failure);
  }
}

/** Show Clear whenever hand-drawn walls are shown (they stay in Suggest after
 *  "+ Add" is switched off), but the click hint only while a click places one. */
export function syncDrawControls() {
  el('draw-controls').hidden = !drawShown();
  el('draw-hint').hidden = !drawActive();
  el('draw-hint').innerHTML = t('Click two points across an overhang — straight onto the red faces — to lay a breakaway wall along that line. Hover an upright side to preview a sway brace: its top follows the cursor, and near the top of the side it runs full height. Click to stand it. Esc or right-click cancels.');
}

// Clear acts on the hand-drawn breakaway walls -- the thing both Draw and the
// Suggest "+ Add" augment now place. Undo is the sidebar's (and Ctrl-Z).
el('draw-clear').addEventListener('click', () => {
  if (!drawnWalls.length) return;
  histPush();
  drawnWalls = [];
  drawMsg = '';
  clearPreview();
  rebuildDrawn();
  updateReadout(lastBuilt);
  updateFit();
});
el('draw-remove').addEventListener('click', removeSelected);

export function setDrawMsg(v) { drawMsg = v; }
/** The part turned or changed: the cached print-space triangles are stale. */
export function markPrintTrisDirty() { braceMemo.stamp = null; }

// ---- the draw pointer (app.js dispatches here while drawActive()) ----------

/** Pointer move: the cursor, band and ghost wall track the surface under it. */
export function drawHover(ev) {
  const hit = pickFace(ev);
  if (hit && swayHit(hit)) {
    updateBracePreview(hit, ev);
    renderer.domElement.style.cursor = 'crosshair';
  } else if (hit) {
    slipOff(hit, true);   // Draw's own cursor carries on over the rest of the part
    updatePreview(hit.point);
    renderer.domElement.style.cursor = 'crosshair';
  } else if (!drawStart) {
    drawBand.visible = false;
    braceAway();   // off the part: a gap crossed on the way doesn't blink the brace
    renderer.domElement.style.cursor = '';
  } else {
    braceQueued = null;
    drawCursor.visible = drawBand.visible = false;
    braceShown = null;
    hideBrace(false);
    if (ghostMesh) { scene.remove(ghostMesh); ghostMesh.geometry.dispose(); ghostMesh = null; }
    renderer.domElement.style.cursor = '';
  }
}

/** braceActive's pointer move: true when it showed a brace (the cursor is on an
 *  upright side); otherwise it hides its preview and the caller's hover runs. */
export function braceHover(ev) {
  const hit = pickFace(ev);
  if (hit && swayHit(hit)) {
    updateBracePreview(hit, ev);
    renderer.domElement.style.cursor = 'crosshair';
    return true;
  }
  if (hit && (slipOff(hit, false) || braceGrace())) {
    drawCursor.position.copy(hit.point);   // still fading in its grace: keep following
    return false;
  }
  braceAway();   // off the part, or on it with no brace shown: the dot goes too
  return false;
}

/** The pointer left the part (a gap, the background) or is over the rotate rings
 *  without dragging: the same grace as slipOff, then the preview and its dot go. */
export function braceAway() {
  previewGeneration++; geometryQueue.cancel('preview');
  braceQueued = null;
  if (!braceShown && !braceGrace()) {
    // the crosshair too, even with the dot already gone (a build landing hides it)
    drawCursor.visible = false;
    renderer.domElement.style.cursor = '';
    return;
  }
  braceShown = null;
  hideBrace(true, () => { drawCursor.visible = false; renderer.domElement.style.cursor = ''; });
}

/** Fade braceActive's ghost and tip and hide its cursor (an orbit or a ring drag
 *  has the pointer). */
export function dropBracePreview() {
  previewGeneration++; geometryQueue.cancel('preview');
  braceQueued = null;
  braceShown = null;
  hideBrace(false);
  drawCursor.visible = false;
  renderer.domElement.style.cursor = '';
}

/** braceActive's click: select a support placed by hand, or stand a brace on an
 *  upright side; true when it did. Anywhere else is left to the caller (an orbit,
 *  the rings). */
export function braceClick(e) {
  const sup = pickSupport(e);
  if (sup) { selectWall(sup); return true; }
  const hit = pickFace(e);
  if (!hit || !swayHit(hit)) return false;
  if (selectedWall) { selectedWall = null; syncSelection(); }
  placeSway(hit);
  return true;
}

/** With Sway braces on, a click on an UPRIGHT side (no wall half-drawn) stands a brace. */
const swayHit = (hit) => !drawStart && el('sway').checked &&
  faceIsUpright(topology, rotM3.elements, hit.faceIndex);

/** A click: select a placed support, stand a sway brace, or set / commit a wall end. */
export function drawClick(e) {
  if (placing) return;
  // A click on a support you placed selects it (for Delete / Remove selected),
  // unless a wall is half-drawn -- then the click is its second point.
  if (!drawStart) {
    const sup = pickSupport(e);
    if (sup) { selectWall(sup); return; }
  }
  const hit = pickFace(e);
  if (!hit) return;
  if (selectedWall) { selectedWall = null; syncSelection(); }
  // With Sway braces on, a single click on an UPRIGHT side stands a brace there;
  // a click on anything else still starts a two-point wall as before.
  if (swayHit(hit)) {
    placeSway(hit);
    return;
  }
  if (!drawStart) {
    dropGhost();   // a brace still fading in its grace is not what this click starts
    drawStart = part.worldToLocal(hit.point.clone());
    drawMsg = '';
    updatePreview(hit.point);
    updateReadout(lastBuilt);
  } else {
    placeSecondPoint(hit.point);
  }
}

el('draw-retry').addEventListener('click', () => {
  reportTask('place', false);
  rebuildDrawn();
  dispatchEvent(new Event('retry-draw'));
});
