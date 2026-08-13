/**
 * Support Fins - M0: load an STL, orbit it, see it sitting on the plate.
 *
 * COORDINATES: Z up, millimetres, bed plane at z = 0, plate centred on the
 * origin in XY. This is the printer's frame and the same one the Python
 * generators use (tools/support/breakaway.py) -- three.js defaults to Y up, so
 * that is overridden here rather than converting at every later step.
 */
import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { buildTopology, analyze, DEFAULT_THRESHOLD } from './overhangs.js';
import { suggestOrientations, suggestStrengthPose, loadAlignment, layerVerdict } from './orient.js';
import { buildFins } from './fins.js';
import { findWallPatches } from './planes.js';
import { drawnWall } from './draw.js';
import { writeBinarySTL, download } from './stl.js';
import { writeThreeMF } from './threemf.js';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

/**
 * Build volumes are listed by DIMENSION, never by printer name. This ships to
 * strangers: a model name is a brand claim we would have to maintain, it dates
 * badly, and nobody has to recognise a name to type in three numbers. Custom
 * covers everything not listed, and the choice is remembered.
 */
const VOLUMES = [
  { x: 180, y: 180, z: 180 },
  { x: 220, y: 220, z: 250 },
  { x: 250, y: 220, z: 270 },
  { x: 256, y: 256, z: 256 },
  { x: 300, y: 300, z: 300 },
  { x: 350, y: 350, z: 350 },
];
const DEFAULT_VOLUME = { x: 250, y: 220, z: 270 };
const VOLUME_STORE = 'sf.volume';
const volLabel = (v) => `${v.x} × ${v.y} × ${v.z} mm`;

const el = (id) => document.getElementById(id);

// ---------------------------------------------------------------- scene setup

const viewport = el('viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
// Label the canvas: a screen reader otherwise announces a bare "canvas". The 3D
// itself isn't reachable non-visually, but the live stats panel carries the same
// state as text, so this points there.
renderer.domElement.setAttribute('role', 'img');
renderer.domElement.setAttribute(
  'aria-label', 'Interactive 3D preview of the loaded part. Orientation and support '
  + 'stats are reported as text in the panel on the left.');
viewport.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14161a);

const camera = new THREE.PerspectiveCamera(45, 1, 1, 5000);
camera.up.set(0, 0, 1);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

// Lighting is a legibility requirement here, not decoration: overhangs are on the
// UNDERSIDE, so the user spends most of their time looking up at the part. A
// conventional key-from-above rig leaves exactly the faces this tool exists to
// show sitting in the dark, so the ground bounce is bright and there is a real
// light underneath the plate.
scene.add(new THREE.HemisphereLight(0xbcd2ff, 0x7d8492, 2.0));
const key = new THREE.DirectionalLight(0xffffff, 1.5);
key.position.set(0.6, -1, 1.4);
scene.add(key);
const fill = new THREE.DirectionalLight(0xffffff, 0.5);
fill.position.set(-1, 0.7, 0.5);
scene.add(fill);
const under = new THREE.DirectionalLight(0xffffff, 0.9);
under.position.set(-0.35, 0.55, -1.2);
scene.add(under);

// ------------------------------------------------------------------ the plate

const plate = new THREE.Group();
scene.add(plate);

/** Grid + volume wireframe for a bed `sx` x `sy` mm and `sz` mm of headroom. */
function buildPlate(sx, sy, sz) {
  plate.clear();
  const hx = sx / 2, hy = sy / 2;
  const step = 10;

  // grid lines on z=0, brighter every 50mm
  const minor = [], major = [];
  for (let x = -Math.floor(hx / step) * step; x <= hx; x += step) {
    (Math.abs(x) % 50 === 0 ? major : minor).push(x, -hy, 0, x, hy, 0);
  }
  for (let y = -Math.floor(hy / step) * step; y <= hy; y += step) {
    (Math.abs(y) % 50 === 0 ? major : minor).push(-hx, y, 0, hx, y, 0);
  }
  for (const [pts, color, opacity] of [[minor, 0x2b303a, 0.9], [major, 0x3d4552, 1]]) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    plate.add(new THREE.LineSegments(
      g, new THREE.LineBasicMaterial({ color, transparent: true, opacity })));
  }

  // bed outline
  const edge = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-hx, -hy, 0), new THREE.Vector3(hx, -hy, 0),
    new THREE.Vector3(hx, hy, 0), new THREE.Vector3(-hx, hy, 0),
    new THREE.Vector3(-hx, -hy, 0),
  ]);
  plate.add(new THREE.Line(edge, new THREE.LineBasicMaterial({ color: 0x5b6472 })));

  // build volume
  const box = new THREE.Box3(
    new THREE.Vector3(-hx, -hy, 0), new THREE.Vector3(hx, hy, sz));
  const helper = new THREE.Box3Helper(box, 0x39414f);
  helper.material.transparent = true;
  helper.material.opacity = 0.55;
  plate.add(helper);
}

// ------------------------------------------------------------------- the part

