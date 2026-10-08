/**
 * The "Mouse" menu (#53): applies a navigation preset from ui/navpresets.js to the
 * orbit controls. Remembered in localStorage (optional), undoable like every setting.
 */
import { el } from './dom.js';
import { renderer, controls } from './scene.js';
import { NAV_PRESETS, navPreset } from './navpresets.js';

const NAV_KEY = 'sf.navPreset';
const menu = el('nav-preset');
for (const [key, p] of Object.entries(NAV_PRESETS)) menu.add(new Option(p.label, key));

function apply(key) {
  const p = navPreset(key);
  controls.mouseButtons = { ...p.buttons };
  menu.title = p.hint;
  el('nav-hint').textContent = p.hint;
}

let saved = 'default';
try { saved = localStorage.getItem(NAV_KEY) ?? 'default'; } catch { /* storage off */ }
menu.value = NAV_PRESETS[saved] ? saved : 'default';
apply(menu.value);
menu.addEventListener('change', () => {
  try { localStorage.setItem(NAV_KEY, menu.value); } catch { /* storage off */ }
  apply(menu.value);
});

// A middle press on the canvas starts the browser's autoscroll (Windows) or a
// paste (Linux) -- it is a navigation button in most presets, so keep it ours.
renderer.domElement.addEventListener('mousedown', (e) => {
  if (e.button === 1) e.preventDefault();
});
