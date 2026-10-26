/** Pure version of ui/walls.js's manual sweep; no DOM or THREE dependency. */
import { applyTunables } from "./fins.js";
import { drawnWall } from "./draw.js";
import { swayAtFace } from "./sway.js";
import { planGrid } from "./fins/tall.js";
export function printTriangles(topo, rot, offset) {
  const out = new Float64Array(topo.pos.length), p = topo.pos;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    out[i] = rot[0] * x + rot[3] * y + rot[6] * z + offset.x;
    out[i + 1] = rot[1] * x + rot[4] * y + rot[7] * z + offset.y;
    out[i + 2] = rot[2] * x + rot[5] * y + rot[8] * z + offset.z;
  }
  return out;
}
export function autoSupports(built, gone = []) {
  const removed = new Set(gone),
    braces = [],
    walls = [],
    outlines = built?.sway?.braces ?? [];
  let k = 0;
  for (const rec of built?.fins ?? []) {
    if (rec.kind === "sway") {
      const r = outlines[k++];
      if (r && !removed.has(rec.id)) braces.push(r);
    } else if (!removed.has(rec.id) && rec.line?.length) walls.push(rec.line);
  }
  return { braces, walls };
}
export function buildDrawn(
  topo,
  result,
  rot,
  requests,
  options = {},
  avoid = {},
  partTris = null,
) {
  applyTunables(options.tunables);
  const tris = partTris ?? printTriangles(topo, rot, result.offset),
    out = [],
    items = [],
    built = options.auto;
  const gone = new Set(options.gone ?? []), ribGrid = planGrid();
  for (const rec of built?.fins ?? []) {
    if (!gone.has(rec.id)) {
      for (const [a, b] of rec.triRanges ?? []) {
        ribGrid.add(built.triangles.slice(a, b), "auto");
      }
    }
  }
  if (built?.padTriangles?.length) ribGrid.add(built.padTriangles, "auto");
  let gridded = 0;
  const drawOpts = {
    ...options.draw,
    topo,
    rot,
    offset: result.offset,
    braceClear: (rib) => {
      ribGrid.add(out.slice(gridded));
      gridded = out.length;
      return !ribGrid.hits(rib);
    },
  };
  const auto = autoSupports(built, gone),
    braces = [...auto.braces, ...(avoid.braces ?? [])],
    walls = [...auto.walls, ...(avoid.walls ?? [])];
  for (const w of requests) {
    const triStart = out.length / 3;
    const r = w.kind === "sway"
      ? swayAtFace(topo, result, rot, w.face, w.a, {
        ...options.sway,
        full: !w.capped,
      }, { braces, walls })
      : drawnWall(w.a, w.b, tris, 0, drawOpts);
    if (r.ok) {
      if (w.kind === "sway") braces.push(r);
      for (const t of r.tris) out.push(t);
    }
    items.push({ ok: r.ok, info: r, triStart, triEnd: out.length / 3 });
  }
  return { items, triangles: out };
}
