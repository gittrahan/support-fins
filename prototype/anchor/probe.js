// Headless check for GH #351: hover each stand-in's up-facing back the way Draw does
// (swayAtFace on the face under a point mid-width, 50 mm up), and report what it
// builds. Mirrors the app: analyze(topo, 45, rot) first.
//   python3 prototype/anchor/gen.py && deno run -A prototype/anchor/probe.js
import { buildTopology, analyze, readSTL } from '../../tests/_util.js';
const sway = await import('../../web/sway.js');
const ID = [1, 0, 0, 0, 1, 0, 0, 0, 1];

for (const name of ['anchor_lean_flat', 'anchor_lean_curved']) {
  const pos = readSTL(Deno.readFileSync(new URL(`./${name}.stl`, import.meta.url)));
  const topo = buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
  const res = analyze(topo, 45, ID);
  // click the back mid-width, about 50 mm up: the face there whose normal faces up
  // and +X (~40 degrees off vertical), at its own centroid
  let best = null;
  const P = topo.pos;
  for (let f = 0; f < topo.nFaces; f++) {
    const nx = topo.nrm[f * 3], nz = topo.nrm[f * 3 + 2];
    if (!(nx > 0.5 && nz > 0.3)) continue;
    const c = [0, 1, 2].map((k) => (P[f * 9 + k] + P[f * 9 + 3 + k] + P[f * 9 + 6 + k]) / 3);
    const pt = [c[0] + res.offset.x, c[1] + res.offset.y, c[2] + res.offset.z];
    const d = Math.abs(pt[1]) + Math.abs(pt[2] - 50);
    if (!best || d < best.d) best = { f, d, nz, pt };
  }
  const pt = best.pt;
  const r = sway.swayAtFace(topo, res, ID, best.f, pt, { layerHeight: 0.2, full: true });
  console.log(`${name}: back nz=${best.nz.toFixed(3)} upright=${sway.faceIsUpright(topo, ID, best.f)}`,
    r.ok ? `BUILT h=${r.height.toFixed(0)} depth=${r.depth.toFixed(0)} tines=${r.tines} stilt=${r.stilt.toFixed(1)}`
         : `REFUSED: ${r.reason}`);
}
