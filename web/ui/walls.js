import { t } from './i18n.js';
/**
 * Hand-placed supports: the breakaway walls drawn in Draw mode (or the Suggest
 * "+ Add" augment) and sway braces stood with one click, their preview markers,
 * selecting one to remove it, and the Draw Clear button. app.js's pointer
 * dispatch calls drawHover / drawClick while drawActive().
 */
import * as THREE from 'three';
import { drawnWall } from '../draw.js';
import { arcThrough, arcStations } from '../drawarc.js';
import { planGrid } from '../fins/tall.js';
import { swayAtFace, faceIsUpright } from '../sway.js';
import { initBraceGhost, showBrace, moveTip, hideBrace, dropBrace, braceGrace } from './braceghost.js';
import { el } from './dom.js';
import { viewport, renderer, scene, camera, meshFrom, ifaceMaterial, raycaster, pointer, clip, MODEL } from './scene.js';
import { keptHit } from './section.js';
import { removedIds } from './remove.js';
import { histPush } from './history.js';
import { updateReadout } from './readout.js';
import { pickFace } from './pose.js';
import { part, topology, rotM3, lastResult, updateFit } from './part.js';
import { finsVisible, finMode, autoLike, drawAugment } from './settings.js';
import { lastBuilt, swayOpts } from './finbuild.js';

// ---- draw mode: the user places breakaway walls by hand --------------------
// A drawn wall IS the same kind of support the auto-placer emits, so it shares
// the fin material and the green legend swatch. What is different is who chose
// the line: a person, not a PCA fit -- which is the whole reason it comes out
// straight. Endpoints are stored in the part's LOCAL frame so a wall tracks the
// part through later rotations, the same way the auto fins are rebuilt each time
// the orientation changes.
export let drawnWalls = [];        // committed walls: { a, b, m?: Vector3(local), ok, info } -- m: a curve's third click
export function setDrawnWalls(w) { drawnWalls = w; }
export let drawnMesh = null;
export let drawnTris = [];
export let drawStart = null;       // Vector3 (local) -- first click of a wall in progress
let drawEnd = null;                // Vector3 (local) -- a curve's second click (its other end)
// Line or Curve (local issue 063): a curve is three clicks -- its ends, then a point it
// runs through -- built round the circular arc through all three (drawarc.js).
// Remembered per browser (optional).
const SHAPE_KEY = 'support_fins_draw_shape';
let drawShape = 'line';
export const drawShapeNow = () => drawShape;
try { if (localStorage.getItem(SHAPE_KEY) === 'curve') drawShape = 'curve'; } catch { /* storage off */ }
export let drawMsg = '';           // last placement result, for the readout
let printTris = null;       // whole part in print space, cached per orientation
let printTrisDirty = true;

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
const drawDot2 = new THREE.Mesh(drawDot.geometry, drawDot.material);   // a curve's other end
// The band is a straight line, or a curve's arc: a fixed buffer, drawn to its length.
const BAND_MAX = 129;
const bandGeom = new THREE.BufferGeometry();
bandGeom.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(BAND_MAX * 3), 3));
const BAND_OK = 0x6dffab, BAND_BAD = 0xff6b6b;   // red: the wall in progress can't build (too tight)
const drawBand = new THREE.Line(bandGeom,
  new THREE.LineBasicMaterial({ color: BAND_OK, depthTest: false, transparent: true }));
drawBand.frustumCulled = false;   // its endpoints move every frame; stale bounds would cull it
initBraceGhost(drawCursor.material);
for (const o of [drawDot, drawDot2, drawCursor, drawBand]) {
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
  if (drawDot2.visible) drawDot2.scale.setScalar(DOT_PX * mmPerPx(drawDot2.position));
  if (drawCursor.visible) drawCursor.scale.setScalar(CURSOR_PX * mmPerPx(drawCursor.position));
}

/** The whole part in PRINT space (rotated + seated), rebuilt only when the
 *  orientation changes. This is the surface a drawn wall's contact line samples,
 *  the same transform export bakes in. */
function partPrintTriangles() {
  if (printTris && !printTrisDirty) return printTris;
  printTris = printTriangles(topology, rotM3.elements, lastResult.offset);
  printTrisDirty = false;
  return printTris;
}

