/**
 * Several models on one plate (ui/plates.js). A plate holds a list of model slots,
 * one of them live -- the one every tool works on -- and the rest parked, drawn
 * where they stand (ui/plateview.js). A click on a parked model swaps it in the way
 * a plate switch does: the live one is stashed as it stands (part.js stashPart keeps
 * the mesh and its weld; history.js takeState its walls, removals, settings and
 * pose) and the clicked one brought back as undo restores a state.
 *
 * The live model stays at the origin, where every tool, fin key, saved session and
 * cached sweep expects it. A slot's `xy` is where it stands on its plate, and the
 * bed, the plates and the parked models are drawn shifted by minus the live one's;
 * the camera moves with the shift, so nothing jumps on screen.
 */
import * as THREE from 'three';
import { el } from './dom.js';
import { camera, controls } from './scene.js';
import { part, clearPart, stashPart, unstashPart } from './part.js';
import { takeState, takeHistory, setHistory, restoreState, VIEWER_IDS } from './history.js';
import { scaleState, setScaleState } from './scale.js';
import { importState, setImportState } from './io.js';
import { activeAdded, buildPending } from './finbuild.js';
import { sectionState, restoreSection } from './section.js';
import { suggestState, restoreSuggestions } from './suggest.js';
import { currentVolume } from './volume.js';
import { ghostFins, parkMesh, glide } from './plateview.js';
import { currentPlate, isBusy, redraw } from './plates.js';

/** A model's place on a plate. `stash` holds it while parked; the live slot's is
 *  null (its state is the live one), and so is an empty plate's one slot. */
export const slot = (xy = [0, 0]) => ({ stash: null, ghost: null, xy });

/** Where the live model stands on the plate being edited. */
export const liveXY = () => {
  const p = currentPlate();
  return p.models[p.live].xy;
};

// Models on one plate print in one job: the layer height is the plate's, so a model
// brought in takes the one showing (the viewer's and printer's settings stay too).
// Read when used: history.js is in an import cycle with this module.
const samePlate = () => new Set([...VIEWER_IDS, 'layer-height']);

/** Put `plate`'s live model and its state away, leaving the page empty. */
export function park(plate) {
  const m = plate.models[plate.live];
  if (!part) { m.stash = null; return; }
  // read before stashPart: it resets the history, scale, import note, cut and list
  const state = takeState(), history = takeHistory(), scale = scaleState(), imp = importState();
  const section = sectionState(), suggest = suggestState();
  // Left before its fins were built (they build in the worker): the parked copy
  // keeps the fins it had when it was last parked, if the pose is still that one.
  const last = m.ghost;
  m.ghost = null;
  let fins;
  if (last && buildPending() && part.quaternion.equals(last.quat)) fins = last.fins;
  else {
    if (last?.fins) last.fins.geometry.dispose();
    fins = ghostFins(activeAdded());
  }
  const rec = stashPart();
  parkMesh(rec.mesh);
  m.stash = { part: rec, fins, state, history, scale, imp, section, suggest };
}

/** Bring `plate`'s live slot back (stashed, or empty); the page is empty. `keep`:
 *  the settings that stay as they are rather than follow the model. */
export function unpark(plate, keep = VIEWER_IDS) {
  const m = plate.models[plate.live], s = m.stash;
  if (s) {
    const form = { ...s.state.form };
    for (const id of keep) {
      const f = el(id);
      form[id] = f.type === 'checkbox' ? f.checked : f.value;
    }
    setImportState(s.imp);
    unstashPart(s.part);
    restoreState({ ...s.state, form });
    setHistory(s.history);
    setScaleState(s.scale);
    restoreSection(s.section);
    restoreSuggestions(s.suggest);
    // off screen while the model is live, kept in case it is left before its build lands
    s.fins?.removeFromParent();
    m.ghost = { fins: s.fins, quat: s.part.mesh.quaternion.clone() };
  }
  m.stash = null;      // only once it is live: a throw above keeps the model
}

/** Free what a parked slot holds (a removal past its Undo). */
export function disposeSlot(m) {
  const s = m.stash;
  if (!s) return;
  s.part.mesh.removeFromParent();
  s.part.mesh.geometry.dispose();
  if (s.fins) { s.fins.removeFromParent(); s.fins.geometry.dispose(); }
}

/** Swap the live model for slot `k` of the same plate. The world shifts by the
 *  difference of their spots: the camera goes with it, then pans to the model. */
function swap(k, quiet) {
  const plate = currentPlate();
  const from = plate.models[plate.live].xy, to = plate.models[k].xy;
  const pos = camera.position.clone(), target = controls.target.clone();
  park(plate);
  plate.live = k;
  unpark(plate, samePlate());
  redraw();
  if (quiet) return;
  const d = new THREE.Vector3(from[0] - to[0], from[1] - to[1], 0);
  pos.add(d);
  target.add(d);
  // unstashPart framed the model: keep the view's direction and distance instead,
  // aimed at the model's middle
  const aim = new THREE.Vector3(0, 0, controls.target.z);
  camera.position.copy(pos).add(aim).sub(target);
  controls.target.copy(aim);
  controls.update();
  glide(pos, target);
}

/** Edit model `k` of the plate being edited (a click on it). */
export function select(k) {
  const plate = currentPlate();
  if (isBusy() || k === plate.live || k < 0 || k >= plate.models.length) return;
  swap(k, false);
}

