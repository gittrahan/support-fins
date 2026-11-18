// Project orchestration only. Shapes are built by the shared engine.
import { computeFins } from "../shared/engine/fins_entry.js";
import { turningRuntime } from "./project-turning-geometry.js";
import { buildTopology } from "../../web/overhangs.js";
import { solidClearance } from "../../web/inside.js";
import { turningBounds, turningBoundsOverlap } from "../../web/prop/turn.js";
export {
  rectangle,
  turningBounds,
  turningBoundsOverlap,
} from "../../web/prop/turn.js";
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1], EPS = 1e-4;
const clearanceDistance = (...args) => solidClearance(...args)?.d ?? Infinity;
function mesh(w, flat) {
  if (!flat.length || flat.length % 9 || !flat.every(Number.isFinite)) {
    throw Error("invalid triangle soup");
  }
  const points = [], ids = new Map(), indices = [];
  for (let i = 0; i < flat.length; i += 3) {
    const p = Array.from(flat.slice(i, i + 3)), key = p.join(",");
    if (!ids.has(key)) {
      ids.set(key, points.length / 3);
      points.push(...p);
    }
    indices.push(ids.get(key));
  }
  let solid;
  try {
    solid = new w.Manifold(
      new w.Mesh({
        numProp: 3,
        vertProperties: Float32Array.from(points),
        triVerts: Uint32Array.from(indices),
      }),
    );
  } catch (cause) {
    throw new Error("mesh is not a closed solid", { cause });
  }
  if (solid.status() !== "NoError" || solid.isEmpty()) {
    solid.delete();
    throw Error("mesh is not a closed solid");
  }
  return solid;
}
const topoOf = (positions) =>
  buildTopology({
    getAttribute: (key) => key === "position" ? { array: positions } : null,
  });
export async function validateTurningNeighbor(positions, neighbor, gap) {
  if (!neighbor.length) return;
  if (
    !turningBoundsOverlap(
      turningBounds(positions),
      turningBounds(neighbor),
      gap,
    )
  ) return;
  const w = await turningRuntime();
  let candidate, obstacle, hit;
  try {
    candidate = mesh(w, positions);
    obstacle = mesh(w, neighbor);
    hit = candidate.intersect(obstacle);
    if (!hit.isEmpty()) throw Error("turn intersects another plate object");
    const verts = Array.from(
      { length: positions.length / 3 },
      (_, i) => Array.from(positions.slice(i * 3, i * 3 + 3)),
    );
    if (
      clearanceDistance(
            topoOf(neighbor),
            IDENTITY,
            { x: 0, y: 0, z: 0 },
            verts,
            gap,
            true,
          ) + EPS < gap
    ) {
      throw Error("turn is too close to another plate object");
    }
  } finally {
    hit?.delete();
    obstacle?.delete();
    candidate?.delete();
  }
}

/** Each neighbor's unchanged supports are computed at most once per plate.
 * Do not retain decoded source meshes or failed partial results. */
export function plateFinCache(generate = computeFins) {
  let plate, entries = new Map();
  return {
    get(id, number, positions, options) {
      if (id !== plate) {
        entries.clear();
        plate = id;
      }
      const key = JSON.stringify([number, options]);
      if (!entries.has(key)) {
        try {
          const fins = generate(positions, options);
          entries.set(key, {
            positions: Float64Array.from(
              fins.triangles,
              (v, i) =>
                v - [fins.offset.x, fins.offset.y, fins.offset.z][i % 3],
            ),
          });
        } catch (e) {
          entries.set(key, { error: e.message });
        }
      }
      const entry = entries.get(key);
      if (entry.error) throw Error(entry.error);
      return entry.positions;
    },
    clear() {
      entries.clear();
      plate = undefined;
    },
  };
}
/** The synchronous engine owns candidate geometry. The async project layer
 * checks other selected/unselected objects, then asks the same engine to retain
 * rejected pieces. No CLI-only support construction or input-mesh repair. */
export async function validateTurnSet(generate, validate) {
  const disabled = [], reasons = [];
  for (;;) {
    const generated = generate(disabled);
    let rejected = false;
    for (const d of generated.stats.turningDetails) {
      if (disabled.includes(d.piece)) {
        throw Error("engine repeated a rejected turn");
      }
      try {
        await validate(generated, d);
      } catch (e) {
        disabled.push(d.piece);
        reasons.push(`${d.piece}: ${e.message}`);
        rejected = true;
      }
    }
    if (!rejected) {
      generated.stats.turningReasons.push(...reasons);
      return generated;
    }
    // Retaining a straight piece changes the local obstacle envelopes. Another
    // candidate can become eligible on the next build: validate that complete
    // result too, never export newly enabled turns without the plate checks.
  }
}
export async function turnProjectFins(
  { positions, options, dimensions, angle = null, validate },
) {
  if (typeof validate !== "function") {
    throw Error("turning fins require a plate-object clearance validator");
  }
  const request = { dimensions, angle };
  const generated = await validateTurnSet(
    (disabled) =>
      computeFins(positions, { ...options, turning: { ...request, disabled } }),
    async (candidate, d) => {
      const piece = candidate.pieces.find((p) => p.id === d.piece);
      const flat = Float64Array.from(
        piece.ranges.flatMap(([a, b]) =>
          Array.from(candidate.triangles.subarray(a * 9, b * 9))
        ),
        (v, i) =>
          v -
          [candidate.offset.x, candidate.offset.y, candidate.offset.z][i % 3],
      );
      await validate(flat);
    },
  );
  // Engine bounds use its seated frame. Project/cache records use world axes.
  for (const d of generated.stats.turningDetails) {
    for (const key of ["min", "max"]) {
      d.bounds[key] = d.bounds[key].map((v, i) =>
        v - [generated.offset.x, generated.offset.y, generated.offset.z][i]
      );
    }
    for (
      const key of ["joinZ", "firstPrintZ", "lastPrintZ", "topZ", "turnEndZ"]
    ) {
      d[key] -= generated.offset.z;
    }
  }
  return generated;
}