/** `topology` posed `rot` and seated at `offset` (analyze's), as one flat array. */
export function printTriangles(topology, rot, { x: dx, y: dy, z: dz }) {
  const { pos, nFaces } = topology;
  const a = new Float64Array(nFaces * 9);
  for (let i = 0; i < a.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    a[i]     = rot[0] * x + rot[3] * y + rot[6] * z + dx;
    a[i + 1] = rot[1] * x + rot[4] * y + rot[7] * z + dy;
    a[i + 2] = rot[2] * x + rot[5] * y + rot[8] * z + dz;
  }
  return a;
}

/** Drop any wall-in-progress and hide every transient draw visual. */
export function clearPreview() {
  drawStart = drawEnd = null;
  drawDot.visible = drawDot2.visible = drawCursor.visible = drawBand.visible = false;
  dropGhost();
  showGhostMsg('');
  syncBack();
}

/** Backspace: take back the last point of the wall in progress (a curve's end, or
 *  its start -- which drops the wall). True when there was one. */
export function undoDrawPoint() {
  if (!drawStart) return false;
  if (drawEnd) {
    drawEnd = null;
    drawDot2.visible = false;
    showGhostMsg('');
    if (ghostMesh) { scene.remove(ghostMesh); ghostMesh.geometry.dispose(); ghostMesh = null; }
    part.updateMatrixWorld();
    if (drawCursor.visible) updatePreview(drawCursor.position);
    else drawBand.visible = false;
    syncBack();
  } else {
    clearPreview();
  }
  updateReadout(lastBuilt);
  return true;
}

/** The band's points: the straight line, or a curve's arc ending at the cursor. */
function setBand(pts) {
  const pos = bandGeom.attributes.position, n = Math.min(pts.length, BAND_MAX);
  for (let i = 0; i < n; i++) pos.setXYZ(i, pts[i].x, pts[i].y, pts[i].z);
  pos.needsUpdate = true;
  bandGeom.setDrawRange(0, n);
}

/** World points round the arc a -> b through m (a straight line when in line). */
function arcPoints(a, b, m) {
  const c = arcThrough([a.x, a.y], [b.x, b.y], [m.x, m.y]);
  if (!c) return [a, b];
  const step = Math.max(0.25, Math.abs(c.sweep) * c.r / (BAND_MAX - 1));
  return arcStations([a.x, a.y, a.z], [b.x, b.y, b.z], [m.x, m.y, m.z], step, 3)
    .slice(0, BAND_MAX).map((p) => new THREE.Vector3(p[0], p[1], p[2]));
}

// A curve the ghost can't build says why in the readout, as soon as it can't
// (a placed wall's refusal already does): changed only when the reason does.
let ghostMsg = '';
function showGhostMsg(msg) {
  drawBand.material.color.setHex(msg ? BAND_BAD : BAND_OK);
  if (msg === ghostMsg) return;
  ghostMsg = msg;
  drawMsg = msg ? t('can’t place this curve: {reason}', { reason: t(msg) }) : '';
  updateReadout(lastBuilt);
}

// Ends snap to another drawn wall's end within this many CSS pixels, so curves chain
// into a ring (two arcs; one closed loop could not be pulled off the part).
const SNAP_PX = 10;
/** `p` (world), or the drawn wall end it is within SNAP_PX of on screen. */
function snapEnd(p) {
  const tol = SNAP_PX * 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
    * camera.position.distanceTo(p) / Math.max(1, viewport.clientHeight);
  let best = null, bd = tol;
  const q = new THREE.Vector3();
  for (const w of drawnWalls) {
    if (w.kind === 'sway') continue;
    for (const end of [w.a, w.b]) {
      part.localToWorld(q.copy(end));
      const d = q.distanceTo(p);
      if (d < bd) { bd = d; best = q.clone(); }
    }
  }
  return best ?? p;
}

function dropGhost() {
  if (ghostMesh) { scene.remove(ghostMesh); ghostMesh.geometry.dispose(); ghostMesh = null; }
  braceShown = null;
  dropBrace();
}

