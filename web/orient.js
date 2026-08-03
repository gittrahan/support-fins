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
    // printability proxy: overhang area dominates, bed contact helps adhesion,
    // height is a mild time/tipping penalty. Lower is better.
    const cheap = a.overArea + Math.max(0, 200 - a.bedArea) * 0.25 + a.size.z * 2;
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
    // Printability cost, lower is better: the overhang that needs supporting at
    // all dominates; then the plastic the fins themselves cost, a height penalty
    // (layers = time, and tall = tippy), and a bed-adhesion bonus. A part balanced
    // on a point is unprintable in this pose -- push it to the bottom, not out, so
    // it still shows with an honest "nothing can hold this".
    const score = s.a.overArea
      + (b.volume ?? 0) / 1000 * 2
      + s.a.size.z * 3
      + Math.max(0, 300 - s.a.bedArea) * 0.5
      + (point ? 1e6 : 0);
    return {
      rot: s.rot,
      overArea: s.a.overArea,
      bedArea: s.a.bedArea,
      height: s.a.size.z,
      regions: s.a.regions.length,
      walls: b.props?.length ?? 0,
      coverage,
      volume: b.volume ?? 0,
      seating: b.seating?.kind ?? 'unknown',
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
