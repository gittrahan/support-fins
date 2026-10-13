/**
 * Downhill walls, judged on the whole build (issue #25). buildProps races downhill
 * walls region by region (prop/downhill.js, prop/raster.js raceAgainst), but what
 * comes after the walls -- wedges, the last-resort short walls, the fill pass --
 * builds around whatever won, and the race can't see it. Two sweep cases traded:
 * bore_bracket x30y60 served a region its short wall used to grip 1.15 mm off the
 * plate, and the part's lowest grip rose to 2.64 mm; torus x45 lost a squat wall's
 * share (98.3 -> 97.2%). So when any region swaps, the build without downhill walls
 * is built too, and the downhill one is kept only if it holds at least as much
 * overhang, grips no higher and keeps every wedge: more supported, never less.
 */
import { PROP } from '../prop.js';
import { gripRise } from '../prop/raster.js';
import { classify, HOLE, PLATE_Z, reachOf } from './coverage.js';

/**
 * Overhang area (mm2) a build's wall tops reach (coverage.js's rule): MUST and the
 * near-plate strip (LOW) -- a squat wall's ledge counts (torus X45, tests/tails.test.js).
 * A tiny hole's ceiling is exempt, as on the scoreboard.
 */
export function heldArea(topo, result, rot, built, cls = classify(topo, result, rot)) {
  const tops = [];
  for (const w of built.fins ?? []) for (const p of w.line ?? []) tops.push(p);
  const near = reachOf(tops, PROP.maxUnsupportedSpan / 2);
  const { pos, nFaces, area } = topo, off = result.offset;
  let held = 0;
  for (let f = 0; f < nFaces; f++) {
    if (!result.over[f] || cls[f] === HOLE) continue;
    const c = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const o = f * 9 + i * 3;
      for (let k = 0; k < 3; k++) {
        c[k] += (rot[k] * pos[o] + rot[3 + k] * pos[o + 1] + rot[6 + k] * pos[o + 2] + [off.x, off.y, off.z][k]) / 3;
      }
    }
    if (c[2] < PLATE_Z || near(c[0], c[1], c[2])) held += area[f];
  }
  return held;
}

/** Did any region swap to downhill walls? */
export const usedDownhill = (built) => (built.props ?? []).some((q) => q.downhill);

const wedges = (built) => (built.fins ?? []).filter((f) => f.kind === 'wedge').length;

/**
 * Auto's build, with downhill walls only where they leave the part better off.
 * `build(downhill)` is buildFinsCore with opts.downhill set. The lowest grip is each
 * build's lowest KEPT tine, read through the tine capture (tines.js's
 * globalThis.__TINECAP, which the races already trim to the walls they keep); a
 * caller's own capture ends up holding the returned build's tines only.
 */
export function judgeDownhill(topo, result, rot, build) {
  const outer = globalThis.__TINECAP;
  const run = (flag) => {
    globalThis.__TINECAP = [];
    const b = build(flag);
    const caps = globalThis.__TINECAP;
    let low = Infinity;
    for (const t of caps) if (t.z < low) low = t.z;
    return { b, caps, low };
  };
  try {
    const a = run(true);
    let keep = a;
    if (usedDownhill(a.b)) {
      const n = run(false);
      const cls = classify(topo, result, rot);
      const worse = heldArea(topo, result, rot, a.b, cls) < heldArea(topo, result, rot, n.b, cls) - 1e-6
        || a.low > n.low + (Number.isFinite(n.low) ? gripRise(n.low) : 0)
        || wedges(a.b) < wedges(n.b);
      if (worse) keep = n;
    }
    if (outer) outer.push(...keep.caps);
    return keep.b;
  } finally {
    globalThis.__TINECAP = outer;   // a throwing build must not leave the capture on
  }
}
