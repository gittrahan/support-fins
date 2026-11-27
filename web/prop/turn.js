/** Internal shared-engine turning option. Ordinary wall/foot/crest builders own
 * all profiles; a height frame changes only a proven free upper run. The caller
 * supplies print dimensions. This is geometric preflight, not a slicer model. */
import { sweep, sweepBetween } from "./sweep.js";
import { flatRunAxis } from "./bridge.js";
import { PROP } from "./config.js";
import { turnFrame, frameSweep } from "./turn-frame.js";
import { seatedSweep } from "./foot-seat.js";
import { insidePart, solidClearance } from "../inside.js";
import { buildTopology } from "../overhangs.js";
import { seatedPartTris } from "../fins/seating.js";
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const angle180 = (v) => (v % 180 + 180) % 180;
const delta = (to, from) => (to - from + 270) % 180 - 90;
const EPS = 1e-4; // float32 engine coordinates, not an input-repair allowance
const round = (v) => Math.round(v * 1e6) / 1e6;
export function turningBounds(positions) {
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    min[i % 3] = Math.min(min[i % 3], positions[i]);
    max[i % 3] = Math.max(max[i % 3], positions[i]);
  }
  return { min, max };
}
export function turningBoundsOverlap(a, b, gap) {
  return a.min.every((v, i) =>
    v <= b.max[i] + gap && a.max[i] + gap >= b.min[i]
  );
}
const area = (ring) =>
  Math.abs(ring.reduce((a, p, i) => {
    const q = ring[(i + 1) % ring.length];
    return a + p[0] * q[1] - p[1] * q[0];
  }, 0)) / 2;

/** An exact rectangular footprint, allowing collinear mesh-seam vertices. */
export function rectangle(ring) {
  if (
    ring.length < 4 ||
    ring.some((p) => p.length !== 2 || p.some((v) => !Number.isFinite(v)))
  ) return null;
  let best;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i],
      q = ring[(i + 1) % ring.length],
      dx = q[0] - p[0],
      dy = q[1] - p[1];
    if (Math.hypot(dx, dy) < EPS) continue;
    const a = Math.atan2(dy, dx),
      u = [Math.cos(a), Math.sin(a)],
      v = [-u[1], u[0]];
    const x = ring.map((p) => p[0] * u[0] + p[1] * u[1]),
      y = ring.map((p) => p[0] * v[0] + p[1] * v[1]);
    const lo = [Math.min(...x), Math.min(...y)],
      hi = [Math.max(...x), Math.max(...y)];
    const size = [hi[0] - lo[0], hi[1] - lo[1]], boxArea = size[0] * size[1];
    if (!best || boxArea < best.boxArea) {
      best = { a, u, v, lo, hi, size, boxArea };
    }
  }
  if (
    !best || best.size.some((n) => n < EPS) ||
    Math.abs(best.boxArea - area(ring)) > EPS * Math.max(...best.size)
  ) return null;
  const { u, v, lo, hi, size } = best;
  return {
    center: [
      u[0] * (lo[0] + hi[0]) / 2 + v[0] * (lo[1] + hi[1]) / 2,
      u[1] * (lo[0] + hi[0]) / 2 + v[1] * (lo[1] + hi[1]) / 2,
    ],
    angle: angle180(best.a * 180 / Math.PI + (size[1] > size[0] ? 90 : 0)),
    length: Math.max(...size),
    width: Math.min(...size),
  };
}

const topoOf = (positions) =>
  buildTopology({ getAttribute: () => ({ array: positions }) });
const ZERO = { x: 0, y: 0, z: 0 };
const vertices = (flat) =>
  Array.from(
    { length: flat.length / 3 },
    (_, i) => Array.from(flat.slice(i * 3, i * 3 + 3)),
  );