const partMaterial = new THREE.MeshStandardMaterial({
  color: 0xffffff, roughness: 0.62, metalness: 0.05,
  vertexColors: true, side: THREE.DoubleSide,
});
let part = null;
let partName = '';
let topology = null;      // welded adjacency, rebuilt only when the mesh changes
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
function setPart(geometry, filename) {
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
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
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
  drawAugment = false;
  drawMsg = '';
  printTrisDirty = true;
  clearPreview();
  // A new part starts with no load direction either.
  loadDir = null;
  loadPlacing = false;
  loadDragStart = null;
  controls.enabled = true;
  loadArrowHelper.visible = false;
  if (loadArrowHelper.parent) loadArrowHelper.parent.remove(loadArrowHelper);
  syncLoadUI();
  setGizmo();

  // Undo history does not carry across parts.
  undoStack = [];
  redoStack = [];
  syncHistButtons();

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
const rotM3 = new THREE.Matrix3();
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

function shade() {
  if (!part || !topology) return new THREE.Vector3();
  rotM3.setFromMatrix4(rotM4.makeRotationFromQuaternion(part.quaternion));

  const t0 = performance.now();
  const res = analyze(topology, threshold, rotM3.elements);
  const ms = performance.now() - t0;

  // drop the rotated part back onto the plate, centred over it
  part.position.set(res.offset.x, res.offset.y, res.offset.z);

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
  el('s-overarea').textContent = `${res.overArea.toFixed(0)} mm²`;
  el('s-bed').textContent = `${res.bedArea.toFixed(0)} mm²`;
  el('s-bed').classList.toggle('warn', res.bedArea < 1);

  // "Do you even need me?" -- fire the honest signal before the user turns fins
  // on. Current pose clean wins outright; otherwise, if the part printed flat as
  // loaded, the overhangs on screen are self-inflicted by rotating.
  const flat = el('s-flat-note');
  if (res.regions.length === 0) {
    flat.textContent = 'Prints support-free in this orientation — no fins needed.';
    flat.className = 'note good';
  } else if (flatRegions === 0) {
    flat.textContent = 'This part prints flat as loaded — the overhangs above appeared '
      + 'when you rotated it. You only need fins if you’re tilting it for strength.';
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

/** Point the camera at the part, backed off far enough to see all of it. */
function frame(size) {
  sizeMarkers(size);
  const reach = Math.max(size.x, size.y, size.z, 40);
  const dist = reach * 2.1;
  camera.position.set(dist * 0.62, -dist * 0.72, dist * 0.55);
  camera.near = Math.max(0.5, reach / 200);
  camera.far = dist * 12;
  camera.updateProjectionMatrix();
  controls.target.set(0, 0, size.z / 2);
  controls.update();
}

// -------------------------------------------------------------------- reports

function report(filename, size) {
  el('s-name').textContent = filename;
  el('s-tris').textContent = (topology?.nFaces ?? 0).toLocaleString();
  el('s-bbox').textContent =
    `${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)} mm`;

  lastSize = size;
  updateFit();

  el('stats').hidden = false;
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
function updateFit() {
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

let lastResult = null;
let finsVisible = false;
// The wall is the default support and the fin is the Brace OPTION, not the
// other way around -- flipped at M5c. Measured over the dev matrix, the fin
// covers 4% of overhang area (it braces against toppling; it holds nothing up)
// and 7 of its 12 placements lean 25-40deg. The wall covers 61%, always
// vertical. A user who loads a part and exports should get the support that
// supports.
//
// DEFAULT IS 'draw', not 'prop'. Draw mode -- the user hands the tool one
// contact line and it sweeps one clean breakaway wall along it -- is the
// reliable path: it is exactly how tools/support/breakaway.py works, and its
// output matches breakaway.py's because there is no contact line left to guess.
// 'prop' (relabelled "Suggest" in the UI) is the best-effort auto-placer; it is
// kept but demoted, because on a square face its PCA axis snaps to a diagonal
// and it sprays walls that miss the face. See web/draw.js.
let finMode = 'draw';
// Suggest + Draw mix: when true, the pointer places hand-drawn walls ON TOP of the
// auto-placed ones (for when auto misses a spot). It only gates the pointer; the
// drawn walls themselves stay shown/exported after placing until Clear all.
let drawAugment = false;
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

let finMesh = null;
let padMesh = null;
let finTris = [];
let padTris = [];

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
let drawnWalls = [];        // committed walls: { a: Vector3(local), b: Vector3(local), ok, info }
let drawnMesh = null;
let drawnTris = [];
let drawStart = null;       // Vector3 (local) -- first click of a wall in progress
let drawMsg = '';           // last placement result, for the readout
let lastBuilt = null;       // last buildFins result, kept for the bed pad + seating readout
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

// endpoint dot, cursor dot, and the rubber-band line between them. Base radius
// 1mm; sizeMarkers() scales them to the part so they read on a 40mm cube and a
// 300mm bracket alike.
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
const drawCursor = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), guideMat(0xcffbe4));
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
let loadDir = null;         // THREE.Vector3 unit direction in local space, or null
let loadPlacing = false;    // true while dragging out a direction (modal: orbit off)
let loadDragStart = null;   // world-space surface point the drag began at, transient
const loadArrowHelper = new THREE.ArrowHelper(
  new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 10, 0xffb454, 4, 2.6);
loadArrowHelper.visible = false;
loadArrowHelper.renderOrder = 12;   // over the part and the draw guides
for (const m of [loadArrowHelper.line, loadArrowHelper.cone]) {
  m.material.depthTest = false;      // a HUD arrow, always visible like the draw guides
  m.material.transparent = true;
  m.renderOrder = 12;
}

/** Pointer is setting the load direction. Gates the gizmo and face-lay like drawing. */
const loadActive = () => loadPlacing;

// ------------------------------------------------------------------- layer view
//
// A faint stack of horizontal frames around the part, world-aligned, that shows
// how the print is layered: they stay horizontal while the part turns INSIDE them,
// so you see which way the layers slice it and (with the note) where it's weak.
// Purely illustrative -- no input, no effect on geometry. This is the automatic
// "what does this orientation do to strength" view; the load arrow is the optional
// add-on for when you know the actual load. Rebuilt each shade() to fit the part.
let layersOn = true;
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

/** Update the automatic layer note + frames for the current pose. */
function updateLayerView(size) {
  rebuildLayerViz(size);
  layerViz.visible = layersOn && !!part;
  const lv = layerVerdict(size);
  const ln = el('layer-note');
  ln.textContent = lv.note;
  ln.className = `layer-note ${lv.posture}`;
}

// Pointer is in wall-placement mode (draw mode, or Suggest with the add toggle on).
// Gates the draw interaction, the gizmo, and face-lay.
const drawActive = () => finsVisible && (finMode === 'draw' || drawAugment);
// Hand-drawn walls contribute to the display and the export. In Draw mode that's
// always; in Suggest it's whenever the user has drawn any (they persist after the
// add toggle is switched off, so you can orbit and export without losing them).
const drawShown = () =>
  finsVisible && (finMode === 'draw' || (finMode === 'prop' && (drawAugment || drawnWalls.length > 0)));

function sizeMarkers(size) {
  const r = Math.max(0.7, Math.max(size.x, size.y, size.z) / 90);
  drawDot.scale.setScalar(r);
  drawCursor.scale.setScalar(r * 0.85);
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
function clearPreview() {
  drawStart = null;
  drawDot.visible = drawCursor.visible = drawBand.visible = false;
  if (ghostMesh) { scene.remove(ghostMesh); ghostMesh.geometry.dispose(); ghostMesh = null; }
}

/** Rebuild the committed drawn walls for the current orientation. */
function rebuildDrawn() {
  if (drawnMesh) { scene.remove(drawnMesh); drawnMesh.geometry.dispose(); drawnMesh = null; }
  drawnTris = [];
  if (!drawShown() || !drawnWalls.length || !topology || !lastResult) return;
  part.updateMatrixWorld();
  const tris = partPrintTriangles();
  const wa = new THREE.Vector3(), wb = new THREE.Vector3();
  for (const w of drawnWalls) {
    part.localToWorld(wa.copy(w.a));
    part.localToWorld(wb.copy(w.b));
    const r = drawnWall([wa.x, wa.y, wa.z], [wb.x, wb.y, wb.z], tris, 0);
    w.ok = r.ok;
    w.info = r;
    if (r.ok) for (const t of r.tris) drawnTris.push(t);
  }
  drawnMesh = meshFrom(drawnTris, drawMaterial);
}

/** The walls + pad the CURRENT mode contributes to the export and the fit check. */
function activeAdded() {
  // Both auto modes bake their geometry into finTris (refreshFins' else branch):
  // Suggest → breakaway walls, Combined fin → tined fins. Only Draw leaves it
  // empty and exports the hand-drawn walls instead.
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

/** Enable the rotate gizmo only when NOT drawing or placing the load arrow --
 *  its handles would otherwise swallow the clicks that place points. */
function setGizmo() {
  const on = !!part && !drawActive() && !loadActive();
  gizmo.enabled = on;
  const helper = gizmo.getHelper ? gizmo.getHelper() : gizmo;
  helper.visible = on;
}

// ---------------------------------------------------------------- load arrow UI

/**
 * Redraw the arrow from `loadDir`, parented to the part so it follows the pose.
 * The part geometry is centred on its own origin (see setPart), so the load axis
 * is drawn THROUGH that centre -- it reads as "the part is pulled this way", not
 * as a force pinned to some spot, which is the honest picture for the pull model.
 */
function updateLoadArrowMesh() {
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

/** Live preview while dragging out a direction: cursor at the pointer, band from
 *  the drag's start point to it. */
function previewLoadDrag(hitPoint) {
  drawCursor.position.copy(hitPoint);
  drawCursor.visible = true;
  if (!loadDragStart) { drawBand.visible = drawDot.visible = false; return; }
  drawDot.position.copy(loadDragStart);
  drawDot.visible = true;
  bandGeom.setFromPoints([loadDragStart, hitPoint]);
  bandGeom.attributes.position.needsUpdate = true;
  drawBand.visible = true;
}

/**
 * The qualitative strength verdict for the CURRENT pose. World +Z is the build
 * axis once the part is seated, so the load direction in world space is all
 * loadAlignment needs. Re-run on every orientation change (from shade()) so the
 * verdict tracks the part as it turns.
 */
function updateLoadReadout() {
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

/** Enter direction-setting: modal, so a drag on the part sets direction instead
 *  of orbiting the camera. */
function beginLoadPlacement() {
  if (!part || !topology) return;
  loadPlacing = true;
  loadDragStart = null;
  controls.enabled = false;   // no orbit while aiming; a drag means "this way"
  clearPreview();
  setGizmo();
  syncLoadUI();
}

/** Leave direction-setting without committing (Esc / right-click / re-toggle). */
function cancelLoadPlacement() {
  loadPlacing = false;
  loadDragStart = null;
  drawCursor.visible = drawBand.visible = drawDot.visible = false;
  renderer.domElement.style.cursor = '';
  controls.enabled = true;
  setGizmo();
  syncLoadUI();
}

/** Drop a drag-in-progress but stay in the mode, so a stray click can be retried. */
function cancelLoadDrag() {
  loadDragStart = null;
  drawCursor.visible = drawBand.visible = drawDot.visible = false;
}

/** Commit the dragged direction (start -> end, both world surface points). Only the
 *  DIRECTION is kept, converted to the part's local frame so it tracks the pose. */
function commitLoadDrag(endWorld) {
  const dirWorld = endWorld.clone().sub(loadDragStart);
  if (dirWorld.length() < 1e-3) { cancelLoadDrag(); return; }   // a click, not a drag
  // World direction -> local direction: rotate by the inverse pose (translation is
  // irrelevant for a direction), so it's stored in the same frame as the geometry.
  const local = dirWorld.applyQuaternion(part.quaternion.clone().invert()).normalize();
  histPush();
  loadDir = local;
  loadPlacing = false;
  loadDragStart = null;
  drawCursor.visible = drawBand.visible = drawDot.visible = false;
  renderer.domElement.style.cursor = '';
  controls.enabled = true;
  updateLoadArrowMesh();
  updateLoadReadout();
  setGizmo();
  syncLoadUI();
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

/** Mirror the button/hint state to whether a direction is set and whether we're placing. */
function syncLoadUI() {
  const has = !!loadDir;
  el('load-set').textContent = loadPlacing ? 'Cancel'
    : has ? 'Change load direction' : 'Set load direction';
  el('load-set').classList.toggle('active', loadPlacing);
  el('load-clear').hidden = !has || loadPlacing;
  el('load-hint').hidden = !loadPlacing;
}

/** Upload a triangle list into the scene, or null if there is nothing to show. */
function meshFrom(tris, material) {
  if (!tris.length) return null;
  const arr = new Float32Array(tris.length * 3);
  for (let i = 0; i < tris.length; i++) {
    arr[i * 3] = tris[i][0];
    arr[i * 3 + 1] = tris[i][1];
    arr[i * 3 + 2] = tris[i][2];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, material);
  scene.add(m);
  return m;
}

/**
 * Regenerate the fins for the current orientation. Fins live in PRINT space
 * (already rotated and seated), not in the part's local frame, so they are added
 * to the scene rather than parented to the part.
 */
function refreshFins() {
  for (const m of [finMesh, padMesh]) {
    if (m) { scene.remove(m); m.geometry.dispose(); }
  }
  finMesh = padMesh = null;
  finTris = padTris = [];
  if (!finsVisible || !lastResult || !topology) {
    clearPreview();
    rebuildDrawn();
    updateReadout(null);
    return;
  }

  const t0 = performance.now();
  // buildFins runs in BOTH modes. In Suggest it places the walls; in Draw it is
  // called only for the bed pad + seating verdict -- a tilted part rests on an
  // edge and needs a pad however its walls are placed, and that logic lives in
  // fins.js, so it is reused rather than duplicated. Draw simply ignores the
  // walls buildFins suggests and shows the hand-drawn ones instead.
  const built = buildFins(topology, lastResult, rotM3.elements,
                          { mode: finMode === 'draw' ? 'prop' : finMode,
                            bedPad: el('bed-pad').checked });
  lastBuilt = built;
  padTris = built.padTriangles;
  padMesh = meshFrom(padTris, padMaterial);

  if (finMode === 'draw') {
    rebuildDrawn();
  } else {
    clearPreview();
    finTris = built.triangles;
    finMesh = meshFrom(finTris, finMaterial);
    // In Suggest, also (re)build any hand-drawn walls layered on top. rebuildDrawn
    // self-gates on drawShown(), so it clears them when none apply.
    rebuildDrawn();
  }
  updateReadout(built, performance.now() - t0);
  updateFit();
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
  el('s-fins').textContent = 'recalculating…';
}

// PLA, the common default. Grams are labelled with the material so the number
// is honest rather than pretending to be machine truth.
const PLA_DENSITY_G_CM3 = 1.24;

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
  const grams = meshVolumeMM3(added) * PLA_DENSITY_G_CM3 / 1000;
  el('r-grams').textContent = `${fmtGrams(grams)} g`;
  box.hidden = false;
}

/** Route the readout to the active mode. */
function updateReadout(built, ms) {
  if (finMode === 'draw') updateDrawReadout(built, ms);
  else updateFinReadout(built, ms);
  updateReceipt();
}

/**
 * Draw mode's readout. Reports the walls the USER placed, plus the pad/seating
 * verdict from buildFins. When a drawn line can't become a wall it says WHY --
 * silence-as-success is the exact bug M5's scoreboard was built on.
 */
function updateDrawReadout(built, ms) {
  finMaterial.transparent = padMaterial.transparent = drawMaterial.transparent = false;
  finMaterial.opacity = padMaterial.opacity = drawMaterial.opacity = 1;
  const box = el('s-fins');
  const note = el('s-fin-note');
  el('s-pad').textContent = built?.pad ? 'added' : built ? 'not needed' : '—';

  const ok = drawnWalls.filter((w) => w.ok);
  const bad = drawnWalls.length - ok.length;
  box.textContent = ok.length ? `${ok.length} wall${ok.length === 1 ? '' : 's'} · drawn` : 'none yet';
  box.classList.toggle('warn', ok.length === 0);

  const bits = [];
  if (!drawnWalls.length && !drawMsg) {
    bits.push('click two points under an overhang to lay a breakaway wall along that line');
  }
  if (ok.length) {
    bits.push(ok.map((w) => `${w.info.height.toFixed(0)}mm tall × ${w.info.length.toFixed(0)}mm`).join(' · '));
    bits.push('breakaway: each stops 0.2mm under the part, so it snaps off rather than needing to be cut');
  }
  if (bad) {
    const one = drawnWalls.find((w) => !w.ok);
    bits.push(`${bad} drawn wall${bad === 1 ? '' : 's'} no longer reach${bad === 1 ? 'es' : ''} the part in this orientation${one?.info?.reason ? ` (${one.info.reason})` : ''} — undo, or rotate back`);
  }
  if (drawMsg) bits.push(drawMsg);
  if (built?.seating?.kind === 'point') {
    bits.push(built.pad
      ? 'this part balances on a single point — the bed pad is what seats it, so print with the pad on'
      : 'this part balances on a single point — turn the bed pad on to seat it, or rotate until it sits down');
  }
  note.textContent = bits.length ? bits.join('. ') + '.' : '';
  if (ms != null) el('s-time').textContent = `${analysisTiming} · pad ${ms.toFixed(0)} ms`;
}

function updateFinReadout(built, ms) {
  finMaterial.transparent = padMaterial.transparent = false;
  finMaterial.opacity = padMaterial.opacity = 1;
  const box = el('s-fins');
  const note = el('s-fin-note');
  if (!built) {
    box.textContent = '—';
    box.classList.remove('warn');
    el('s-pad').textContent = '—';
    note.textContent = '';
    return;
  }
  el('s-pad').textContent = built.pad ? 'added' : 'not needed';
  const n = built.fins.length;
  const kind = built.mode === 'prop' ? 'prop' : 'fin';
  // Hand-added walls (Suggest + Draw mix) count toward the tally too.
  const drawnOk = drawShown() ? drawnWalls.filter((w) => w.ok).length : 0;
  const autoTxt = n
    ? `${n} ${kind}${n === 1 ? '' : 's'}` + (built.mode === 'prop' ? '' : ` · ${built.tines} tines`)
    : '';
  const drawnTxt = drawnOk ? `${autoTxt ? ' + ' : ''}${drawnOk} drawn` : '';
  box.textContent = (autoTxt + drawnTxt) || 'none possible';
  box.classList.toggle('warn', n === 0 && !drawnOk);

  const bits = [];
  if (!n && !drawnOk) {
    bits.push(explainNoFins(built));
  } else if (n) {
    bits.push(built.fins
      .map((f) => `${f.height.toFixed(0)}mm tall × ${f.length.toFixed(0)}mm`)
      .join(' · '));
    if (built.mode === 'prop') {
      bits.push('breakaway: each stops 0.2mm under the part, so it snaps off '
              + 'rather than needing to be cut');
    }
  }
  if (drawnOk) {
    bits.push(`plus ${drawnOk} wall${drawnOk === 1 ? '' : 's'} you added by hand`);
  }
  // Hand-placement feedback has to surface here too (Suggest + Draw mix), or a
  // rejected wall fails silently -- the same silence-as-success trap as M5.
  if (drawShown()) {
    const bad = drawnWalls.length - drawnOk;
    if (bad) {
      const one = drawnWalls.find((w) => !w.ok);
      bits.push(`${bad} drawn wall${bad === 1 ? '' : 's'} couldn’t attach here`
              + (one?.info?.reason ? ` (${one.info.reason})` : ''));
    }
    if (drawMsg) bits.push(drawMsg);
  }
  // Worth saying even when something WAS placed: a point-balanced part is
  // standing on the added pad and nothing else, so the pad is load-bearing,
  // not cosmetic.
  if (n && built.seating?.kind === 'point') {
    bits.push(built.pad
      ? 'this part balances on a single point — the bed pad is what seats it, '
        + 'so print with the pad on'
      : 'this part is balanced on a single point of contact — whatever is '
        + 'placed here is holding up a part that has nothing to stand on. '
        + 'Rotate until it sits down');
  }
  if (built.unserved) {
    bits.push(`${built.unserved} overhang region${built.unserved === 1 ? '' : 's'} ` +
              'still unsupported — rotate further, or use “+ Add walls by hand” to place them here');
  }
  note.textContent = bits.join('. ') + '.';
  // ms is absent when a hand-drawn wall (Suggest + Draw mix) re-runs the readout
  // without rebuilding the auto fins -- don't touch the timing line then, and
  // never throw, or the updateReceipt() call after this one never happens.
  if (ms != null) el('s-time').textContent = `${analysisTiming} · fins ${ms.toFixed(0)} ms`;
}

/** Show the Draw controls (hint + Undo/Clear) only while Draw is the live mode. */
function syncDrawControls() {
  el('draw-controls').hidden = !drawShown();
}

/** The "+ Add walls by hand" toggle, shown only in Suggest mode. */
function syncAugmentUI() {
  const show = finsVisible && finMode === 'prop';
  el('augment-toggle').hidden = !show;
  el('augment-toggle').classList.toggle('primary', drawAugment);
  el('augment-toggle').textContent = drawAugment ? 'Done adding walls' : '+ Add walls by hand';
}

el('fin-mode').addEventListener('change', (e) => {
  histPush();
  finMode = e.target.value;
  drawAugment = false;      // start each mode with hand-placement off
  drawMsg = '';
  clearPreview();
  syncAugmentUI();
  syncDrawControls();
  setGizmo();
  refreshFins();
});
el('bed-pad').addEventListener('change', refreshFins);

/** The fins-toggle button's appearance for the current finsVisible. Factored out
 *  so undo/redo can re-sync it after restoring the flag. */
function syncFinsToggleUI() {
  el('fins-toggle').classList.toggle('primary', finsVisible);
  el('fins-toggle').textContent = finsVisible ? 'Fins on' : 'Add fins';
  el('fin-opts').hidden = !finsVisible;
}

el('fins-toggle').addEventListener('click', () => {
  histPush();
  finsVisible = !finsVisible;
  if (!finsVisible) drawAugment = false;
  syncFinsToggleUI();
  drawMsg = '';
  clearPreview();
  syncAugmentUI();
  syncDrawControls();
  setGizmo();
  refreshFins();
});

el('augment-toggle').addEventListener('click', () => {
  drawAugment = !drawAugment;
  drawMsg = '';
  clearPreview();
  syncAugmentUI();
  syncDrawControls();
  setGizmo();
  refreshFins();
});

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

/**
 * Export the part AS ORIENTED, seated on the plate, with the fins as extra
 * solids in the same file. The whole promise of the tool is that the STL prints
 * the same way for whoever opens it, so the orientation has to be baked in --
 * exporting the original frame and hoping the user re-rotates defeats the point.
 */
/**
 * The part geometry AS ORIENTED and seated on the plate, plus the fins, kept in
 * two separate lists. STL flattens them into one solid; 3MF keeps them distinct.
 * Returns null when there is nothing to export.
 */
function buildExportGeometry() {
  if (!part || !topology || !lastResult) return null;
  const rot = rotM3.elements;
  const dz = lastResult.offset.z;
  const dx = lastResult.offset.x, dy = lastResult.offset.y;
  const { pos, nFaces } = topology;

  const partTris = new Array(nFaces * 3);
  for (let f = 0; f < nFaces; f++) {
    for (let i = 0; i < 3; i++) {
      const o = f * 9 + i * 3;
      const x = pos[o], y = pos[o + 1], z = pos[o + 2];
      partTris[f * 3 + i] = [
        rot[0] * x + rot[3] * y + rot[6] * z + dx,
        rot[1] * x + rot[4] * y + rot[7] * z + dy,
        rot[2] * x + rot[5] * y + rot[8] * z + dz,
      ];
    }
  }
  // whichever walls the live mode contributes -- hand-drawn in Draw, suggested
  // in Suggest -- plus the pad, all already in print space
  const finTris = [...activeAdded()];
  const base = partName.replace(/\.stl$/i, '') || 'part';
  return { partTris, finTris, base };
}

/**
 * Export the part AS ORIENTED, seated on the plate, with the fins as extra
 * solids in the same file. The whole promise of the tool is that the file prints
 * the same way for whoever opens it, so the orientation has to be baked in --
 * exporting the original frame and hoping the user re-rotates defeats the point.
 */
el('export').addEventListener('click', () => {
  const g = buildExportGeometry();
  if (!g) return;
  download(writeBinarySTL([...g.partTris, ...g.finTris], g.base), `${g.base}-fins.stl`);
});

// 3MF keeps the fins as a separate object and states millimeters, so the file
// opens correctly oriented and support-free in Bambu Studio, OrcaSlicer, or
// PrusaSlicer without a re-scale or a re-rotate.
el('export-3mf').addEventListener('click', () => {
  const g = buildExportGeometry();
  if (!g) return;
  download(writeThreeMF(g.partTris, g.finTris, g.base), `${g.base}-fins.3mf`);
});

// ------------------------------------------------------------- undo / redo
// A whole-state snapshot stack, not a command log. The undoable state is small
// -- orientation plus the hand-drawn walls -- and restoring it re-runs the same
// shade + refreshFins the rest of the app already uses, so there is no separate
// inverse-operation path to keep correct. Every mutation calls histPush() first;
// undo/redo swap snapshots between the two stacks.
let undoStack = [];
let redoStack = [];

function snapshot() {
  const q = part.quaternion;
  return {
    quat: [q.x, q.y, q.z, q.w],
    walls: drawnWalls.map((w) => ({ a: w.a.clone(), b: w.b.clone() })),
    load: loadDir ? loadDir.clone() : null,
    finMode, finsVisible, drawAugment,
  };
}

/** Capture state BEFORE a mutation. A fresh action invalidates the redo stack. */
function histPush() {
  if (!part) return;
  undoStack.push(snapshot());
  if (undoStack.length > 100) undoStack.shift();
  redoStack.length = 0;
  syncHistButtons();
}

function restoreState(s) {
  part.quaternion.set(s.quat[0], s.quat[1], s.quat[2], s.quat[3]);
  drawnWalls = s.walls.map((w) => ({ a: w.a.clone(), b: w.b.clone(), ok: false, info: null }));
  loadDir = s.load ? s.load.clone() : null;
  loadPlacing = false;
  loadDragStart = null;
  controls.enabled = true;
  updateLoadArrowMesh();
  syncLoadUI();
  finMode = s.finMode;
  finsVisible = s.finsVisible;
  drawAugment = s.drawAugment ?? false;
  drawStart = null;
  clearPreview();
  // Re-sync every control that mirrors the restored state, then rebuild the
  // scene the same way a normal edit would.
  el('fin-mode').value = finMode;
  syncFinsToggleUI();
  syncAugmentUI();
  syncDrawControls();
  setGizmo();
  el('rot-delta').textContent = '';
  el('suggest-list').hidden = true;
  el('suggest-note').textContent = '';
  shade();
  refreshFins();
  syncHistButtons();
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(snapshot());
  restoreState(undoStack.pop());
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshot());
  restoreState(redoStack.pop());
}

function syncHistButtons() {
  el('undo').disabled = !undoStack.length;
  el('redo').disabled = !redoStack.length;
}

el('undo').addEventListener('click', undo);
el('redo').addEventListener('click', redo);

// Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z (or Ctrl+Y) redoes. Ignored while typing
// in a field so it never eats a text-edit undo.
addEventListener('keydown', (e) => {
  if (!part) return;
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
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
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
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
  // Setting the load direction: drag across the part. Face-lay hover is off; the
  // cursor tracks the surface and, once a drag has started, a band shows the
  // direction so far.
  if (loadActive()) {
    hoverFace.visible = false;
    const hit = pickFace(ev);
    if (hit) {
      previewLoadDrag(hit.point);
      renderer.domElement.style.cursor = 'crosshair';
    } else {
      drawCursor.visible = drawBand.visible = false;
      renderer.domElement.style.cursor = '';
    }
    return;
  }
  // Draw mode: the pointer places wall endpoints, so face-lay hover is off and
  // the cursor / band / ghost track the surface instead.
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
  // don't compete with the gizmo: if a handle is hovered or held, it wins
  if (!part || gizmo.dragging || gizmo.axis || pressAt) {
    hoverFace.visible = false;
    return;
  }
  const hit = pickFace(ev);
  hoverFace.visible = !!hit;
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
});

renderer.domElement.addEventListener('pointerdown', (e) => {
  pressAt = { x: e.clientX, y: e.clientY };
  // Load mode: the press begins a direction drag at the surface point under it.
  if (loadActive()) {
    const hit = pickFace(e);
    loadDragStart = hit ? hit.point.clone() : null;
    if (hit) previewLoadDrag(hit.point);
  }
});

renderer.domElement.addEventListener('pointerup', (e) => {
  const from = pressAt;
  pressAt = null;
  if (!from || !part || !topology) return;

  // Load mode: the release ends the direction drag. This is a DRAG by design, so
  // it must be handled before the "a drag is an orbit" bail below.
  if (loadActive()) {
    const hit = pickFace(e);
    if (loadDragStart && hit) commitLoadDrag(hit.point);
    else cancelLoadDrag();
    return;
  }

  // a drag is an orbit, not a pick
  if (Math.hypot(e.clientX - from.x, e.clientY - from.y) > 4) return;

  // Draw mode: first click sets the start of a wall, second click commits it.
  if (drawActive()) {
    const hit = pickFace(e);
    if (!hit) return;
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

  const hit = pickFace(e);
  if (!hit) return;

  // A face-click re-lays the part flat, which silently discards a careful
  // rotation -- the papercut that motivated undo. Snapshot before doing it so
  // Ctrl-Z brings the old pose back.
  histPush();
  // Use OUR winding-derived normal, not the STL's stored one, for the same
  // reason the analysis does: exported normals are not trustworthy.
  const i = hit.faceIndex * 3;
  faceNormal.set(topology.nrm[i], topology.nrm[i + 1], topology.nrm[i + 2])
            .applyQuaternion(part.quaternion);
  layQuat.setFromUnitVectors(faceNormal, DOWN);
  part.quaternion.premultiply(layQuat);
  shade();
});

// Cancel a wall-in-progress: Escape, or a right-click in the viewport.
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (loadActive()) { cancelLoadPlacement(); return; }
  if (drawActive() && drawStart) {
    clearPreview();
    updateReadout(lastBuilt);
  }
});
renderer.domElement.addEventListener('contextmenu', (e) => {
  if (loadActive()) { e.preventDefault(); cancelLoadPlacement(); return; }
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
  el('suggest-list').hidden = true;   // a manual turn invalidates the ranking's "active" mark
  el('suggest-note').textContent = '';
  shade();
});

// -------------------------------------------------------- suggest orientation

const _sm4 = new THREE.Matrix4();
let suggestions = [];

/** Turn the part to a suggested pose. `rot` is a column-major 3x3. */
function applySuggestion(rot) {
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

const CONF_TEXT = {
  high: 'clear best pose', medium: 'a good pose, close alternatives',
  low: 'several poses are similar — your call', none: '',
};

function renderSuggestions() {
  const list = el('suggest-list');
  list.replaceChildren();
  suggestions.forEach((c, i) => {
    const row = document.createElement('button');
    row.className = 'btn suggest-row';
    const point = c.seating === 'point';
    const fins = c.walls === 0 ? 'no fins' : `${c.walls} fin${c.walls === 1 ? '' : 's'}`;
    const overs = c.regions === 0 ? 'no overhangs'
      : `${c.regions} overhang${c.regions === 1 ? '' : 's'} → ${fins}`;
    row.innerHTML =
      `<span class="sr-rank">${i === 0 ? 'Best' : `#${i + 1}`}</span>` +
      `<span class="sr-main">${c.height.toFixed(0)} mm tall · ${c.bedArea.toFixed(0)} mm² on the bed</span>` +
      `<span class="sr-sub">${overs}${point ? ' · balances on a point — can’t print this way' : ''}</span>`;
    if (point) row.classList.add('bad');
    row.addEventListener('click', () => {
      applySuggestion(c.rot);
      for (const r of list.children) r.classList.remove('active');
      row.classList.add('active');
    });
    list.append(row);
  });
  list.hidden = false;
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
      if (!candidates.length || confidence === 'none') {
        el('suggest-list').hidden = true;
        el('suggest-note').textContent = confidence === 'none'
          ? 'No printable orientation — this part balances on a point at every angle.'
          : 'Nothing to suggest for this part.';
      } else {
        el('suggest-note').textContent = `Best guess — ${CONF_TEXT[confidence]}. Click one to turn the part.`;
        renderSuggestions();
      }
    } finally {
      btn.disabled = false; btn.textContent = 'Suggest orientation';
    }
  }));
});

// --------------------------------------------------------------- load arrow

el('show-layers').addEventListener('change', (e) => {
  layersOn = e.target.checked;
  layerViz.visible = layersOn && !!part;
});

el('load-set').addEventListener('click', () => {
  if (loadPlacing) cancelLoadPlacement();
  else beginLoadPlacement();
});
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

let threshold = DEFAULT_THRESHOLD;
const thrInput = el('thr');
thrInput.value = String(threshold);
thrInput.addEventListener('input', () => {
  threshold = Number(thrInput.value);
  el('thr-val').textContent = `${threshold}°`;
  computeFlatBaseline();   // the flat baseline moves with the overhang threshold
  shade();
});

const volumeSelect = el('volume');
const customRow = el('custom-vol');
const customInputs = ['vx', 'vy', 'vz'].map(el);

for (const v of VOLUMES) volumeSelect.add(new Option(volLabel(v), volLabel(v)));
volumeSelect.add(new Option('Custom…', 'custom'));

let volume = { ...DEFAULT_VOLUME };
try {
  const saved = JSON.parse(localStorage.getItem(VOLUME_STORE) || 'null');
  if (saved && saved.x > 0 && saved.y > 0 && saved.z > 0) volume = saved;
} catch { /* corrupt or unavailable storage is not worth failing over */ }

const isPreset = (v) => VOLUMES.some((p) => volLabel(p) === volLabel(v));
volumeSelect.value = isPreset(volume) ? volLabel(volume) : 'custom';
customInputs.forEach((inp, i) => { inp.value = String([volume.x, volume.y, volume.z][i]); });

const currentVolume = () => volume;

function applyVolume() {
  customRow.hidden = volumeSelect.value !== 'custom';
  buildPlate(volume.x, volume.y, volume.z);
  try {
    localStorage.setItem(VOLUME_STORE, JSON.stringify(volume));
  } catch { /* private mode; the app still works, it just forgets */ }
  if (part) shade();
}

volumeSelect.addEventListener('change', () => {
  if (volumeSelect.value !== 'custom') {
    volume = VOLUMES.find((v) => volLabel(v) === volumeSelect.value) ?? volume;
    customInputs.forEach((inp, i) => {
      inp.value = String([volume.x, volume.y, volume.z][i]);
    });
  }
  applyVolume();
});

for (const inp of customInputs) {
  inp.addEventListener('input', () => {
    const [x, y, z] = customInputs.map((n) => Number(n.value));
    if (x > 0 && y > 0 && z > 0) { volume = { x, y, z }; applyVolume(); }
  });
}

// ------------------------------------------------------------------- file I/O

const loader = new STLLoader();

function loadFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      setPart(loader.parse(reader.result), file.name);
    } catch (err) {
      console.error(err);
      alert(`Could not read ${file.name}:\n${err.message}`);
    }
  };
  reader.readAsArrayBuffer(file);
}

