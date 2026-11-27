/** Seat clearly unsupported straight part walls beside a ledge (#482).
 * The ordinary sweep still owns the wall, cutouts and interface crest. Only its
 * lower run is translated; it returns before the existing top/contact geometry.
 * This is conservative geometric preflight, not a slicer or print certification.
 */
import { PROP } from './config.js';
import { surfaceHitsAt } from './surface.js';
import { floorLine, PART_FOOT_REACH } from './mold.js';
import { sweepBetween } from './sweep.js';
import { frameSweep } from './turn-frame.js';
import { levelsOn, levelCell, levelCut } from './levels.js';
import { insidePart, solidClearance } from '../inside.js';
import { buildTopology } from '../overhangs.js';
import { sectionMesh, sectionAt, area, difference, intersection, offset } from '../fins/sections.js';

const ID = [1, 0, 0, 0, 1, 0, 0, 0, 1], ZERO = { x: 0, y: 0, z: 0 };
const EPS = 1e-4, MAX_STATIONS = 4096;
const contexts = new WeakMap();
const exclusions = new WeakMap();
const topology = (array) => buildTopology({ getAttribute: () => ({ array }) });

function context(tris) {
  let c = contexts.get(tris);
  if (c) return c;
  const up = [], sides = [];
  for (let i = 0; i < tris.length; i += 9) {
    const nz = (tris[i + 3] - tris[i]) * (tris[i + 7] - tris[i + 1])
      - (tris[i + 4] - tris[i + 1]) * (tris[i + 6] - tris[i]);
    const target = nz > 0 ? up : sides;
    for (let k = 0; k < 9; k++) target.push(tris[i + k]);
  }
  c = { up: Float64Array.from(up), sides: topology(Float64Array.from(sides)),
    topo: topology(tris), sections: sectionMesh(tris), gap: null };
  contexts.set(tris, c);
  return c;
}

function floorAt(tris, x, y, ceiling, upward) {
  let z = 0;
  for (const [hit, nz] of surfaceHitsAt(tris, x, y)) {
    if ((!upward || nz > .05) && hit < ceiling && hit > z) z = hit;
  }
  return z;
}

function bearing(top, floor, tris, sx, sy, layer, upward = false, reach = 2 * layer + .05) {
  let good = 0, count = 0;
  for (let i = 0; i < top.length; i++) {
    const p = top[i], f = floor[i];
    for (let k = 0; k <= 8; k++) {
      const t = k / 8, o = (t - .5) * PROP.th;
      const base = (f[3] ?? f[2]) * (1 - t) + (f[4] ?? f[2]) * t;
      const below = floorAt(tris, p[0] + sx * o, p[1] + sy * o, Math.min(p[2] - 1, base + .01), upward);
      const hang = base - below;
      if (hang >= -EPS && hang <= reach) good++;
      count++;
    }
  }
  return good / count;
}

/** A structured-cloneable recipe; shared by the initial and turning rebuilds. */
export function footSeatFrame(route) {
  const { delta, sx, sy, start, end } = route;
  return { degrees: 1, levels: [start, end], at(p) {
    if (p[2] >= end) return p;
    const shift = delta * Math.min(1, (end - p[2]) / (end - start));
    const q = [p[0] + sx * shift, p[1] + sy * shift, p[2]];
    if (p.length > 3) q.push(p[3]);
    return q;
  } };
}

// At the ordinary nominal line width, require the first printable footprint to
// stand above the model across the intended bottom gap. Use supplied layer
// boundaries (including the browser First layer setting), or the uniform grid.
// Exact slicer widths and generated paths still require final slicing.
function firstLayerSeated(triangles, c, layer, end) {
  const mesh = sectionMesh(triangles.map(p => p.slice(0, 3))), width = PROP.nominalLineWidth;
  // CAD triangle soups can contain harmless seams without paired mesh edges.
  // Require closed, consistently wound source sections across the changed run
  // instead of repairing those seams or assuming a globally closed solid.
  const cellAt = z => levelsOn() ? levelCell(z) : {
    bot: Math.max(0, Math.round(z / layer)) * layer,
    top: (Math.max(0, Math.round(z / layer)) + 1) * layer,
  };
  // Include a complete preceding cell when checking source sections.
  let cell = cellAt(Math.max(0, mesh.minZ - 2 * layer - PROP.footGap));
  while ((cell.bot + cell.top) / 2 <= end + layer) {
    const mid = (cell.bot + cell.top) / 2;
    if (mid >= mesh.minZ - 2 * layer - PROP.footGap) sectionAt(c.sections, mid);
    cell = cellAt(cell.top);
  }
  cell = cellAt(mesh.minZ - 1e-9);
  for (let i = 0; i < 10; i++, cell = cellAt(cell.top)) {
    const section = sectionAt(mesh, (cell.bot + cell.top) / 2);
    const core = offset(section, -width / 2 + 1e-6);
    if (!area(core)) continue;
    if (cell.bot <= EPS && mesh.minZ <= EPS) return true;
    const footprint = intersection(offset(core, width / 2), section);
    let belowZ = cell.bot - PROP.footGap - layer / 2;
    if (levelsOn()) {
      const boundary = levelCut(cell.bot - PROP.footGap, 1);
      if (boundary < 0) return false;
      const below = levelCell(boundary);
      belowZ = (below.bot + below.top) / 2;
    }
    const below = sectionAt(c.sections, belowZ);
    return area(difference(footprint, below)) <= 1e-6;
  }
  return false;
}

