/**
 * The three.js stage every other UI module draws into: renderer, camera, orbit
 * controls, lights, the build plate, and the helpers that put a triangle list on
 * screen or aim the camera at the part.
 *
 * COORDINATES: Z up, millimetres, bed plane at z = 0 (see app.js).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { el } from './dom.js';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

// ---------------------------------------------------------------- scene setup

export const viewport = el('viewport');
export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
// Label the canvas: a screen reader otherwise announces a bare "canvas". The 3D
// itself isn't reachable non-visually, but the live stats panel carries the same
// state as text, so this points there.
renderer.domElement.setAttribute('role', 'img');
renderer.domElement.setAttribute(
  'aria-label', 'Interactive 3D preview of the loaded part. Orientation and support '
  + 'stats are reported as text in the panel on the left.');
viewport.appendChild(renderer.domElement);

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14161a);

export const camera = new THREE.PerspectiveCamera(45, 1, 1, 5000);
camera.up.set(0, 0, 1);

export const controls = new OrbitControls(camera, renderer.domElement);
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

export const plate = new THREE.Group();
scene.add(plate);

/** Grid + volume wireframe for a bed `sx` x `sy` mm and `sz` mm of headroom. */
export function buildPlate(sx, sy, sz) {
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

/** Point the camera at the part, backed off far enough to see all of it. */
export function frame(size) {
  const reach = Math.max(size.x, size.y, size.z, 40);
  const dist = reach * 2.1;
  camera.position.set(dist * 0.62, -dist * 0.72, dist * 0.55);
  camera.near = Math.max(0.5, reach / 200);
  camera.far = dist * 12;
  camera.updateProjectionMatrix();
  controls.target.set(0, 0, size.z / 2);
  controls.update();
}

/** Upload a triangle list into the scene, or null if there is nothing to show. */
export function meshFrom(tris, material) {
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

// Shared by every pointer pick (part faces, fins, hand-placed supports).
export const raycaster = new THREE.Raycaster();
export const pointer = new THREE.Vector2();

export function resize() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  renderer.setSize(w, h);          // must update CSS size too, or a 2x DPR
  camera.aspect = w / h;           // canvas lays out at 2x and we see a quadrant
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