el('file').addEventListener('change', (e) => loadFile(e.target.files[0]));

/** Load an STL that is already on the web (the sample model, a demo link). */
async function loadURL(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  setPart(loader.parse(await res.arrayBuffer()), url.split('/').pop());
  // Drop ?stl= once it has been consumed: the path is nobody's business but the
  // user's, and a stale one in the address bar is misleading after they open a
  // different file.
  history.replaceState(null, '', location.pathname);
}

const drop = el('drop');
let dragDepth = 0;
addEventListener('dragenter', (e) => {
  e.preventDefault();
  if (dragDepth++ === 0) drop.classList.remove('hidden'), drop.classList.add('armed');
});
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('dragleave', () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    drop.classList.remove('armed');
    if (part) drop.classList.add('hidden');
  }
});
addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  drop.classList.remove('armed');
  if (part) drop.classList.add('hidden');
  loadFile(e.dataTransfer.files[0]);
});

// ----------------------------------------------------------------- main loop

function resize() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  renderer.setSize(w, h);          // must update CSS size too, or a 2x DPR
  camera.aspect = w / h;           // canvas lays out at 2x and we see a quadrant
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

const fpsEl = el('fps');
let frames = 0, last = performance.now();

function tick(now) {
  requestAnimationFrame(tick);
  controls.update();
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
window.__sf = { get part() { return part; }, get topo() { return topology; },
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