/** Sweep a seated wall: the ordinary sweep, then its lower run moved by
 * footSeatFrame(route). With `tris`, Line anchors (prop/anchors.js) are checked
 * against the part shifted back by the route's delta, i.e. against the floor
 * the moved foot actually lands on, and move with the foot. A contact reaching
 * the bend (which would not move rigidly) is dropped and counted as skipped.
 * `details` receives bodyEnd (index before the contacts) and anchorsSkipped.
 * Shared by seatPartWall and turning's rebuild, so both produce one mesh. */
export function seatedSweep(top, floor, route, minH, tris, details = {}) {
  const local = [], d = {};
  let source;
  if (tris && PROP.bottomAnchors) {
    const dx = -route.sx * route.delta, dy = -route.sy * route.delta;
    source = Float64Array.from(tris, (v, i) => v + (i % 3 === 0 ? dx : i % 3 === 1 ? dy : 0));
  }
  if (!sweepBetween(top, floor, local, minH, null, route.end, source, d)) return null;
  const frame = footSeatFrame(route);
  const body = frameSweep(local.slice(0, d.bodyEnd), frame);
  let anchors = local.slice(d.bodyEnd), skipped = d.anchorsSkipped ?? 0;
  if (anchors.some(p => p[2] >= route.start - EPS)) { anchors = []; skipped = 1; }
  Object.assign(details, { bodyEnd: body.length, anchorsSkipped: skipped });
  return body.concat(frameSweep(anchors, frame));
}

/** Return an ordinary wall, a corrected wall, or a degenerate verdict.
 * A failed landing search retains the ordinary wall and reports seatingSkipped;
 * this does not certify its landing or bypass the callers' existing clearance checks.
 * Curved/welded walls retain their existing path. Straight walls are rerouted
 * only when at least 90% of the bottom probes exceed the ordinary foot's reach;
 * this does not retune the existing permissible tilt of a partially seated foot.
 */