/** The XY box a parked model and its fins cover on its plate. */
export function footprint(m) {
  const { mesh } = m.stash.part, b = new THREE.Box3();
  mesh.updateMatrix();
  b.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrix);
  if (m.stash.fins) {
    m.stash.fins.geometry.computeBoundingBox();
    b.union(m.stash.fins.geometry.boundingBox);
  }
  return [b.min.x + m.xy[0], b.min.y + m.xy[1], b.max.x + m.xy[0], b.max.y + m.xy[1]];
}

const GAP = 10;      // mm between footprints: room for a new model's pad and wall bases
const STEP = 5;      // mm: the grid a new model's spot is searched on

/** Where a `w` x `h` model goes on `plate`, clear of its parked models but `skip`:
 *  the free spot nearest the bed's centre, or past the others' right edge when the
 *  bed has none. */
function spot(plate, w, h, skip = []) {
  const v = currentVolume(), hx = v.x / 2 - w / 2, hy = v.y / 2 - h / 2;
  const taken = plate.models.filter((m) => m.stash && !skip.includes(m)).map(footprint);
  const free = (x, y) => taken.every(([x0, y0, x1, y1]) =>
    x + w / 2 + GAP <= x0 || x - w / 2 - GAP >= x1 || y + h / 2 + GAP <= y0 || y - h / 2 - GAP >= y1);
  let best = null, bestD = Infinity;
  for (let y = -Math.floor(hy / STEP) * STEP; y <= hy; y += STEP) {
    for (let x = -Math.floor(hx / STEP) * STEP; x <= hx; x += STEP) {
      const d = x * x + y * y;
      if (d < bestD && free(x, y)) { best = [x, y]; bestD = d; }
    }
  }
  return best ?? [Math.max(...taken.map((r) => r[2])) + GAP + w / 2, 0];
}

/**
 * Make room for `geometry` on the plate being edited, about to be setPart: the live
 * model is parked and a new slot, at a free spot, is the live one. An empty plate
 * takes it in its own slot.
 */
export function addSlot(geometry) {
  const plate = currentPlate(), prev = plate.live;
  if (!part) return -1;
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  park(plate);
  plate.models.push(slot(spot(plate, bb.max.x - bb.min.x, bb.max.y - bb.min.y)));
  plate.live = plate.models.length - 1;
  return prev;
}

/** The file addSlot made room for did not load: drop its slot, and slot `prev`
 *  (the one live before) is again. */
export function dropAdded(prev) {
  const plate = currentPlate();
  if (prev < 0 || plate.live !== plate.models.length - 1 || !plate.models[prev]) return;
  clearPart();
  plate.models.pop();
  plate.live = prev;
  unpark(plate, samePlate());
  redraw();
}

/** A model alone on its plate stands at its centre, where a one-model export puts
 *  it and the fit check measures it. */
export function centreLone(plate) {
  if (plate.models.length === 1) plate.models[0].xy = [0, 0];
}

/**
 * Put the parked `slots` (a removal's Undo) back on `plate` beside its models: each
 * where it stood, unless something put there since covers that spot -- then at the
 * free spot nearest the centre, as Add model would.
 */
export function putBack(plate, slots) {
  for (const m of slots) {
    const [x0, y0, x1, y1] = footprint(m);
    const clash = plate.models.some((o) => {
      if (!o.stash) return false;
      const [a0, b0, a1, b1] = footprint(o);
      return x0 < a1 + GAP && x1 > a0 - GAP && y0 < b1 + GAP && y1 > b0 - GAP;
    });
    if (clash) {
      // spot() places the box's middle; the model's spot is off it by the fins' reach
      const [cx, cy] = [(x0 + x1) / 2 - m.xy[0], (y0 + y1) / 2 - m.xy[1]];
      const [sx, sy] = spot(plate, x1 - x0, y1 - y0, [m]);
      m.xy = [sx - cx, sy - cy];
    }
    plate.models.push(m);
  }
}

/** Does any parked model of the plate being edited have fins (Export fins only)? */
export const parkedFins = () => currentPlate().models.some((m) => m.stash?.fins);

/**
 * Take the live model off the plate being edited (Remove model): its slot, parked,
 * for an Undo to put back. A plate of several goes on with the model before it;
 * the last one leaves the plate empty.
 */
export function takeLive() {
  const plate = currentPlate();
  const k = plate.live, m = plate.models[k];
  if (plate.models.length === 1) {
    park(plate);
    plate.models = [slot()];
    plate.live = 0;
    redraw();
    return m;
  }
  swap(k === 0 ? 1 : k - 1, false);
  plate.models.splice(k, 1);
  if (plate.live > k) plate.live--;
  centreLone(plate);
  redraw();
  return m;
}

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * `fn(xy)` for every model of the plate being edited, each live in turn with its
 * supports built (they build in the worker), then back to the one that was live,
 * the camera where it was. For an export of the whole plate; the caller holds the
 * plates still (plates.js locked).
 */
export async function eachModel(fn) {
  const plate = currentPlate(), back = plate.live;
  const pos = camera.position.clone(), target = controls.target.clone();
  const out = [];
  try {
    for (let k = 0; k < plate.models.length; k++) {
      if (k !== plate.live) swap(k, true);
      if (!part) continue;
      await tick(0);
      while (buildPending()) await tick(50);
      out.push(fn(plate.models[k].xy));
    }
  } finally {
    if (plate.live !== back && plate.models[back]) swap(back, true);
    camera.position.copy(pos);
    controls.target.copy(target);
    controls.update();
  }
  return out;
}
