/**
 * The part: loading a mesh onto the plate (setPart), re-analysing and shading it
 * in its current pose (shade), the stats panel, the build-volume fit check, and
 * the overhang threshold. Owns part / topology / rotM3 / lastResult.
 */
import * as THREE from 'three';
import { buildTopology, analyze, DEFAULT_THRESHOLD } from '../overhangs.js';
import { el } from './dom.js';
import { scene, controls, frame } from './scene.js';
import { removeMode, cancelRemove, resetRemovals } from './remove.js';
import { resetHistory } from './history.js';
import { importNote } from './io.js';
import { currentVolume } from './volume.js';
import { resetLoad, updateLayerView, updateLoadReadout, syncLoadUI } from './strength.js';
import { setDrawnWalls, setDrawMsg, markPrintTrisDirty, clearPreview } from './walls.js';
import { activeAdded, refreshFins, markFinsStale } from './finbuild.js';
import { finsVisible, setDrawAugment } from './settings.js';
import { gizmo, hoverFace, setGizmo, setLayPlacing } from '../app.js';

const partMaterial = new THREE.MeshStandardMaterial({
  color: 0xffffff, roughness: 0.62, metalness: 0.05,
  vertexColors: true, side: THREE.DoubleSide,
});
export let part = null;
export let partName = '';
export let topology = null;      // welded adjacency, rebuilt only when the mesh changes
let weldMs = 0;
export let analysisTiming = '';
let lastSize = null;

const SHADE = {
  plain: new THREE.Color().setHex(0xb9c2d0, THREE.SRGBColorSpace),
  over: new THREE.Color().setHex(0xff5a4d, THREE.SRGBColorSpace),
  bed: new THREE.Color().setHex(0x3f7fd0, THREE.SRGBColorSpace),
};

/**
 * Drop `geometry` onto the plate: centred in XY, its lowest point resting on
 * z=0. Returns the measured size so the caller can report it.
 */
export function setPart(geometry, filename) {
  if (part) {
    part.geometry.dispose();
    scene.remove(part);
  }
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  // Centre the geometry on its own origin in ALL THREE axes, so the part rotates
  // about its middle and the gizmo sits there rather than at its feet. Seating on
  // the plate is not this transform's job -- analyze() returns the offset for that
  // after the rotation is known.
  geometry.translate(
    -(bb.min.x + bb.max.x) / 2,
    -(bb.min.y + bb.max.y) / 2,
    -(bb.min.z + bb.max.z) / 2);
  // Always recompute shading normals from the winding -- never trust the STL's
  // stored normals. A binary STL carries a per-face normal that STLLoader loads
  // into a `normal` attribute, and exporters routinely write those as zero or
  // garbage (the same reason buildTopology derives its own). A zero normal lights
  // as pure black, so trusting the stored one renders the whole part invisible.
  // Dropping the attribute first forces computeVertexNormals to rebuild it.
  geometry.deleteAttribute('normal');
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();

  part = new THREE.Mesh(geometry, partMaterial);
  part.add(hoverFace);
  hoverFace.visible = false;
  scene.add(part);

  const nFaces = geometry.getAttribute('position').count / 3;
  geometry.setAttribute(
    'color', new THREE.Float32BufferAttribute(new Float32Array(nFaces * 9), 3));

  const tWeld = performance.now();
  topology = buildTopology(geometry);
  weldMs = performance.now() - tWeld;
  computeFlatBaseline();

  partName = filename;
  part.quaternion.identity();
  gizmo.attach(part);
  el('orient').hidden = false;

  // A new part starts with no hand-drawn walls and a fresh print-space cache.
  setDrawnWalls([]);
  // Per-fin removals are keyed by a content signature that can coincidentally
  // match a different model's fins, so they must NOT carry across parts -- clear
  // them here alongside the walls, or loading a new STL silently drops fins.
  resetRemovals();
  // Nor does an armed remove mode: it hides the rotate rings and turns every click
  // on the new part into a fin pick, so the part looked stuck until Esc.
  if (removeMode) cancelRemove();
  setDrawAugment(false);
  setDrawMsg('');
  markPrintTrisDirty();
  clearPreview();
  // A new part starts with no load direction either.
  resetLoad();
  setLayPlacing(false);
  controls.enabled = true;
  syncLoadUI();
  setGizmo();

  // Undo history does not carry across parts.
  resetHistory();

  const size = shade();
  frame(size);
  return size;
}

/**
 * Re-run the overhang analysis in the part's CURRENT orientation, re-seat it on
 * the plate, and paint the result. Cheap enough to call on every frame of a
 * gizmo drag -- the expensive weld already happened in setPart(), and rotation
 * cannot invalidate it.
 */
