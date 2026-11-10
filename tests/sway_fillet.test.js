// Sway braces on a part with filleted edges (GH #115): the brace's inner edge keeps the breakaway gap
// all the way through a fillet (it may only widen where the part recedes), and its tines overlap the
// part by the 0.01 mm contact offset, never the 0.05-0.1 mm the reporter feared was too much.
import { buildTopology, analyze, fins, ptTriDist2, insidePart, assert } from './_util.js';
import { siteOpts } from './_scene.js';
import { swayAtFace } from '../web/sway.js';
import { filletedPrism } from './_fillet_fixture.js';

const ID = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const W = 60, D = 30, H = 150, GAP = 0.2;

function setup(r) {
  const pos = filletedPrism(W, D, H, r);
  const topo = buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
  const res = analyze(topo, 45, ID);
  const o = res.offset;
  const part = [];
  for (let i = 0; i < pos.length; i += 9) {
    part.push([0, 3, 6].map((k) => [pos[i + k] + o.x, pos[i + k + 1] + o.y, pos[i + k + 2] + o.z]));
  }
  return { topo, res, part };
}
const surfaceDist = (p, part) => {
  let m = Infinity;
  for (const t of part) {
    if (Math.min(t[0][2], t[1][2], t[2][2]) - p[2] > m || p[2] - Math.max(t[0][2], t[1][2], t[2][2]) > m) continue;
    const d = ptTriDist2(p, t[0], t[1], t[2]);
    if (d < m * m) m = Math.sqrt(d);
  }
  return m;
};
// Each triangle sampled on a 4-step barycentric grid (corners, edges and inside): a brace is
// a few triangles up to 150 mm long, and its closest point to the part can sit mid-face.
const GRID = 4;
function samples(verts) {
  const out = [];
  for (let i = 0; i + 2 < verts.length; i += 3) {
    const [a, b, c] = [verts[i], verts[i + 1], verts[i + 2]];
    for (let u = 0; u <= GRID; u++) for (let v = 0; u + v <= GRID; v++) {
      const s = u / GRID, t = v / GRID, w = 1 - s - t;
      out.push([0, 1, 2].map((k) => w * a[k] + s * b[k] + t * c[k]));
    }
  }
  return out;
}
const braceVerts = (out) => {
  const v = [];
  for (const f of (out.fins ?? []).filter((x) => x.kind === 'sway')) for (const [a, b] of f.triRanges) for (let i = a; i < b; i++) v.push(out.triangles[i]);
  return v;
};

for (const r of [2, 5, 10]) {
  Deno.test(`sway fillet r=${r}: Auto brace body keeps the gap through the fillets; tines overlap 0.01 mm`, () => {
    const { topo, res, part } = setup(r);
    // body only
    const body = siteOpts({ sway: true });
    body.tines = false; body.sway.tines = false;
    const out = fins.buildFins(topo, res, ID, body);
    assert(out.sway.count >= 2, `braces placed: ${out.sway.count} (${out.sway.reason})`);
    let worst = Infinity;
    for (const p of samples(braceVerts(out))) if (p[2] > 0.01) worst = Math.min(worst, surfaceDist(p, part));
    assert(worst >= GAP - 1e-3, `r=${r}: brace body came within ${worst.toFixed(3)} mm of the part (gap ${GAP})`);
    // with tines: whatever is inside the part is the kiss overlap, never more than 0.05 mm
    const withT = fins.buildFins(topo, res, ID, siteOpts({ sway: true }));
    assert(withT.sway.tines > 0, 'tines built');
    let deepest = 0, inside = 0;
    for (const p of braceVerts(withT)) {
      if (p[2] < 0.01 || !insidePart(topo, ID, res.offset, p[0], p[1], p[2])) continue;
      inside++;
      deepest = Math.max(deepest, surfaceDist(p, part));
    }
    assert(inside > 0, 'tine tips reach the part');
    assert(deepest <= 0.05, `r=${r}: a tine runs ${deepest.toFixed(3)} mm into the part`);
  });

  Deno.test(`sway fillet r=${r}: a hand-placed brace on the fillet keeps the gap`, () => {
    const { topo, res, part } = setup(r);
    const o = res.offset;
    for (const x of [0, W / 2 - r * 0.4]) {
      let best = -1, bd = Infinity;
      for (let f = 0; f < topo.nFaces; f++) {
        if (topo.nrm[3 * f + 1] < 0.3) continue;
        const t = part[f];
        const c = [0, 1, 2].map((k) => (t[0][k] + t[1][k] + t[2][k]) / 3);
        const d = Math.hypot(c[0] - (x + o.x), c[1] - (D / 2 + o.y), c[2] - (70 + o.z));
        if (d < bd) { bd = d; best = f; }
      }
      const rib = swayAtFace(topo, res, ID, best, [x + o.x, D / 2 + o.y, 100 + o.z], { full: true, tines: false, layerHeight: 0.2, gap: GAP });
      assert(rib.ok, `click at x=${x}: ${rib.reason}`);
      assert(rib.tris.length > 0, `click at x=${x}: the brace has no triangles`);
      let worst = Infinity;
      for (const p of samples(rib.tris)) if (p[2] > 0.01) worst = Math.min(worst, surfaceDist(p, part));
      assert(worst >= GAP - 1e-3, `r=${r} click x=${x}: brace within ${worst.toFixed(3)} mm of the part`);
    }
  });
}
