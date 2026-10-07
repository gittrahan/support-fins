import { classify as classifyFaces, reachOf, PLATE_Z, MUST, HOLE, LOW } from '../../web/fins/coverage.js';
import { PROP, surfaceZAt } from '../../web/prop.js';

export { MUST, HOLE, LOW };

/**
 * Which overhang faces a build actually holds -- the one rule probe.js and compare.js
 * share. A face counts as HELD when a wall-top point lies within maxUnsupportedSpan/2
 * of its centroid in plan and 0..1.5 mm below it, or it sits on the plate (z < 0.6),
 * or on the bed pad: the pad's top under its centroid is at most PAD_REACH below it
 * (or above it -- the pad's tack). A cleat sole on studs 0.7 mm up, over a 0.5 mm
 * pad, is held by the pad as a shim would hold it.
 * The rule itself (reachOf, classify) lives in web/fins/coverage.js, which the engine's
 * Full coverage fill pass shares.
 *
 * EVERY overhang face counts (`res.over`), including the ones in regions under
 * MIN_REGION_AREA that analyze() drops as slivers and the engine never looks at:
 * on a miniature those are most of the overhang (a 26 mm goblin: 106 mm2 of overhang,
 * 26 mm2 of it in a region big enough to be seen). `small` marks them, so a report
 * can say how much the floor alone costs.
 *
 * Each face also gets a CLASS (classify, below): must-hold, a tiny hole's
 * ceiling, or the near-plate strip. Policy 2026-10-05: every red face must get
 * something, except tiny holes (a model issue -- they stay flagged, unsupported);
 * the near-plate strip is reported apart until a shim is coupon-tested.
 */
export const PAD_REACH = PROP.gap + 0.3;   // a pad up to this far under a face holds it

export function heldFaces(topo, res, rot, build, R) {
  const { pos } = topo;
  const off = res.offset;
  const tops = [];
  for (const w of build.fins ?? []) for (const p of w.line ?? []) tops.push(p);
  const near = reachOf(tops, R);
  const onPad = padUnder(build.padTriangles);
  const cls = classify(topo, res, rot);
  const faces = [];
  let area = 0, held = 0, small = 0, smallHeld = 0;
  const by = [[0, 0], [0, 0], [0, 0]];      // per CLASS: [area, held]
  for (let f = 0; f < topo.nFaces; f++) {
    if (!res.over[f]) continue;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < 3; i++) {
      const o = f * 9 + i * 3, x = pos[o], y = pos[o + 1], z = pos[o + 2];
      cx += (rot[0] * x + rot[3] * y + rot[6] * z + off.x) / 3;
      cy += (rot[1] * x + rot[4] * y + rot[7] * z + off.y) / 3;
      cz += (rot[2] * x + rot[5] * y + rot[8] * z + off.z) / 3;
    }
    const a = topo.area[f], s = !res.kept[f];
    const h = cz < PLATE_Z || near(cx, cy, cz) || onPad(cx, cy, cz);
    area += a; if (h) held += a;
    if (s) { small += a; if (h) smallHeld += a; }
    by[cls[f]][0] += a; if (h) by[cls[f]][1] += a;
    faces.push([f, h ? 1 : 0, s ? 1 : 0, cls[f]]);
  }
  return { faces, area, held, small, smallHeld,
           must: by[MUST][0], mustHeld: by[MUST][1], hole: by[HOLE][0], holeHeld: by[HOLE][1],
           low: by[LOW][0], lowHeld: by[LOW][1] };
}

/** (x, y, z) -> is the bed pad's top under (x, y) within PAD_REACH below z (or above
 *  it)? `pad` is the build's padTriangles, one vertex per entry. The top is the
 *  highest pad surface: the lowest of the pad mirrored in z. */
function padUnder(pad) {
  if (!pad?.length) return () => false;
  const flip = new Float64Array(pad.length * 3);
  pad.forEach((v, i) => { flip[i * 3] = v[0]; flip[i * 3 + 1] = v[1]; flip[i * 3 + 2] = -v[2]; });
  return (x, y, z) => {
    const m = surfaceZAt(flip, x, y);
    return m !== null && z + m <= PAD_REACH;
  };
}

/**
 * classify (web/fins/coverage.js) scored with THIS checkout's inside grid:
 * insidePart caches its grid on the topo, and under probe.js --web the other
 * engine's build made that one, so swap it out and put the engine's back after
 * (the next pose's build reuses the topo).
 */
export function classify(topo, res, rot) {
  const engineGrid = topo._insideGrid;
  delete topo._insideGrid;
  try { return classifyFaces(topo, res, rot); }
  finally { if (engineGrid) topo._insideGrid = engineGrid; else delete topo._insideGrid; }
}
