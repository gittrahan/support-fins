import { t } from './i18n.js';
/**
 * The view cube (#350): a little cube above the view toolbar that turns with the
 * camera, as in Fusion and PrusaSlicer. Click a face to look square at that side, an
 * edge for the view halfway between two faces, a corner for the view from that corner
 * (ui/viewpresets.js CUBE_FACES); drag it to orbit, whatever the Mouse preset; Home
 * goes back to the starting angle. Every jump keeps the target and zoom, like the
 * View popover's buttons (ui/camviews.js), which stay as the keyboard and small-
 * screen way in.
 *
 * Plain DOM in CSS 3D, not a second WebGL scene: the labels are text (translated,
 * sharp), and the browser hit-tests the turned faces itself. app.js calls
 * syncViewCube() whenever the camera has moved. Hidden while a toolbar popover (or
 * the ring-drag angle) shows over it, and wherever it would cover the stats card or
 * run under the top bar.
 */
import { Vector3 } from 'three';
import { el } from './dom.js';
import { camera, controls, renderer } from './scene.js';
import { VIEWS, CUBE_FACES, HOME_DIR, cubeCellDir } from './viewpresets.js';
import { glideTo, stopGlide } from './camviews.js';

const S = 64;                       // cube edge, px
const AXES = [['X', '#ff5a5a'], ['Y', '#5ad65a'], ['Z', '#5a8cff']];   // the rotate rings' colours

const root = el('viewcube');
const stage = root.querySelector('.vc-stage');
const cube = root.querySelector('.vc-cube');
const axes = root.querySelector('.vc-axes');
const home = root.querySelector('.vc-home');

const labels = {};
for (const [key, f] of Object.entries(CUBE_FACES)) {
  const face = document.createElement('div');
  face.className = 'vc-face';
  const col = (a) => `${a[0]},${a[1]},${a[2]}`;
  face.style.transform = `matrix3d(${col(f.u)},0,${col(f.v)},0,${col(f.n)},0,`
    + `${col(f.n.map((c) => (c * S) / 2))},1)`;
  for (let row = -1; row <= 1; row++) {
    for (let c = -1; c <= 1; c++) {
      const cell = document.createElement('div');
      cell.className = 'vc-cell';
      cell.dataset.dir = cubeCellDir(key, c, row).join(',');
      if (!c && !row) cell.appendChild(labels[key] = document.createElement('span'));
      face.appendChild(cell);
    }
  }
  cube.appendChild(face);
}
const axisLines = AXES.map(([name, color]) => {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.innerHTML = `<line x1="16" y1="16" stroke="${color}" stroke-width="1.6" stroke-linecap="round"/>`
    + `<text fill="${color}" text-anchor="middle" dominant-baseline="central">${name}</text>`;
  axes.appendChild(g);
  return g;
});

function renderLabels() {
  for (const [key, span] of Object.entries(labels)) span.textContent = t(VIEWS[key].label);
  home.title = t('Home view: front right, from above. Keeps the zoom.');
  home.setAttribute('aria-label', home.title);
}
renderLabels();
window.addEventListener('languagechange', renderLabels);

const right = [0, 0, 0], up = [0, 0, 0], back = [0, 0, 0];
const v = new Vector3();
const basis = (out, x, y, z) => {
  v.set(x, y, z).applyQuaternion(camera.quaternion);
  out[0] = v.x; out[1] = v.y; out[2] = v.z;
};
/** Turn the cube and the axis marker to the camera. */
export function syncViewCube() {
  basis(right, 1, 0, 0); basis(up, 0, 1, 0); basis(back, 0, 0, 1);
  // world -> CSS (x right, y DOWN, z toward the viewer): rows right, -up, back
  const m = [0, 1, 2].map((j) => `${right[j]},${-up[j]},${back[j]},0`).join(',');
  cube.style.transform = `matrix3d(${m},0,0,0,1)`;
  AXES.forEach((_, j) => {
    const x = 16 + right[j] * 10, y = 16 - up[j] * 10;
    const [line, text] = axisLines[j].children;
    line.setAttribute('x2', x);
    line.setAttribute('y2', y);
    text.setAttribute('x', 16 + right[j] * 14.5);
    text.setAttribute('y', 16 - up[j] * 14.5);
    axisLines[j].style.opacity = 0.45 + 0.55 * Math.max(0, back[j] * 0.5 + 0.5);
  });
}
syncViewCube();

// ------------------------------------------------------------ hover, click, drag

