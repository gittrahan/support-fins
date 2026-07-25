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
import { buildTopology, analyze, DEFAULT_THRESHOLD } from './overhangs.js';

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
let topology = null;      // welded adjacency, rebuilt only when the mesh changes
let weldMs = 0;

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
  geometry.translate(
    -(bb.min.x + bb.max.x) / 2,
    -(bb.min.y + bb.max.y) / 2,
    -bb.min.z);
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  geometry.computeBoundingBox();

  part = new THREE.Mesh(geometry, partMaterial);
  scene.add(part);

  const nFaces = geometry.getAttribute('position').count / 3;
  geometry.setAttribute(
    'color', new THREE.Float32BufferAttribute(new Float32Array(nFaces * 9), 3));

  const tWeld = performance.now();
  topology = buildTopology(geometry);
  weldMs = performance.now() - tWeld;

  const size = geometry.boundingBox.getSize(new THREE.Vector3());
  report(filename, geometry, size);
  shade();
  frame(size);
  return size;
}

/**
 * Re-run the overhang analysis at the current threshold and paint the result
 * onto the mesh. Cheap enough to call straight from the slider's input event --
 * the expensive weld already happened in setPart().
 */
function shade() {
  if (!part || !topology) return;
  const t0 = performance.now();
  const res = analyze(topology, threshold);
  const ms = performance.now() - t0;

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

function report(filename, geometry, size) {
  const tris = geometry.getAttribute('position').count / 3;
  el('s-name').textContent = filename;
  el('s-tris').textContent = tris.toLocaleString();
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
  if (part) {
    const size = part.geometry.boundingBox.getSize(new THREE.Vector3());
    report(el('s-name').textContent, part.geometry, size);
  }
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
                analyze, get threshold() { return threshold; } };

const wanted = new URLSearchParams(location.search).get('stl');
if (wanted) loadURL(wanted).catch((err) => console.error('?stl=', err));
