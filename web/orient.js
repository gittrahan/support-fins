/**
 * Orientation suggester -- ranked, never auto-applied.
 *
 * The product rule (v1 spec, and the "human stays in the loop" video beat) is
 * that the user rotates; this only proposes. It returns 2-3 candidate poses with
 * their tradeoffs and an honest confidence, and the UI applies one on a click.
 *
 * We score for PRINTABILITY, not strength, on purpose. Strength wants the part
 * tilted onto a slant so the layer lines run diagonally -- but which slant is
 * strongest depends on the load direction, which geometry cannot infer (the
 * spike's four parts each picked a different pose for pull vs. lever). Worse, a
 * strength-first solver is exactly what produced the "155mm tall, balanced on its
 * own needle, two sail-sized fins" pose the spike flagged: geometrically valid,
 * terrible print. So the auto suggester minimises support instead, and the
 * stronger-but-tilted pose is offered only once the user places the load arrow.
 *
 * Cheap first pass over every candidate using analyze() (allocation-free), then
 * the full buildFins() on the few finalists to measure how much of the overhang
 * can actually be finned. Candidates need no convex-hull kernel: a part rests on
 * a flat face, so the large-area normal clusters ARE its stable down-faces.
 */
import { analyze } from './overhangs.js';
import { buildFins } from './fins.js';

/** Column-major (THREE.Matrix3.elements) rotation taking unit `a` onto unit `b`. */
function rotFromTo(a, b) {
  const cx = a[1] * b[2] - a[2] * b[1];
  const cy = a[2] * b[0] - a[0] * b[2];
  const cz = a[0] * b[1] - a[1] * b[0];
  const s2 = cx * cx + cy * cy + cz * cz;   // sin^2 of the angle
  const c = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (s2 < 1e-12) {
    if (c > 0) return [1, 0, 0, 0, 1, 0, 0, 0, 1];        // already aligned
    // antiparallel: 180 about any axis perpendicular to a
    let px = 1, py = 0, pz = 0;
    if (Math.abs(a[0]) > 0.9) { px = 0; py = 1; }
    const dx = a[0], dy = a[1], dz = a[2];
    const d = px * dx + py * dy + pz * dz;
    px -= d * dx; py -= d * dy; pz -= d * dz;
    const pn = Math.hypot(px, py, pz); px /= pn; py /= pn; pz /= pn;
    // R = 2 p p^T - I
    return [
      2 * px * px - 1, 2 * py * px, 2 * pz * px,
      2 * px * py, 2 * py * py - 1, 2 * pz * py,
      2 * px * pz, 2 * py * pz, 2 * pz * pz - 1,
    ];
  }
  // Rodrigues with k = (1-c)/s2 = 1/(1+c)
  const k = 1 / (1 + c);
  // R = I + [v]x + k [v]x^2, v = cross. Written out column-major.
  const R = [
    1 + k * (-cz * cz - cy * cy),        cz + k * (cy * cx),           -cy + k * (cz * cx),
    -cz + k * (cx * cy),                 1 + k * (-cz * cz - cx * cx),  cx + k * (cz * cy),
    cy + k * (cx * cz),                  -cx + k * (cy * cz),           1 + k * (-cy * cy - cx * cx),
  ];
  return R;
}

/** Multiply two column-major 3x3s: returns A*B. */
function mul(A, B) {
  const O = new Array(9);
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 3; row++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += A[k * 3 + row] * B[col * 3 + k];
      O[col * 3 + row] = s;
    }
  }
  return O;
}

/** Apply a column-major 3x3 (THREE.Matrix3.elements order) to a vector: R * v. */
function applyRot(R, v) {
  return [
    R[0] * v[0] + R[3] * v[1] + R[6] * v[2],
    R[1] * v[0] + R[4] * v[1] + R[7] * v[2],
    R[2] * v[0] + R[5] * v[1] + R[8] * v[2],
  ];
}

/** Column-major rotation of `deg` about a unit world axis. */
function rotAxis(axis, deg) {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const [x, y, z] = axis, t = 1 - c;
  return [
    t * x * x + c,     t * x * y + s * z, t * x * z - s * y,
    t * x * y - s * z, t * y * y + c,     t * y * z + s * x,
    t * x * z + s * y, t * y * z - s * x, t * z * z + c,
  ];
}

