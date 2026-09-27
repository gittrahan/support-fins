// SMALL TUBES (MorbidJ-hub, Sept 2026, from 3DBenchy in the Fusion add-in): a
// small horizontal tube (a peg, a pin, Benchy's chimney laid on its side) got no
// support at all. Under tubeMinArea (300 mm2) the tube route refused it as a
// "pocket", and splitRegion's 15-degree cut shattered the curved band into facet
// strips under MIN_REGION_AREA, every one dropped as a sliver. A CONVEX band now
// takes the tube route down to tubeSmallMinArea, and its one wall may be as short
// as minSpanTube. Concave pockets stay out.
import { buildTopology, analyze, fins, assert } from './_util.js';
import { PROP } from '../web/prop.js';

const quad = (a, b, c, d) => [a, b, c, a, c, d];
function block(x0, x1, y0, y1, z0, z1) {
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
             [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  return [...quad(v[0], v[3], v[2], v[1]), ...quad(v[4], v[5], v[6], v[7]), ...quad(v[0], v[1], v[5], v[4]),
          ...quad(v[2], v[3], v[7], v[6]), ...quad(v[1], v[2], v[6], v[5]), ...quad(v[0], v[4], v[7], v[3])];
}
// closed cylinder along +Y from y0 to y1, axis at (cx, cz), radius r, n sides
function cylinderY(cx, cz, r, y0, y1, n = 48) {
  const ring = (y) => Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n;
    return [cx + r * Math.cos(a), y, cz + r * Math.sin(a)];
  });
  const A = ring(y0), B = ring(y1), t = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    t.push(A[i], B[j], A[j], A[i], B[i], B[j]);           // side, outward
    t.push([cx, y0, cz], A[i], A[j]);                     // cap at y0, facing -Y
    t.push([cx, y1, cz], B[j], B[i]);                     // cap at y1, facing +Y
  }
  return t;
}
function volume(tris) {
  let v = 0;
  for (let i = 0; i < tris.length; i += 3) {
    const [a, b, c] = [tris[i], tris[i + 1], tris[i + 2]];
    v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return v;
}
const topoOf = (tris) => {
  const arr = Float32Array.from(tris.flat());
  return buildTopology({ getAttribute: (k) => (k === 'position' ? { array: arr } : null) });
};
const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const build = (topo) => fins.buildFins(topo, analyze(topo, 45, I), I,
  { mode: 'auto', bedPad: true, tines: true, coverage: 0.5 });

// A 30x20x24 block with a 5 mm peg sticking 8 mm out of its +Y face, 14 mm up:
// the chimney in miniature. The peg overlaps the block by 1 mm, as a modelled
// boss would, and its underside band is ~25 mm2 -- well under tubeMinArea.
const pegPart = () => topoOf([...block(-15, 15, -10, 10, 0, 24), ...cylinderY(0, 14, 2.5, 9, 18)]);

Deno.test('small tube: the test peg is a real, outward-facing solid', () => {
  const v = volume(cylinderY(0, 14, 2.5, 9, 18));
  assert(v > 0.95 * Math.PI * 2.5 * 2.5 * 9, `peg volume ${v}: wound inside out?`);
});

Deno.test('small tube: a peg sticking out sideways gets a wall under it', () => {
  const topo = pegPart();
  const b = build(topo);
  const res = analyze(topo, 45, I);
  const peg = res.regions.findIndex((r) => r.faces.some((f) => {
    const y = topo.pos[f * 9 + 1] + topo.pos[f * 9 + 4] + topo.pos[f * 9 + 7];
    return y / 3 > 10.5;
  }));
  assert(peg >= 0, 'the peg underside should be an overhang region');
  assert(res.regions[peg].area < PROP.tubeMinArea, 'the peg must be a SMALL tube for this test');
  assert((b.servedRegions ?? []).includes(peg), `peg region left unserved (served: ${b.servedRegions})`);
  // and the wall under it really is under it: some support vertex beyond the
  // block's face, below the peg
  const tris = b.triangles;
  let under = 0;
  for (let i = 0; i < tris.length; i += 3) {
    const x = tris[i] ?? tris[i]?.[0];
    const p = Array.isArray(x) ? x : [tris[i], tris[i + 1], tris[i + 2]];
    if (p[1] > 10.8 && p[1] < 17.5 && p[2] < 11) under++;
  }
  assert(under > 0, 'no support geometry stands under the peg');
});

// Overhang area held by `sup` (support triangles), by the sweep's coverage rule:
// a support vertex within maxUnsupportedSpan in plan and 0-3 mm below the face.
function held(topo, res, sup) {
  let tot = 0, got = 0;
  for (const g of res.regions) {
    for (const f of g.faces) {
      const c = [0, 1, 2].map((k) => (topo.pos[f * 9 + k] + topo.pos[f * 9 + 3 + k] + topo.pos[f * 9 + 6 + k]) / 3
                                     + [res.offset.x, res.offset.y, res.offset.z][k]);
      tot += topo.area[f];
      if (sup.some((v) => v[2] > c[2] - 3 && v[2] < c[2] + 0.5
                     && Math.hypot(v[0] - c[0], v[1] - c[1]) <= PROP.maxUnsupportedSpan)) got += topo.area[f];
    }
  }
  return got / tot;
}

// A longer, fatter peg: its underside is a small convex band that takes the tube
// route. When that one wall fails, the region must go back to the patch path,
// as if the tube had never claimed it. On bore_bracket flat (a dev model) #84
// kept the failed claim and coverage fell 98 -> 52%.
const fatPeg = () => topoOf([...block(-25, 25, -10, 10, 0, 60), ...cylinderY(0, 30, 8, 9, 23)]);

Deno.test('small tube: a failed tube hands its region back to the patch path', () => {
  const topo = fatPeg();
  const res = analyze(topo, 45, I);
  const keep = { small: PROP.tubeSmallMinArea, span: PROP.minSpanTube };
  try {
    PROP.tubeSmallMinArea = Infinity;                 // small tubes off: the old patch path
    const patchOnly = build(topo);
    PROP.tubeSmallMinArea = keep.small;
    assert(build(topo).props.length > patchOnly.props.length, 'the peg should take the tube route');
    PROP.minSpanTube = 1000;                          // the tube's one wall now always fails
    const failed = build(topo);
    assert(held(topo, res, failed.triangles) >= held(topo, res, patchOnly.triangles) - 1e-9,
      'a failed small tube must hold no less than the patch path');
    assert(JSON.stringify(failed.skipped) === JSON.stringify(patchOnly.skipped),
      `the patch path must run as before: ${JSON.stringify(failed.skipped)} vs ${JSON.stringify(patchOnly.skipped)}`);
  } finally {
    PROP.tubeSmallMinArea = keep.small;
    PROP.minSpanTube = keep.span;
  }
});
