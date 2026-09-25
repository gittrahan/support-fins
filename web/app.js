/**
 * Support Fins - M0: load an STL, orbit it, see it sitting on the plate.
 *
 * COORDINATES: Z up, millimetres, bed plane at z = 0, plate centred on the
 * origin in XY. This is the printer's frame and the same one the Python
 * generators use (tools/support/breakaway.py) -- three.js defaults to Y up, so
 * that is overridden here rather than converting at every later step.
 */
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { buildTopology, analyze, DEFAULT_THRESHOLD } from './overhangs.js';
import { buildFins } from './fins.js';
import { findWallPatches } from './planes.js';
import { drawnWall } from './draw.js';
import { el } from './ui/dom.js';
import {
  renderer, scene, camera, controls, frame, raycaster, pointer, resize,
} from './ui/scene.js';
import {
  removeMode, removeActive, cancelRemove, clearFinHover,
  hoverRemove, clickRemove, resetRemovals,
} from './ui/remove.js';
import { histPush, undo, redo, resetHistory } from './ui/history.js';
import { importNote, loadURL } from './ui/io.js';
import { currentVolume, applyVolume } from './ui/volume.js';
import { buildExportGeometry } from './ui/export.js';
import { hideSuggestions, clearSuggestionMark } from './ui/suggest.js';
import { resetLoad, updateLayerView, updateLoadReadout, syncLoadUI } from './ui/strength.js';
import { updateReadout } from './ui/readout.js';
import {
  drawnWalls, setDrawnWalls, drawnTris, drawStart, selectedWall,
  setDrawMsg, markPrintTrisDirty, drawActive, sizeMarkers, clearPreview,
  selectWall, removeSelected, drawHover, drawClick,
} from './ui/walls.js';
import {
  finTris, padTris, lastBuilt, activeAdded, refreshFins, markFinsStale,
} from './ui/finbuild.js';
import { finsVisible, setDrawAugment, initSettings } from './ui/settings.js';

// ------------------------------------------------------------------- the part

const partMaterial = new THREE.MeshStandardMaterial({
  color: 0xffffff, roughness: 0.62, metalness: 0.05,
  vertexColors: true, side: THREE.DoubleSide,
});
export let part = null;
export let partName = '';
export let topology = null;      // welded adjacency, rebuilt only when the mesh changes
let weldMs = 0;
export let analysisTiming = '';
let lastSize = null;

// The user rotates. Always. Auto-orientation may suggest, never apply -- the
// spike's strength-optimal pose for one hub was 155mm tall balanced on a needle:
// geometrically valid, unprintable.
const gizmo = new TransformControls(camera, renderer.domElement);
gizmo.setMode('rotate');
gizmo.setSize(0.85);
scene.add(gizmo.getHelper ? gizmo.getHelper() : gizmo);
const dragFrom = new THREE.Quaternion();   // pose at drag start: did the drag turn it?
gizmo.addEventListener('dragging-changed', (e) => {
  controls.enabled = !e.value;
  if (e.value && part) dragFrom.copy(part.quaternion);
  if (!e.value) {
    el('rot-delta').textContent = '';
    if (part && !part.quaternion.equals(dragFrom)) clearSuggestionMark();
    // Drag released: reseat onto the plate now the pivot is allowed to move again
    // (shade() holds part.position steady WHILE dragging -- see the note there --
    // so this is the frame that actually drops the turned part back down).
    shade();
    // Fins are rebuilt when the drag ENDS, not during it. Placement runs the
    // exact confirmation passes -- containment, clearance, per-tine bite -- and
    // costs ~100ms on a 43k-face part, which is fine once and unusable at 60fps.
    // The overhang shading still updates live at 1-6ms, so the diagnosis the
    // user is steering by never stalls.
    if (finsVisible) refreshFins();
  }
});
gizmo.addEventListener('objectChange', () => {
  showDelta(gizmo.axis, gizmo.rotationAngle);
  requestShade();
});