/** Rebuild the committed drawn walls for the current orientation. */
export function rebuildDrawn() {
  if (drawnMesh) { scene.remove(drawnMesh); drawnMesh.geometry.dispose(); drawnMesh = null; }
  drawnTris = [];
  if (!drawShown() || !topology || !lastResult) { syncSelection(); return; }
  part.updateMatrixWorld();
  drawnTris = sweepDrawn({
    topology, res: lastResult, rot: rotM3.elements, tris: partPrintTriangles(), walls: drawnWalls,
    toWorld: (v, out) => part.localToWorld(out.copy(v)),
    auto: finsVisible && autoLike() ? lastBuilt : null, gone: removedIds,
  });
  drawnMesh = meshFrom(drawnTris, drawMaterial, ifaceMaterial);
  braceMemo.stamp = null;   // the braces a preview stands clear of have moved
  if (braceShown) dropGhost();
  syncSelection();
}

/**
 * Stand a model's hand-placed supports for its pose, under the settings on the
 * page: the live model's (rebuildDrawn) or a parked one's (ui/parkedbuild.js).
 * Sets each wall's ok / info / triangle range and returns the triangles. `ctx`:
 * { topology, res, rot, tris (the part in print space), walls, toWorld(local, out),
 * auto (Auto's build on screen, or null), gone (its removed fin ids) }.
 */