let hot = '';
function light(dir) {
  if (dir === hot) return;
  hot = dir;
  for (const c of cube.querySelectorAll('.vc-cell')) c.classList.toggle('hot', !!dir && c.dataset.dir === dir);
}
const cellAt = (e) => e.target.closest?.('.vc-cell');

let press = null;                   // { id, x, y, dragged }
stage.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || press) return;   // one pointer at a time (a second finger)
  press = { id: e.pointerId, x: e.clientX, y: e.clientY, dragged: false };
  stage.setPointerCapture(e.pointerId);
  e.preventDefault();
});
stage.addEventListener('pointermove', (e) => {
  if (!press || e.pointerId !== press.id) { light(cellAt(e)?.dataset.dir ?? ''); return; }
  const dx = e.clientX - press.x, dy = e.clientY - press.y;
  if (!press.dragged && Math.hypot(dx, dy) < 4) return;
  if (!press.dragged) { press.dragged = true; light(''); stage.classList.add('dragging'); stopGlide(); }
  // a tool holding the orbit still (a ring or section drag) holds the cube's too
  if (!controls.enabled || !controls.enableRotate) return;
  // the canvas's own orbit rate (OrbitControls: a full turn per view height)
  const k = (2 * Math.PI * controls.rotateSpeed) / renderer.domElement.clientHeight;
  controls._rotateLeft(k * dx);
  controls._rotateUp(k * dy);
  controls.update();
  press.x = e.clientX;
  press.y = e.clientY;
});
function release(e) {
  if (!press || e.pointerId !== press.id) return;
  const { dragged } = press;
  press = null;
  stage.classList.remove('dragging');
  if (e.type !== 'pointerup' || dragged) return;
  // a capture retargets the up to the stage: find the cell under the pointer
  const cell = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.vc-cell');
  if (cell && cube.contains(cell)) glideTo(cell.dataset.dir.split(',').map(Number));
  light('');                        // the cube turns away under a still pointer
}
stage.addEventListener('pointerup', release);
stage.addEventListener('pointercancel', release);
stage.addEventListener('contextmenu', (e) => e.preventDefault());
stage.addEventListener('pointerleave', () => { if (!press) light(''); });
home.addEventListener('click', () => glideTo(HOME_DIR));

// ------------------------------------------------------------------ room to show

const bar = el('viewbar');
const over = (a, b) => b.width && b.right > a.left && b.left < a.right && b.bottom > a.top && b.top < a.bottom;
const GAP = 12;
/**
 * Room to show: step right past the stats card when it reaches down beside the cube
 * (toolbar.js only parks the bar itself beside the card when the card reaches the
 * bar); hide under an open popover or the top bar, or where it would still cover the
 * card, the settings panel, the plate tabs (at the bottom on a narrow window) or a status note.
 */
function fit() {
  if (bar.hidden) return;
  root.style.left = '0px';
  let r = root.getBoundingClientRect();
  const cards = [...el('left-rail').children].map((card) => card.getBoundingClientRect());
  const card = cards.find((c) => over(r, c));
  if (card) {
    root.style.left = `${card.right + GAP - r.left}px`;
    r = root.getBoundingClientRect();
  }
  const off = r.top < el('topbar').getBoundingClientRect().bottom
    || r.right > innerWidth
    || cards.some((c) => over(r, c))
    || [el('plates'), ...el('right-rail').children, el('status')].some((b) => over(r, b.getBoundingClientRect()))
    || [...bar.querySelectorAll('.vb-pop:not([hidden])')].some((pop) =>
      (!pop.classList.contains('vb-tip') || pop.classList.contains('show'))
      && over(r, pop.getBoundingClientRect()));
  root.classList.toggle('vc-off', off);
}
addEventListener('resize', fit);
// the card grows; a wrapping top bar pushes the whole rail down without resizing it
const roomWatch = new ResizeObserver(fit);
for (const id of ['stats', 'topbar', 'left-rail', 'plates', 'right-rail']) roomWatch.observe(el(id));
el('left-rail').addEventListener('scroll', fit);
// toolbar.js parks the bar beside the stats card (its left), shows and hides it and
// its popovers, and places a popover above its badge; the ring-drag angle shows by class
// (the cube's own turning and hover are inside it: those don't move anything)
new MutationObserver((ms) => { if (ms.some((m) => !root.contains(m.target))) fit(); }).observe(bar, { attributes: true, subtree: true, attributeFilter: ['style', 'hidden', 'class'] });
