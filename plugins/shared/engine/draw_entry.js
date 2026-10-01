// Support Fins -- Draw mode for the plugins: one wall along a line the user drew.
//
// The website's Draw mode (web/ui/walls.js rebuildDrawn) calls web/draw.js
// drawnWall with the part's triangles and the two endpoints in the seated print
// frame. This does the same for a host: the part as computeFins takes it (posed
// triangle soup, mm, z up, anywhere on the plate) and the two points in that same
// frame -- typically where the user's two clicks hit the part.
//
// Same seat and clearances as computeFins (seat.js), so a drawn wall grips with the
// tines and gap the auto fins next to it use, and doesn't move with plate position.
import { buildTopology, analyze, IDENTITY3 } from '../../../web/overhangs.js';
import { applyTunables } from '../../../web/fins.js';
import { drawnWall } from '../../../web/draw.js';
import { ENGINE_DEFAULTS } from './fins_entry.js';
import { seatSoup, clearances, flatten, snap } from './seat.js';

/**
 * @param positions  the part, as for computeFins
 * @param a, b       [x, y, z] the wall's ends, in the same frame as `positions`
 * @param options    as for computeFins (material, tines, tineDensity, layerHeight,
 *                   threshold); the rest is ignored
 * @returns {{ ok: true, triangles: Float32Array, offset, stats: {length, height, tines, partAttached} }
 *          | { ok: false, reason: string }}
 *   triangles are in the seated frame, mapped back exactly as computeFins':
 *   input = seated - offset. `reason` is the site's words (too short, at the plate...).
 */
export function drawWall(positions, a, b, options = {}) {
  const opts = { ...ENGINE_DEFAULTS, ...options };
  for (const [name, p] of [['a', a], ['b', b]]) {
    if (!Array.isArray(p) || p.length !== 3 || !p.every(Number.isFinite)) {
      throw new Error(`${name} must be [x, y, z], got ${JSON.stringify(p)}`);
    }
  }
  const { tunables } = clearances(opts);
  const { pos, shift } = seatSoup(positions);
  const topo = buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
  const result = analyze(topo, opts.threshold, IDENTITY3);
  const off = result.offset;
  // The part in the print frame, as the site's partPrintTriangles builds it.
  const tris = new Float64Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    tris[i] = pos[i] + off.x; tris[i + 1] = pos[i + 1] + off.y; tris[i + 2] = pos[i + 2] + off.z;
  }
  const seat = (p) => [snap(p[0] - shift.x) + off.x, snap(p[1] - shift.y) + off.y, snap(p[2] - shift.z) + off.z];
  // The site sets these on its settings change; buildFins sets them per build. A
  // drawn wall goes through neither, so set them here -- the full set, every call.
  applyTunables(tunables);
  const r = drawnWall(seat(a), seat(b), tris, 0, {
    tines: opts.tines, tineDensity: opts.tineDensity, layerHeight: opts.layerHeight,
    topo, rot: IDENTITY3, offset: off,
  });
  if (!r.ok) return { ok: false, reason: r.reason };
  return {
    ok: true,
    triangles: flatten(r.tris),
    offset: { x: off.x - shift.x, y: off.y - shift.y, z: off.z - shift.z },
    // partAttached: it stands on the part below, not the plate (the site says so)
    stats: { length: r.length, height: r.height, tines: r.tines ?? 0, partAttached: !!r.partAttached },
  };
}
