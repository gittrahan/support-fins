/**
 * Models that collide, and Arrange (local issue 052 PR 4). Each model of the plate
 * being edited has a footprint (ui/footprint.js): the 1 mm cells its part, fins and
 * pad cover at any height. Where two share a cell they would print into each other:
 * those cells show red on the bed (plateview.js showClash) and the Volume line says
 * so. The export is not held back -- a slicer shows the same clash, and the user may
 * mean it.
 *
 * Arrange (the toolbar's) packs the plate's models: the biggest first, each at the
 * free spot nearest the bed's centre, GAP mm from the others, turned as they are --
 * a turn about Z is a new pose and would rebuild the fins. One undo step. A model
 * the bed has no room left for goes past its right edge, where the Volume line
 * says it hangs off.
 *
 * A footprint is kept with its slot and rebuilt only when the mesh, its pose or its
 * fins change; a move only places it again, so a drag checks as it goes.
 */
import { el } from './dom.js';
import { part } from './part.js';
import { activeAdded } from './finbuild.js';
import { currentVolume } from './volume.js';
import { currentPlate, isBusy } from './plates.js';
import { showClash } from './plateview.js';
import { pushMoves } from './history.js';
import { placeSlots, dragging } from './move.js';
import { rasterize, union, placed, shared, pack } from './footprint.js';

export const GAP = 10;      // mm Arrange leaves between footprints: pads and brims stay apart

const flat = (tris) => {
  const a = new Float32Array(tris.length * 3);
  for (let i = 0; i < tris.length; i++) { a[i * 3] = tris[i][0]; a[i * 3 + 1] = tris[i][1]; a[i * 3 + 2] = tris[i][2]; }
  return a;
};

const partKey = (mesh) => {
  mesh.updateMatrix();
  return `${mesh.geometry.uuid}|${mesh.matrix.elements.join(',')}`;
};

/** The part's cells, kept on the slot while its mesh and pose stay. */
function partGrid(m, mesh) {
  const key = partKey(mesh);
  if (m.fpPart?.key !== key) {
    m.fpPart = { key, grid: rasterize(mesh.geometry.getAttribute('position').array, mesh.matrix.elements) };
  }
  return m.fpPart.grid;
}

/** Slot `m`'s footprint about its own spot (null for an empty slot): the live one
 *  from what the export writes (activeAdded), a parked one from its ghost fins. */
export function slotGrid(m, live) {
  if (live) {
    if (!part) return null;
    const added = activeAdded();
    // the added triangles' own vertex arrays: a rebuild makes new ones
    const same = m.fpAdded && m.fpAdded.n === added.length
      && m.fpAdded.first === added[0] && m.fpAdded.last === added[added.length - 1];
    if (!same) m.fpAdded = { n: added.length, first: added[0], last: added[added.length - 1], grid: rasterize(flat(added)) };
    return union(partGrid(m, part), m.fpAdded.grid);
  }
  const s = m.stash;
  if (!s) return null;
  const fins = s.fins?.geometry;
  if (!m.fpFins || m.fpFins.uuid !== fins?.uuid) {
    m.fpFins = { uuid: fins?.uuid, grid: fins ? rasterize(fins.getAttribute('position').array) : null };
  }
  return union(partGrid(m, s.part.mesh), m.fpFins.grid);
}

/** The plate's models with their footprints: [{ m, grid }], empty slots left out. */
function footprints() {
  const p = currentPlate();
  return p.models.map((m, k) => ({ m, grid: slotGrid(m, k === p.live) })).filter((f) => f.grid);
}

let colliding = false;
/** Two models of the plate being edited share a cell (as of the last check). */
export const overlapping = () => colliding;

/** Check the plate being edited for collisions: the red cells and the Volume line's
 *  flag. Returns whether the flag changed. */
export function checkOverlap() {
  const p = currentPlate();
  let cells = [];
  if (part && p?.models.length > 1) {
    const at = footprints().map(({ m, grid }) => placed(grid, m.xy));
    for (let a = 0; a < at.length; a++) for (let b = a + 1; b < at.length; b++) cells.push(...shared(at[a], at[b]));
  }
  syncButton();
  showClash(cells);
  const was = colliding;
  colliding = cells.length > 0;
  return was !== colliding;
}

function syncButton() {
  const p = currentPlate();
  el('arrange-btn').hidden = !(part && p?.models.filter((m, k) => k === p.live || m.stash).length > 1);
}

/** Pack the plate being edited's models (the toolbar's Arrange). */
export function arrange() {
  if (!part || isBusy() || dragging()) return;
  const fps = footprints();
  if (fps.length < 2) return;
  const v = currentVolume();
  const at = pack(fps.map((f) => f.grid), v.x, v.y, GAP);
  // no room left: a row past the bed's right edge, in the order they came
  let x = v.x / 2 + GAP;
  fps.forEach((f, k) => {
    if (at[k]) return;
    const g = f.grid;
    at[k] = [Math.ceil(x - g.x0), Math.round(-(g.y0 + g.h / 2))];
    x += g.w + GAP;
  });
  const moves = fps.map((f, k) => ({ who: f.m, xy: at[k] }))
    .filter(({ who, xy }) => who.xy[0] !== xy[0] || who.xy[1] !== xy[1]);
  if (!moves.length) return;
  pushMoves(moves.map(({ who }) => ({ who, xy: who.xy.slice() })));
  placeSlots(moves);
}

el('arrange-btn').addEventListener('click', arrange);
document.addEventListener('partchange', syncButton);
