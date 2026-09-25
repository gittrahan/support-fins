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
import { suggestOrientations, layerVerdict } from './orient.js';
import { buildFins, FIN, PAD } from './fins.js';
import { PROP } from './prop.js';
import { CUT } from './cutout.js';
import { findWallPatches } from './planes.js';
import { drawnWall } from './draw.js';
import { swayAtFace, faceIsUpright } from './sway.js';
import { el } from './ui/dom.js';
import {
  viewport, renderer, scene, camera, controls, frame, meshFrom, raycaster, pointer, resize,
} from './ui/scene.js';
import {
  removeMode, removedIds, removeActive, syncRemoveUI, cancelRemove, clearFinHover,
  hoverRemove, clickRemove, adoptFins, forgetFins, resetRemovals,
} from './ui/remove.js';
import { histPush, undo, redo, resetHistory } from './ui/history.js';
import { importNote, loadURL } from './ui/io.js';
import { currentVolume, applyVolume } from './ui/volume.js';
import { buildExportGeometry } from './ui/export.js';
import { resetLoad, updateLayerView, updateLoadReadout, syncLoadUI } from './ui/strength.js';

// ------------------------------------------------------------------- the part

const partMaterial = new THREE.MeshStandardMaterial({
  color: 0xffffff, roughness: 0.62, metalness: 0.05,
  vertexColors: true, side: THREE.DoubleSide,
});
export let part = null;
export let partName = '';
export let topology = null;      // welded adjacency, rebuilt only when the mesh changes
let weldMs = 0;
let analysisTiming = '';
let lastSize = null;