export function sweepDrawn({ topology, res, rot, tris, walls, toWorld, auto: built, gone }) {
  const out = [];
  // Both Draw and the Suggest "+ Add" augment place the SAME thing now: hand-drawn
  // under-overhang breakaway walls. Each wall is stored as two local endpoints and
  // re-swept against the part's current pose, so a wall that no longer reaches the
  // part (rotated away) is flagged by drawnWall rather than dropped silently.
  // Drawn walls grip with the same tine comb the auto fins use when Tines is on.
  const drawOpts = { tines: el('tines').checked,
                     tineDensity: el('tine-density').valueAsNumber / 100,
                     layerHeight: el('layer-height').valueAsNumber,
                     plateOnly: el('plate-only').checked,
                     braceTall: el('tall-ribs').checked,
                     topo: topology, rot, offset: res.offset };
  // A tall drawn wall's ribs keep sideClear off the walls drawn before it and off
  // Auto's supports and pad when they're on screen (draw.js braceTall): a rib fused
  // into a neighbour no longer breaks away by itself. (Walls drawn later don't check
  // back -- drawn walls never check each other -- and Auto's ribs, built in the
  // Worker, can't see drawn walls.)
  const ribGrid = planGrid();
  if (built) {
    for (const rec of built.fins ?? []) {
      if (gone.has(rec.id)) continue;
      for (const [a, b] of rec.triRanges ?? []) ribGrid.add(built.triangles.slice(a, b), 'auto');
    }
    if (built.padTriangles?.length) ribGrid.add(built.padTriangles, 'auto');
  }
  let gridded = 0;
  drawOpts.braceClear = (rib) => {
    ribGrid.add(out.slice(gridded));   // walls drawn since the last rib
    gridded = out.length;
    return !ribGrid.hits(rib);
  };
  const wa = new THREE.Vector3(), wb = new THREE.Vector3(), wm = new THREE.Vector3();
  const toArr = (v) => [v.x, v.y, v.z];
  // Everything a hand-placed brace has to keep clear of: Auto's braces and walls
  // (when Auto's supports are on screen), then each hand-placed brace as it is
  // re-stood, so a rotation that brings two together is reported rather than fused.
  const auto = autoSupports(built, gone);
  const braces = [...auto.braces];
  for (const w of walls) {
    // Each support remembers which triangles of the merged mesh are its own, so a
    // click on the mesh can be traced back to the support to select / remove.
    w.triStart = out.length / 3;
    if (w.kind === 'sway') {
      // A hand-placed sway brace: re-stood on the same face at the same spot, so
      // it follows the part when it turns (and says why if that face no longer
      // stands upright, or now runs into an earlier brace). A capped one stops at
      // its clicked point's height; the rest run up the whole face.
      toWorld(w.a, wa);
      const r = swayAtFace(topology, res, rot, w.face,
                           [wa.x, wa.y, wa.z], { ...swayOpts(), full: !w.capped }, { braces, walls: auto.walls });
      w.ok = r.ok;
      w.info = r;
      if (r.ok) { braces.push(r); for (const t of r.tris) out.push(t); }
      w.triEnd = out.length / 3;
      continue;
    }
    toWorld(w.a, wa);
    toWorld(w.b, wb);
    const r = drawnWall([wa.x, wa.y, wa.z], [wb.x, wb.y, wb.z], tris, 0,
                        w.m ? { ...drawOpts, through: toArr(toWorld(w.m, wm)) } : drawOpts);
    w.ok = r.ok;
    w.info = r;
    if (r.ok) for (const t of r.tris) out.push(t);
    w.triEnd = out.length / 3;
  }
  return out;
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

/** Show the endpoint / cursor / band, and a live ghost of the wall in progress. A
 *  curve with both ends down bends through the cursor: its third click. */
let ghostQueued = null;
function updatePreview(hitPoint) {
  // a wall end snaps onto another wall's end; a curve's third click goes where it's put
  const p = drawEnd ? hitPoint : snapEnd(hitPoint);
  drawCursor.position.copy(p);
  drawCursor.visible = true;
  if (!drawStart) { drawBand.visible = false; return; }
  part.updateMatrixWorld();
  const aWorld = part.localToWorld(drawStart.clone());
  const bWorld = drawEnd ? part.localToWorld(drawEnd.clone()) : null;
  drawDot.position.copy(aWorld);
  drawDot.visible = true;
  if (bWorld) { drawDot2.position.copy(bWorld); drawDot2.visible = true; }
  setBand(bWorld ? arcPoints(aWorld, bWorld, p) : [aWorld, p]);
  drawBand.visible = true;

  // Build the ghost wall at most once per frame: one wall over the whole part is
  // a few ms, fine occasionally but not at raw pointer-move rates.
  const already = !!ghostQueued;
  ghostQueued = bWorld ? [aWorld, bWorld, p.clone()] : [aWorld, p.clone()];
  if (already) return;
  requestAnimationFrame(() => {
    const q = ghostQueued;
    ghostQueued = null;
    if (!q || !drawStart || !drawActive()) return;
    if (ghostMesh) { scene.remove(ghostMesh); ghostMesh.geometry.dispose(); ghostMesh = null; }
    const tris = partPrintTriangles();
    const [ga, gb, gm] = q;
    const r = drawnWall([ga.x, ga.y, ga.z], [gb.x, gb.y, gb.z], tris, 0,
                        { braceTall: el('tall-ribs').checked,   // the ghost shows its ribs
                          ...(gm ? { through: [gm.x, gm.y, gm.z] } : {}) });
    if (r.ok) { ghostMesh = meshFrom(r.tris, ghostMaterial); ghostMesh?.layers.disable(MODEL); }
    // a curve says at once why it can't bend that tight; a straight wall in progress
    // keeps today's quiet ghost (its end is not chosen yet)
    showGhostMsg(gm && !r.ok && /too tight/.test(r.reason) ? r.reason : '');
  });
}

/** Commit the wall from `drawStart` to `bWorld` (through `mWorld` for a curve), if it can build. */
function placeWall(bWorld, mWorld = null) {
  part.updateMatrixWorld();
  const aWorld = part.localToWorld(drawStart.clone());
  const tris = partPrintTriangles();
  const r = drawnWall([aWorld.x, aWorld.y, aWorld.z],
                      [bWorld.x, bWorld.y, bWorld.z], tris, 0,
                      mWorld ? { through: [mWorld.x, mWorld.y, mWorld.z] } : {});
  if (!r.ok) {
    // a curve too tight keeps its ends: the next click tries a wider bend
    if (mWorld && /too tight/.test(r.reason)) { showGhostMsg(r.reason); return; }
    clearPreview();   // (clears a curve's live message first)
    drawMsg = t('couldn’t place that wall: {reason}', { reason: t(r.reason) });
    updateReadout(lastBuilt);
    return;
  }
  drawMsg = '';
  histPush();
  drawnWalls.push({ a: drawStart.clone(), b: part.worldToLocal(bWorld.clone()),
                    ...(mWorld ? { m: part.worldToLocal(mWorld.clone()) } : {}) });
  clearPreview();
  rebuildDrawn();
  updateReadout(lastBuilt);
  updateFit();
}

/**
 * The supports Auto has ALREADY placed, as things a hand-placed brace must avoid.
 *
 * Auto builds in the Worker, so the page has no other way to know where its braces
 * and walls stand: without this, a brace you click can land on top of an Auto one
 * (or face it across a channel) and the two fuse into one piece that won't break
 * away. Empty unless Auto's supports are actually on screen, and fins the user has
 * removed are left out -- they aren't there to hit.
 */
function autoSupports(built = finsVisible && autoLike() ? lastBuilt : null, removed = removedIds) {
  if (!built) return { braces: [], walls: [] };
  const outlines = built.sway?.braces ?? [];
  const braces = [], walls = [];
  let k = 0;   // sway records and their outlines are emitted in the same order
  for (const rec of built.fins ?? []) {
    const gone = removed.has(rec.id);
    if (rec.kind === 'sway') {
      const outline = outlines[k++];
      if (outline && !gone) braces.push(outline);
    } else if (!gone && Array.isArray(rec.line) && rec.line.length) {
      walls.push(rec.line);
    }
  }
  return { braces, walls };
}

// ---- sway brace preview: hover an upright side to see what a click stands ----
// The ghost IS the brace the click builds (both go through braceAt). Its top follows
// the cursor; in the top quarter of what a brace could reach there it snaps to the
// whole face, the height a brace always had before the clicked-height cap. A spot
// that can't take one turns the cursor amber and says why, before any click.
// braceghost.js fades and eases what this shows, so moving about doesn't flash.
const SNAP_TOP = 0.75;
const STEP_Z = 1;   // capped tops in 1 mm steps, so a creeping cursor reuses its ghost
const MEMO_MAX = 200;
let braceMemo = { stamp: null, map: new Map() };
let braceShown = null;   // the braceAt key the ghost and tip show now
let braceQueued = null;

/**
 * The brace a click at print-space point `p` on face `faceIndex` stands, as
 * { r: swayAtFace's result, full, point, key }: `point` is the spot it stands at
 * (x, y to the mm, a capped top to STEP_Z), which placeSway stores. Memoised until
 * the pose, the settings or the supports it stands clear of change.
 */
function braceAt(faceIndex, p) {
  const opts = swayOpts();
  const stamp = [lastResult, lastBuilt, removedIds, drawnWalls, drawnWalls.length, finsVisible, autoLike(),
                 rotM3.elements.join(), JSON.stringify(opts)];
  if (!braceMemo.stamp || braceMemo.stamp.some((v, i) => v !== stamp[i])) braceMemo = { stamp, map: new Map() };
  const memo = (key, f) => {
    const m = braceMemo.map;
    if (!m.has(key)) {
      m.set(key, f());
      if (m.size > MEMO_MAX) m.delete(m.keys().next().value);   // oldest first
    }
    return m.get(key);
  };
  const auto = autoSupports();
  const avoid = { braces: [...auto.braces, ...drawnWalls.filter((w) => w.kind === 'sway' && w.ok).map((w) => w.info)],
                  walls: auto.walls };
  // x, y to the mm, slid back onto the face's plane: the stored point has to stay on
  // the face, or a reopened session's nearestFace can pick the one beside it
  const n = topology.nrm, r = rotM3.elements, f = faceIndex * 3;
  const nx = r[0] * n[f] + r[3] * n[f + 1] + r[6] * n[f + 2], ny = r[1] * n[f] + r[4] * n[f + 1] + r[7] * n[f + 2];
  const rx = Math.round(p[0]), ry = Math.round(p[1]), off = ((rx - p[0]) * nx + (ry - p[1]) * ny) / (nx * nx + ny * ny || 1);
  const x = rx - off * nx, y = ry - off * ny, at = `${faceIndex}|${rx}|${ry}`;
  const full = memo(at, () => swayAtFace(topology, lastResult, rotM3.elements, faceIndex, [x, y, p[2]],
                                         { ...opts, full: true }, avoid));
  if (!full.ok || p[2] >= SNAP_TOP * full.height) return { r: full, full: true, point: [x, y, p[2]], key: at };
  const z = Math.max(STEP_Z, Math.round(p[2] / STEP_Z) * STEP_Z), key = `${at}|${z}`;
  return { r: memo(key, () => swayAtFace(topology, lastResult, rotM3.elements, faceIndex, [x, y, z], opts, avoid)),
           full: false, point: [x, y, z], key };
}

/** Hovering an upright side with Sway braces on: ghost + tip for the brace a click there stands. */
function updateBracePreview(hit, ev) {
  drawCursor.position.copy(hit.point);
  drawCursor.visible = true;
  drawBand.visible = drawDot.visible = false;
  moveTip(ev.clientX + 16, ev.clientY + 16);
  // at most one brace build per frame, as the wall ghost
  const already = !!braceQueued;
  braceQueued = { face: hit.faceIndex, p: [hit.point.x, hit.point.y, hit.point.z] };
  if (already) return;
  requestAnimationFrame(() => {
    const q = braceQueued;
    braceQueued = null;
    if (!q || drawStart || !(drawActive() || braceActive())) return;
    const b = braceAt(q.face, q.p);
    if (b.key === braceShown) return;
    braceShown = b.key;
    const mm = Math.round(b.r.height ?? 0);
    showBrace(b.r.ok ? b.r.tris : null, b.r.height ?? 0,
              !b.r.ok ? t(b.r.reason)
              : b.full ? t('Brace · full height {mm} mm', { mm })
              : t('Brace · {mm} mm · move up for full height', { mm }),
              !b.r.ok);
  });
}

renderer.domElement.addEventListener('pointerleave', () => {
  braceQueued = null;
  if (!drawStart) { drawCursor.visible = false; braceShown = null; hideBrace(false); }
});

/** The pointer is on the part but off an upright side: the dot follows it, and the
 *  brace stays a moment (an edge or a small facet on the way) before it fades. */
function slipOff(hit, keepCursor) {
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
function placeSway(hit) {
  braceQueued = null;
  const { r, full, point } = braceAt(hit.faceIndex, [hit.point.x, hit.point.y, hit.point.z]);
  dropGhost();
  if (!r.ok) {
    drawMsg = t('couldn’t place that brace: {reason}', { reason: t(r.reason) });
    updateReadout(lastBuilt);
    return;
  }
  drawMsg = '';
  histPush();
  part.updateMatrixWorld();
  drawnWalls.push({ kind: 'sway', face: hit.faceIndex, ...(full ? {} : { capped: true }),
                    a: part.worldToLocal(new THREE.Vector3(point[0], point[1], point[2])) });
  rebuildDrawn();
  syncDrawControls();   // Auto's first brace by hand brings up Clear / Remove selected
  updateReadout(lastBuilt);
  updateFit();
}

/** Show Clear whenever hand-drawn walls are shown (they stay in Suggest after
 *  "+ Add" is switched off), but the click hint only while a click places one. */
export function syncDrawControls() {
  el('draw-controls').hidden = !drawShown();
  el('draw-hint').hidden = el('draw-shape').hidden = !drawActive();
  for (const b of el('draw-shape').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.shape === drawShape));
  el('draw-hint').innerHTML = drawShape === 'curve'
    ? t('Click the two ends of a curved wall on the red faces, then a point it runs through — out past the ends for a bigger arc. Ends snap to another wall’s end, so two curves close a ring. Backspace takes back a point; Esc or right-click cancels.')
    : t('Click two points across an overhang — straight onto the red faces — to lay a breakaway wall along that line. Hover an upright side to preview a sway brace: its top follows the cursor, and near the top of the side it runs full height. Click to stand it. Esc or right-click cancels.');
  syncBack();
}

/** "Back one point" shows while a wall is half drawn. */
function syncBack() { el('draw-back').hidden = !drawStart; }

for (const b of el('draw-shape').querySelectorAll('button')) {
  b.addEventListener('click', () => {
    if (drawShape === b.dataset.shape) return;
    drawShape = b.dataset.shape;
    try { localStorage.setItem(SHAPE_KEY, drawShape); } catch { /* storage off */ }
    clearPreview();   // a wall half drawn as the other shape starts over
    updateReadout(lastBuilt);
    syncDrawControls();
  });
}
el('draw-back').addEventListener('click', () => undoDrawPoint());

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
export function markPrintTrisDirty() { printTrisDirty = true; }

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
const swayHit = (hit) => !drawStart && el('sway').checked && faceIsUpright(topology, rotM3.elements, hit.faceIndex);

/** A click: select a placed support, stand a sway brace, or set / commit a wall end. */
export function drawClick(e) {
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
    drawStart = part.worldToLocal(snapEnd(hit.point));
    drawMsg = '';
    updatePreview(hit.point);
    updateReadout(lastBuilt);
    syncBack();
  } else if (drawShape === 'curve' && !drawEnd) {
    drawEnd = part.worldToLocal(snapEnd(hit.point));
    updatePreview(hit.point);
  } else if (drawEnd) {
    placeWall(part.localToWorld(drawEnd.clone()), hit.point.clone());
  } else {
    placeWall(snapEnd(hit.point));
  }
}