// 5 degrees, not 15: a coarse snap is what makes a drag feel like it is
// juddering rather than turning. Shift releases it entirely for fine work.
const SNAP = THREE.MathUtils.degToRad(5);
gizmo.setRotationSnap(SNAP);
addEventListener('keydown', (e) => { if (e.key === 'Shift') gizmo.setRotationSnap(null); });
addEventListener('keyup', (e) => { if (e.key === 'Shift') gizmo.setRotationSnap(SNAP); });

/**
 * Coalesce re-analysis to one per frame. A high-polling-rate mouse fires
 * pointermove (and so objectChange) well above 60Hz, so an un-throttled drag
 * runs the classify pass several times per displayed frame and stutters.
 */
let shadeQueued = false;
function requestShade() {
  if (shadeQueued) return;
  shadeQueued = true;
  requestAnimationFrame(() => { shadeQueued = false; shade(); });
}

function showDelta(axis, radians) {
  if (!axis || !radians) return;
  const label = axis.length > 1 ? 'free' : axis;   // 'XYZE' / 'E' are screen-space
  const deg = THREE.MathUtils.radToDeg(radians);
  el('rot-delta').textContent =
    `${label} ${deg >= 0 ? '+' : ''}${deg.toFixed(deg % 1 ? 1 : 0)}°`;
}

const SHADE = {
  plain: new THREE.Color().setHex(0xb9c2d0, THREE.SRGBColorSpace),
  over: new THREE.Color().setHex(0xff5a4d, THREE.SRGBColorSpace),
  bed: new THREE.Color().setHex(0x3f7fd0, THREE.SRGBColorSpace),
};

/**
 * Drop `geometry` onto the plate: centred in XY, its lowest point resting on
 * z=0. Returns the measured size so the caller can report it.
 */
export function setPart(geometry, filename) {
  if (part) {
    part.geometry.dispose();
    scene.remove(part);
  }
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  // Centre the geometry on its own origin in ALL THREE axes, so the part rotates
  // about its middle and the gizmo sits there rather than at its feet. Seating on
  // the plate is not this transform's job -- analyze() returns the offset for that
  // after the rotation is known.
  geometry.translate(
    -(bb.min.x + bb.max.x) / 2,
    -(bb.min.y + bb.max.y) / 2,
    -(bb.min.z + bb.max.z) / 2);
  // Always recompute shading normals from the winding -- never trust the STL's
  // stored normals. A binary STL carries a per-face normal that STLLoader loads
  // into a `normal` attribute, and exporters routinely write those as zero or
  // garbage (the same reason buildTopology derives its own). A zero normal lights
  // as pure black, so trusting the stored one renders the whole part invisible.
  // Dropping the attribute first forces computeVertexNormals to rebuild it.
  geometry.deleteAttribute('normal');
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();

  part = new THREE.Mesh(geometry, partMaterial);
  part.add(hoverFace);
  hoverFace.visible = false;
  scene.add(part);

  const nFaces = geometry.getAttribute('position').count / 3;
  geometry.setAttribute(
    'color', new THREE.Float32BufferAttribute(new Float32Array(nFaces * 9), 3));

  const tWeld = performance.now();
  topology = buildTopology(geometry);
  weldMs = performance.now() - tWeld;
  computeFlatBaseline();

  partName = filename;
  part.quaternion.identity();
  gizmo.attach(part);
  el('orient').hidden = false;

  // A new part starts with no hand-drawn walls and a fresh print-space cache.
  setDrawnWalls([]);
  // Per-fin removals are keyed by a content signature that can coincidentally
  // match a different model's fins, so they must NOT carry across parts -- clear
  // them here alongside the walls, or loading a new STL silently drops fins.
  resetRemovals();
  // Nor does an armed remove mode: it hides the rotate rings and turns every click
  // on the new part into a fin pick, so the part looked stuck until Esc.
  if (removeMode) cancelRemove();
  setDrawAugment(false);
  setDrawMsg('');
  markPrintTrisDirty();
  clearPreview();
  // A new part starts with no load direction either.
  resetLoad();
  layPlacing = false;
  controls.enabled = true;
  syncLoadUI();
  setGizmo();

  // Undo history does not carry across parts.
  resetHistory();

  const size = shade();
  frame(size);
  return size;
}