const bounds = (vs) => turningBounds(vs.flatMap((p) => p.slice(0, 3)));
const corners = (r) => {
  const a = r.angle * Math.PI / 180,
    u = [Math.cos(a), Math.sin(a)],
    v = [-u[1], u[0]];
  return [-1, 1].flatMap((x) =>
    [-1, 1].map(
      (y) => [
        r.center[0] + u[0] * x * r.length / 2 + v[0] * y * r.width / 2,
        r.center[1] + u[1] * x * r.length / 2 + v[1] * y * r.width / 2,
      ],
    )
  );
};
function within(p, r, margin = 0) {
  const a = r.angle * Math.PI / 180,
    x = p[0] - r.center[0],
    y = p[1] - r.center[1];
  return Math.abs(x * Math.cos(a) + y * Math.sin(a)) <=
      r.length / 2 - margin + EPS &&
    Math.abs(-x * Math.sin(a) + y * Math.cos(a)) <= r.width / 2 - margin + EPS;
}
// Closed oriented source surfaces are required for the containment check. No
// topology repair, geometric welding tolerance, or hidden source modification.
export function closedTurningMesh(vs) {
  const edges = new Map();
  let volume = 0;
  for (let i = 0; i < vs.length; i += 3) {
    const [a, b, c] = vs.slice(i, i + 3);
    if (!c || [...a, ...b, ...c].some((v) => !Number.isFinite(v))) return false;
    const u = b.map((v, j) => v - a[j]), v = c.map((v, j) => v - a[j]);
    if (
      Math.hypot(
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ) === 0
    ) return false;
    volume +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const x = p.slice(0, 3).join(","), y = q.slice(0, 3).join(",");
      if (x === y) return false;
      const k = [x, y].sort().join("|"), e = edges.get(k) ?? [0, 0];
      e[0]++;
      e[1] += x < y ? 1 : -1;
      edges.set(k, e);
    }
  }
  return volume > 0 &&
    [...edges.values()].every(([n, b]) => n === 2 && b === 0);
}
function rectangleRoof(vs, z) {
  const points = [], faces = [];
  let areaSum = 0;
  for (let i = 0; i < vs.length; i += 3) {
    const [a, b, c] = vs.slice(i, i + 3);
    if ([a, b, c].some((p) => Math.abs(p[2] - z) > EPS)) continue;
    const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (nz >= 0) continue;
    areaSum -= nz / 2;
    points.push(a, b, c);
    faces.push(i / 3);
  }
  if (!points.length) return null;
  // Convex hull removes interior triangulation vertices. Its area must also
  // equal the entire downward surface, ruling out holes/disconnected roofs.
  const pts = [
    ...new Map(points.map((p) => [p.slice(0, 2).join(","), p.slice(0, 2)]))
      .values(),
  ].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (a, b, c) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const half = (p) => {
    const out = [];
    for (const q of p) {
      while (out.length > 1 && cross(out.at(-2), out.at(-1), q) <= 0) out.pop();
      out.push(q);
    }
    return out.slice(0, -1);
  };
  const hull = [...half(pts), ...half([...pts].reverse())],
    shape = rectangle(hull);
  return shape &&
      Math.abs(areaSum - shape.length * shape.width) <=
        EPS * Math.max(shape.length, shape.width)
    ? { ...shape, faces }
    : null;
}
function clear(vs, topo, gap, containment = true) {
  const hit = solidClearance(topo, IDENTITY, ZERO, vs, gap, true);
  if (hit && hit.d + EPS < gap) return false;
  return !containment ||
    !vs.some((p) => insidePart(topo, IDENTITY, ZERO, ...p.slice(0, 3)));
}
/** Predict in the roof's own frame, using the same anchor rule as ordinary
 * walls. A turned top already has a foot, so it need not meet the plate-wall
 * minimum length that can otherwise override the bridge direction. */
