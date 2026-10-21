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
const GAP = 12, LIFT = 8;
/**
 * Room to show. The cube sits LIFT above the toolbar's left end; a toolbar popover
 * or the ring-drag angle showing over it lifts it to sit above that instead (Rotate
 * is open the whole time a part is being turned), and the stats card reaching down
 * beside it steps it right past the card (toolbar.js parks the bar itself beside the
 * card only when the card reaches the bar). Hidden where none of that makes room: under
 * the top bar, or still over the card, the settings panel, the plate tabs (at the
 * bottom on a narrow window) or a status note. The spot is worked out from the bar's
 * box, not the cube's -- that eases between spots (CSS) and would measure mid-way.
 */
function fit() {
  if (bar.hidden) return;
  const b = bar.getBoundingClientRect(), w = root.offsetWidth, h = root.offsetHeight;
  const x0 = b.left, y0 = b.top - LIFT - h;
  let x = x0, y = y0;
  const box = () => ({ left: x, right: x + w, top: y, bottom: y + h });
  const cards = [...el('left-rail').children].map((c) => c.getBoundingClientRect());
  const pops = [...bar.querySelectorAll('.vb-pop:not([hidden])')]
    .filter((p) => !p.classList.contains('vb-tip') || p.classList.contains('show'))
    .map((p) => p.getBoundingClientRect());
  const others = [el('plates'), ...el('right-rail').children, el('status')].map((o) => o.getBoundingClientRect());
  for (let pass = 0; pass < 3; pass++) {
    const pop = pops.filter((p) => over(box(), p));
    if (pop.length) y = Math.min(...pop.map((p) => p.top)) - LIFT - h;
    const card = cards.find((c) => over(box(), c));
    if (card) x = card.right + GAP;
    if (!pop.length && !card) break;
  }
  const r = box();
  const off = r.top < el('topbar').getBoundingClientRect().bottom || r.right > innerWidth
    || [...cards, ...pops, ...others].some((o) => over(r, o));
  root.style.transform = `translate(${x - x0}px, ${y - y0}px)`;
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
