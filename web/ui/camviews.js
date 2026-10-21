import { t } from './i18n.js';
/**
 * The camera view buttons in the View popover (#350): one click glides the camera
 * square onto a side of the part (ui/viewpresets.js), keeping the target and zoom.
 * View only -- no undo, nothing saved.
 */
import { el } from './dom.js';
import { camera, controls, requestRender } from './scene.js';
import { VIEWS, viewPosition, orbitLerp } from './viewpresets.js';

const row = el('cam-views');

function render() {
  row.innerHTML = '';
  row.setAttribute('aria-label', t('Camera view'));
  for (const [key, v] of Object.entries(VIEWS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn sm';
    b.textContent = t(v.label);
    b.title = t(v.hint);
    b.addEventListener('click', () => go(key));
    row.appendChild(b);
  }
}
render();
window.addEventListener('languagechange', render);

const EASE_MS = 450;
let gliding = 0;   // a second click mid-glide takes over from the first

function go(key) {
  const tgt = controls.target.clone();
  const from = camera.position.clone().sub(tgt).toArray();
  const to = viewPosition(key, [0, 0, 0], Math.hypot(...from));
  // An orbit still easing out from a drag would carry on past the view, off square.
  controls._sphericalDelta.set(0, 0, 0);
  controls._panOffset.set(0, 0, 0);
  const t0 = performance.now(), run = ++gliding;
  const step = (now) => {
    if (run !== gliding) return;
    const k = Math.min(1, (now - t0) / EASE_MS);
    const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    camera.position.fromArray(orbitLerp(from, to, e)).add(tgt);
    controls.update();
    requestRender();
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