export const rotM3 = new THREE.Matrix3();
const rotM4 = new THREE.Matrix4();

// Overhangs in the AS-LOADED (identity) orientation. For an exported STL that is
// almost always the flat print pose, so it answers the question the leaf raised:
// does this part even need the tool? A part that prints flat with no overhangs
// gets none here, and every overhang the user then sees is one they created by
// rotating. Depends only on topology + threshold, never on rotation, so it is
// cached -- recomputed on load and on a threshold change, not per drag frame.
const IDENTITY3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
let flatRegions = null;
function computeFlatBaseline() {
  flatRegions = topology ? analyze(topology, threshold, IDENTITY3).regions.length : null;
}

export function shade() {
  if (!part || !topology) return new THREE.Vector3();
  rotM3.setFromMatrix4(rotM4.makeRotationFromQuaternion(part.quaternion));

  const t0 = performance.now();
  const res = analyze(topology, threshold, rotM3.elements);
  const ms = performance.now() - t0;

  // Drop the rotated part back onto the plate, centred over it -- but NOT mid-drag.
  // The rotate gizmo turns the part about part.position, so re-seating it every
  // frame slides the pivot out from under the pointer and the ring reads as jumpy /
  // jittery. While a drag is live we hold the pre-drag seat and let the part swing
  // about that fixed point; the drag-end handler re-seats once, on release. The
  // face SHADING below still updates live either way, so the diagnosis never stalls.
  if (!gizmo.dragging) part.position.set(res.offset.x, res.offset.y, res.offset.z);

  const size = new THREE.Vector3(res.size.x, res.size.y, res.size.z);
  report(partName, size);

  const colors = part.geometry.getAttribute('color');
  const arr = colors.array;
  for (let f = 0; f < topology.nFaces; f++) {
    const c = res.kept[f] ? SHADE.over : res.onBed[f] ? SHADE.bed : SHADE.plain;
    for (let i = 0; i < 3; i++) {
      const o = f * 9 + i * 3;
      arr[o] = c.r; arr[o + 1] = c.g; arr[o + 2] = c.b;
    }
  }
  colors.needsUpdate = true;

  const dropped = res.rawRegionCount - res.regions.length;
  el('s-over').textContent = res.regions.length === 0
    ? 'none'
    : `${res.regions.length} region${res.regions.length === 1 ? '' : 's'}` +
      (dropped ? ` (+${dropped} sliver${dropped === 1 ? '' : 's'})` : '');
  el('s-over').classList.toggle('good', res.regions.length === 0);

  // Overhang warning (bottom-right card). The tool builds support for the big
  // overhang REGIONS but drops the small ones -- hole ceilings, slot roofs, bore
  // tops -- as slivers. Those are exactly what prints rough by surprise, so name
  // them out loud instead of leaving the maker to find out at the printer. Only
  // fires when this pose actually has overhangs to support (a clean/flat pose says
  // its piece via s-flat-note); the fix is almost always a better orientation.
  const warn = el('over-warn');
  if (res.regions.length > 0 && dropped > 0) {
    warn.textContent = `⚠ ${dropped} small overhang${dropped === 1 ? '' : 's'} `
      + `(hole ceilings, slots, bore tops) print unsupported this way up and may come `
      + `out rough. Try Suggest orientation to point them up.`;
  } else {
    warn.textContent = '';
  }
  el('s-overarea').textContent = `${res.overArea.toFixed(0)} mm²`;
  el('s-bed').textContent = `${res.bedArea.toFixed(0)} mm²`;
  el('s-bed').classList.toggle('warn', res.bedArea < 1);

  // "Do you even need me?" -- fire the honest signal before the user turns fins
  // on. Current pose clean wins outright; otherwise, if the part printed flat as
  // loaded, the overhangs on screen are self-inflicted by rotating.
  const flat = el('s-flat-note');
  if (res.regions.length === 0) {
    flat.textContent = 'No supports needed this way up.';
    flat.className = 'note good';
  } else if (flatRegions === 0) {
    flat.textContent = 'This prints clean lying flat. You only need fins if you’re '
      + 'tilting it for strength.';
    flat.className = 'note';
  } else {
    flat.textContent = '';
  }
  // Kept as a value rather than read back off the element: the fin readout
  // appends to this line, and the mode / bed-pad / toggle handlers call
  // refreshFins() WITHOUT going through shade(), so appending in place stacked
  // up "· fins 3 ms · fins 3 ms · fins 3 ms" with every toggle.
  analysisTiming = `${ms.toFixed(0)} ms · weld ${weldMs.toFixed(0)} ms`;
  el('s-time').textContent = analysisTiming;

  lastResult = res;
  markPrintTrisDirty();       // orientation moved: the cached print-space part is stale
  if (finsVisible && !gizmo.dragging) refreshFins();
  else if (finsVisible) markFinsStale();

  // where the part currently sits, the way a slicer states it
  const [ex, ey, ez] = readableEuler(part.quaternion);
  el('rot-now').textContent = `X ${ex}° · Y ${ey}° · Z ${ez}°`;
  // both strength views are pose-dependent, so refresh them whenever the part turns:
  // the automatic layer view (always), and the optional load-arrow verdict (if set)
  updateLayerView(size);
  updateLoadReadout();
  syncLoadUI();            // re-light the pad button for the load's new world direction
  return size;
}

