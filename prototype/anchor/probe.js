// Headless check for GH #351: hover each stand-in's back the way Draw does, at a
// spread of spots, and report how many of them take a brace and why the rest don't.
// "Picky" is the share of spots refused. Mirrors the app: analyze(topo, 45, rot) first.
//   python3 prototype/anchor/gen.py && deno run -A prototype/anchor/probe.js [name...]
import { buildTopology, analyze, readSTL } from '../../tests/_util.js';
const sway = await import('../../web/sway.js');
const ID = [1, 0, 0, 0, 1, 0, 0, 0, 1];

const ALL = ['anchor_lean_flat', 'anchor_lean_curved', 'anchor_bend_convex', 'anchor_bend_concave', 'anchor_dome'];
const names = Deno.args.length ? Deno.args : ALL;
const SPOTS = 40;

for (const name of names) {
  const pos = readSTL(Deno.readFileSync(new URL(`./${name}.stl`, import.meta.url)));
  const topo = buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
  const res = analyze(topo, 45, ID);
  // the back: faces facing +X that Draw hands a brace (faceIsUpright), away from the
  // side edges and the foot, spread out by height
  const P = topo.pos, cands = [];
  for (let f = 0; f < topo.nFaces; f++) {
    if (!(topo.nrm[f * 3] > 0.5) || !sway.faceIsUpright(topo, ID, f)) continue;
    const c = [0, 1, 2].map((k) => (P[f * 9 + k] + P[f * 9 + 3 + k] + P[f * 9 + 6 + k]) / 3);
    const pt = [c[0] + res.offset.x, c[1] + res.offset.y, c[2] + res.offset.z];
    if (Math.abs(pt[1]) > 15 || pt[2] < 25) continue;
    cands.push({ f, pt });
  }
  cands.sort((a, b) => a.pt[2] - b.pt[2]);
  const picks = cands.length <= SPOTS ? cands
    : Array.from({ length: SPOTS }, (_, i) => cands[Math.floor((i + 0.5) * cands.length / SPOTS)]);
  let ok = 0, okFull = 0;
  const hs = [], why = new Map();
  const t0 = performance.now();
  for (const { f, pt } of picks) {
    const full = sway.swayAtFace(topo, res, ID, f, pt, { layerHeight: 0.2, full: true });
    const capped = sway.swayAtFace(topo, res, ID, f, pt, { layerHeight: 0.2 });
    if (full.ok) { okFull++; hs.push(full.height); }
    if (capped.ok) ok++;
    for (const r of [full, capped]) {
      if (r.ok) continue;
      if (Deno.env.get('WHERE')) console.log(`      z=${pt[2].toFixed(0)} ${r === full ? 'full' : 'capped'}: ${r.reason.slice(0, 40)}`);
      const k = r.reason.replace(/\d+(\.\d+)?/g, '#');
      why.set(k, (why.get(k) ?? 0) + 1);
    }
  }
  const ms = (performance.now() - t0) / Math.max(1, picks.length * 2);
  console.log(`${name} (${res.size.z.toFixed(0)} mm tall): ${picks.length} spots, full ${okFull}/${picks.length}, `
    + `at cursor ${ok}/${picks.length}`
    + (hs.length ? `, full heights ${Math.min(...hs).toFixed(0)}-${Math.max(...hs).toFixed(0)} mm` : '')
    + `, ${ms.toFixed(0)} ms/hover`);
  for (const [k, n] of why) console.log(`    ${n}x ${k}`);
}
