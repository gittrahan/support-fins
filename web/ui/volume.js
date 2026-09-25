/**
 * Build volume: the preset/custom select, the remembered choice, and the plate
 * it draws. updateFit() reads the live size through currentVolume().
 */
import { el } from './dom.js';
import { buildPlate } from './scene.js';
import { part, shade } from './part.js';

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

export const currentVolume = () => volume;

export function applyVolume() {
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