/**
 * Re-run the overhang analysis in the part's CURRENT orientation, re-seat it on
 * the plate, and paint the result. Cheap enough to call on every frame of a
 * gizmo drag -- the expensive weld already happened in setPart(), and rotation
 * cannot invalidate it.
 */
export const rotM3 = new THREE.Matrix3();
const rotM4 = new THREE.Matrix4();

// Overhangs in the AS-LOADED (identity) orientation. For an exported STL that is
// almost always the flat print pose, so it answers the question the leaf raised:
// does this part even need the tool? A part that prints flat with no overhangs
// gets none here, and every overhang the user then sees is one they created by
// rotating. Depends only on topology + threshold, never on rotation, so it is
// cached -- recomputed on load and on a threshold change, not per drag frame.
const IDENTITY3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
let flatRegions = null;
function computeFlatBaseline() {
  flatRegions = topology ? analyze(topology, threshold, IDENTITY3).regions.length : null;
}

export function shade() {
  if (!part || !topology) return new THREE.Vector3();
  rotM3.setFromMatrix4(rotM4.makeRotationFromQuaternion(part.quaternion));

  const t0 = performance.now();
  const res = analyze(topology, threshold, rotM3.elements);
  const ms = performance.now() - t0;

  // Drop the rotated part back onto the plate, centred over it -- but NOT mid-drag.
  // The rotate gizmo turns the part about part.position, so re-seating it every
  // frame slides the pivot out from under the pointer and the ring reads as jumpy /
  // jittery. While a drag is live we hold the pre-drag seat and let the part swing
  // about that fixed point; the drag-end handler re-seats once, on release. The
  // face SHADING below still updates live either way, so the diagnosis never stalls.
  if (!gizmo.dragging) part.position.set(res.offset.x, res.offset.y, res.offset.z);

  const size = new THREE.Vector3(res.size.x, res.size.y, res.size.z);
  report(partName, size);

  const colors = part.geometry.getAttribute('color');
  const arr = colors.array;
  for (let f = 0; f < topology.nFaces; f++) {
    const c = res.kept[f] ? SHADE.over : res.onBed[f] ? SHADE.bed : SHADE.plain;
    for (let i = 0; i < 3; i++) {
      const o = f * 9 + i * 3;
      arr[o] = c.r; arr[o + 1] = c.g; arr[o + 2] = c.b;
    }
  }
  colors.needsUpdate = true;

  const dropped = res.rawRegionCount - res.regions.length;
  el('s-over').textContent = res.regions.length === 0
    ? 'none'
    : `${res.regions.length} region${res.regions.length === 1 ? '' : 's'}` +
      (dropped ? ` (+${dropped} sliver${dropped === 1 ? '' : 's'})` : '');
  el('s-over').classList.toggle('good', res.regions.length === 0);

  // Overhang warning (bottom-right card). The tool builds support for the big
  // overhang REGIONS but drops the small ones -- hole ceilings, slot roofs, bore
  // tops -- as slivers. Those are exactly what prints rough by surprise, so name
  // them out loud instead of leaving the maker to find out at the printer. Only
  // fires when this pose actually has overhangs to support (a clean/flat pose says
  // its piece via s-flat-note); the fix is almost always a better orientation.
  const warn = el('over-warn');
  if (res.regions.length > 0 && dropped > 0) {
    warn.textContent = `⚠ ${dropped} small overhang${dropped === 1 ? '' : 's'} `
      + `(hole ceilings, slots, bore tops) print unsupported this way up and may come `
      + `out rough. Try Suggest orientation to point them up.`;
  } else {
    warn.textContent = '';
  }
  el('s-overarea').textContent = `${res.overArea.toFixed(0)} mm²`;
  el('s-bed').textContent = `${res.bedArea.toFixed(0)} mm²`;
  el('s-bed').classList.toggle('warn', res.bedArea < 1);

  // "Do you even need me?" -- fire the honest signal before the user turns fins
  // on. Current pose clean wins outright; otherwise, if the part printed flat as
  // loaded, the overhangs on screen are self-inflicted by rotating.
  const flat = el('s-flat-note');
  if (res.regions.length === 0) {
    flat.textContent = 'No supports needed this way up.';
    flat.className = 'note good';
  } else if (flatRegions === 0) {
    flat.textContent = 'This prints clean lying flat. You only need fins if you’re '
      + 'tilting it for strength.';
    flat.className = 'note';
  } else {
    flat.textContent = '';
  }
  // Kept as a value rather than read back off the element: the fin readout
  // appends to this line, and the mode / bed-pad / toggle handlers call
  // refreshFins() WITHOUT going through shade(), so appending in place stacked
  // up "· fins 3 ms · fins 3 ms · fins 3 ms" with every toggle.
  analysisTiming = `${ms.toFixed(0)} ms · weld ${weldMs.toFixed(0)} ms`;
  el('s-time').textContent = analysisTiming;

  lastResult = res;
  markPrintTrisDirty();       // orientation moved: the cached print-space part is stale
  if (finsVisible && !gizmo.dragging) refreshFins();
  else if (finsVisible) markFinsStale();

  // where the part currently sits, the way a slicer states it
  const [ex, ey, ez] = readableEuler(part.quaternion);
  el('rot-now').textContent = `X ${ex}° · Y ${ey}° · Z ${ez}°`;
  // both strength views are pose-dependent, so refresh them whenever the part turns:
  // the automatic layer view (always), and the optional load-arrow verdict (if set)
  updateLayerView(size);
  updateLoadReadout();
  syncLoadUI();            // re-light the pad button for the load's new world direction
  return size;
}

