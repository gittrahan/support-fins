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
import { buildFins } from './fins.js';
import { findWallPatches } from './planes.js';
import { writeBinarySTL, download } from './stl.js';

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

// The user rotates. Always. Auto-orientation may suggest, never apply -- the
// spike's strength-optimal pose for one hub was 155mm tall balanced on a needle:
// geometrically valid, unprintable.
const gizmo = new TransformControls(camera, renderer.domElement);
gizmo.setMode('rotate');
gizmo.setSize(0.85);
scene.add(gizmo.getHelper ? gizmo.getHelper() : gizmo);
gizmo.addEventListener('dragging-changed', (e) => {
  controls.enabled = !e.value;
  if (!e.value) el('rot-delta').textContent = '';
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

  partName = filename;
  part.quaternion.identity();
  gizmo.attach(part);
  el('orient').hidden = false;

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
  el('s-time').textContent =
    `${ms.toFixed(0)} ms · weld ${weldMs.toFixed(0)} ms`;

  lastResult = res;
  if (finsVisible) refreshFins();

  // where the part currently sits, the way a slicer states it
  const [ex, ey, ez] = readableEuler(part.quaternion);
  el('rot-now').textContent = `X ${ex}° · Y ${ey}° · Z ${ez}°`;
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

  const v = currentVolume();
  const over = size.x > v.x || size.y > v.y || size.z > v.z;
  const fit = el('s-fit');
  fit.textContent = over ? 'does not fit' : 'fits';
  fit.classList.toggle('warn', over);

  el('stats').hidden = false;
  el('drop').classList.add('hidden');
}

// ------------------------------------------------------------------- printers

// ----------------------------------------------------------------------- fins

let lastResult = null;
let finsVisible = false;
let finMode = 'stabilize';
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
  if (!finsVisible || !lastResult || !topology) { updateFinReadout(null); return; }

  const t0 = performance.now();
  const built = buildFins(topology, lastResult, rotM3.elements,
                          { mode: finMode, bedPad: el('bed-pad').checked });
  finTris = built.triangles;
  padTris = built.padTriangles;

  finMesh = meshFrom(finTris, finMaterial);
  padMesh = meshFrom(padTris, padMaterial);
  updateFinReadout(built, performance.now() - t0);
}

/**
 * Stabilize mode does NOT claim to serve every overhang -- it claims to keep a
 * tilted part standing. So the readout reports the fins AND what is still red,
 * rather than implying the red went away. Overstating this is how a tool loses
 * someone on their first print.
 */
function updateFinReadout(built, ms) {
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
  box.textContent = n
    ? `${n} fin${n === 1 ? '' : 's'} · ${built.tines} tines`
    : 'none possible';
  box.classList.toggle('warn', n === 0);

  const bits = [];
  if (!n) {
    bits.push(built.patchCount
      ? 'no flat vertical face is tall enough to stand a fin against'
      : 'this part has no flat vertical faces — rotate it, or wait for Draw mode');
  } else {
    bits.push(built.fins
      .map((f) => `${f.height.toFixed(0)}mm tall × ${f.length.toFixed(0)}mm`)
      .join(' · '));
  }
  if (built.unserved) {
    bits.push(`${built.unserved} overhang region${built.unserved === 1 ? '' : 's'} ` +
              'still unsupported — rotate further, or fin them by hand (M5)');
  }
  note.textContent = bits.join('. ') + '.';
  el('s-time').textContent += ` · fins ${ms.toFixed(0)} ms`;
}

el('fin-mode').addEventListener('change', (e) => {
  finMode = e.target.value;
  refreshFins();
});
el('bed-pad').addEventListener('change', refreshFins);

el('fins-toggle').addEventListener('click', () => {
  finsVisible = !finsVisible;
  el('fins-toggle').classList.toggle('primary', finsVisible);
  el('fins-toggle').textContent = finsVisible ? 'Fins on' : 'Add fins';
  el('fin-opts').hidden = !finsVisible;
  refreshFins();
});

/**
 * Export the part AS ORIENTED, seated on the plate, with the fins as extra
 * solids in the same file. The whole promise of the tool is that the STL prints
 * the same way for whoever opens it, so the orientation has to be baked in --
 * exporting the original frame and hoping the user re-rotates defeats the point.
 */
el('export').addEventListener('click', () => {
  if (!part || !topology || !lastResult) return;
  const rot = rotM3.elements;
  const dz = lastResult.offset.z;
  const dx = lastResult.offset.x, dy = lastResult.offset.y;
  const { pos, nFaces } = topology;

  const tris = new Array(nFaces * 3);
  for (let f = 0; f < nFaces; f++) {
    for (let i = 0; i < 3; i++) {
      const o = f * 9 + i * 3;
      const x = pos[o], y = pos[o + 1], z = pos[o + 2];
      tris[f * 3 + i] = [
        rot[0] * x + rot[3] * y + rot[6] * z + dx,
        rot[1] * x + rot[4] * y + rot[7] * z + dy,
        rot[2] * x + rot[5] * y + rot[8] * z + dz,
      ];
    }
  }
  for (const t of finTris) tris.push(t);
  for (const t of padTris) tris.push(t);

  const base = partName.replace(/\.stl$/i, '') || 'part';
  download(writeBinarySTL(tris, base), `${base}-fins.stl`);
});

// ---------------------------------------------------------------- orientation

/** Rotate 90 degrees about a world axis, keeping the part seated. */
function rotate90(name, axis) {
  if (!part) return;
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
});

renderer.domElement.addEventListener('pointerup', (e) => {
  const from = pressAt;
  pressAt = null;
  if (!from || !part || !topology || gizmo.dragging || gizmo.axis) return;
  // a drag is an orbit, not a pick
  if (Math.hypot(e.clientX - from.x, e.clientY - from.y) > 4) return;

  const hit = pickFace(e);
  if (!hit) return;

  // Use OUR winding-derived normal, not the STL's stored one, for the same
  // reason the analysis does: exported normals are not trustworthy.
  const i = hit.faceIndex * 3;
  faceNormal.set(topology.nrm[i], topology.nrm[i + 1], topology.nrm[i + 2])
            .applyQuaternion(part.quaternion);
  layQuat.setFromUnitVectors(faceNormal, DOWN);
  part.quaternion.premultiply(layQuat);
  shade();
});

const AXES = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0),
               z: new THREE.Vector3(0, 0, 1) };
for (const a of ['x', 'y', 'z']) {
  el(`rot-${a}`).addEventListener('click', () => rotate90(a, AXES[a]));
}
el('rot-reset').addEventListener('click', () => {
  if (!part) return;
  part.quaternion.identity();
  el('rot-delta').textContent = '';
  shade();
});

let threshold = DEFAULT_THRESHOLD;
const thrInput = el('thr');
thrInput.value = String(threshold);
thrInput.addEventListener('input', () => {
  threshold = Number(thrInput.value);
  el('thr-val').textContent = `${threshold}°`;
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
                buildFins, findWallPatches };

const wanted = new URLSearchParams(location.search).get('stl');
if (wanted) loadURL(wanted).catch((err) => console.error('?stl=', err));
