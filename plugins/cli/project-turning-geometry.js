let wasmBinary, runtime;
/** The CLI bundle supplies the existing vendored WASM bytes. */
export function setTurningWasm(bytes) { wasmBinary = bytes; runtime = null; }
export function turningRuntime() {
  runtime ??= import('../../web/vendor/manifold-3d-3.5.4/manifold.js').then(async ({ default: init }) => {
    const w = await init(wasmBinary ? { wasmBinary } : {}); w.setup(); return w;
  }).catch((e) => { runtime = null; throw e; });
  return runtime;
}

// A closed, layer-stepped turn for preserved-project supports. Every dimension
// comes from the caller; this module does not infer roof direction or repair meshes.
const round = (n) => Number(n.toFixed(6));
const EPS = 1e-7;

export function planTurn(input) {
  const p = { ...input, center: [...(input.center ?? [])] };
  for (const key of ['nozzle', 'lineWidth', 'firstLayerHeight', 'layerHeight',
    'firstPrintZ', 'lastPrintZ', 'topZ', 'startLength', 'endLength']) {
    if (!Number.isFinite(p[key]) || p[key] <= 0) throw Error(`invalid ${key}`);
  }
  if (p.center.length !== 2 || p.center.some((n) => !Number.isFinite(n))) throw Error('invalid center');
  if (!Number.isFinite(p.startAngle) || !Number.isFinite(p.turnDegrees) || Math.abs(p.turnDegrees) > 90) {
    throw Error('invalid turn angle');
  }
  if (p.layerHeight > p.nozzle || p.firstLayerHeight > p.nozzle) throw Error('layer exceeds nozzle');
  // Bounded prototype: two-line endpoints and a three-line middle. Refuse
  // shorter-than-wide strips instead of inventing a different contact shape.
  if (Math.min(p.startLength, p.endLength) < 3 * p.lineWidth) throw Error('insufficient fin length');
  for (const key of ['firstPrintZ', 'lastPrintZ']) {
    const n = (p[key] - p.firstLayerHeight) / p.layerHeight;
    if (n < 1 || Math.abs(n - Math.round(n)) > EPS) throw Error('turn must follow established fixed layers');
  }
  const intervals = Math.round((p.lastPrintZ - p.firstPrintZ) / p.layerHeight);
  if (intervals < 1 || intervals > 4096) throw Error('invalid turn height');
  if (p.topZ < p.lastPrintZ || p.topZ >= p.lastPrintZ + p.layerHeight / 2 - EPS) {
    throw Error('top does not end on the intended last slice layer');
  }
  const steps = [];
  for (let i = 0; i <= intervals; i++) {
    const t = i / intervals, printZ = round(p.firstPrintZ + i * p.layerHeight);
    const halfLength = (p.startLength + (p.endLength - p.startLength) * t) / 2;
    const width = 2 * p.lineWidth + p.lineWidth * Math.sin(Math.PI * t);
    const angle = p.startAngle + p.turnDegrees * t, r = angle * Math.PI / 180;
    const corners = [[-halfLength, -width / 2], [halfLength, -width / 2],
      [halfLength, width / 2], [-halfLength, width / 2]].map(([x, y]) => [
        p.center[0] + x * Math.cos(r) - y * Math.sin(r),
        p.center[1] + x * Math.sin(r) + y * Math.cos(r),
      ]);
    steps.push({ printZ, bottom: round(printZ - p.layerHeight),
      top: i === intervals ? p.topZ : printZ, halfLength, width, angle, corners });
  }
  const maximumCornerStep = Math.max(...steps.slice(1).flatMap((s, i) => s.corners.map((c, j) =>
    Math.hypot(c[0] - steps[i].corners[j][0], c[1] - steps[i].corners[j][1]))));
  // A sufficient geometric bound; this does not predict native bead placement.
  if (maximumCornerStep > p.layerHeight + EPS) throw Error('insufficient height for the 45-degree growth bound');
  return { settings: p, steps, maximumCornerStep };
}

/** Caller owns returned solid. Obstacles are caller-owned closed solids, including
 * any separately constructed clearance/exclusion envelopes. They are not repaired. */
export function buildTurn(w, input, obstacles = []) {
  const plan = planTurn(input), slabs = [];
  let result;
  try {
    for (const s of plan.steps) {
      const block = w.Manifold.cube([2 * s.halfLength, s.width, s.top - s.bottom]);
      let centered, rotated;
      try {
        centered = block.translate([-s.halfLength, -s.width / 2, s.bottom]);
        rotated = centered.rotate([0, 0, s.angle]);
        // Avoid a no-op transform so the printed recipe remains reproducible.
        if (plan.settings.center.every((n) => n === 0)) {
          slabs.push(rotated); rotated = undefined;
        } else slabs.push(rotated.translate([...plan.settings.center, 0]));
      } finally { rotated?.delete(); centered?.delete(); block.delete(); }
    }
    result = w.Manifold.union(slabs);
    if (result.status() !== 'NoError' || result.isEmpty()) throw Error('invalid generated turn');
    const parts = result.decompose();
    try { if (parts.length !== 1) throw Error('disconnected generated turn'); }
    finally { for (const part of parts) part.delete(); }
    for (const obstacle of obstacles) {
      if (obstacle.solid.status() !== 'NoError' || obstacle.solid.isEmpty()) throw Error('invalid obstacle');
      const collision = result.intersect(obstacle.solid);
      try { if (!collision.isEmpty()) throw Error(`turn intersects ${obstacle.id}`); }
      finally { collision.delete(); }
    }
    return { solid: result, plan };
  } catch (e) { result?.delete(); throw e; }
  finally { for (const slab of slabs) slab.delete(); }
}

export function triangles(solid) {
  const m = solid.getMesh(), out = [];
  for (const i of m.triVerts) out.push(Array.from(m.vertProperties.slice(i * m.numProp, i * m.numProp + 3), round));
  return out;
}
