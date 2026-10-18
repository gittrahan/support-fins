/**
 * Scale: one uniform percent for the part, in the view toolbar beside Rotate.
 *
 * A new scale reloads the part at that size (setPart): the weld, the analysis and
 * the fins are all in mm, so nothing short of a reload is honest. The pose is kept;
 * drawn walls, removed fins and undo start over, as for a new file -- walls drawn at
 * 100 % don't fit the overhangs at 150 %. The part as loaded is kept (once the
 * first rescale happens) so every scale is taken from it, never compounded.
 * A slicer's own parts (#104) scale with it, about the same centre, so the 3MF
 * export still puts them where the part is.
 */
import * as THREE from 'three';
import { el } from './dom.js';
import { addBadge } from './toolbar.js';
import { part, partName, setPart } from './part.js';
import { forgetSessionNote } from './io.js';
import { scaleAbout, scaleFromPercent } from '../scale.js';

let scale = 1;
// the part at 100 %: its positions centred on the origin (as setPart leaves them),
// the file-frame centre, and the slicer parts as the file had them
let base = null;

const sync = addBadge('scale-badge', { pop: 'scale-pop', isOn: () => scale !== 1 });

function render() {
  const pct = +(scale * 100).toFixed(2);
  el('scale-pct').value = pct;
  el('scale-now').textContent = scale === 1 ? '' : ` ${pct}%`;
  el('scale-reset').disabled = scale === 1;
  sync();
}

/** A new part (setPart, from a load): it is at 100 %. */
export function resetScale() {
  scale = 1;
  base = null;
  render();
}

/** The scale and the part at 100 %, kept with a plate that is not showing (ui/plates.js). */
export const scaleState = () => ({ scale, base });
export function setScaleState(st) {
  scale = st.scale;
  base = st.base;
  render();
}

function setScale(s) {
  if (!part || s === scale) { render(); return; }
  const g = part.geometry;
  if (!base) {
    const { centre, slicer } = g.userData;
    base = { pos: g.getAttribute('position').array.slice(), centre, slicer, colors: g.userData.colors };
  }
  const c = base.centre;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(scaleAbout(base.pos, s, [0, 0, 0], c), 3));
  if (base.colors) geometry.userData.colors = base.colors;
  if (base.slicer) {
    const sl = base.slicer;
    geometry.userData.slicer = {
      ...sl,
      positions: scaleAbout(sl.positions, s, c),
      extras: sl.extras.map((e) => ({ ...e, positions: scaleAbout(e.positions, s, c) })),
    };
  }
  const quat = part.quaternion.clone();
  const keep = base;
  setPart(geometry, partName, { quat });
  base = keep;                 // setPart's resetScale cleared it: this is still the part
  scale = s;
  forgetSessionNote();
  render();
}

// Each new scale is a whole reload, so the field takes a typed value on Enter or
// blur only: no spin buttons (CSS) and no arrow-key steps, which would reload the
// part once per percent.
el('scale-pct').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') e.preventDefault();
});
el('scale-pct').addEventListener('change', (e) => {
  const s = scaleFromPercent(e.target.value);
  if (s == null) render();     // junk or empty: show the scale that holds
  else setScale(s);
});
el('scale-reset').addEventListener('click', () => setScale(1));
