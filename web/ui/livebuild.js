/**
 * LIVE FULL COVERAGE BUILD, on the page: the walls pop in as the Worker places them,
 * a progress bar says how far along it is, and Stop keeps what is shown. The Worker
 * side, and which walls are shown, is fins/progress.js; finbuild.js routes the
 * Worker's messages here. While it runs the page is locked (ui/lock.js) but the
 * view stays free.
 *
 * The walls shown are the first layout's (Auto, then its fill walls in order). The
 * build that lands may be another layout -- a Full build compares up to four -- and
 * replaces them; the bar says "comparing layouts" meanwhile.
 */
import * as THREE from 'three';
import { el } from './dom.js';
import { t } from './i18n.js';
import { scene, clip, requestRender, MODEL } from './scene.js';
import { setLocked } from './lock.js';

const material = new THREE.MeshStandardMaterial({
  color: 0x59d98e, roughness: 0.7, metalness: 0.0, side: THREE.DoubleSide, clippingPlanes: clip,
});

let active = false;
let chunks = [];          // Float32Arrays of xyz, Auto's first, then each fill wall
let mesh = null;
let walls = 0;            // fill walls shown
let redraw = 0;           // a pending requestAnimationFrame
let onStop = null;
let reveal = 0;           // the bar shows only on a build past REVEAL_MS (no flash on a quick one)
const REVEAL_MS = 300;

const LABEL = {
  auto: () => t('Placing walls…'),
  fill: () => t('Full coverage · walls added: {n}', { n: walls }),
  compare: () => t('Comparing layouts…'),
  stop: () => t('Stopping: keeping the walls shown…'),
};

// Some stages post nothing for seconds (Auto's own walls, the Long walls search): after
// IDLE_MS without a message the bar sweeps, so it reads as working, not stuck --
// without a made-up percentage.
const IDLE_MS = 1000;
let idle = 0;
function kick(busy = false) {
  clearTimeout(idle);
  el('live-bar-wrap').classList.toggle('busy', busy);
  if (!busy && active) idle = setTimeout(() => el('live-bar-wrap').classList.add('busy'), IDLE_MS);
}

function setBar(frac, label) {
  el('live-bar').style.width = `${Math.round(frac * 100)}%`;
  el('live-bar-wrap').setAttribute('aria-valuenow', String(Math.round(frac * 100)));
  el('live-label').textContent = label;
}

function draw() {
  redraw = 0;
  if (!active) return;
  if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); mesh = null; }
  const n = chunks.reduce((s, c) => s + c.length, 0);
  if (!n) return;
  const arr = new Float32Array(n);
  let at = 0;
  for (const c of chunks) { arr.set(c, at); at += c.length; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  g.computeVertexNormals();
  mesh = new THREE.Mesh(g, material);
  mesh.layers.enable(MODEL);
  scene.add(mesh);
  requestRender();
}

/** A live build is in flight. */
export const liveActive = () => active;

/** The fill walls on screen: what Stop keeps. */
export const liveWalls = () => walls;

/**
 * A live build starts: the bar shows, the page locks. `stop()` is called when the
 * user presses Stop (finbuild.js ends the Worker and builds what is shown).
 */
export function liveStart(stop) {
  liveEnd();
  active = true;
  onStop = stop;
  chunks = [];
  walls = 0;
  setBar(0, LABEL.auto());
  kick();
  el('live-stop').disabled = false;
  reveal = setTimeout(() => { el('live-build').hidden = false; document.body.classList.add('live-shown'); }, REVEAL_MS);
  setLocked(true);
}

/**
 * One Worker progress message (fins/progress.js). `hideStale()` takes the last
 * build's greyed fins away once the new Auto walls are in to replace them.
 */
export function liveMessage(m, hideStale) {
  if (!active || el('live-stop').disabled) return;    // (stopping: the bar sweeps until it lands)
  kick();
  if (m.type === 'auto') {
    hideStale();
    chunks = [m.tris];
  } else if (m.type === 'wall') {
    chunks.push(m.tris);
    walls++;
  } else if (m.type === 'tick') {
    setBar(m.frac, LABEL[m.phase]());
    return;
  }
  if (!redraw) redraw = requestAnimationFrame(draw);
  el('live-label').textContent = LABEL.fill();
}

/** Stop pressed: the bar says so and stays up until the stopped build lands. */
export function liveStopping() {
  if (!active) return;
  el('live-stop').disabled = true;
  el('live-label').textContent = LABEL.stop();
  kick(true);
}

/** The build landed or was dropped: the walls go (the build's own mesh replaces
 *  them), the bar hides, the page unlocks. */
export function liveEnd() {
  if (redraw) cancelAnimationFrame(redraw);
  redraw = 0;
  if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); mesh = null; requestRender(); }
  chunks = [];
  if (!active) return;
  active = false;
  onStop = null;
  clearTimeout(reveal);
  kick();
  el('live-build').hidden = true;
  document.body.classList.remove('live-shown');
  setLocked(false);
}

el('live-stop').addEventListener('click', () => { if (active && onStop) onStop(); });
