/**
 * Run direction for walls under a near-flat overhang: ACROSS the slicer's bridge
 * lines, never along them (local issue 038).
 *
 * Why. A slicer prints a flat overhang's first layer as straight bridge lines. A
 * wall that crosses them holds every line; a wall parallel to them holds one line
 * and the rest sag between walls -- Matthew's orient coupon: across "pretty good"
 * at 4-8 mm spacing, parallel "junk" at every spacing. The old rule ran walls
 * along the longer free run, and PrusaSlicer bridges a cantilever along its
 * longer side too, so every ledge stuck out from one edge got parallel walls by
 * construction (the cutout coupon: five perfect walls, five ledges in midair).
 *
 * The rule, measured headless on test ledges (local-issues/038-tools):
 *   - free area with solid on TWO opposite sides (a bridge between legs):
 *     PrusaSlicer and Cura (bridging on) both bridge leg to leg -> walls run
 *     across that line;
 *   - anything else (a cantilever off one edge, a plate on a pillar): PrusaSlicer
 *     bridges along the longer side -> walls run along the SHORTER side.
 * The walls themselves never steer the slicer's angle (none / along / out / both
 * all bridged alike), so this is a prediction we can make before building them.
 * Cura with bridging off (its default) lays 45/135 skin whatever the shape, which
 * any axis-aligned wall crosses.
 *
 * "Solid" is the part in the layer just under the overhang, the slicer's anchor:
 * a leg under the face or a post beside it, read on a grid one margin wider than
 * the patch so a post that only borders the face counts.
 */
import { insidePart } from '../inside.js';
import { PROP } from './config.js';
import { surfaceZAt } from './surface.js';

const MARGIN = 2;        // grid cells read outside the patch (a post beside the face)
const LOOK = 2;          // cells a free run's end may skip to find its anchor (boundary noise)
const BRIDGED = 0.25;    // share of the free area anchored at both ends that makes it a bridge

/**
 * [ux, uy] for a near-flat patch, axis-aligned like the old rule. `pts` give the
 * footprint, `patchTris` the face, `support` = { topo, rot, offset }. The array's
 * `turned` is true when this is not what the old rule (walls along the longer
 * free run) picked, and `old` is that pick: buildProps races the two (prop/bridgerace.js).
 */
export function flatRunAxis(pts, patchTris, step, support) {
  let xLo = Infinity, xHi = -Infinity, yLo = Infinity, yHi = -Infinity, zSum = 0;
  for (const p of pts) {
    if (p[0] < xLo) xLo = p[0]; if (p[0] > xHi) xHi = p[0];
    if (p[1] < yLo) yLo = p[1]; if (p[1] > yHi) yHi = p[1];
    zSum += p[2];
  }
  const spanX = xHi - xLo, spanY = yHi - yLo;
  // no part to read anchors from: the old rule, walls along the longer side
  if (!support || spanX <= 0 || spanY <= 0) return spanX >= spanY ? [1, 0] : [0, 1];

  const zMean = zSum / pts.length;
  const gstep = Math.max(1, step);
  const nx = Math.min(80, Math.ceil(spanX / gstep));
  const ny = Math.min(80, Math.ceil(spanY / gstep));
  const dx = spanX / nx, dy = spanY / ny;
  const { topo, rot, offset } = support;
  // FREE = face with nothing under it; ANCHOR = part in the layer below
  // (a supported cell of the face, or a post/leg just outside it)
  const FREE = 1, ANCHOR = 2;
  const W = nx + 1 + 2 * MARGIN, H = ny + 1 + 2 * MARGIN;
  const cell = new Uint8Array(W * H);
  for (let i = 0; i < W; i++) {
    const x = xLo + dx * (i - MARGIN);
    for (let j = 0; j < H; j++) {
      const y = yLo + dy * (j - MARGIN);
      const z = surfaceZAt(patchTris, x, y);
      if (z !== null) {
        cell[i * H + j] = insidePart(topo, rot, offset, x, y, z - 0.1) ? ANCHOR : FREE;
      } else if (insidePart(topo, rot, offset, x, y, zMean - 0.3)) {
        cell[i * H + j] = ANCHOR;
      }
    }
  }

  // per axis: the longest contiguous free run (the old rule's measure, now the
  // fallback) and the free length anchored at BOTH ends (what a slicer bridges)
  const scan = (alongX) => {
    const n = alongX ? W : H, m = alongX ? H : W, d = alongX ? dx : dy;
    const at = (a, b) => (alongX ? cell[a * H + b] : cell[b * H + a]);
    let longest = 0, anchored = 0, free = 0;
    for (let b = 0; b < m; b++) {
      for (let a = 0; a < n;) {
        if (at(a, b) !== FREE) { a++; continue; }
        let e = a;
        while (e < n && at(e, b) === FREE) e++;
        const len = e - a;
        free += len;
        if (len > longest) longest = len;
        let lo = false, hi = false;
        for (let k = 1; k <= LOOK && a - k >= 0 && !lo; k++) lo = at(a - k, b) === ANCHOR;
        for (let k = 0; k < LOOK && e + k < n && !hi; k++) hi = at(e + k, b) === ANCHOR;
        if (lo && hi) anchored += len;
        a = e;
      }
    }
    return { longest: longest * d, anchored: anchored * d * (alongX ? dy : dx), free: free * d * (alongX ? dy : dx) };
  };
  const sx = scan(true), sy = scan(false);
  const pick = (wantY, oldY) => Object.assign(wantY ? [0, 1] : [1, 0],
    { turned: wantY !== oldY, old: oldY ? [0, 1] : [1, 0] });
  // the old rule: walls along the longer free run (a tie along x)
  const oldY = sx.longest > 0 && sy.longest > 0 ? sx.longest < sy.longest : spanX < spanY;
  // walls along x are as long as the free runs along x, so a direction whose
  // walls would come out under minSpan is no choice at all: on a narrow ledge
  // (or a deck split by its post) crossing walls are stubs, dropped -- the old
  // long walls hold it better than nothing does
  const along = (wantY) => {
    const len = wantY ? sy.longest : sx.longest, other = wantY ? sx.longest : sy.longest;
    // (+2 cells: a run counts its boundary cells, and the wall stands clear of the part)
    return len < PROP.minSpan + 2 * Math.max(dx, dy) && other > len ? !wantY : wantY;
  };
  const free = Math.max(sx.free, sy.free);
  if (free > 0 && Math.max(sx.anchored, sy.anchored) >= BRIDGED * free) {
    // bridge lines run along the better-anchored axis; walls cross them
    return pick(along(sx.anchored >= sy.anchored), oldY);
  }
  // no two-ended anchor: the slicer bridges along the longer free run, walls
  // along the shorter (with nothing free at all, the plain footprint decides).
  // A square face (runs within a cell) keeps the old pick, walls along x: it
  // bridges either way, and flipping it only churns round parts like a sphere.
  if (!(sx.longest > 0 && sy.longest > 0)) return pick(spanX > spanY + Math.max(dx, dy), oldY);
  return pick(along(sx.longest > sy.longest + Math.max(dx, dy)), oldY);
}
