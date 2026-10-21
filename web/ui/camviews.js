import { t } from './i18n.js';
/**
 * The camera view buttons in the View popover (#350): one click glides the camera
 * square onto a side of the part (ui/viewpresets.js), keeping the target and zoom.
 * View only -- no undo, nothing saved.
 */
import { el } from './dom.js';
import { camera, controls } from './scene.js';
import { glide } from './plateview.js';
import { VIEWS, viewPosition } from './viewpresets.js';

const row = el('cam-views');

function render() {
  row.innerHTML = '';
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

function go(key) {
  const fromPos = camera.position.clone(), fromTarget = controls.target.clone();
  const tgt = controls.target.toArray();
  camera.position.fromArray(viewPosition(key, tgt, camera.position.distanceTo(controls.target)));
  controls.update();
  glide(fromPos, fromTarget);
}
