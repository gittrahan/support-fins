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
import { buildFins, gripPatches, buildFinOnPatch, PAD } from './fins.js';
import { PROP } from './prop.js';
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

  // A new part starts with no hand-drawn walls or fins and a fresh print-space cache.
  drawnWalls = [];
  drawnFins = [];
  gripCache = null;
  drawAugment = false;
  drawMsg = '';
  printTrisDirty = true;
  clearPreview();
  // A new part starts with no load direction either.
  loadDir = null;
  layPlacing = false;
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
// DEFAULT IS 'auto': click "Add fins" and the tool places the supports for you
// (tined combined fins on the grippable overhangs, plain props on the rest). Draw
// is the by-hand path. ('prop' still exists internally -- Draw calls it for the
// bed pad + seating verdict, and it is the geometry Auto props with.)
let finMode = 'auto';
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
// Grip-first Draw: hand-placed GRIPPING FINS, each pinned to a seed FACE index
// (topology faces are orientation-invariant, so a fin survives re-orientation by
// re-finding its patch). Kept separate from drawnWalls: Draw places fins, the
// Suggest "+ Add" augment still places under-ledge walls -- different geometry.
let drawnFins = [];         // { face: seedFaceIdx, ok, info }
// The grippable faces in the current pose, cached and recomputed only when the
// part turns (findWallPatches is tens of ms on a big part). null = recompute.
let gripCache = null;
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
let layPlacing = false;     // true while "lay a face flat" is armed -- gated behind a
                            // button so a stray viewport click can't re-lay the part
const loadArrowHelper = new THREE.ArrowHelper(
  new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 10, 0xffb454, 4, 2.6);
loadArrowHelper.visible = false;
loadArrowHelper.renderOrder = 12;   // over the part and the draw guides
for (const m of [loadArrowHelper.line, loadArrowHelper.cone]) {
  m.material.depthTest = false;      // a HUD arrow, always visible like the draw guides
  m.material.transparent = true;
  m.renderOrder = 12;
}

/** "Lay a face flat" is armed: a face click lays the part on that face. Off by
 *  default so casual clicks orbit instead of silently re-laying the part. */
const layActive = () => layPlacing;

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
function updateLayerView(size) {
  rebuildLayerViz(size);
  layerViz.visible = layersOn && !!part;
}

// Pointer is in wall-placement mode (draw mode, or Suggest with the add toggle on).
// Gates the draw interaction, the gizmo, and face-lay.
const drawActive = () => finsVisible && (finMode === 'draw' || drawAugment);
// Hand-drawn walls contribute to the display and the export. In Draw mode that's
// always; in Suggest it's whenever the user has drawn any (they persist after the
// add toggle is switched off, so you can orbit and export without losing them).
const drawShown = () =>
  finsVisible && (finMode === 'draw' || (finMode === 'auto' && (drawAugment || drawnWalls.length > 0)));

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
/** The grippable faces in the current pose, computed once per orientation. */
function getGrip() {
  if (!gripCache && topology && lastResult) {
    gripCache = gripPatches(topology, lastResult, rotM3.elements);
  }
  return gripCache;
}

function rebuildDrawn() {
  if (drawnMesh) { scene.remove(drawnMesh); drawnMesh.geometry.dispose(); drawnMesh = null; }
  drawnTris = [];
  if (!drawShown() || !topology || !lastResult) return;
  part.updateMatrixWorld();

  if (finMode === 'draw') {
    // Grip-first Draw: each hand-placed fin is pinned to a seed face, so re-find
    // that face's patch in the CURRENT pose and rebuild the fin against it. A fin
    // whose face no longer takes one (rotated away) is kept but flagged, the same
    // way a drawn wall that no longer reaches the part is -- never dropped silently.
    const { faceMap } = getGrip() ?? { faceMap: new Map() };
    for (const d of drawnFins) {
      const patch = faceMap.get(d.face);
      if (!patch) {
        d.ok = false;
        d.info = { reason: 'that face no longer takes a fin in this orientation — '
          + 'rotate back, or undo' };
        continue;
      }
      const r = buildFinOnPatch(topology, lastResult, rotM3.elements, patch,
                                { tines: el('tines').checked,
                                  tineDensity: el('tine-density').valueAsNumber / 100 });
      d.ok = r.ok;
      d.info = r.ok ? r.info : r;
      if (r.ok) for (const t of r.triangles) drawnTris.push(t);
    }
  } else {
    // Suggest "+ Add" augment: hand-placed under-ledge breakaway walls.
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
  }
  drawnMesh = meshFrom(drawnTris, drawMaterial);
}

