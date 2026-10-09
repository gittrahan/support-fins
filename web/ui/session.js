/**
 * SESSION (#214): the supports a user placed by hand, saved inside the 3MF the
 * site exports and restored when that file is opened again -- so a part drawn
 * over yesterday doesn't have to be drawn again.
 *
 * Not the support MESH: the drawn walls themselves (two points each, a sway brace
 * one point), the fin mode and the settings. On the way back in they are real drawn
 * walls again -- selectable, removable, undoable, re-swept when the part turns --
 * and Auto's fins rebuild from the same settings in the same pose, so nothing is
 * doubled and there is nothing to clear.
 *
 * Points are stored relative to the centre of the part's bounding box in print
 * space. The reloaded part is the exported part already in that pose, centred on
 * that same box by setPart (whatever bed shift the 3MF items carry), with the
 * rotation reset -- so a stored point IS its new local point.
 */
import * as THREE from 'three';
import { part, topology } from './part.js';
import { drawnWalls } from './walls.js';
import { finMode, finsVisible } from './settings.js';
import { sessionForm, restoreState, resetHistory } from './history.js';

const SIZE_TOL = 0.05;   // mm: the part read back must be the part saved (float32 round trip)

function boxOf(tris) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of tris) for (let k = 0; k < 3; k++) { if (p[k] < lo[k]) lo[k] = p[k]; if (p[k] > hi[k]) hi[k] = p[k]; }
  return { centre: lo.map((v, k) => (v + hi[k]) / 2), size: lo.map((v, k) => hi[k] - v) };
}
const round = (v) => Math.round(v * 1e5) / 1e5;

/** The session for an export: `partTris` is the part in print space, as written. */
export function sessionOf(partTris) {
  if (!part) return null;
  const { centre, size } = boxOf(partTris);
  part.updateMatrixWorld();
  const w = new THREE.Vector3();
  const at = (v) => { part.localToWorld(w.copy(v)); return [round(w.x - centre[0]), round(w.y - centre[1]), round(w.z - centre[2])]; };
  return {
    v: 1,
    part: { size: size.map(round) },
    finMode, finsVisible,
    form: sessionForm(),
    walls: drawnWalls.map((d) => d.kind === 'sway' ? { kind: 'sway', a: at(d.a) } : { a: at(d.a), b: at(d.b) }),
  };
}

/** Which of a 3MF's objects is the part a session was saved with: the export names
 *  the supports "<name> supports", so the one object that isn't. Null if unclear. */
export function partObjectOf(objects) {
  const parts = objects.filter((o) => !/ supports$/.test(o.name));
  return parts.length === 1 ? parts[0] : null;
}

/** The face of the (local) part nearest `p`: a sway brace stands on a face, and the
 *  writer drops degenerate triangles, so the saved index wouldn't survive. */
function nearestFace(p) {
  const tri = new THREE.Triangle(), q = new THREE.Vector3();
  const { pos, nFaces } = topology;
  let best = -1, bestD = Infinity;
  for (let f = 0; f < nFaces; f++) {
    const o = f * 9;
    tri.set(tri.a.set(pos[o], pos[o + 1], pos[o + 2]), tri.b.set(pos[o + 3], pos[o + 4], pos[o + 5]),
            tri.c.set(pos[o + 6], pos[o + 7], pos[o + 8]));
    const d = tri.closestPointToPoint(p, q).distanceToSquared(p);
    if (d < bestD) { bestD = d; best = f; }
  }
  return best;
}

/**
 * Restore `s` onto the part setPart just loaded. Returns the number of supports
 * restored, or null when the part read back isn't the one the session was saved
 * with (re-saved and edited in a slicer, say) -- it then loads as a plain part.
 */
export function restoreSession(s) {
  if (!part || !topology || !s) return null;
  const bb = part.geometry.boundingBox;
  const size = [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z];
  if (!Array.isArray(s.part?.size) || size.some((v, k) => Math.abs(v - s.part.size[k]) > SIZE_TOL)) return null;
  const vec = (a) => new THREE.Vector3(a[0], a[1], a[2]);
  const walls = [];
  for (const w of s.walls ?? []) {
    if (w.kind === 'sway') {
      const a = vec(w.a);
      walls.push({ kind: 'sway', face: nearestFace(a), a, ok: false, info: null });
    } else walls.push({ a: vec(w.a), b: vec(w.b), ok: false, info: null });
  }
  restoreState({
    quat: [0, 0, 0, 1], walls, load: null, removedSigs: [],
    finMode: s.finMode ?? finMode, finsVisible: s.finsVisible ?? true, drawAugment: false,
    form: s.form ?? {},
  });
  resetHistory();          // a fresh part: undo starts here, not at the plain load
  return walls.length;
}