/**
 * Candidate DOWN-directions (the outward normal that will face the plate):
 * the part's large flat faces, found by binning face normals by area, plus the
 * six axis directions so a boxy part is always covered. Yaw about vertical is
 * omitted -- overhang, height and bed area are all invariant under it.
 */
function candidateDowns(topo, maxClusters = 12) {
  const { nrm, area, nFaces } = topo;
  const bins = new Map();
  const q = (v) => Math.round(v * 12) / 12;   // ~5deg buckets
  for (let f = 0; f < nFaces; f++) {
    const x = nrm[f * 3], y = nrm[f * 3 + 1], z = nrm[f * 3 + 2];
    if (x === 0 && y === 0 && z === 0) continue;
    const key = `${q(x)},${q(y)},${q(z)}`;
    const b = bins.get(key);
    if (b) { b.a += area[f]; b.x += x * area[f]; b.y += y * area[f]; b.z += z * area[f]; }
    else bins.set(key, { a: area[f], x: x * area[f], y: y * area[f], z: z * area[f] });
  }
  const clusters = [...bins.values()]
    .sort((p, r) => r.a - p.a)
    .slice(0, maxClusters)
    .map((b) => { const n = Math.hypot(b.x, b.y, b.z); return [b.x / n, b.y / n, b.z / n]; });

  const downs = [...clusters,
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

  // dedup near-duplicate directions
  const out = [];
  for (const d of downs) {
    if (!out.some((e) => e[0] * d[0] + e[1] * d[1] + e[2] * d[2] > 0.996)) out.push(d);
  }
  return out;
}

const DOWN = [0, 0, -1];

/**
 * Rank orientations for printability. Returns up to `top` candidates, best first,
 * each with the metrics the UI shows and a `confidence`.
 */
export function suggestOrientations(topo, { top = 3, threshold = 45 } = {}) {
  const downs = candidateDowns(topo);

  // pass 1: cheap analyze() on every candidate
  const scored = downs.map((d) => {
    const rot = rotFromTo(d, DOWN);
    const a = analyze(topo, threshold, rot);
    // The small overhangs analyze() drops as slivers ARE the hole ceilings, slot
    // roofs and bore tops that print rough by surprise -- a pose that turns them
    // UP prints them clean with no support, so fewer is better. This is the
    // quality-first counterpart to the bore-guard: it gives the "rotate so the
    // hole points up" warning a pose to actually land on.
    const holes = a.rawRegionCount - a.regions.length;
    // printability proxy: overhang area dominates, bed contact helps adhesion,
    // height is a mild time/tipping penalty, holes-in-overhang a rough-surface
    // penalty. Lower is better.
    const cheap = a.overArea + Math.max(0, 200 - a.bedArea) * 0.25
      + a.size.z * 2 + holes * 2;
    return { rot, a, cheap };
  }).sort((p, r) => p.cheap - r.cheap);

  // pass 2: full fin build on the finalists, to measure real finnable coverage
  const finalists = scored.slice(0, Math.max(top + 2, 5));
  const built = finalists.map((s) => {
    const b = buildFins(topo, s.a, s.rot, { mode: 'prop', bedPad: true });
    // buildFins reports `unserved` = overhang regions that took NO wall; coverage
    // is DISPLAY only (how many fins the user will get), never a score driver --
    // rewarding coverage rewards ADDING supports, and printability wants fewer.
    const nReg = s.a.regions.length;
    const coverage = nReg ? (nReg - (b.unserved ?? nReg)) / nReg : 1;
    const point = b.seating?.kind === 'point';
    // Holes/slots/bore tops in overhang (the dropped slivers) print rough; ones
    // inside a bore (b.skipped.bore) can't even be supported, only oriented away.
    // Penalise both so a pose that points the holes UP -- the one-click answer to
    // the bore/rough-overhang warning -- ranks above one that buries them under
    // an overhang. Weighted below the plastic/height terms so it tips near-ties,
    // not so hard it chases a few slivers into a worse-supported pose.
    const holes = s.a.rawRegionCount - s.a.regions.length;
    const bore = b.skipped?.bore ?? 0;
    // Printability cost, lower is better: the overhang that needs supporting at
    // all dominates; then the plastic the fins themselves cost, a height penalty
    // (layers = time, and tall = tippy), a bed-adhesion bonus, and the rough-hole
    // penalty. A part balanced on a point is unprintable in this pose -- push it
    // to the bottom, not out, so it still shows with an honest "nothing can hold this".
    const score = s.a.overArea
      + (b.volume ?? 0) / 1000 * 2
      + s.a.size.z * 3
      + Math.max(0, 300 - s.a.bedArea) * 0.5
      + holes * 2
      + bore * 25
      + (point ? 1e6 : 0);
    return {
      rot: s.rot,
      overArea: s.a.overArea,
      bedArea: s.a.bedArea,
      height: s.a.size.z,
      size: s.a.size,       // full {x,y,z} so callers can run layerVerdict on the pose
      regions: s.a.regions.length,
      walls: b.props?.length ?? 0,
      coverage,
      volume: b.volume ?? 0,
      seating: b.seating?.kind ?? 'unknown',
      holes, bore,
      score,
    };
  }).sort((p, r) => p.score - r.score);

  // Confidence is the honest part, and it is about the POSE, not the fins: how
  // clearly does the top pick beat the runner-up? A big separation means "print
  // it this way"; a near-tie means several orientations are about as good and the
  // user's judgement (or the load, once placed) should decide. A part that can
  // only balance on a point has no printable pose at all.
  const best = built[0], second = built[1];
  let confidence = 'high';
  if (!best || best.seating === 'point') confidence = 'none';
  else if (second) {
    const sep = (second.score - best.score) / Math.max(1, best.score);
    confidence = sep > 0.25 ? 'high' : sep > 0.08 ? 'medium' : 'low';
  }

  return { candidates: built.slice(0, top), confidence };
}

// ---------------------------------------------------------------- load / strength
//
// FDM parts are weakest ACROSS the layer lines -- the interlayer bond is the weak
// plane, and the weak axis is the build direction (world +Z once the part is
// seated). A tensile load carried along that axis pulls the layers apart; the
// same load carried within the layer plane is the part's strong direction. So the
// whole question "is this orientation strong for this load?" reduces to: how much
// of the load points straight up the build axis?
//
// This is deliberately QUALITATIVE. We refuse to print a "3.4x stronger" number:
// real anisotropy depends on infill, wall count, temperature and geometry, none
// of which we can measure in the browser -- a hard multiplier would be the same
// false-precision trust-trap the value receipt avoids. What we CAN say honestly is
// which way the layers run relative to the load, and whether a better pose exists.

/** cos of the angle between two unit-ish directions in the same frame. */
function crossFraction(dir) {
  const n = Math.hypot(dir[0], dir[1], dir[2]);
  return n < 1e-9 ? null : Math.abs(dir[2]) / n;   // |d . buildZ| = share pulling across layers
}

/** Bucket a cross-fraction into an honest three-step verdict + copy. */
function alignQuality(cross) {
  // cross = |load . build-Z|: 0 = load lies in the layer plane (strong),
  // 1 = load pulls straight across the layers (weak). Bounds at 60deg / 30deg
  // from the plate: within 30deg of in-plane reads "well aligned".
  if (cross <= 0.5) {
    return { quality: 'good',
      text: 'Layers run with your load — the pull is along the layer lines, '
          + 'the part’s strong direction.' };
  }
  if (cross <= 0.866) {
    return { quality: 'mixed',
      text: 'Layers only partly aligned — some of the load pulls across the '
          + 'layer lines.' };
  }
  return { quality: 'poor',
    text: 'Layers poorly aligned — the load pulls straight across the layer '
        + 'lines, where a printed part splits most easily.' };
}

/**
 * Automatic, input-free strength note for the CURRENT pose. A printed part is
 * weakest across its layer lines -- the flat, horizontal planes -- so it splits
 * most easily when pulled straight up the build axis. We can't know the real
 * load, but we can ALWAYS say how this orientation lays the part down: if its
 * longest span stands up the layers that's the classic weak print; lying flat
 * runs the long spans along the layers, the strong way. `size` is the seated
 * bounding box {x, y, z}, z the build height. Changes as the part turns.
 */
export function layerVerdict(size) {
  const z = size.z;
  const dims = [size.x, size.y, size.z].sort((a, b) => a - b);
  const span = dims[2];
  const eps = 0.05 * Math.max(1, span);
  if (z >= span - eps) {
    return { posture: 'weak',
      note: `Standing tall — its longest span (${z.toFixed(0)} mm) runs up the layers. `
          + `That's the classic weak print: layer lines peel apart most easily when `
          + `pulled straight up.` };
  }
  if (z <= dims[0] + eps) {
    return { posture: 'strong',
      note: `Lying flat (${z.toFixed(0)} mm tall) — its long spans run along the layers, `
          + `the strong way. Only a straight-up pull tests the weaker layer bond.` };
  }
  return { posture: 'mixed',
    note: `On its side (${z.toFixed(0)} mm tall) — layers run flat, so the part is weakest `
        + `pulled straight up and stronger side-to-side.` };
}

/**
 * Qualitative strength readout for a load in the CURRENT pose. `dirWorld` is the
 * load direction in seated print space (so world +Z is the build axis). Pull
 * model only: the critical tensile direction IS the applied force. (Lever -- where
 * the part bends and the tensile stress runs along the beam, perpendicular to the
 * push -- picks a different pose and can't be inferred from one arrow; it's a
 * future toggle, not a default.)
 */
export function loadAlignment(dirWorld) {
  const cross = crossFraction(dirWorld);
  if (cross == null) return null;
  return { cross, ...alignQuality(cross) };
}

/**
 * The strongest PRINTABLE pose for a given load. The arrow is anchored to a
 * feature, so its direction is fixed in the part's own (as-loaded) frame; as we
 * try candidate orientations that direction swings relative to the build axis and
 * we want the pose that lays it most in-plane.
 *
 * The guard is the whole point. A pure strength solver is exactly what produced
 * the spike's "155mm tall, balanced on its own needle" pose -- geometrically the
 * layers were perfect, the print was impossible. So we only consider poses that
 * actually SIT on the plate (a real bed footprint, not a point) and whose
 * printability cost is within a bounded budget of the best available; among those,
 * we pick the strongest. Returns null if nothing beats simply not tilting.
 */
export function suggestStrengthPose(topo, dirLocal, { threshold = 45 } = {}) {
  const dl = (() => {
    const n = Math.hypot(dirLocal[0], dirLocal[1], dirLocal[2]);
    return n < 1e-9 ? null : [dirLocal[0] / n, dirLocal[1] / n, dirLocal[2] / n];
  })();
  if (!dl) return null;

  const cands = candidateDowns(topo).map((d) => {
    const rot = rotFromTo(d, DOWN);
    const a = analyze(topo, threshold, rot);
    const cross = Math.abs(applyRot(rot, dl)[2]);   // rot orthonormal, dl unit -> result unit
    // Same printability proxy suggestOrientations' pass 1 uses (overhang dominates,
    // bed contact helps, height is a mild penalty) -- lower is better.
    const printCost = a.overArea + Math.max(0, 200 - a.bedArea) * 0.25 + a.size.z * 2;
    return { rot, cross, printCost, height: a.size.z, over: a.overArea, bedArea: a.bedArea };
  });

  // A pose with ~no bed contact is a tip/needle -- unprintable regardless of how
  // nicely the layers line up. Drop those before ranking; if that leaves nothing,
  // there's no printable pose to recommend.
  const seated = cands.filter((c) => c.bedArea >= 1);
  if (!seated.length) return null;

  // Bound the strength search by printability: only poses within a budget of the
  // most printable one are eligible, so we never trade a sane print for a tower.
  const bestPrint = Math.min(...seated.map((c) => c.printCost));
  const affordable = seated.filter((c) => c.printCost <= bestPrint + 60);
  affordable.sort((p, r) => p.cross - r.cross);

  const best = affordable[0];
  return { rot: best.rot, cross: best.cross, ...alignQuality(best.cross),
           height: best.height, over: best.over, bedArea: best.bedArea };
}
