/**
 * How the part sits on the plate: `seatedPartTris` lays the part's triangles out
 * in print space, `bedContact` finds where it touches down (and its centre of
 * mass), and `seatingOf` calls that contact a face, an edge or a point.
 *
 * Split out of fins.js.
 */
import { BED_EPS } from '../overhangs.js';
import { FIN } from './config.js';

/**
 * The whole part, seated into print space, as a flat triangle array -- what
 * `surfaceZAt` needs to know how low the part hangs over each pad cell. Built
 * only when a pad is actually wanted (small bed contact), so the full-mesh pass
 * is not paid on every well-seated part.
 */
export function seatedPartTris(topo, rot, offset) {
  const { pos, nFaces } = topo;
  const { x: ox, y: oy, z: oz } = offset;
  const tris = new Float64Array(nFaces * 9);
  for (let f = 0; f < nFaces; f++) {
    for (let i = 0; i < 3; i++) {
      const o = f * 9 + i * 3;
      const x = pos[o], y = pos[o + 1], z = pos[o + 2];
      tris[o] = rot[0] * x + rot[3] * y + rot[6] * z + ox;
      tris[o + 1] = rot[1] * x + rot[4] * y + rot[7] * z + oy;
      tris[o + 2] = rot[2] * x + rot[5] * y + rot[8] * z + oz;
    }
  }
  return tris;
}

/**
 * The part's bed-contact points and its area-weighted centre of mass.
 *
 * Contact comes from VERTICES under BED_EPS, not from bed-flagged faces: a part
 * tilted onto an edge has no face on the plate at all, which is exactly the case
 * the bed pad exists for.
 */
export function bedContact(topo, result, rot) {
  const { pos, nFaces, area } = topo;
  const { x: ox, y: oy, z: oz } = result.offset;
  let mx = 0, my = 0, mw = 0;
  const pts = [];
  for (let f = 0; f < nFaces; f++) {
    let gx = 0, gy = 0;
    for (let i = 0; i < 3; i++) {
      const o = f * 9 + i * 3;
      const x = pos[o], y = pos[o + 1], z = pos[o + 2];
      const wx = rot[0] * x + rot[3] * y + rot[6] * z + ox;
      const wy = rot[1] * x + rot[4] * y + rot[7] * z + oy;
      const wz = rot[2] * x + rot[5] * y + rot[8] * z + oz;
      gx += wx; gy += wy;
      if (wz < BED_EPS) pts.push([wx, wy]);
    }
    mx += (gx / 3) * area[f]; my += (gy / 3) * area[f]; mw += area[f];
  }
  if (mw > 0) { mx /= mw; my /= mw; }
  return { pts, mx, my };
}

/**
 * HOW the part meets the plate: on a face, on an edge, or on a single point.
 *
 * This is the question neither support mode was asking, and it is the one that
 * explains hub_post_foot. That part has 0.0 mm^2 of bed contact at EVERY tilt
 * from 0 to 165 degrees -- it balances on the tip of its own tapered foot -- so
 * every overhang on it sits 70-100mm in the air. Stabilize finds nothing to grip
 * and Prop wants a 100mm scaffold, and both then reported some local reason
 * ("no flat face", "part in the way") that sent the user off tuning the wrong
 * thing. The actionable truth is upstream of both: nothing you add to a part
 * balanced on a point will hold it, because the support has nothing to work
 * against. Rotate it until it sits down.
 *
 * A tilted-onto-an-EDGE part is the flagship Stabilize case and must not be
 * caught by this -- it also has ~0 bed area, but its contact is a long line, not
 * a dot. So the discriminator is the footprint's extent, not its area.
 */
const POINT_FOOTPRINT = 2.0;      // mm; contact narrower than this is a point

export function seatingOf(result, contactPts) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of contactPts) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const span = contactPts.length
    ? Math.hypot(maxX - minX, maxY - minY) : 0;
  // Area decides `face`, because a part can sit on a wide footprint of many
  // separate little pads; extent decides point-vs-edge, because those two differ
  // in shape at the same (~zero) area.
  const kind = result.bedArea >= FIN.padMinArea ? 'face'
    : span < POINT_FOOTPRINT ? 'point' : 'edge';
  return { kind, span, bedArea: result.bedArea };
}