const wrap180 = (deg) => {
  const v = ((deg + 180) % 360 + 360) % 360 - 180;
  if (Object.is(v, -0)) return 0;
  return v === -180 ? 180 : v;      // half a turn reads better as +180
};

/**
 * Euler angles for display, in whichever of the two equivalent solutions reads
 * better. Every orientation has two XYZ triples, and the one three.js hands back
 * is often the ugly one: turning a part 90 degrees about Y twice reports
 * "X -180, Y 0, Z -180" rather than "Y 180". Same rotation, but a user reading it
 * cannot tell what they did.
 *
 * The alternate solution is verified against the original quaternion rather than
 * trusted, so a convention change in three.js degrades to the plain answer
 * instead of silently displaying a wrong one.
 */
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();

function readableEuler(q) {
  _e.setFromQuaternion(q, 'XYZ');
  const a = [_e.x, _e.y, _e.z].map((r) => wrap180(THREE.MathUtils.radToDeg(r)));
  const b = [wrap180(a[0] + 180), wrap180(180 - a[1]), wrap180(a[2] + 180)];

  const cost = (v) => Math.abs(v[0]) + Math.abs(v[1]) + Math.abs(v[2]);
  if (cost(b) < cost(a)) {
    _e.set(...b.map(THREE.MathUtils.degToRad), 'XYZ');
    _q.setFromEuler(_e);
    if (Math.abs(Math.abs(_q.dot(q)) - 1) < 1e-6) return b.map(Math.round);
  }
  return a.map(Math.round);
}

// -------------------------------------------------------------------- reports

function report(filename, size) {
  el('s-name').textContent = filename;
  el('s-tris').textContent = (topology?.nFaces ?? 0).toLocaleString();
  el('s-bbox').textContent =
    `${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)} mm`;

  lastSize = size;
  updateFit();

  // Empty string hides it: `.note:empty { display: none }`, same as the sibling notes.
  el('s-import-note').textContent = importNote;

  el('stats').hidden = false;
  el('status').hidden = false;
  el('drop').classList.add('hidden');
}

/**
 * Does it fit the build volume -- including everything the tool ADDS?
 *
 * Checking the part alone understates it. The pad spreads `padMargin` past the
 * part's contact and the fin's base another `basePad` past the wall, so a part
 * that fits on its own can still put its bed pad over the edge of the plate. The
 * export bakes those in, so the answer has to account for them.
 */
