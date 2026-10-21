// A rim round a flat underside (#269): a bead or a lip at the plate's edge is split
// off as a strip of its own, too thin for a wall, and the rows stopped where the
// plate's patch did -- ~2 mm short, the rim printed over air. A near-flat patch's
// track now runs on along the part's underside to where it meets air, within
// PROP.edgeReach (web/prop/tracks.js toEdge). Fixtures: tests/fixtures/gen_rims.py.
import { fileURLToPath } from 'node:url';
import { buildTopology, analyze, fins, assert, insideCount, readSTL } from './_util.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const example = (name) => {
  const pos = readSTL(Deno.readFileSync(`${FIXTURES}${name}.stl`));
  return buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
};
// the walls running along x (the plate's length), their end x's in the model's frame
// (|y| under 19: the rows under the y edges' own rims run along x too)
const build = (name, coverage) => {
  const topo = example(name), res = analyze(topo, 45, I);
  const b = fins.buildFins(topo, res, I, { mode: 'auto', bedPad: true, tines: true, coverage });
  const ends = b.props.map((q) => q.line.map((p) => [p[0] - res.offset.x, p[1] - res.offset.y]))
    .filter((ps) => Math.abs(ps.at(-1)[0] - ps[0][0]) > 20 && Math.abs(ps[0][1]) < 19)
    .map((ps) => [Math.min(...ps.map((p) => p[0])), Math.max(...ps.map((p) => p[0]))]);
  return { ends };
};
// support vertices inside the part, tines off (a tine bites in by design) and above
// the bed (a ray along the post's foot reads inside on main too)
const inside = (name, coverage) => {
  const topo = example(name), res = analyze(topo, 45, I);
  const b = fins.buildFins(topo, res, I, { mode: 'auto', bedPad: true, tines: false, coverage });
  return insideCount(topo, I, res.offset, b.triangles.filter((v) => v[2] > 0.05));
};

for (const coverage of [0, 0.5]) {
  Deno.test(`rim: a bead round a flat plate gets the rows out under it, both ends (coverage ${coverage})`, () => {
    // bead r 1.5 on the plate's x = +-30 edges: underside from 28.5 to 31.5, lowest at 30
    const { ends } = build('rim_bead', coverage);
    assert(ends.length >= 2, `${ends.length} walls along the plate`);
    for (const [lo, hi] of ends) {
      // main stopped at +-27.5, the plate patch's last certified station
      // (an end at the post in the middle is no edge)
      assert((lo > -20 || lo <= -30) && (hi < 20 || hi >= 30), `a wall ends at ${lo.toFixed(1)} .. ${hi.toFixed(1)}, short of the bead`);
    }
    const n = inside('rim_bead', coverage);
    assert(n === 0, `${n} support vertices inside the part`);
  });

  Deno.test(`rim: a lip hanging under a flat plate's edge gets the rows out under it (coverage ${coverage})`, () => {
    // lip from |x| 28.5 to 30, its underside 3 mm below the plate's
    const { ends } = build('rim_lip', coverage);
    assert(ends.length >= 2, `${ends.length} walls along the plate`);
    for (const [lo, hi] of ends) {
      assert((lo > -20 || lo <= -29) && (hi < 20 || hi >= 29), `a wall ends at ${lo.toFixed(1)} .. ${hi.toFixed(1)}, short of the lip`);
    }
    const n = inside('rim_lip', coverage);
    assert(n === 0, `${n} support vertices inside the part`);
  });
}