/** The walls + pad the CURRENT mode contributes to the export and the fit check. */
function activeAdded() {
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
 * Draw: stand a support fin against the face the user clicked. The fin is pinned
 * to the seed FACE (not a point), so it survives re-orientation. A face that
 * can't take one says why rather than doing nothing -- and the same patch never
 * gets two fins stacked on it.
 */
function placeFin(faceIndex) {
  const grip = getGrip();
  const patch = grip && grip.faceMap.get(faceIndex);
  if (!patch) {
    drawMsg = 'can’t stand a support fin on that face — aim at an overhang face '
      + '(it lights up green), or tilt the part so this becomes one';
    updateReadout(lastBuilt);
    return;
  }
  if (drawnFins.some((d) => grip.faceMap.get(d.face) === patch)) {
    drawMsg = 'there is already a fin on that face';
    updateReadout(lastBuilt);
    return;
  }
  histPush();
  drawnFins.push({ face: faceIndex, ok: false, info: null });
  drawMsg = '';
  rebuildDrawn();          // builds the fin and sets its ok/info (or a reason)
  updateReadout(lastBuilt);
  updateFit();
}

/** Enable the rotate gizmo only when NOT drawing or laying a face flat --
 *  its handles would otherwise swallow the clicks those modes need. */
function setGizmo() {
  const on = !!part && !drawActive() && !layActive();
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
function syncLoadUI() {
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
           bedPad: el('bed-pad').checked,
           tines: el('tines').checked,
           tineDensity: el('tine-density').valueAsNumber / 100,
           coverage: el('coverage').valueAsNumber / 100 };
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

function refreshFins() {
  // The pose may have changed, so the cached grippable-face map is stale. Drop it;
  // rebuildDrawn (below) recomputes it once, and hover reuses that until the next
  // orientation change. In Draw mode the gizmo is off, so a pose only ever changes
  // through a path that lands here (rotate buttons, Suggest, reset).
  gripCache = null;
  if (!finsVisible || !lastResult || !topology) {
    supersedeBuild();                  // no build wanted now: drop any in-flight one so it can't re-add fins
    clearSpinner();
    for (const m of [finMesh, padMesh]) { if (m) { scene.remove(m); m.geometry.dispose(); } }
    finMesh = padMesh = null;
    finTris = padTris = [];
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
  finTris = padTris = [];
  // Undo the grey markFinsStale applied to the shared materials.
  finMaterial.transparent = padMaterial.transparent = false;
  finMaterial.opacity = padMaterial.opacity = 1;

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
  updateReadout(built, performance.now() - finT0);
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
  el('s-fins').textContent = 'generating supports…';
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
 * Draw mode's readout. Reports the gripping FINS the user placed by hand, plus
 * the pad/seating verdict from buildFins. When a clicked face can't take a fin it
 * says WHY -- silence-as-success is the exact bug M5's scoreboard was built on.
 */
function updateDrawReadout(built, ms) {
  finMaterial.transparent = padMaterial.transparent = drawMaterial.transparent = false;
  finMaterial.opacity = padMaterial.opacity = drawMaterial.opacity = 1;
  const box = el('s-fins');
  el('s-pad').textContent = built?.pad ? 'added' : built ? 'not needed' : '—';

  const ok = drawnFins.filter((d) => d.ok);
  const bad = drawnFins.length - ok.length;
  const tines = ok.reduce((a, d) => a + (d.info?.tines ?? 0), 0);
  box.textContent = ok.length
    ? `${ok.length} support fin${ok.length === 1 ? '' : 's'}` + (tines ? ` · ${tines} tines` : '')
    : 'none yet';
  box.classList.toggle('warn', ok.length === 0);

  const lead = [];
  const help = [];
  if (!drawnFins.length && !drawMsg) {
    lead.push('Click an overhang face (it lights up green where a fin can go) to '
      + 'stand a support fin against it');
  }
  if (ok.length) {
    help.push(tines
      ? 'The tines grab onto the part and bend away when you snap the supports off.'
      : 'Each wall stands a hair off the part (0.2mm) so it pops right off. Turn '
        + 'Tines on if you want it to grip.');
  }
  if (bad) {
    const one = drawnFins.find((d) => !d.ok);
    lead.push(`${bad} fin${bad === 1 ? '' : 's'} couldn’t build this way up`
      + `${one?.info?.reason ? ` (${one.info.reason})` : ''}. Undo, or rotate`);
  }
  if (drawMsg) lead.push(drawMsg);
  if (built?.seating?.kind === 'point') {
    lead.push(built.pad
      ? 'this part balances on one point, so the bed pad is holding it. Print with the pad on'
      : 'this part balances on one point. Turn the bed pad on to seat it, or rotate until it sits down');
  }
  setFinNote(lead, help);
  if (ms != null) el('s-time').textContent = `${analysisTiming} · pad ${ms.toFixed(0)} ms`;
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
  el('s-pad').textContent = built.pad ? 'added' : 'not needed';
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
  box.textContent = (autoTxt + drawnTxt) || 'none possible';
  box.classList.toggle('warn', n === 0 && !drawnOk);

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
  }
  // Worth saying even when something WAS placed: a point-balanced part is
  // standing on the added pad and nothing else, so the pad is load-bearing,
  // not cosmetic. Must-see -> stays visible.
  if (n && built.seating?.kind === 'point') {
    lead.push(built.pad
      ? 'this part balances on one point, so the bed pad is holding it. Print with the pad on'
      : 'this part balances on one point with nothing under it. Turn the bed pad on, or rotate until it sits down');
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
  setFinNote(lead, help);
  // ms is absent when a hand-drawn wall (Suggest + Draw mix) re-runs the readout
  // without rebuilding the auto fins -- don't touch the timing line then, and
  // never throw, or the updateReceipt() call after this one never happens.
  if (ms != null) el('s-time').textContent = `${analysisTiming} · fins ${ms.toFixed(0)} ms`;
}

/** Show the Draw controls (hint + Undo/Clear) only while hand-placement is live,
 *  and word the hint for what the click does: a support fin in Draw, a two-point
 *  wall in the Suggest "+ Add" augment. */
function syncDrawControls() {
  el('draw-controls').hidden = !drawShown();
  el('draw-hint').innerHTML = finMode === 'draw'
    ? 'Click an <strong>overhang face</strong> — it lights up green when a fin can '
      + 'go there — to stand a support fin against it.'
    : 'Click <strong>two points</strong> under an overhang to lay a breakaway wall '
      + 'along that line. <kbd>Esc</kbd> or right-click cancels.';
}

/** The "+ Add walls by hand" toggle, shown only in Suggest mode. */
function syncAugmentUI() {
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
  drawMsg = '';
  clearPreview();
  syncAugmentUI();
  syncDrawControls();
  setGizmo();
  refreshFins();
});
el('bed-pad').addEventListener('change', refreshFins);
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
function syncTineGrip() { el('tinegrip-fld').hidden = !el('tines').checked; }
el('tines').addEventListener('change', () => { syncTineGrip(); refreshFins(); });
el('tine-density').addEventListener('input', () => debouncedRefresh());
el('coverage').addEventListener('input', () => debouncedRefresh());
syncTineGrip();

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
wireGap('pad-grip', PAD, 'grab', 0, 0.3);

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

// Undo/Clear act on whatever the live mode places -- fins in Draw, walls in the
// Suggest "+ Add" augment.
el('draw-undo').addEventListener('click', () => {
  const list = finMode === 'draw' ? drawnFins : drawnWalls;
  if (!list.length) return;
  histPush();
  list.pop();
  drawMsg = '';
  clearPreview();
  rebuildDrawn();
  updateReadout(lastBuilt);
  updateFit();
});
el('draw-clear').addEventListener('click', () => {
  const draw = finMode === 'draw';
  if (!(draw ? drawnFins : drawnWalls).length) return;
  histPush();
  if (draw) drawnFins = []; else drawnWalls = [];
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
    fins: drawnFins.map((d) => d.face),
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
  drawnFins = (s.fins ?? []).map((face) => ({ face, ok: false, info: null }));
  loadDir = s.load ? s.load.clone() : null;
  layPlacing = false;
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
  hideSuggestions();
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
  // Draw a gripping fin: hover a face and it lights up -- green if a fin can grip
  // it, grey if not -- so the user aims at a real site instead of clicking blind.
  if (drawActive() && finMode === 'draw') {
    drawCursor.visible = drawBand.visible = false;
    const hit = pickFace(ev);
    if (!hit) { hoverFace.visible = false; renderer.domElement.style.cursor = ''; return; }
    const grip = getGrip();
    const ok = !!grip && grip.faceMap.has(hit.faceIndex);
    const pos = hoverGeom.getAttribute('position');
    const src = part.geometry.getAttribute('position').array;
    const o = hit.faceIndex * 9;
    for (let i = 0; i < 9; i++) pos.array[i] = src[o + i];
    pos.needsUpdate = true;
    hoverGeom.computeBoundingSphere();
    hoverFace.material.color.setHex(ok ? 0x39d98a : 0x8892a0);
    hoverFace.visible = true;
    renderer.domElement.style.cursor = ok ? 'pointer' : 'not-allowed';
    return;
  }
  // Suggest "+ Add" augment: the pointer places wall endpoints, so face-lay hover
  // is off and the cursor / band / ghost track the surface instead.
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

  // Draw a gripping fin: one click on a face stands a fin against it.
  if (drawActive() && finMode === 'draw') {
    const hit = pickFace(e);
    if (hit) placeFin(hit.faceIndex);
    return;
  }
  // Suggest "+ Add" augment: first click sets the start of a wall, second commits it.
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
  if (layActive()) { cancelLay(); return; }
  if (drawActive() && drawStart) {
    clearPreview();
    updateReadout(lastBuilt);
  }
});
renderer.domElement.addEventListener('contextmenu', (e) => {
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
    const grams = (c.volume ?? 0) * PLA_DENSITY_G_CM3 / 1000;
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
    const badge = verdict ? `<span class="sr-badge">${verdict.badge}</span>` : '';
    // One tight line per pose: rank · height · overhangs→fins · rough holes. Bed
    // area was dropped to fit -- height already stands in for how it sits.
    const tail = point ? ' · can’t print (on a point)' : roughTxt;
    row.innerHTML =
      `<span class="sr-rank">${i === 0 ? 'Best' : `#${i + 1}`}</span>` +
      `<span class="sr-line">${c.height.toFixed(0)} mm · ${overs}${tail}</span>` +
      badge;
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

/** Fold the suggestion results away (the × dismiss, and the reset paths). */
function hideSuggestions() {
  el('suggest-list').hidden = true;
  el('suggest-list').replaceChildren();
  const note = el('suggest-note');
  note.textContent = '';
  note.className = 'hint';
  el('suggest-close').hidden = true;
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
      el('suggest-close').hidden = false;   // there's now something to dismiss
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

el('suggest-close').addEventListener('click', hideSuggestions);

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

// Lay a face flat -- armed behind a button so a stray click can't re-lay the part.
el('lay-face').addEventListener('click', () => {
  if (layPlacing) cancelLay();
  else beginLay();
});

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