export function updateFit() {
  if (!lastSize) return;
  const v = currentVolume();
  let dx = lastSize.x, dy = lastSize.y, dz = lastSize.z;

  const added = activeAdded();
  if (added.length) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const t of added) {
      if (t[0] < x0) x0 = t[0]; if (t[0] > x1) x1 = t[0];
      if (t[1] < y0) y0 = t[1]; if (t[1] > y1) y1 = t[1];
      if (t[2] > z1) z1 = t[2];
    }
    // the part is centred on the plate, so what matters is the half-extent each
    // way, not the raw span of the fins alone
    dx = Math.max(dx, 2 * Math.max(Math.abs(x0), Math.abs(x1)));
    dy = Math.max(dy, 2 * Math.max(Math.abs(y0), Math.abs(y1)));
    dz = Math.max(dz, z1);
  }

  const over = dx > v.x || dy > v.y || dz > v.z;
  const fit = el('s-fit');
  fit.textContent = over
    ? (added.length ? 'does not fit (with fins)' : 'does not fit')
    : 'fits';
  fit.classList.toggle('warn', over);
}

// ------------------------------------------------------------------- printers

// ----------------------------------------------------------------------- fins

export let lastResult = null;
export let layPlacing = false;     // true while "lay a face flat" is armed -- gated behind a
                            // button so a stray viewport click can't re-lay the part
export function setLayPlacing(v) { layPlacing = v; }   // undo/redo disarms it directly

/** "Lay a face flat" is armed: a face click lays the part on that face. Off by
 *  default so casual clicks orbit instead of silently re-laying the part. */
const layActive = () => layPlacing;

/** Enable the rotate gizmo only when NOT drawing or laying a face flat --
 *  its handles would otherwise swallow the clicks those modes need. */
export function setGizmo() {
  const on = !!part && !drawActive() && !layActive() && !removeActive();
  gizmo.enabled = on;
  const helper = gizmo.getHelper ? gizmo.getHelper() : gizmo;
  helper.visible = on;
}

// ---- Lay a face flat (armed behind a button so stray clicks can't re-lay) -------

/** Arm face-lay: the next face click lays the part on that face. Modal so a click
 *  isn't swallowed by the rotate gizmo; hovering highlights the face. */
function beginLay() {
  if (!part || !topology) return;
  layPlacing = true;
  clearPreview();
  setGizmo();          // hides the rotate rings so they don't eat the pick
  syncLayUI();
}

/** Disarm face-lay (Esc / right-click / re-toggle / after a lay). */
function cancelLay() {
  layPlacing = false;
  hoverFace.visible = false;
  renderer.domElement.style.cursor = '';
  setGizmo();
  syncLayUI();
}

function syncLayUI() {
  el('lay-face').textContent = layPlacing ? 'Click a face to lay it flat — Esc cancels'
    : 'Lay a face flat';
  el('lay-face').classList.toggle('active', layPlacing);
}

// Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z (or Ctrl+Y) redoes. Ignored while typing
// in a field so it never eats a text-edit undo.
addEventListener('keydown', (e) => {
  if (!part) return;
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (selectedWall && (e.key === 'Delete' || e.key === 'Backspace')) {
    e.preventDefault();
    removeSelected();
    return;
  }
  if (!(e.metaKey || e.ctrlKey)) return;
  const k = e.key.toLowerCase();
  if (k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (k === 'y') { e.preventDefault(); redo(); }
});

// ---------------------------------------------------------------- orientation

/** Rotate 90 degrees about a world axis, keeping the part seated. */
function rotate90(name, axis) {
  if (!part) return;
  histPush();
  const q = new THREE.Quaternion().setFromAxisAngle(axis, Math.PI / 2);
  part.quaternion.premultiply(q);   // premultiply = about the WORLD axis
  showDelta(name.toUpperCase(), Math.PI / 2);
  clearSuggestionMark();
  shade();
}

/**
 * Click a face to lay it flat on the plate. This is the fastest way to reach a
 * sane orientation -- far quicker than hunting for it on the rings -- and it is
 * how you actually think about the problem: "put THAT face down".
 */
const DOWN = new THREE.Vector3(0, 0, -1);
const layQuat = new THREE.Quaternion();
const faceNormal = new THREE.Vector3();
let pressAt = null;

/**
 * The hovered face, drawn as a single highlighted triangle. Without this,
 * click-to-lay is invisible: nothing on screen suggests the part is clickable,
 * so a first-time user never discovers the fastest control in the app.
 * Parented to the part so it inherits the orientation for free.
 */
const hoverGeom = new THREE.BufferGeometry();
hoverGeom.setAttribute(
  'position', new THREE.BufferAttribute(new Float32Array(9), 3));
const hoverFace = new THREE.Mesh(hoverGeom, new THREE.MeshBasicMaterial({
  color: 0x4da3ff, transparent: true, opacity: 0.6, side: THREE.DoubleSide,
  depthTest: true, polygonOffset: true,
  polygonOffsetFactor: -4, polygonOffsetUnits: -4,
}));
hoverFace.visible = false;
hoverFace.renderOrder = 1;

/** Ray the pointer into the part; returns the intersection or null. */
export function pickFace(ev) {
  if (!part || !topology) return null;
  const r = renderer.domElement.getBoundingClientRect();
  pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1,
              -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(part, false)[0];
  return hit && hit.faceIndex != null ? hit : null;
}

renderer.domElement.addEventListener('pointermove', (ev) => {
  // Remove-fins mode: hover lights the fin a click would drop, in red.
  if (removeActive()) {
    hoverFace.visible = false;
    hoverRemove(ev);
    return;
  }
  // Draw / Suggest "+ Add": the pointer places wall endpoints ON the overhang, so
  // face-lay hover is off and the cursor / band / ghost track the surface instead.
  // Draw picks ANY surface point the user aims at -- including the red overhang
  // faces themselves -- because a drawn breakaway wall sweeps under the line you
  // draw, wherever you draw it; there is no "grippable face" gate to fight.
  if (drawActive()) {
    hoverFace.visible = false;
    drawHover(ev);
    return;
  }
  // Face-lay hover ONLY while armed: otherwise a highlighted, clickable-looking
  // face invites the stray click that silently re-lays the part. Off by default,
  // clicks just orbit.
  if (!layActive() || !part || gizmo.dragging || gizmo.axis || pressAt) {
    hoverFace.visible = false;
    return;
  }
  const hit = pickFace(ev);
  hoverFace.visible = !!hit;
  hoverFace.material.color.setHex(0x4da3ff);   // reset from Draw's green/grey tint
  renderer.domElement.style.cursor = hit ? 'pointer' : '';
  if (!hit) return;

  const pos = hoverGeom.getAttribute('position');
  const src = part.geometry.getAttribute('position').array;
  const o = hit.faceIndex * 9;
  for (let i = 0; i < 9; i++) pos.array[i] = src[o + i];
  pos.needsUpdate = true;
  hoverGeom.computeBoundingSphere();
});

renderer.domElement.addEventListener('pointerleave', () => {
  hoverFace.visible = false;
  clearFinHover();
});

renderer.domElement.addEventListener('pointerdown', (e) => {
  pressAt = { x: e.clientX, y: e.clientY };
});

renderer.domElement.addEventListener('pointerup', (e) => {
  const from = pressAt;
  pressAt = null;
  if (!from || !part || !topology) return;

  // a drag is an orbit, not a pick
  if (Math.hypot(e.clientX - from.x, e.clientY - from.y) > 4) return;

  // Remove-fins mode: one click drops just the fin under the pointer.
  if (removeActive()) {
    clickRemove(e);
    return;
  }

  // Draw / Suggest "+ Add": first click sets the start of a wall on the overhang,
  // second commits it. A breakaway wall sweeps under the line between the two
  // points, so the user draws it straight onto the red overhang -- no face gate.
  if (drawActive()) {
    drawClick(e);
    return;
  }

  if (gizmo.dragging || gizmo.axis) return;

  // Lay a face flat -- ONLY when armed via the button. Off by default so a stray
  // viewport click orbits instead of silently discarding a careful rotation.
  if (!layActive()) return;
  const hit = pickFace(e);
  if (!hit) return;

  // Snapshot before laying so Ctrl-Z brings the old pose back.
  histPush();
  // Use OUR winding-derived normal, not the STL's stored one, for the same
  // reason the analysis does: exported normals are not trustworthy.
  const i = hit.faceIndex * 3;
  faceNormal.set(topology.nrm[i], topology.nrm[i + 1], topology.nrm[i + 2])
            .applyQuaternion(part.quaternion);
  layQuat.setFromUnitVectors(faceNormal, DOWN);
  part.quaternion.premultiply(layQuat);
  clearSuggestionMark();
  cancelLay();            // one-shot: disarm after a lay so the next click is safe
  shade();
});

// Cancel an armed mode / wall-in-progress: Escape, or a right-click in the viewport.
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (removeActive()) { cancelRemove(); return; }
  if (layActive()) { cancelLay(); return; }
  if (drawActive() && drawStart) {
    clearPreview();
    updateReadout(lastBuilt);
  } else if (selectedWall) {
    selectWall(selectedWall);        // toggles it off
  }
});
renderer.domElement.addEventListener('contextmenu', (e) => {
  if (removeActive()) { e.preventDefault(); cancelRemove(); return; }
  if (layActive()) { e.preventDefault(); cancelLay(); return; }
  if (!drawActive()) return;
  e.preventDefault();
  if (drawStart) { clearPreview(); updateReadout(lastBuilt); }
});