// The user rotates. Always. Auto-orientation may suggest, never apply -- the
// spike's strength-optimal pose for one hub was 155mm tall balanced on a needle:
// geometrically valid, unprintable.
const gizmo = new TransformControls(camera, renderer.domElement);
gizmo.setMode('rotate');
gizmo.setSize(0.85);
scene.add(gizmo.getHelper ? gizmo.getHelper() : gizmo);
gizmo.addEventListener('dragging-changed', (e) => {
  controls.enabled = !e.value;
  if (!e.value) {
    el('rot-delta').textContent = '';
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
  drawnWalls = [];
  // Per-fin removals are keyed by a content signature that can coincidentally
  // match a different model's fins, so they must NOT carry across parts -- clear
  // them here alongside the walls, or loading a new STL silently drops fins.
  resetRemovals();
  // Nor does an armed remove mode: it hides the rotate rings and turns every click
  // on the new part into a fin pick, so the part looked stuck until Esc.
  if (removeMode) cancelRemove();
  drawAugment = false;
  drawMsg = '';
  printTrisDirty = true;
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
  printTrisDirty = true;      // orientation moved: the cached print-space part is stale
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
export let finsVisible = false;
export function setFinsVisible(v) { finsVisible = v; }
// The wall is the default support and the fin is the Brace OPTION, not the
// other way around -- flipped at M5c. Measured over the dev matrix, the fin
// covers 4% of overhang area (it braces against toppling; it holds nothing up)
// and 7 of its 12 placements lean 25-40deg. The wall covers 61%, always
// vertical. A user who loads a part and exports should get the support that
// supports.
//
// DEFAULT IS 'auto': click "Add fins" and the tool places the supports for you
// (tined combined fins on the grippable overhangs, plain props on the rest). Draw
// is the by-hand path. ('prop' still exists internally -- Draw calls it for the
// bed pad + seating verdict, and it is the geometry Auto props with.)
export let finMode = 'auto';
export function setFinMode(v) { finMode = v; }
// Suggest + Draw mix: when true, the pointer places hand-drawn walls ON TOP of the
// auto-placed ones (for when auto misses a spot). It only gates the pointer; the
// drawn walls themselves stay shown/exported after placing until Clear all.
export let drawAugment = false;
export function setDrawAugment(v) { drawAugment = v; }
/**
 * Why did this part get no fins, in terms the user can act on?
 *
 * "No flat vertical face" is technically true and useless: it does not say
 * whether to rotate the part, accept it, or wait for draw mode. Each stage of
 * the search discards candidates for a different reason, so name the stage that
 * actually emptied out.
 */
function explainNoFins(b) {
  // A part balanced on a point cannot be rescued by ANY support UNLESS the
  // bed pad is on to seat it (the shelter hubs print exactly that way), so
  // saying "no flat face" or "part in the way" sends the user to tune
  // something that was never the problem. This outranks every mode-specific
  // reason below.
  if (b.seating?.kind === 'point' && !b.pad) {
    return 'this part touches the plate at a single point, so it has nothing to '
         + 'stand on. Turn the bed pad on to seat it, or rotate until it sits '
         + 'down on a face or an edge';
  }
  if (b.mode === 'prop') {
    const s = b.skipped ?? {};
    if (!b.rejected.sites) return 'no overhangs to prop in this orientation';
    // Named in the order that tells the user the most. Each is a different
    // stage of the search, and lumping them into "blocked" is what let M5 be
    // recorded as working on a part where it built nothing.
    if (s.wanders) {
      const one = s.wanders === 1;
      return `${s.wanders} overhang${one ? ' is' : 's are'} bowl-shaped rather than `
           + `a ledge — ${one ? 'its' : 'their'} lowest points form a ring, not a `
           + 'line, so there is nothing for a wall to follow. Rotate, or switch '
           + 'to Draw and place one by hand';
    }
    if (s.buried || s.weld) {
      return 'every wall that reaches these overhangs would fuse to the '
           + 'part — rotate, or switch to Draw and place one by hand';
    }
    if (s.blocked) {
      return 'no run of these overhangs is long enough to stand a wall under — '
           + 'the part is in the way, or they sit too close to the plate';
    }
    if (s.stub || s.noLine || s.sliver) {
      return 'the overhangs here are too small or too low to be worth a wall';
    }
    if (s.degenerate) {
      return 'the contact lines here collapse to a point — nothing to sweep along';
    }
    return 'no overhang here can take a prop in this orientation';
  }
  const st = b.patchStats ?? {};
  if (!b.patchCount) {
    // a cylinder or a mesh of small facets has no flat face wide enough
    return (st.tooNarrow ?? 0) > (st.notFlat ?? 0)
      ? 'nothing flat and wide enough to stand a fin against — curved or '
        + 'finely faceted surfaces have no flat face to grip'
      : 'no flat upright face on this part in this orientation';
  }
  if (!b.rejected.sites) {
    return st.tooHigh
      ? `${st.tooHigh} flat face${st.tooHigh === 1 ? '' : 's'} found, but every `
        + 'one starts too far up the part — a fin would be mostly bare stilt. '
        + 'Rotate so a flat face runs down to the plate'
      : 'no usable face in this orientation — try rotating';
  }
  if (b.rejected.blocked) {
    return 'the part is in the way of every wall position on the faces it found '
         + '— rotate, or switch to Draw and place one by hand';
  }
  return 'the workable spots would put the fin inside the part — try rotating';
}

export let finMesh = null;
let padMesh = null;
let finTris = [];
let padTris = [];

/** Show `tris` as the auto fin mesh, replacing the one on screen (used by per-fin
 *  removal, which re-filters the last build without a worker round-trip). */
export function setFinTris(tris) {
  if (finMesh) { scene.remove(finMesh); finMesh.geometry.dispose(); }
  finTris = tris;
  finMesh = meshFrom(finTris, finMaterial);
}

const finMaterial = new THREE.MeshStandardMaterial({
  color: 0x59d98e, roughness: 0.7, metalness: 0.0, side: THREE.DoubleSide,
});
// The pad is not a fin -- it is a modification to how the part meets the plate,
// and the user has to be able to see at a glance which is which before they
// commit to an export.
const padMaterial = new THREE.MeshStandardMaterial({
  color: 0xe8b64c, roughness: 0.8, metalness: 0.0, side: THREE.DoubleSide,
});

// ---- draw mode: the user places breakaway walls by hand --------------------
// A drawn wall IS the same kind of support the auto-placer emits, so it shares
// the fin material and the green legend swatch. What is different is who chose
// the line: a person, not a PCA fit -- which is the whole reason it comes out
// straight. Endpoints are stored in the part's LOCAL frame so a wall tracks the
// part through later rotations, the same way the auto fins are rebuilt each time
// the orientation changes.
export let drawnWalls = [];        // committed walls: { a: Vector3(local), b: Vector3(local), ok, info }
export function setDrawnWalls(w) { drawnWalls = w; }
let drawnMesh = null;
let drawnTris = [];
let drawStart = null;       // Vector3 (local) -- first click of a wall in progress
let drawMsg = '';           // last placement result, for the readout
export let lastBuilt = null;       // last buildFins result, kept for the bed pad + seating readout
let printTris = null;       // whole part in print space, cached per orientation
let printTrisDirty = true;

const drawMaterial = new THREE.MeshStandardMaterial({
  color: 0x59d98e, roughness: 0.7, metalness: 0.0, side: THREE.DoubleSide,
});
// A live, translucent preview of the wall the current drag would make.
const ghostMaterial = new THREE.MeshStandardMaterial({
  color: 0x8ff0bd, roughness: 0.7, transparent: true, opacity: 0.45,
  side: THREE.DoubleSide,
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
const drawCursor = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14),
  new THREE.MeshBasicMaterial({ color: 0xcffbe4, depthTest: false, transparent: true, opacity: 0.6 }));
const bandGeom = new THREE.BufferGeometry()
  .setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
const drawBand = new THREE.Line(bandGeom,
  new THREE.LineBasicMaterial({ color: 0x6dffab, depthTest: false, transparent: true }));
drawBand.frustumCulled = false;   // its endpoints move every frame; stale bounds would cull it
for (const o of [drawDot, drawCursor, drawBand]) {
  o.visible = false;
  o.renderOrder = 11;             // above the hoverFace (renderOrder 1) and the part
  scene.add(o);
}

export let layPlacing = false;     // true while "lay a face flat" is armed -- gated behind a
                            // button so a stray viewport click can't re-lay the part
export function setLayPlacing(v) { layPlacing = v; }   // undo/redo disarms it directly

/** "Lay a face flat" is armed: a face click lays the part on that face. Off by
 *  default so casual clicks orbit instead of silently re-laying the part. */
const layActive = () => layPlacing;

// Pointer is in wall-placement mode (draw mode, or Suggest with the add toggle on).
// Gates the draw interaction, the gizmo, and face-lay.
const drawActive = () => finsVisible && (finMode === 'draw' || drawAugment);
// Hand-drawn walls contribute to the display and the export. In Draw mode that's
// always; in Suggest it's whenever the user has drawn any (they persist after the
// add toggle is switched off, so you can orbit and export without losing them).
const drawShown = () =>
  finsVisible && (finMode === 'draw' || (finMode === 'auto' && (drawAugment || drawnWalls.length > 0)));

// Marker radii in CSS pixels, whatever the zoom.
const DOT_PX = 5, CURSOR_PX = 4;
/** Scale the draw markers so they keep a fixed on-screen size at any zoom. */
function sizeMarkers() {
  // World mm per CSS pixel at a point's depth, for the perspective camera.
  const mmPerPx = (p) => 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
    * camera.position.distanceTo(p) / Math.max(1, viewport.clientHeight);
  if (drawDot.visible) drawDot.scale.setScalar(DOT_PX * mmPerPx(drawDot.position));
  if (drawCursor.visible) drawCursor.scale.setScalar(CURSOR_PX * mmPerPx(drawCursor.position));
}

/** The whole part in PRINT space (rotated + seated), rebuilt only when the
 *  orientation changes. This is the surface a drawn wall's contact line samples,
 *  the same transform export bakes in. */
function partPrintTriangles() {
  if (printTris && !printTrisDirty) return printTris;
  const { pos, nFaces } = topology;
  const rot = rotM3.elements;
  const { x: dx, y: dy, z: dz } = lastResult.offset;
  const a = new Float64Array(nFaces * 9);
  for (let i = 0; i < a.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    a[i]     = rot[0] * x + rot[3] * y + rot[6] * z + dx;
    a[i + 1] = rot[1] * x + rot[4] * y + rot[7] * z + dy;
    a[i + 2] = rot[2] * x + rot[5] * y + rot[8] * z + dz;
  }
  printTris = a;
  printTrisDirty = false;
  return a;
}

/** Drop any wall-in-progress and hide every transient draw visual. */
export function clearPreview() {
  drawStart = null;
  drawDot.visible = drawCursor.visible = drawBand.visible = false;
  if (ghostMesh) { scene.remove(ghostMesh); ghostMesh.geometry.dispose(); ghostMesh = null; }
}

/** Rebuild the committed drawn walls for the current orientation. */
function rebuildDrawn() {
  if (drawnMesh) { scene.remove(drawnMesh); drawnMesh.geometry.dispose(); drawnMesh = null; }
  drawnTris = [];
  if (!drawShown() || !topology || !lastResult) { syncSelection(); return; }
  part.updateMatrixWorld();

  // Both Draw and the Suggest "+ Add" augment place the SAME thing now: hand-drawn
  // under-overhang breakaway walls. Each wall is stored as two local endpoints and
  // re-swept against the part's current pose, so a wall that no longer reaches the
  // part (rotated away) is flagged by drawnWall rather than dropped silently.
  const tris = partPrintTriangles();
  // Drawn walls grip with the same tine comb the auto fins use when Tines is on.
  const drawOpts = { tines: el('tines').checked,
                     tineDensity: el('tine-density').valueAsNumber / 100,
                     layerHeight: el('layer-height').valueAsNumber,
                     topo: topology, rot: rotM3.elements, offset: lastResult.offset };
  const wa = new THREE.Vector3(), wb = new THREE.Vector3();
  // Everything a hand-placed brace has to keep clear of: Auto's braces and walls
  // (when Auto's supports are on screen), then each hand-placed brace as it is
  // re-stood, so a rotation that brings two together is reported rather than fused.
  const auto = autoSupports();
  const braces = [...auto.braces];
  for (const w of drawnWalls) {
    // Each support remembers which triangles of the merged mesh are its own, so a
    // click on the mesh can be traced back to the support to select / remove.
    w.triStart = drawnTris.length / 3;
    if (w.kind === 'sway') {
      // A hand-placed sway brace: re-stood on the same face at the same spot, so
      // it follows the part when it turns (and says why if that face no longer
      // stands upright, or now runs into an earlier brace).
      part.localToWorld(wa.copy(w.a));
      const r = swayAtFace(topology, lastResult, rotM3.elements, w.face,
                           [wa.x, wa.y, wa.z], swayOpts(), { braces, walls: auto.walls });
      w.ok = r.ok;
      w.info = r;
      if (r.ok) { braces.push(r); for (const t of r.tris) drawnTris.push(t); }
      w.triEnd = drawnTris.length / 3;
      continue;
    }
    part.localToWorld(wa.copy(w.a));
    part.localToWorld(wb.copy(w.b));
    const r = drawnWall([wa.x, wa.y, wa.z], [wb.x, wb.y, wb.z], tris, 0, drawOpts);
    w.ok = r.ok;
    w.info = r;
    if (r.ok) for (const t of r.tris) drawnTris.push(t);
    w.triEnd = drawnTris.length / 3;
  }
  drawnMesh = meshFrom(drawnTris, drawMaterial);
  syncSelection();
}

// ---- selecting a hand-placed support, to remove it -------------------------
// A click on a drawn wall or sway brace selects it (drawn in amber); Delete /
// Backspace or the "Remove selected" button takes it out, and Undo brings it back.
// Held as the wall OBJECT, not an index, so an undo/clear that replaces the list
// simply drops a selection that no longer exists.
let selectedWall = null;
let selMesh = null;
const selMaterial = new THREE.MeshStandardMaterial({
  color: 0xffb347, roughness: 0.6, metalness: 0.0, side: THREE.DoubleSide,
  polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
});

/** Re-draw the highlight for the current selection, or clear a stale one. */
function syncSelection() {
  if (selMesh) { scene.remove(selMesh); selMesh.geometry.dispose(); selMesh = null; }
  if (selectedWall && (!drawShown() || !drawnWalls.includes(selectedWall) || !selectedWall.ok)) {
    selectedWall = null;
  }
  if (selectedWall) {
    selMesh = meshFrom(drawnTris.slice(selectedWall.triStart * 3, selectedWall.triEnd * 3), selMaterial);
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
  const hit = raycaster.intersectObject(drawnMesh, false)[0];
  if (!hit || hit.faceIndex == null) return null;
  const onPart = part ? raycaster.intersectObject(part, false)[0] : null;
  if (onPart && onPart.distance < hit.distance) return null;   // the part is in front
  return drawnWalls.find((w) => w.ok && hit.faceIndex >= w.triStart && hit.faceIndex < w.triEnd) ?? null;
}

/** One readout line naming what is selected and how to remove it. */
function selectedNote() {
  const i = selectedWall.info ?? {};
  const what = selectedWall.kind === 'sway'
    ? `sway brace ${Math.round(i.height ?? 0)}mm tall`
    : `wall ${Math.round(i.length ?? 0)}mm long`;
  return `selected: ${what}${i.tines ? `, ${i.tines} tines` : ''}. Press Delete or `
    + 'Remove selected to take it out (Esc to keep it)';
}

function selectWall(w) {
  selectedWall = selectedWall === w ? null : w;   // a second click deselects
  drawMsg = '';
  syncSelection();
  updateReadout(lastBuilt);
}

function removeSelected() {
  if (!selectedWall) return;
  histPush();
  drawnWalls = drawnWalls.filter((w) => w !== selectedWall);
  selectedWall = null;
  drawMsg = '';
  rebuildDrawn();
  updateReadout(lastBuilt);
  updateFit();
}

/** The walls + pad the CURRENT mode contributes to the export and the fit check. */
export function activeAdded() {
  // Both auto modes bake their geometry into finTris (refreshFins' else branch):
  // Suggest → gripping fins + fallback props, Combined fin → gripping fins only.
  // Only Draw leaves it empty and exports the hand-drawn walls instead.
  const auto = finMode === 'draw' ? [] : finTris;
  const drawn = drawShown() ? drawnTris : [];
  return [...auto, ...drawn, ...padTris];
}

/** Show the endpoint / cursor / band, and a live ghost of the wall in progress. */
let ghostQueued = null;
function updatePreview(hitPoint) {
  drawCursor.position.copy(hitPoint);
  drawCursor.visible = true;
  if (!drawStart) { drawBand.visible = false; return; }
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
  requestAnimationFrame(() => {
    const q = ghostQueued;
    ghostQueued = null;
    if (!q || !drawStart || !drawActive()) return;
    if (ghostMesh) { scene.remove(ghostMesh); ghostMesh.geometry.dispose(); ghostMesh = null; }
    const tris = partPrintTriangles();
    const r = drawnWall([q[0].x, q[0].y, q[0].z], [q[1].x, q[1].y, q[1].z], tris, 0);
    if (r.ok) ghostMesh = meshFrom(r.tris, ghostMaterial);
  });
}

/** Commit the wall from `drawStart` to the just-clicked point, if it can build. */
function placeSecondPoint(hitPoint) {
  part.updateMatrixWorld();
  const aWorld = part.localToWorld(drawStart.clone());
  const bWorld = hitPoint.clone();
  const tris = partPrintTriangles();
  const r = drawnWall([aWorld.x, aWorld.y, aWorld.z],
                      [bWorld.x, bWorld.y, bWorld.z], tris, 0);
  if (!r.ok) {
    drawMsg = `couldn’t place that wall: ${r.reason}`;
    clearPreview();
    updateReadout(lastBuilt);
    return;
  }
  drawMsg = '';
  histPush();
  drawnWalls.push({ a: drawStart.clone(), b: part.worldToLocal(bWorld.clone()) });
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
function autoSupports() {
  if (!finsVisible || finMode !== 'auto' || !lastBuilt) return { braces: [], walls: [] };
  const outlines = lastBuilt.sway?.braces ?? [];
  const braces = [], walls = [];
  let k = 0;   // sway records and their outlines are emitted in the same order
  for (const rec of lastBuilt.fins ?? []) {
    const gone = removedIds.has(rec.id);
    if (rec.kind === 'sway') {
      const outline = outlines[k++];
      if (outline && !gone) braces.push(outline);
    } else if (!gone && Array.isArray(rec.line) && rec.line.length) {
      walls.push(rec.line);
    }
  }
  return { braces, walls };
}

/** Stand a sway brace on the upright face the user clicked. One click, no second point. */
function placeSway(hit) {
  const auto = autoSupports();
  const standing = [...auto.braces,
                    ...drawnWalls.filter((w) => w.kind === 'sway' && w.ok).map((w) => w.info)];
  const r = swayAtFace(topology, lastResult, rotM3.elements, hit.faceIndex,
                       [hit.point.x, hit.point.y, hit.point.z], swayOpts(),
                       { braces: standing, walls: auto.walls });
  if (!r.ok) {
    drawMsg = `couldn’t place that brace: ${r.reason}`;
    updateReadout(lastBuilt);
    return;
  }
  drawMsg = '';
  histPush();
  part.updateMatrixWorld();
  drawnWalls.push({ kind: 'sway', face: hit.faceIndex, a: part.worldToLocal(hit.point.clone()) });
  rebuildDrawn();
  updateReadout(lastBuilt);
  updateFit();
}

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
function swayOpts() {
  const num = (id, d) => (Number.isFinite(el(id).valueAsNumber) ? el(id).valueAsNumber : d);
  return { gripFrom: num('sway-from', 0),
           tineSpacing: num('sway-spacing', 6),
           reach: num('sway-depth', 15) / 100,
           gap: PROP.gap, bite: FIN.tineBite,
           tines: el('tines').checked,
           layerHeight: el('layer-height').valueAsNumber };
}

function makeFinWorker() {
  const w = new Worker(new URL('./finworker.js', import.meta.url), { type: 'module' });
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
function markFinsStale() {
  for (const m of [finMesh, padMesh, drawnMesh]) if (m) m.material.opacity = 0.25;
  finMaterial.transparent = padMaterial.transparent = drawMaterial.transparent = true;
  el('s-fins').textContent = 'generating supports…';
}

// Grams use the selected material's density (materialDensity, set by applyMaterial),
// so the number is honest rather than pretending to be machine truth.

/** Signed volume of a closed triangle-soup, mm^3. Fins and pad are closed solids. */
function meshVolumeMM3(tris) {
  let v = 0;
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i], b = tris[i + 1], c = tris[i + 2];
    v += a[0] * (b[1] * c[2] - b[2] * c[1])
       - a[1] * (b[0] * c[2] - b[2] * c[0])
       + a[2] * (b[0] * c[1] - b[1] * c[0]);
  }
  return Math.abs(v) / 6;
}

const fmtGrams = (g) => (g < 9.95 ? g.toFixed(1) : String(Math.round(g)));

/**
 * The "what did this actually get me" receipt. The headline -- the mass of
 * breakaway support the tool adds -- is EXACT (we generate that geometry, and
 * this volume was cross-checked against buildFins' own wall volume). It ticks as
 * you re-orient, so a better pose visibly costs less support.
 *
 * The saving vs. the slicer's own supports is deliberately NOT computed per part:
 * we can't slice in the browser, and a made-up "you saved 5.2 g" is exactly what
 * loses trust on the first print. Instead the sub-line states the MEASURED result
 * from the test prints (see video notes), which is a claim we can stand behind.
 */
function updateReceipt() {
  const box = el('receipt');
  const added = activeAdded();
  if (!finsVisible || !added.length) { box.hidden = true; return; }
  const grams = meshVolumeMM3(added) * materialDensity / 1000;
  el('r-grams').textContent = `${fmtGrams(grams)} g`;
  box.hidden = false;
}

/** Route the readout to the active mode. */
export function updateReadout(built, ms) {
  if (finMode === 'draw') updateDrawReadout(built, ms);
  else updateFinReadout(built, ms);
  updateReceipt();
}

/**
 * Two audiences, two homes. `lead` is the short, must-see stuff -- a support that
 * couldn't build, a part balanced on a point -- and stays in the status panel.
 * `detail` is the how-it-works / how-to-fix text, which reads as a wall when it's
 * always on, so it's tucked behind the (i) on the Fins row where a curious user
 * can hover for it. Either can be empty.
 */
function setFinNote(lead, detail) {
  el('s-fin-note').textContent = lead.length ? lead.join('. ') + '.' : '';
  const info = el('s-fin-info');
  const text = detail.filter(Boolean).join(' ');
  if (text) { info.title = text; info.hidden = false; }
  else { info.title = ''; info.hidden = true; }
}

/**
 * Draw mode's readout. Reports the breakaway WALLS the user drew by hand (a wall
 * per line, straight onto the overhang), plus the pad/seating verdict from
 * buildFins. When a drawn wall can't build it says WHY -- silence-as-success is
 * the exact bug M5's scoreboard was built on.
 */
function updateDrawReadout(built, ms) {
  finMaterial.transparent = padMaterial.transparent = drawMaterial.transparent = false;
  finMaterial.opacity = padMaterial.opacity = drawMaterial.opacity = 1;
  const box = el('s-fins');
  el('s-pad').textContent = built ? padStatus(built) : '—';

  const ok = drawnWalls.filter((w) => w.ok);
  const bad = drawnWalls.length - ok.length;
  const tines = ok.reduce((a, w) => a + (w.info?.tines ?? 0), 0);
  const braces = ok.filter((w) => w.kind === 'sway').length;
  const walls = ok.length - braces;
  const parts = [];
  if (walls) parts.push(`${walls} drawn wall${walls === 1 ? '' : 's'}`);
  if (braces) parts.push(`${braces} sway brace${braces === 1 ? '' : 's'}`);
  box.textContent = ok.length
    ? parts.join(' + ') + (tines ? ` · ${tines} tines` : '')
    : 'none yet';
  box.classList.toggle('warn', ok.length === 0);

  const lead = [];
  const help = [];
  if (!drawnWalls.length && !drawMsg) {
    lead.push('Click two points across an overhang (a line lands right where you '
      + 'draw it, red faces included) to lay a breakaway wall under it');
  }
  if (ok.length) {
    help.push(tines
      ? 'The tines grab onto the part and bend away when you snap the wall off.'
      : 'Each wall stops a hair under the part (0.2mm) so it snaps off clean. Turn '
        + 'Tines on if you want it to grip the part.');
  }
  // A brace you place by hand is built even where Auto would refuse to stand one,
  // so say what it is doing: below its first tine it holds nothing and nothing
  // holds it, which is worth knowing but is your call to make.
  const stilted = ok.filter((w) => w.kind === 'sway' && (w.info?.stilt ?? 0) > 20);
  if (stilted.length) {
    const tallest = Math.max(...stilted.map((w) => w.info.stilt));
    help.push(`${stilted.length === 1 ? 'One brace stands' : `${stilted.length} braces stand`} `
      + `up to ${Math.round(tallest)}mm before gripping the part — that much of it prints as a `
      + 'lone wall. Fine if it prints; rotate so that side reaches the plate if it wobbles.');
  }
  if (bad) {
    const one = drawnWalls.find((w) => !w.ok);
    lead.push(`${bad} wall${bad === 1 ? '' : 's'} couldn’t build here`
      + `${one?.info?.reason ? ` (${one.info.reason})` : ''}. Undo, or redraw`);
  }
  if (drawMsg) lead.push(drawMsg);
  if (selectedWall) lead.push(selectedNote());
  if (built?.seating?.kind === 'point') {
    lead.push(built.pad
      ? 'this part balances on one point, so the bed pad is holding it. Print with the pad on'
      : 'this part balances on one point. Turn the bed pad on to seat it, or rotate until it sits down');
  }
  if (built && padNote(built)) lead.push(padNote(built));
  setFinNote(lead, help);
  if (ms != null) el('s-time').textContent = `${analysisTiming} · pad ${ms.toFixed(0)} ms`;
}

/**
 * The Light pad grips by first-layer squish along the part's first-layer outline.
 * A part on a point or a small round foot has only a few mm of it, so fins.js
 * builds Sure hold there instead (pad.autoSure) -- say so, since the user picked
 * Light. A Custom pad with a gap on such a foot gets a warning instead of a swap.
 */
function padStatus(built) {
  syncAutoLabel(built);
  if (!built.pad) return 'not needed';
  return built.pad.autoSure ? 'Sure hold (small foot)' : 'added';
}
// The Auto option names what it built, so the dropdown never claims Light while
// the pad on screen is Sure hold.
function syncAutoLabel(built) {
  const opt = el('bed-pad').querySelector('option[value="auto"]');
  const p = built?.pad;
  opt.textContent = !p || PAD.style !== 'auto' ? 'Auto'
    : p.style === 'sure' ? 'Auto (Sure hold)' : 'Auto (Light)';
  syncSectionSums();
}
function padNote(built) {
  const p = built.pad;
  if (!p?.smallFoot) return '';
  const mm = p.outline < 1 ? 'under 1 mm' : `${p.outline.toFixed(0)} mm`;
  if (p.autoSure) {
    return `this part meets the plate on a small foot (${mm} of first-layer edge), too little for a `
         + 'Light pad to grip, so Auto made it Sure hold, touching the part to hold it';
  }
  if (PAD.style === 'light') {
    return `this part meets the plate on a small foot (${mm} of first-layer edge); a Light pad has `
         + 'almost nothing to grip. Auto or Sure hold holds it';
  }
  if (PAD.style === 'custom' && PAD.custom.gap > 0) {
    return `this part meets the plate on a small foot (${mm} of first-layer edge); a pad with a gap `
         + 'has almost nothing to grip. Sure hold, or Pad gap 0, holds it';
  }
  return '';
}

function updateFinReadout(built, ms) {
  finMaterial.transparent = padMaterial.transparent = false;
  finMaterial.opacity = padMaterial.opacity = 1;
  const box = el('s-fins');
  if (!built) {
    box.textContent = '—';
    box.classList.remove('warn');
    el('s-pad').textContent = '—';
    setFinNote([], []);
    return;
  }
  el('s-pad').textContent = padStatus(built);
  const n = built.fins.length;
  const kind = built.mode === 'prop' ? 'prop' : 'fin';
  // Hand-added walls (Suggest + Draw mix) count toward the tally too.
  const drawnOk = drawShown() ? drawnWalls.filter((w) => w.ok).length : 0;
  let autoTxt;
  if (built.mode === 'auto') {
    // Named apart so the readout is honest: the support fins sit on the overhangs
    // (tined when the toggle is on), the props are the fallback under ledges too
    // flat to take a fin. "N fins" alone would hide which is which.
    const p = built.propCount, b = built.braceCount;
    const seg = [];
    if (b) seg.push(`${b} support fin${b === 1 ? '' : 's'}` + (built.tines ? ` · ${built.tines} tines` : ''));
    if (p) seg.push(`${p} prop${p === 1 ? '' : 's'}`);
    autoTxt = seg.join(' + ');
  } else {
    autoTxt = n
      ? `${n} ${kind === 'prop' ? 'prop' : 'support fin'}${n === 1 ? '' : 's'}`
        + (built.mode === 'prop' || !built.tines ? '' : ` · ${built.tines} tines`)
      : '';
  }
  const drawnTxt = drawnOk ? `${autoTxt ? ' + ' : ''}${drawnOk} drawn` : '';
  const removedN = removedIds.size;
  const removedTxt = removedN ? ` (${removedN} removed)` : '';
  const sw = built.sway;
  const swayTxt = sw?.count
    ? `${autoTxt || drawnTxt ? ' + ' : ''}${sw.count} sway brace${sw.count === 1 ? '' : 's'}`
      + (sw.tines ? ` · ${sw.tines} brace tines` : '')
    : '';
  box.textContent = (autoTxt + drawnTxt + swayTxt + removedTxt) || 'none possible';
  box.classList.toggle('warn', n === 0 && !drawnOk && !sw?.count);

  // `lead` = short + must-see, stays in the panel; `help` = how-it-works and
  // how-to-fix, goes behind the (i). Split so the panel doesn't read as a wall.
  const lead = [];
  const help = [];
  if (!n && !drawnOk) {
    // Nothing placed -- the box already says "none possible"; the why goes in the
    // (i), since it's a paragraph and the user can hover for it.
    help.push(explainNoFins(built));
  } else if (n) {
    if (built.mode === 'auto') {
      // Make "why no tines" legible: props never take tines, only the gripping
      // fins do, so a part that gets only props shows no tines and that's correct.
      const b = built.braceCount, p = built.propCount;
      if (b) {
        help.push(built.tines
          ? 'The tines grab onto the part and bend away when you snap the supports off.'
          : 'The fins stand a hair off the part (0.2mm) so they pop off. Turn Tines on if you want them to grip.');
      }
      if (p && !b) {
        help.push('These are plain props, not gripping fins. The overhangs here are '
          + 'too shallow or curved to stand a fin against, so there are no tines to add.');
      } else if (p) {
        help.push(`The ${p} prop${p === 1 ? '' : 's'} sit under overhangs too shallow `
          + 'to grip, so those get no tines.');
      }
    } else if (built.mode === 'prop') {
      help.push('Each one stops a hair under the part (0.2mm) so it pops off instead of needing a cut.');
    }
  }
  if (drawnOk) {
    lead.push(`plus ${drawnOk} wall${drawnOk === 1 ? '' : 's'} you added by hand`);
  }
  // Hand-placement feedback has to surface here too (Suggest + Draw mix), or a
  // rejected wall fails silently -- the same silence-as-success trap as M5. This
  // one is an interactive failure, so it stays visible, not behind the (i).
  if (drawShown()) {
    const bad = drawnWalls.length - drawnOk;
    if (bad) {
      const one = drawnWalls.find((w) => !w.ok);
      lead.push(`${bad} drawn wall${bad === 1 ? '' : 's'} couldn’t attach here`
              + (one?.info?.reason ? ` (${one.info.reason})` : ''));
    }
    if (drawMsg) lead.push(drawMsg);
    if (selectedWall) lead.push(selectedNote());
  }
  // Worth saying even when something WAS placed: a point-balanced part is
  // standing on the added pad and nothing else, so the pad is load-bearing,
  // not cosmetic. Must-see -> stays visible.
  if (n && built.seating?.kind === 'point') {
    lead.push(built.pad
      ? 'this part balances on one point, so the bed pad is holding it. Print with the pad on'
      : 'this part balances on one point with nothing under it. Turn the bed pad on, or rotate until it sits down');
  }
  if (padNote(built)) lead.push(padNote(built));
  if (built.sagRisk) {
    // The coverage slider is left of centre, so a broad flat overhang got rows
    // spaced wider than the 12mm anti-sag guide. That's allowed on purpose (fewer
    // supports), but the plate can bow between them -- must-see, so it's in the
    // panel, not behind the (i).
    lead.push('coverage is below the anti-sag guide, so a broad overhang may sag '
            + 'between supports — nudge the slider right if the surface bows');
  }
  if (built.unserved) {
    // An un-served ledge is a shallow overhang with no room for a prop and too
    // flat to stand a fin against. The fix (tilt steeper) is a sentence, so it
    // rides in the (i) rather than the panel.
    help.push(`${built.unserved} overhang${built.unserved === 1 ? ' is' : 's are'} `
            + 'too shallow for a fin this way up. Tilt the part steeper so a fin can '
            + 'follow it (try Suggest orientation), or add a wall by hand.');
  }
  if (built.skipped?.bore) {
    // A support standing INSIDE a bore or slot scars a surface you can't clean --
    // worse than a little sag. The tool refuses those on purpose; the honest fix
    // is to rotate the hole so it faces out and prints clean with no support.
    const b = built.skipped.bore;
    help.push(`${b} overhang${b === 1 ? ' sits' : 's sit'} inside a bore or slot, `
            + `where a support would leave a mark you can’t reach. The tool leaves `
            + `${b === 1 ? 'it' : 'them'} alone, so turn the hole upward to print `
            + `${b === 1 ? 'it' : 'them'} clean.`);
  }
  // Sway braces were asked for, so say what they did -- and why, if nothing.
  if (sw) {
    if (!sw.count) lead.push(`no sway braces: ${sw.reason}`);
    else {
      help.push('The sway braces stand edge-on against the tall sides and are tied on '
        + 'by tines all the way up, so the top can’t drift or wobble as it prints.');
      if (sw.skipped) {
        help.push(`${sw.skipped} brace spot${sw.skipped === 1 ? ' was' : 's were'} blocked by `
          + 'the part itself. Switch to Draw and click an upright side to place one by hand.');
      }
    }
  }
  setFinNote(lead, help);
  // ms is absent when a hand-drawn wall (Suggest + Draw mix) re-runs the readout
  // without rebuilding the auto fins -- don't touch the timing line then, and
  // never throw, or the updateReceipt() call after this one never happens.
  if (ms != null) el('s-time').textContent = `${analysisTiming} · fins ${ms.toFixed(0)} ms`;
}

/** Show the Draw controls (hint + Undo/Clear) only while hand-placement is live,
 *  and word the hint for what the click does: a support fin in Draw, a two-point
 *  wall in the Suggest "+ Add" augment. */
export function syncDrawControls() {
  el('draw-controls').hidden = !drawShown();
  el('draw-hint').innerHTML = 'Click <strong>two points</strong> across an overhang '
    + '— straight onto the red faces — to lay a breakaway wall along that line. '
    + (el('sway').checked
      ? 'Click an <strong>upright side</strong> once to stand a sway brace against it. '
      : '')
    + '<kbd>Esc</kbd> or right-click cancels.';
}

/** The "+ Add walls by hand" toggle, shown only in Suggest mode. */
export function syncAugmentUI() {
  const show = finsVisible && finMode === 'auto';
  el('augment-toggle').hidden = !show;
  el('augment-toggle').classList.toggle('primary', drawAugment);
  el('augment-toggle').textContent = drawAugment ? 'Done adding walls' : '+ Add walls by hand';
}

el('fin-mode').addEventListener('change', (e) => {
  histPush();
  finMode = e.target.value;
  el('coverage-fld').hidden = finMode !== 'auto';  // row density only applies to Auto
  drawAugment = false;      // start each mode with hand-placement off
  if (removeMode) cancelRemove();
  drawMsg = '';
  clearPreview();
  syncAugmentUI();
  syncDrawControls();
  syncRemoveUI();
  setGizmo();
  refreshFins();
});
// Bed pad style (PAD.style in fins.js). Only Custom shows the pad's numbers; the
// presets keep theirs fixed (Sure hold's follow the material profile). Switching
// to Custom starts it from whichever preset was showing, so a tweak begins from
// numbers that are known to print rather than from blanks.
const PAD_FIELDS = { h: 'pad-h', gap: 'pad-gap', grip: 'pad-grip', margin: 'pad-margin' };
function padPreset(style) {
  // Auto starts Custom from whatever it last built.
  if (style === 'auto') style = lastBuilt?.pad?.style === 'sure' ? 'sure' : 'light';
  return style === 'sure'
    ? { h: FIN.padH, gap: 0, grip: PAD.grab, margin: FIN.padMargin }
    : { h: el('layer-height').valueAsNumber || 0.2, gap: PAD.brimGap, grip: 0, margin: FIN.padMargin };
}
let padShown = el('bed-pad').value;
function syncPadStyle() {
  const v = el('bed-pad').value;
  if (v === 'custom' && padShown !== 'custom') {
    const p = padPreset(padShown);
    for (const [k, id] of Object.entries(PAD_FIELDS)) el(id).value = +p[k].toFixed(2);
    readPadCustom();
  }
  if (v !== 'off') PAD.style = v;
  padShown = v;
  for (const f of document.querySelectorAll('[data-pad-custom]')) f.hidden = v !== 'custom';
  syncTineGrip();
  syncSectionSums();
}
function readPadCustom() {
  for (const [k, id] of Object.entries(PAD_FIELDS)) {
    const input = el(id), v = input.valueAsNumber;
    if (Number.isFinite(v)) PAD.custom[k] = Math.min(+input.max, Math.max(+input.min, v));
  }
}
el('bed-pad').addEventListener('change', () => { syncPadStyle(); refreshFins(); });
for (const id of Object.values(PAD_FIELDS)) {
  el(id).addEventListener('input', () => { readPadCustom(); debouncedRefresh(); });
}
// A slider fires `input` on every pixel of a drag; on a big part one regenerate can
// take a while, so re-running it per tick freezes the page mid-drag. Coalesce the
// drag into a single rebuild once the value settles. `change` (fires on release) is
// too coarse -- no live preview at all -- so debounce instead: quick enough to feel
// live on a small part, one rebuild instead of dozens on a large one.
let refreshTimer = null;
function debouncedRefresh(ms = 180) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => { refreshTimer = null; refreshFins(); }, ms);
}
// Tine grip only means anything when the tines are on, so hide its slider with the
// toggle (keeps the panel honest -- no dead control).
// Tine grip + layer height only matter when Tines is on -- hide both otherwise.
function syncTineGrip() {
  const on = el('tines').checked;
  el('tinegrip-fld').hidden = !on;
  // The Light pad is one layer tall, so it reads the layer height too.
  el('layerh-fld').hidden = !on && !['light', 'auto'].includes(el('bed-pad').value);
}
el('tines').addEventListener('change', () => { syncTineGrip(); refreshFins(); });
el('tine-density').addEventListener('input', () => debouncedRefresh());
el('layer-height').addEventListener('input', () => debouncedRefresh());
el('coverage').addEventListener('input', () => debouncedRefresh());
syncTineGrip();
syncPadStyle();

// Sway braces: the switch sits in its section header (like Tines), and its three
// settings only show while it is on, so an unused feature costs one line. The two
// tine settings additionally follow the global Tines toggle -- with tines off there
// is no comb to space.
function syncSway() {
  const on = el('sway').checked;
  el('sway-from-fld').hidden = !on || !el('tines').checked;
  el('sway-spacing-fld').hidden = !on || !el('tines').checked;
  el('sway-depth-fld').hidden = !on;
  syncDrawControls();
  syncSectionSums();
}
el('sway').addEventListener('change', () => {
  // Switching it on opens its section: the switch is in the header, so a collapsed
  // section would otherwise turn the feature on and hide its settings in one click.
  if (el('sway').checked) el('sway').closest('details').open = true;
  syncSway();
  refreshFins();
});
el('tines').addEventListener('change', syncSway);
for (const id of ['sway-from', 'sway-spacing', 'sway-depth']) {
  el(id).addEventListener('input', () => debouncedRefresh());
}
syncSway();

// Gap tuning. PROP.gap / PAD.grab are read fresh on every build, so setting them
// here and rebuilding is all it takes. Clamp to the input's own range so a typed
// value can't drive the support into the part or float it off the overhang.
function wireGap(id, obj, key, lo, hi) {
  const input = el(id);
  input.addEventListener('input', () => {
    const v = input.valueAsNumber;
    if (Number.isFinite(v)) { obj[key] = Math.min(hi, Math.max(lo, v)); debouncedRefresh(); }
  });
}
wireGap('gap', PROP, 'gap', 0.1, 0.4);

// Wall cutouts (issue #34). CUT.pattern is read fresh by every wall sweep -- the
// drawn walls here on the page, the auto walls in the Worker via tunables.
el('cutout').addEventListener('change', () => {
  CUT.pattern = el('cutout').value;
  refreshFins();
});
CUT.pattern = el('cutout').value;   // a reload can keep the browser's last pick

// Material profiles. PETG welds to a support far harder than the PLA every bite
// number here was tuned on, so PETG needs more clearance in all four places at
// once: the fin's tine standoff (FIN.gap) and how far each tine sinks into the
// part (FIN.tineBite), the plain breakaway prop's clearance (PROP.gap), and the
// bed pad -- thinner (FIN.padH) with a gap instead of a tack (PAD.grab < 0). PLA
// is exactly today's numbers, so switching to PLA (or never touching this) leaves
// existing prints unchanged. These objects are read fresh on every build, so
// applying a profile + rebuilding is all it takes. density is g/cm^3 for the
// grams receipt.
const MATERIAL = {
  pla:  { finGap: 0.2, tineBite: 0.30, padH: 0.5, padGrab:  0.05, propGap: 0.2,  density: 1.24 },
  petg: { finGap: 0.3, tineBite: 0.15, padH: 0.3, padGrab: -0.10, propGap: 0.3,  density: 1.27 },
};
let materialDensity = MATERIAL.pla.density;

function applyMaterial(name) {
  const m = MATERIAL[name] || MATERIAL.pla;
  FIN.gap = m.finGap;
  FIN.tineBite = m.tineBite;
  FIN.padH = m.padH;
  PAD.grab = m.padGrab;
  PROP.gap = m.propGap;
  materialDensity = m.density;
  // Reflect the profile's clearances in the exposed tunables so the numbers on
  // screen match what will actually print (and a later hand-tweak starts from the
  // material's baseline, not PLA's).
  el('gap').value = m.propGap;
  syncSectionSums();
}

el('material').addEventListener('change', () => {
  applyMaterial(el('material').value);
  debouncedRefresh();
});
applyMaterial(el('material').value);   // sync density + tunables to the initial choice

/** The fins-toggle button's appearance for the current finsVisible. Factored out
 *  so undo/redo can re-sync it after restoring the flag. */
export function syncFinsToggleUI() {
  el('fins-toggle').classList.toggle('primary', finsVisible);
  el('fins-toggle').textContent = finsVisible ? 'Fins on' : 'Add fins';
  el('fin-opts').hidden = !finsVisible;
  syncSectionSums();
}

// ------------------------------------------------------------ options sections
//
// The options panel is grouped into <details> sections (issue #41). Two jobs here:
// remember which are open, and write each section's one-line recap so collapsing
// it never hides what's set. Storage is a convenience only -- private windows and
// blocked storage throw, and the panel then just opens in its default layout.
const SEC_KEY = 'sf.sections';
function loadSectionState() {
  try { return JSON.parse(localStorage.getItem(SEC_KEY)) || {}; } catch { return {}; }
}
{
  const saved = loadSectionState();
  for (const d of document.querySelectorAll('#fin-opts details.sec')) {
    if (d.dataset.sec in saved) d.open = !!saved[d.dataset.sec];
    d.addEventListener('toggle', () => {
      const state = loadSectionState();
      state[d.dataset.sec] = d.open;
      try { localStorage.setItem(SEC_KEY, JSON.stringify(state)); } catch { /* storage off */ }
    });
  }
}
// The Tines switch sits inside its section's <summary>; without this a click on it
// would also fold the section open or shut.
el('tines').closest('label').addEventListener('click', (e) => e.stopPropagation());
// ...and the same for the Sway braces switch, which sits in its own section header.
el('sway').closest('label').addEventListener('click', (e) => e.stopPropagation());

/** Refill each section's collapsed recap from the controls' current values. */
function syncSectionSums() {
  const sel = (id) => el(id).selectedOptions[0]?.textContent.split(' —')[0] ?? '';
  el('sum-setup').textContent = `${sel('material')} · ${sel('fin-mode')}`;
  const grip = el('tine-density').valueAsNumber;
  el('sum-tines').textContent = el('tines').checked
    ? `${grip <= 20 ? 'light' : grip >= 80 ? 'firm' : 'medium'} grip · ${el('layer-height').value} mm`
    : 'off';
  el('sum-clearances').textContent =
    `${el('gap').value} mm gap · pad ${el('bed-pad').selectedOptions[0].textContent.toLowerCase()}`;
  const cut = el('cutout').value;
  el('sum-walls').textContent = cut === 'none' ? 'solid' : `${sel('cutout').toLowerCase()} cutouts`;
  el('sum-sway').textContent = el('sway').checked
    ? `${el('sway-spacing').value} mm tines · ${el('sway-depth').value}% deep`
      + (el('sway-from').valueAsNumber > 0 ? ` · from ${el('sway-from').value} mm` : '')
    : 'off';
}
el('fin-opts').addEventListener('input', syncSectionSums);
el('fin-opts').addEventListener('change', syncSectionSums);

el('fins-toggle').addEventListener('click', () => {
  histPush();
  finsVisible = !finsVisible;
  if (!finsVisible) drawAugment = false;
  if (removeMode) cancelRemove();
  syncFinsToggleUI();
  drawMsg = '';
  clearPreview();
  syncAugmentUI();
  syncDrawControls();
  syncRemoveUI();
  setGizmo();
  refreshFins();
});

el('augment-toggle').addEventListener('click', () => {
  if (removeMode) cancelRemove();
  drawAugment = !drawAugment;
  drawMsg = '';
  clearPreview();
  syncAugmentUI();
  syncDrawControls();
  setGizmo();
  refreshFins();
});

// Undo/Clear act on the hand-drawn breakaway walls -- the thing both Draw and the
// Suggest "+ Add" augment now place.
el('draw-undo').addEventListener('click', () => {
  if (!drawnWalls.length) return;
  histPush();
  drawnWalls.pop();
  drawMsg = '';
  clearPreview();
  rebuildDrawn();
  updateReadout(lastBuilt);
  updateFit();
});
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
function pickFace(ev) {
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
    const hit = pickFace(ev);
    if (hit) {
      updatePreview(hit.point);
      renderer.domElement.style.cursor = 'crosshair';
    } else {
      drawCursor.visible = drawBand.visible = false;
      if (ghostMesh) { scene.remove(ghostMesh); ghostMesh.geometry.dispose(); ghostMesh = null; }
      renderer.domElement.style.cursor = '';
    }
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
    if (!drawStart && el('sway').checked
        && faceIsUpright(topology, rotM3.elements, hit.faceIndex)) {
      placeSway(hit);
      return;
    }
    if (!drawStart) {
      drawStart = part.worldToLocal(hit.point.clone());
      drawMsg = '';
      updatePreview(hit.point);
      updateReadout(lastBuilt);
    } else {
      placeSecondPoint(hit.point);
    }
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
el('draw-remove').addEventListener('click', removeSelected);
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

// -------------------------------------------------------- suggest orientation

const _sm4 = new THREE.Matrix4();
let suggestions = [];

/** Turn the part to a suggested pose. `rot` is a column-major 3x3. */
export function applySuggestion(rot) {
  histPush();
  // Matrix4.set takes ROW-major args; rot is column-major (THREE.Matrix3 order).
  _sm4.set(rot[0], rot[3], rot[6], 0,
           rot[1], rot[4], rot[7], 0,
           rot[2], rot[5], rot[8], 0,
           0, 0, 0, 1);
  part.quaternion.setFromRotationMatrix(_sm4);
  el('rot-delta').textContent = '';
  shade();
}

// Overhangs the CURRENT pose refuses to support inside a bore/slot (scarring a fit
// surface) — the count buildFins reports as skipped.bore. We only celebrate a pose
// for CLEARING the bore when the current one actually has that problem, so the
// "points the holes up" verdict never fires on a part with no bores. Set before
// renderSuggestions runs.
let suggestCurBore = 0;

/**
 * The "best support is no support" verdict for a suggested pose — the product's
 * whole thesis made a first-class outcome instead of a gray "0 fins". Two tiers:
 *   free      — the pose needs NO support fins at all (regions === 0): 0 g added.
 *               A leftover rough sliver (c.holes) is a cosmetic caveat, not a
 *               support cost, so it's mentioned but doesn't disqualify the win.
 *   holeclean — it still needs external fins, but every bore prints support-free,
 *               so nothing ever stands inside a hole and scars a fit surface. This
 *               is the "point the bore up" win (bore_bracket: 5 in-bore → 0).
 * Returns null for an ordinary supported pose, so the caller falls back to the
 * normal confidence line.
 */
function noSupportVerdict(c) {
  if (c.regions === 0) {
    const rough = c.holes ?? 0;
    const roughCaveat = rough ? ` One small spot may print a bit rough.` : '';
    // The suggester ranks for printability, not strength (it can't know the load).
    // If this pose also stands the part's long axis up the layers, that's the weak
    // print direction, so add a heads-up and point at the Strength arrow.
    const lv = c.size ? layerVerdict(c.size) : null;
    const strengthCaveat = lv?.posture === 'weak'
      ? ` It prints tall, though, the weaker direction, so check the Strength arrow if it bears a load.`
      : '';
    return { tier: 'free', badge: 'No support',
      note: `This way up it needs no fins, 0 g.${roughCaveat}${strengthCaveat}` };
  }
  if ((c.bore ?? 0) === 0 && suggestCurBore > 0) {
    const grams = (c.volume ?? 0) * materialDensity / 1000;
    return { tier: 'holeclean', badge: 'Bores clean',
      note: `This way up the bores point up, so no support sits inside a hole to scar it `
          + `(${fmtGrams(grams)} g of fins, all on the outside).` };
  }
  return null;
}

function renderSuggestions() {
  const list = el('suggest-list');
  list.replaceChildren();
  suggestions.forEach((c, i) => {
    const row = document.createElement('button');
    row.className = 'btn suggest-row';
    const point = c.seating === 'point';
    const overs = c.walls === 0 ? 'no fins' : `${c.walls} fin${c.walls === 1 ? '' : 's'}`;
    // Rough holes = the small hole/slot/bore-top overhangs this pose leaves
    // unsupported (dropped slivers + bore-refused). Showing it is what makes a
    // hole-friendly pose legible: "Best · 12 rough" over "#3 · 561".
    const rough = (c.holes ?? 0) + (c.bore ?? 0);
    const roughTxt = rough ? ` · ${rough} rough` : '';
    // A support-free pose is the headline outcome, not a footnote — badge it green
    // instead of letting it read as a dull "no overhangs → 0 fins".
    const verdict = point ? null : noSupportVerdict(c);
    // The support-free win is already carried by the green left border (.free) and
    // the "no fins" text, so its badge would just be noise. The "Bores clean" win
    // isn't obvious from the line, so that one earns a badge -- flowed inline so it
    // wraps with the text instead of floating to a lonely top-right corner.
    const badge = verdict?.tier === 'holeclean' ? ` <span class="sr-badge">${verdict.badge}</span>` : '';
    // One tight line per pose: rank · height · fins · rough holes. Bed area was
    // dropped to fit -- height already stands in for how it sits.
    const tail = point ? ' · can’t print (on a point)' : roughTxt;
    row.innerHTML =
      `<span class="sr-rank">${i === 0 ? 'Best' : `#${i + 1}`}</span>` +
      `<span class="sr-line">${c.height.toFixed(0)} mm · ${overs}${tail}${badge}</span>`;
    if (point) row.classList.add('bad');
    if (verdict?.tier === 'free') row.classList.add('free');
    row.addEventListener('click', () => {
      applySuggestion(c.rot);
      for (const r of list.children) r.classList.remove('active');
      row.classList.add('active');
    });
    list.append(row);
  });
  list.hidden = false;
}

/** Clear the suggestion results entirely (new part, or a manual turn that
 *  invalidates the ranking). The disclosure chevron does NOT come through here --
 *  it only collapses/expands what's already there. */
export function hideSuggestions() {
  el('suggest-list').hidden = true;
  el('suggest-list').replaceChildren();
  const note = el('suggest-note');
  note.textContent = '';
  note.className = 'hint';
  const tog = el('suggest-toggle');
  tog.hidden = true;
  tog.setAttribute('aria-expanded', 'true');   // next results open expanded
  el('suggest-body').hidden = false;
}

el('suggest-orient').addEventListener('click', () => {
  if (!part || !topology) return;
  const btn = el('suggest-orient');
  btn.disabled = true; btn.textContent = 'Ranking…';
  // let the button repaint before the (up to ~1s) solve blocks the thread
  requestAnimationFrame(() => requestAnimationFrame(() => {
    try {
      const { candidates, confidence } = suggestOrientations(topology, { top: 3, threshold });
      suggestions = candidates;
      // In-bore overhangs the current pose refuses (would scar a fit surface) — the
      // baseline the "points the bores up" verdict measures its win against.
      suggestCurBore = lastBuilt?.skipped?.bore ?? 0;
      // Fresh results always land expanded, with the collapse chevron available.
      const tog = el('suggest-toggle');
      tog.hidden = false;
      tog.setAttribute('aria-expanded', 'true');
      tog.setAttribute('aria-label', 'Collapse suggestions');
      tog.title = 'Collapse';
      el('suggest-body').hidden = false;
      if (!candidates.length || confidence === 'none') {
        el('suggest-list').hidden = true;
        el('suggest-note').textContent = confidence === 'none'
          ? 'No printable orientation: this part balances on a point at every angle.'
          : 'Nothing to suggest for this part.';
      } else {
        renderSuggestions();
        // Lead with the win when the best pose needs no support (or clears every
        // bore); otherwise fall back to the honest confidence line.
        const note = el('suggest-note');
        const verdict = candidates[0].seating === 'point' ? null : noSupportVerdict(candidates[0]);
        if (verdict) {
          note.textContent = verdict.note;
          note.className = 'hint good';
        } else {
          note.textContent = 'Click a pose to turn the part.';
          note.className = 'hint';
        }
      }
    } finally {
      btn.disabled = false; btn.textContent = 'Suggest orientation';
    }
  }));
});

// Collapse/expand the results in place, keeping them (and the ranking) intact.
el('suggest-toggle').addEventListener('click', () => {
  const tog = el('suggest-toggle');
  const open = tog.getAttribute('aria-expanded') !== 'false';
  const next = !open;
  tog.setAttribute('aria-expanded', String(next));
  tog.setAttribute('aria-label', next ? 'Collapse suggestions' : 'Show suggestions');
  tog.title = next ? 'Collapse' : 'Show';
  el('suggest-body').hidden = !next;
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
