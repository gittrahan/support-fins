/**
 * Scale, in the view toolbar beside Rotate: a size in mm or a percent per axis, as
 * a slicer has it (#440), with Uniform to move all three together.
 *
 * The axes are the plate's, as the part sits -- the mm are the stats card's Size
 * row, and the build volume's X/Y/Z. The scale itself is kept as a matrix in the
 * part's own frame (web/scale.js), so a stretch set along the plate turns with the
 * part if it is rotated afterwards, as a slicer's does.
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
import { gizmo } from './pose.js';
import {
  IDENTITY, scaleAbout, stretchOnPlate, uniformOf, sizeOnPlate, fieldValue, stretchFor,
} from '../scale.js';

let L = IDENTITY;            // the scale, row-major, in the part's frame
// the part at 100 %: its positions centred on the origin (as setPart leaves them),
// the file-frame centre, and the slicer parts as the file had them
let base = null;

const AXES = ['x', 'y', 'z'];
const isIdentity = (m) => m.every((v, i) => v === IDENTITY[i]);
const pop = el('scale-pop');
const sync = addBadge('scale-badge', { pop: 'scale-pop', isOn: () => !isIdentity(L) });
const uniformBox = el('scale-uniform');

/** The part's pose, row-major, part -> plate. */
function pose() {
  const e = new THREE.Matrix4().makeRotationFromQuaternion(part.quaternion).elements;
  return [e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]];
}

/** The part's box on the plate now (as the Size row has it), and at 100 % in the
 *  same pose. Under a stretch that isn't uniform the 100 % box has to measure the
 *  part as loaded; that walk is kept until the pose or the part changes. */
let baseBox = null;
function boxes() {
  const R = pose();
  const cur = sizeOnPlate(part.geometry.getAttribute('position').array, R);
  const u = uniformOf(L);
  if (!base || u !== null) return { R, cur, at100: cur.map((v) => v / (u ?? 1)) };
  const key = R.join();
  if (baseBox?.key !== key || baseBox.base !== base) baseBox = { key, base, size: sizeOnPlate(base.pos, R) };
  return { R, cur, at100: baseBox.size };
}

const show = (v) => String(+v.toFixed(2));
// a part that loads under 10 mm (one written in metres) keeps 4 digits
const showMm = (v) => String(v < 10 ? +v.toPrecision(4) : +v.toFixed(2));
const pctOf = (cur, at100) => (at100 > 0 ? show(cur / at100 * 100) : '');

function render() {
  const u = uniformOf(L);
  el('scale-now').textContent = u !== null && u !== 1 ? ` ${show(u * 100)}%` : '';
  el('scale-reset').disabled = isIdentity(L);
  // the fields walk the part, so they fill only while they show (and on opening)
  if (part && !pop.hidden) {
    const { cur, at100 } = boxes();
    AXES.forEach((a, k) => {
      el(`scale-${a}-mm`).value = showMm(cur[k]);
      el(`scale-${a}-pct`).value = pctOf(cur[k], at100[k]);
    });
  }
  sync();
}

/** A new part (setPart, from a load): it is at 100 %. */
export function resetScale() {
  L = IDENTITY;
  base = null;
  render();
}

/** The scale and the part at 100 %, kept with a plate that is not showing (ui/plates.js). */
export const scaleState = () => ({ L, base });
export function setScaleState(st) {
  L = st.L;
  base = st.base;
  render();
}

/** The scale for a report (web/report.js): a factor while uniform, else the matrix. */
export const reportScale = () => uniformOf(L) ?? L;

function setScale(m) {
  if (!part || m.every((v, i) => v === L[i])) { render(); return; }
  const g = part.geometry;
  if (!base) {
    const { centre, slicer } = g.userData;
    base = { pos: g.getAttribute('position').array.slice(), centre, slicer, colors: g.userData.colors };
  }
  const c = base.centre;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(scaleAbout(base.pos, m, [0, 0, 0], c), 3));
  if (base.colors) geometry.userData.colors = base.colors;
  if (base.slicer) {
    const sl = base.slicer;
    geometry.userData.slicer = {
      ...sl,
      positions: scaleAbout(sl.positions, m, c),
      extras: sl.extras.map((e) => ({ ...e, positions: scaleAbout(e.positions, m, c) })),
    };
  }
  const quat = part.quaternion.clone();
  const keep = base;
  setPart(geometry, partName, { quat });
  base = keep;                 // setPart's resetScale cleared it: this is still the part
  // back at 100 % (a stretch undone by hand, give or take a rounding): as loaded
  L = m.every((v, i) => Math.abs(v - IDENTITY[i]) < 1e-12) ? IDENTITY : m;
  forgetSessionNote();
  render();
}

/** One field typed: its axis's size (mm) or percent, on that axis or all three. */
function edit(k, kind, input) {
  const v = fieldValue(input.value);
  if (!part || v == null) { render(); return; }      // junk or empty: show what holds
  const { R, cur, at100 } = boxes();
  // what the field already shows, typed again, is no change
  if (String(v) === (kind === 'mm' ? showMm(cur[k]) : pctOf(cur[k], at100[k]))) { render(); return; }
  const mm = kind === 'mm' ? v : v / 100 * at100[k];
  const d = stretchFor(k, mm, cur, at100, uniformBox.checked);
  if (!d) { render(); return; }
  setScale(uniformBox.checked ? L.map((x) => x * d[0]) : stretchOnPlate(L, d, R));
}

// Each new scale is a whole reload, so a field takes a typed value on Enter or blur
// only: no spin buttons (CSS) and no arrow-key steps, which would reload the part
// once per step.
AXES.forEach((a, k) => {
  for (const kind of ['mm', 'pct']) {
    const input = el(`scale-${a}-${kind}`);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') e.preventDefault();
    });
    input.addEventListener('change', () => edit(k, kind, input));
  }
});
el('scale-reset').addEventListener('click', () => setScale(IDENTITY));
// opening the popover fills its fields, and a new pose changes what the plate's
// X/Y/Z measure (part.js sends this with each new Size row)
el('scale-badge').addEventListener('click', () => render());
// -- but not each frame of a ring drag (two walks of the part per frame); the
// release shades once more and fills them then (ui/pose.js)
document.addEventListener('partsizechange', () => { if (!pop.hidden && !gizmo.dragging) render(); });