const AXES = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0),
               z: new THREE.Vector3(0, 0, 1) };
for (const a of ['x', 'y', 'z']) {
  el(`rot-${a}`).addEventListener('click', () => rotate90(a, AXES[a]));
}
el('rot-reset').addEventListener('click', () => {
  if (!part) return;
  histPush();
  part.quaternion.identity();
  el('rot-delta').textContent = '';
  hideSuggestions();   // a manual turn invalidates the ranking's "active" mark
  shade();
});

// Lay a face flat -- armed behind a button so a stray click can't re-lay the part.
el('lay-face').addEventListener('click', () => {
  if (layPlacing) cancelLay();
  else beginLay();
});

export let threshold = DEFAULT_THRESHOLD;
const thrInput = el('thr');
thrInput.value = String(threshold);
thrInput.addEventListener('input', () => {
  threshold = Number(thrInput.value);
  el('thr-val').textContent = `${threshold}°`;
  computeFlatBaseline();   // the flat baseline moves with the overhang threshold
  shade();
});

// ----------------------------------------------------------------- main loop

const fpsEl = el('fps');
let frames = 0, last = performance.now();

function tick(now) {
  requestAnimationFrame(tick);
  controls.update();
  sizeMarkers();
  renderer.render(scene, camera);
  if (++frames >= 20) {
    fpsEl.textContent = `${Math.round((frames * 1000) / (now - last))} fps`;
    frames = 0;
    last = now;
  }
}

initSettings();
applyVolume();
resize();
frame(new THREE.Vector3(60, 60, 60));
requestAnimationFrame(tick);

// debug surface, used to cross-check against the Python probes
window.__sf = { get part() { return part; }, camera, get topo() { return topology; },
                analyze, get threshold() { return threshold; },
                get rot() { return rotM3.elements; },
                get result() { return lastResult; },
                get finTris() { return finTris; },
                get padTris() { return padTris; },
                get drawnTris() { return drawnTris; },
                get drawnWalls() { return drawnWalls; },
                buildFins, findWallPatches, drawnWall, buildExportGeometry };

const wanted = new URLSearchParams(location.search).get('stl');
if (wanted) loadURL(wanted).catch((err) => console.error('?stl=', err));
