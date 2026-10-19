/**
 * The parked models' fins (ui/models.js), kept to the plate's settings. The settings
 * are the plate's, so a change made on the live model is a change to every model on
 * it: each parked one is rebuilt here, one at a time in a Worker of its own (the live
 * model's build has finbuild.js's), without being made live -- the panels and the
 * view stay on the model being edited. A parked model's fins stay on screen, greyed,
 * until its new ones land.
 *
 * A build is what the live model's would be in its place: its pose analysed at the
 * plate's threshold, Auto's walls less the fins it had removed (finkeys.js), its
 * hand-placed supports re-stood (walls.js sweepDrawn), and its pad. Export does not
 * rely on these: it makes each model live and builds it there (models.js eachModel).
 */
import * as THREE from 'three';
import { analyze } from '../overhangs.js';
import { findIslands } from '../islands.js';
import { buildFins } from '../fins.js';
import { assignKeys, matchRemoved } from './finkeys.js';
import { finOpts, workerTopology } from './finbuild.js';
import { sweepDrawn, printTriangles } from './walls.js';
import { threshold } from './part.js';
import { finMode, finsVisible, autoLike } from './settings.js';
import { settingsKey } from './history.js';
import { ghostFins, ghostLook } from './plateview.js';
import { currentPlate, isBusy, redraw } from './plates.js';

let worker;          // undefined = not tried yet, null = unavailable, else a Worker
let job = null;      // the build in flight: { m, key, topo, res, rot, mesh }
let timer = null;

/** The plate's settings may have changed (a support build was asked for): grey the
 *  parked fins built under others, and rebuild them once the edits settle. */
export function scheduleParked() {
  clearTimeout(timer);
  timer = setTimeout(next, 150);
}

const parked = (m) => {
  const plate = currentPlate();
  return m.stash && plate.models.includes(m) && plate.models[plate.live] !== m;
};

function next() {
  timer = null;
  // an export makes each model live and parks it built: wait for it
  if (isBusy()) { scheduleParked(); return; }
  const key = settingsKey(), plate = currentPlate();
  for (const m of plate.models) if (m.stash?.fins && parked(m)) ghostLook(m.stash.fins, m.stash.finsKey === key);
  if (job) {
    if (job.key === key && parked(job.m)) return;     // its reply calls next
    worker?.terminate();                              // built for settings since changed
    worker = undefined;
    job = null;
  }
  const m = plate.models.find((s) => parked(s) && s.stash.finsKey !== key);
  if (m) build(m, key);
}

function build(m, key) {
  const s = m.stash, mesh = s.part.mesh, topo = s.part.topology;
  if (!finsVisible) { land({ m, key }, null); return; }
  const rot = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(mesh.quaternion)).elements;
  const res = analyze(topo, threshold, rot);
  const opts = finOpts(finMode === 'full' ? findIslands(topo, res, rot) : undefined);
  job = { m, key, topo, res, rot, mesh, opts };
  const w = getWorker();
  if (w) {
    try {
      w.postMessage({ id: 0, topology: workerTopology(topo), result: res, rot, opts });
      return;
    } catch (err) {
      console.warn('parked support build: postMessage failed; building inline', err);
    }
  }
  land(job, buildFins(topo, res, rot, opts));
}

function getWorker() {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL('../finworker.js', import.meta.url), { type: 'module' });
  } catch {
    return (worker = null);
  }
  worker.onmessage = (e) => {
    const j = job;
    if (!j) return;
    land(j, e.data.error ? buildFins(j.topo, j.res, j.rot, j.opts) : e.data.built);
  };
  // as finbuild.js does: a crashed worker is not a page error, and builds go inline
  worker.onerror = (e) => {
    e.preventDefault();
    worker = null;
    job = null;
    scheduleParked();
  };
  return worker;
}

/** `built` (null: fins off) becomes `j.m`'s parked fins, unless it was made live,
 *  taken off, or the settings changed meanwhile. */
function land(j, built) {
  job = null;
  const { m, key } = j;
  if (!parked(m) || settingsKey() !== key) { scheduleParked(); return; }
  const s = m.stash, tris = [];
  if (built) {
    // Auto's walls, less the fins this model had removed (ui/remove.js adoptFins)
    let gone = new Set();
    if (finMode !== 'draw') {
      const records = assignKeys((built.fins ?? []).map((f) => ({ ...f })));
      gone = new Set(matchRemoved(records, new Set(s.state.removedSigs)).keys());
      for (const r of records) {
        if (gone.has(r.id)) continue;
        for (const [lo, hi] of r.triRanges ?? []) for (let t = lo; t < hi; t++) tris.push(built.triangles[t]);
      }
    }
    // its hand-placed supports where walls.js drawShown would show them
    const walls = s.state.walls;
    if (walls.length && (finMode === 'draw' || autoLike())) {
      const at = new THREE.Vector3(j.res.offset.x, j.res.offset.y, j.res.offset.z);
      for (const t of sweepDrawn({
        topology: j.topo, res: j.res, rot: j.rot, tris: printTriangles(j.topo, j.rot, j.res.offset), walls,
        toWorld: (v, out) => out.copy(v).applyQuaternion(j.mesh.quaternion).add(at),
        auto: autoLike() ? built : null, gone,
      })) tris.push(t);
    }
    for (const t of built.padTriangles ?? []) tris.push(t);
  }
  if (s.fins) { s.fins.removeFromParent(); s.fins.geometry.dispose(); }
  s.fins = tris.length ? ghostFins(tris) : null;
  s.finsKey = key;
  redraw();
  scheduleParked();
}