export function seatPartWall(mold, tris, layer = PROP.tineH, minH = PROP.minHeight, keepClear = null) {
  const ordinary = [], details = {};
  if (!sweepBetween(mold.top, mold.floor, ordinary, minH, null, null, tris, details)) return { ok: false };
  const unchanged = { ok: true, triangles: ordinary, ...mold, bodyEnd: details.bodyEnd, anchorsSkipped: details.anchorsSkipped ?? 0 };
  const fallback = reason => ({ ...unchanged, seatingSkipped: 1, seatingReason: reason });
  if (!(PROP.footGap > 0) || PROP.tineDir === 'vertical' || !(layer > 0)) return unchanged;
  const top = mold.top, first = top[0], last = top.at(-1);
  const length = Math.hypot(last[0] - first[0], last[1] - first[1]);
  if (length < PROP.minSpanPart) return unchanged;
  const sx = (last[1] - first[1]) / length, sy = -(last[0] - first[0]) / length;
  if (top.some(p => Math.abs((p[0] - first[0]) * sx + (p[1] - first[1]) * sy) > EPS)) return unchanged;
  // Continuous steep seats already have a separate, calibrated tilt policy.
  // Only a drop beyond that policy is evidence of the discrete ledge failure.
  if (bearing(top, mold.floor, tris, sx, sy, layer, false,
    Math.max(PART_FOOT_REACH, 2 * layer + .05)) > .1) return unchanged;

  const oldFloor = Math.max(...mold.floor.map(f => f[2]));
  const dense = [], step = Math.min(layer, PROP.th / 5);
  for (let i = 0; i + 1 < top.length; i++) {
    const a = top[i], b = top[i + 1], n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step);
    if (dense.length + n > MAX_STATIONS) return fallback('station-limit');
    for (let k = 0; k < n; k++) dense.push(a.map((v, j) => v + (b[j] - v) * k / n));
  }
  dense.push(last);
  const c = context(tris);
  let excluded = null;
  if (keepClear?.length) {
    excluded = exclusions.get(keepClear);
    if (!excluded) {
      excluded = topology(Float64Array.from(keepClear.flatMap(p => p.slice(0, 3))));
      exclusions.set(keepClear, excluded);
    }
  }
  if (c.gap !== PROP.footGap) {
    c.raised = topology(Float64Array.from(tris, (v, i) => v + (i % 3 === 2 ? PROP.footGap - EPS : 0)));
    c.gap = PROP.footGap;
  }
  // Smallest lateral change wins; ties use the same local negative/positive
  // order. Forty pairs bound work independently of model size and wall length.
  const increment = PROP.th / 10;
  // Prefer another part landing before considering the much longer plate route.
  for (const onPlate of [false, true]) for (let k = 1; k <= 40; k++) for (const sign of [-1, 1]) {
    const delta = sign * k * increment;
    const shifted = dense.map(p => [p[0] + sx * delta, p[1] + sy * delta, p[2]]);
    const margin = Math.max(1, Math.min(...top.map(p => p[2])) - oldFloor - Math.abs(delta) - 2 * layer);
    const floor = floorLine(shifted, c.up, margin, true);
    if (onPlate !== floor.every(f => f[2] === 0)) continue;
    if (bearing(shifted, floor, tris, sx, sy, layer, true) < 1) continue;
    let bottom = 0;
    for (const f of floor) bottom = Math.max(bottom, Math.max(...f.slice(2)) + (f[2] > 0 ? PROP.footGap : 0));
    const start = Math.max(bottom + 2 * layer, oldFloor + PROP.sideClear);
    const end = start + Math.abs(delta);
    const neck = Math.min(...top.map(p => p[2] - PROP.gap)) - Math.max(PROP.tipH,
      PROP.iface ? PROP.ifaceLayers * layer : 0) - layer;
    if (end >= neck) continue;
    const route = { delta, sx, sy, start, end };
    // Candidates are judged on the wall body alone; contacts follow the winner.
    const triangles = seatedSweep(dense, floor, route, minH, null);
    if (!triangles) continue;
    // Test the complete changed lower solid, including the old landing height.
    const cut = Math.max(end, ...mold.floor.flatMap(f => f.slice(2).map(z => z + PROP.footGap))) + layer / 2;
    const split = frameSweep(triangles, { degrees: 1, levels: [cut], at: p => p });
    const lower = [];
    for (let i = 0; i < split.length; i += 3) {
      if (split.slice(i, i + 3).every(p => p[2] <= cut)) lower.push(...split.slice(i, i + 3));
    }
    const gapHit = solidClearance(c.raised, ID, ZERO, lower, 1e-5, true);
    if (gapHit && gapHit.d < 1e-7) continue;
    const sideHit = solidClearance(c.sides, ID, ZERO, lower, PROP.sideClear, true);
    if (sideHit && sideHit.d < PROP.sideClear - EPS) continue;
    if (lower.some(p => insidePart(c.topo, ID, ZERO, p[0], p[1], p[2]))) continue;
    if (excluded) {
      const hit = solidClearance(excluded, ID, ZERO, lower, EPS, true);
      if (hit && hit.d < EPS) continue;
      if (lower.some(p => insidePart(excluded, ID, ZERO, p[0], p[1], p[2]))) continue;
      const wallTopo = topology(Float64Array.from(triangles.flatMap(p => p.slice(0, 3))));
      if (keepClear.some(p => p[2] <= cut && insidePart(wallTopo, ID, ZERO, p[0], p[1], p[2]))) continue;
    }
    try {
      if (!firstLayerSeated(triangles, c, layer, cut)) continue;
    } catch (_) { continue; } // open/inconsistent sections cannot certify a route
    const seated = {};
    const withAnchors = PROP.bottomAnchors ? seatedSweep(dense, floor, route, minH, tris, seated) : null;
    return { ok: true, triangles: withAnchors ?? triangles, bodyEnd: seated.bodyEnd ?? triangles.length,
      anchorsSkipped: withAnchors ? seated.anchorsSkipped : 0, top: dense, floor, route };
  }
  return fallback('no-landing');
}