function automaticDirection(source, roof) {
  const a = roof.angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const local = Float64Array.from(source);
  for (let i = 0; i < local.length; i += 3) {
    const x = source[i] - roof.center[0], y = source[i + 1] - roof.center[1];
    local[i] = x * c + y * s;
    local[i + 1] = -x * s + y * c;
  }
  const patch = roof.faces.flatMap((f) =>
    Array.from(local.subarray(f * 9, f * 9 + 9))
  );
  const axis = flatRunAxis(vertices(patch), patch, PROP.stationStep, {
    topo: topoOf(local),
    rot: IDENTITY,
    offset: ZERO,
  }, 0);
  return angle180(roof.angle + Math.atan2(axis[1], axis[0]) * 180 / Math.PI);
}
function volume(vs) {
  let sum = 0;
  for (let i = 0; i < vs.length; i += 3) {
    const [a, b, c] = vs.slice(i, i + 3);
    sum +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return Math.abs(sum);
}
function build(recipe, frame, partTris) {
  const out = [];
  if (recipe.seating) {
    const seated = seatedSweep(recipe.top, recipe.floor, recipe.seating, PROP.minHeight, partTris);
    if (!seated) throw Error("ordinary sweep could not reconstruct seated wall");
    return frameSweep(seated, frame);
  }
  const ok = recipe.floor
    ? sweepBetween(recipe.top, recipe.floor, out, PROP.minHeight, frame, null, partTris)
    : sweep(recipe.top, recipe.bed, out, PROP.minHeightSquat, frame);
  if (!ok) throw Error("ordinary sweep could not reconstruct wall");
  return out;
}
/** Mutates only this build's output. Rejected candidates keep exact geometry.
 * The option and returned records are structured-cloneable for worker callers. */
export function turnBuilt(topo, result, rot, built, request) {
  const stats = {
    turnedFins: 0,
    turningSkipped: 0,
    turningReasons: [],
    turningDetails: [],
  };
  built.turning = stats;
  const reasons = new Map(),
    reject = (why) => {
      stats.turningSkipped++;
      reasons.set(why, (reasons.get(why) ?? 0) + 1);
    };
  const d = request.dimensions;
  if (
    !d ||
    !["nozzle", "lineWidth", "layerHeight", "firstLayerHeight", "sideGap"]
      .every((k) => Number.isFinite(d[k]) && d[k] > 0)
  ) throw Error("turning needs explicit print dimensions");
  if (PROP.tineDir === "vertical") {
    stats.turningReasons = [
      "turning is unavailable for resin; original fins retained",
    ];
    return built;
  }
  if (d.layerHeight > d.nozzle || d.firstLayerHeight > d.nozzle) {
    throw Error("turning layer height exceeds nozzle");
  }
  const firstLayer = d.firstLayerHeight +
    (request.layerOffset ?? result.offset.z);
  const source = seatedPartTris(topo, rot, result.offset),
    model = vertices(source);
  if (!closedTurningMesh(model)) {
    for (const f of built.fins ?? []) {
      if (f.kind === "prop") {
        reject("source is not a closed solid; original fins retained");
      }
    }
  } else {
    const modelTopo = topoOf(source), replacements = new Map();
    for (const fin of built.fins ?? []) {
      if (fin.kind !== "prop") continue;
      try {
        if (request.disabled?.includes(String(fin.id))) {
          throw Error("plate clearance could not be established");
        }
        const recipe = fin.turnWall;
        if (!recipe || fin.triRanges.length !== 1) {
          throw Error("wall construction is outside initial turning scope");
        }
        const [from, to] = fin.triRanges[0],
          original = built.triangles.slice(from, to),
          ordinary = build(recipe, null, source);
        if (
          ordinary.length !== recipe.count ||
          ordinary.some((p, i) => p.some((v, j) => v !== original[i]?.[j]))
        ) throw Error("wall construction changed during placement");
        const top = recipe.top[0][2] - PROP.gap;
        if (recipe.top.some((p) => Math.abs(p[2] - PROP.gap - top) > EPS)) {
          throw Error("no level upper wall");
        }
        const roof = rectangleRoof(model, top + PROP.gap);
        if (!roof) throw Error("no isolated rectangular horizontal roof");
        const first = recipe.top[0],
          last = recipe.top.at(-1),
          length = Math.hypot(last[0] - first[0], last[1] - first[1]);
        const center = [(first[0] + last[0]) / 2, (first[1] + last[1]) / 2],
          axis = angle180(
            Math.atan2(last[1] - first[1], last[0] - first[0]) * 180 / Math.PI,
          );
        const ar = axis * Math.PI / 180;
        if (
          recipe.top.some((p) =>
            Math.abs(
              -(p[0] - center[0]) * Math.sin(ar) +
                (p[1] - center[1]) * Math.cos(ar),
            ) > EPS
          )
        ) throw Error("upper wall is not straight");
        const target = request.angle != null
            ? angle180(request.angle)
            : d.bridgeAngle != null
            ? angle180(d.bridgeAngle + 90)
            : roof.length < roof.width * 1.1
            ? axis
            : automaticDirection(source, roof),
          degrees = delta(target, axis);
        if (Math.abs(degrees) < 5) continue;
        if (roof.length > 12 + 2 * d.lineWidth) {
          throw Error("roof exceeds the initial turning coverage bound");
        }
        const tips = original.slice(recipe.count),
          base = Math.max(
            PROP.baseH,
            recipe.seating?.end ?? 0,
            ...(recipe.floor ?? []).map((p) =>
              Math.max(...p.slice(2)) + PROP.footGap
            ),
            ...tips.map((p) => p[2]),
          );
        const end = top -
          Math.max(
            PROP.tipH,
            PROP.iface ? PROP.ifaceLayers * d.layerHeight : 0,
          ) - d.layerHeight;
        // Keep at least two complete layers above the last retained lower contact.
        const start = base + 2 * d.layerHeight;
        const ra = roof.angle * Math.PI / 180,
          dx = center[0] - roof.center[0],
          dy = center[1] - roof.center[1];
        const freeRadius = Math.min(
          roof.length / 2 - Math.abs(dx * Math.cos(ra) + dy * Math.sin(ra)),
          roof.width / 2 - Math.abs(-dx * Math.sin(ra) + dy * Math.cos(ra)),
        ) - d.sideGap;
        if (freeRadius <= PROP.th / 2) {
          throw Error("no clear turning footprint");
        }
        let endLength = Math.min(
          length,
          2 * Math.sqrt(Math.max(0, freeRadius ** 2 - (PROP.th / 2) ** 2)),
        );
        while (
          endLength >= 3 * d.lineWidth &&
          !corners({ center, angle: target, length: endLength, width: PROP.th })
            .every((p) => within(p, roof, d.sideGap))
        ) endLength -= d.lineWidth / 2;
        if (endLength < 3 * d.lineWidth) {
          throw Error("no crosswise strip fits beneath the roof");
        }
        const strip = {
          center,
          angle: target,
          length: endLength,
          width: PROP.tip,
        };
        const reach = Math.max(
          ...corners(roof).map((p) => {
            const a = target * Math.PI / 180,
              x = p[0] - center[0],
              y = p[1] - center[1];
            return Math.hypot(
              Math.max(
                0,
                Math.abs(x * Math.cos(a) + y * Math.sin(a)) - endLength / 2,
              ),
              Math.max(
                0,
                Math.abs(-x * Math.sin(a) + y * Math.cos(a)) - strip.width / 2,
              ),
            );
          }),
        );
        if (reach > 6 + EPS) {
          throw Error("turned top leaves excessive roof reach");
        }
        const radius = Math.hypot(length / 2, PROP.th / 2);
        const frame = turnFrame({
          center,
          start,
          end,
          degrees,
          layerHeight: d.layerHeight,
          radius,
          axis,
          endScale: endLength / length,
        });
        const wall = build(recipe, frame, source), upper = [];
        for (let i = 0; i < wall.length; i += 3) {
          if (wall.slice(i, i + 3).some((p) => p[2] > start + EPS)) {
            upper.push(...wall.slice(i, i + 3));
          }
        }
        if (!upper.every((p) => within(p, roof))) {
          throw Error("turn extends beyond original roof footprint");
        }
        const sides = source.filter((_, i) =>
          !roof.faces.includes(Math.floor(i / 9))
        );
        if (
          !clear(upper, modelTopo, Math.min(PROP.gap, d.sideGap)) ||
          sides.length &&
            !clear(upper, topoOf(Float64Array.from(sides)), d.sideGap, false)
        ) throw Error("turn lacks model clearance");
        const b = bounds(upper);
        for (let f = 0; f < result.over.length; f++) {
          if (
            result.over[f] &&
            (!result.kept[f] || result.excludedSupportFaces?.[f])
          ) {
            const face = model.slice(f * 3, f * 3 + 3), fb = bounds(face);
            fb.min[2] = 0;
            if (turningBoundsOverlap(b, fb, 0)) {
              throw Error("turn crosses an excluded overhang column");
            }
          }
        }
        for (const other of built.fins ?? []) {
          if (other !== fin) {
            const vs = replacements.get(other.id)?.triangles ??
              other.triRanges.flatMap(([a, b]) => built.triangles.slice(a, b));
            if (turningBoundsOverlap(b, bounds(vs), d.sideGap)) {
              throw Error("turn overlaps another support envelope");
            }
          }
        }
        const serialized = wall.map((p) =>
          p.slice(0, 3).map((v) => round(Math.fround(v)))
        );
        // Separate flange/crest shells may overlap; their own directed edges remain
        // closed. Failure is a fallback, never mesh repair at this boundary.
        if (!closedTurningMesh(serialized)) {
          throw Error("turned sweep does not survive export precision");
        }
        replacements.set(fin.id, {
          triangles: [...wall, ...tips],
          sourceFrom: from,
          volumeDelta: volume(wall) - volume(ordinary),
          line: recipe.top.map((p) => frame.at([p[0], p[1], p[2] - PROP.gap])),
        });
        stats.turnedFins++;
        stats.turningDetails.push({
          piece: String(fin.id),
          topAngle: target,
          turnDegrees: degrees,
          joinZ: start,
          firstPrintZ: firstLayer +
            (Math.floor(
                (start + d.layerHeight / 2 - firstLayer) / d.layerHeight,
              ) + 1) * d.layerHeight,
          lastPrintZ: firstLayer +
            (Math.ceil((top + d.layerHeight / 2 - firstLayer) / d.layerHeight) -
                1) * d.layerHeight,
          turnEndZ: end,
          topZ: top,
          roofReach: reach,
          bounds: b,
        });
      } catch (e) {
        reject(e.message);
      }
    }
    if (replacements.size) {
      const old = built.triangles, out = [], remap = new Map();
      const at = new Map(
        (built.fins ?? []).filter((f) => replacements.has(f.id)).map(
          (f) => [f.triRanges[0][0], f],
        ),
      );
      for (let i = 0; i < old.length;) {
        const fin = at.get(i);
        if (fin) {
          const r = replacements.get(fin.id);
          remap.set(i, out.length);
          for (const p of r.triangles) out.push(p);
          i = fin.triRanges[0][1];
          remap.set(i, out.length);
        } else {
          remap.set(i, out.length);
          out.push(old[i++]);
        }
      }
      remap.set(old.length, out.length);
      const update = (f) => ({
        ...f,
        triRanges: f.triRanges.map(([a, b]) => [remap.get(a), remap.get(b)]),
        ...(replacements.has(f.id)
          ? { line: replacements.get(f.id).line, turning: true }
          : {}),
      });
      const byStart = new Map(
        [...replacements.values()].map((r) => [r.sourceFrom, r]),
      );
      built.fins = built.fins.map(update);
      built.props = (built.props ?? []).map((p) => ({
        ...p,
        triRanges: p.triRanges.map(([a, b]) => [remap.get(a), remap.get(b)]),
        ...(byStart.has(p.triRanges[0]?.[0])
          ? {
            line: byStart.get(p.triRanges[0][0]).line,
            volume: (p.volume ?? 0) +
              byStart.get(p.triRanges[0][0]).volumeDelta,
          }
          : {}),
      }));
      if (Number.isFinite(built.volume)) {
        for (const r of replacements.values()) {
          built.volume += r.volumeDelta;
        }
      }
      built.triangles = out;
    }
  }
  stats.turningReasons = [...reasons].map(([r, n]) => `${n}: ${r}`);
  // Recipes are transient build data, not additional public result or cache fields.
  for (const f of [...built.fins ?? [], ...built.props ?? []]) {
    delete f.turnWall;
  }
  return built;
}