const wrap180 = (deg) => {
  const v = ((deg + 180) % 360 + 360) % 360 - 180;
  if (Object.is(v, -0)) return 0;
  return v === -180 ? 180 : v;      // half a turn reads better as +180
};

/**
 * Euler angles for display, in whichever of the two equivalent solutions reads
 * better. Every orientation has two XYZ triples, and the one three.js hands back
 * is often the ugly one: turning a part 90 degrees about Y twice reports
 * "X -180, Y 0, Z -180" rather than "Y 180". Same rotation, but a user reading it
 * cannot tell what they did.
 *
 * The alternate solution is verified against the original quaternion rather than
 * trusted, so a convention change in three.js degrades to the plain answer
 * instead of silently displaying a wrong one.
 */
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();

function readableEuler(q) {
  _e.setFromQuaternion(q, 'XYZ');
  const a = [_e.x, _e.y, _e.z].map((r) => wrap180(THREE.MathUtils.radToDeg(r)));
  const b = [wrap180(a[0] + 180), wrap180(180 - a[1]), wrap180(a[2] + 180)];

  const cost = (v) => Math.abs(v[0]) + Math.abs(v[1]) + Math.abs(v[2]);
  if (cost(b) < cost(a)) {
    _e.set(...b.map(THREE.MathUtils.degToRad), 'XYZ');
    _q.setFromEuler(_e);
    if (Math.abs(Math.abs(_q.dot(q)) - 1) < 1e-6) return b.map(Math.round);
  }
  return a.map(Math.round);
}

// -------------------------------------------------------------------- reports

function report(filename, size) {
  el('s-name').textContent = filename;
  el('s-tris').textContent = (topology?.nFaces ?? 0).toLocaleString();
  el('s-bbox').textContent =
    `${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)} mm`;

  lastSize = size;
  updateFit();

  // Empty string hides it: `.note:empty { display: none }`, same as the sibling notes.
  el('s-import-note').textContent = importNote;

  el('stats').hidden = false;
  el('status').hidden = false;
  el('drop').classList.add('hidden');
}

/**
 * Does it fit the build volume -- including everything the tool ADDS?
 *
 * Checking the part alone understates it. The pad spreads `padMargin` past the
 * part's contact and the fin's base another `basePad` past the wall, so a part
 * that fits on its own can still put its bed pad over the edge of the plate. The
 * export bakes those in, so the answer has to account for them.
 */
export function updateFit() {
  if (!lastSize) return;
  const v = currentVolume();
  let dx = lastSize.x, dy = lastSize.y, dz = lastSize.z;

  const added = activeAdded();
  if (added.length) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const t of added) {
      if (t[0] < x0) x0 = t[0]; if (t[0] > x1) x1 = t[0];
      if (t[1] < y0) y0 = t[1]; if (t[1] > y1) y1 = t[1];
      if (t[2] > z1) z1 = t[2];
    }
    // the part is centred on the plate, so what matters is the half-extent each
    // way, not the raw span of the fins alone
    dx = Math.max(dx, 2 * Math.max(Math.abs(x0), Math.abs(x1)));
    dy = Math.max(dy, 2 * Math.max(Math.abs(y0), Math.abs(y1)));
    dz = Math.max(dz, z1);
  }

  const over = dx > v.x || dy > v.y || dz > v.z;
  const fit = el('s-fit');
  fit.textContent = over
    ? (added.length ? 'does not fit (with fins)' : 'does not fit')
    : 'fits';
  fit.classList.toggle('warn', over);
}

export let lastResult = null;
export let threshold = DEFAULT_THRESHOLD;
const thrInput = el('thr');
thrInput.value = String(threshold);
thrInput.addEventListener('input', () => {
  threshold = Number(thrInput.value);
  el('thr-val').textContent = `${threshold}°`;
  computeFlatBaseline();   // the flat baseline moves with the overhang threshold
  shade();
});
