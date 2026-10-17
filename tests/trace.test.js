// Curved walls on a jagged overhang (web/prop/trace.js): a rippled slope near the
// overhang angle breaks its red into strips, and a downhill line traced on one strip
// ends at its edge (coffee bean tilted back: 0 curves). Grown across the slivers,
// the strips trace as one surface and the lines cover the red themselves.
import { buildTopology, analyze, assert } from './_util.js';
import { traceGroups, TRACE } from '../web/prop/trace.js';
import { downhillLines } from '../web/prop/downhill.js';
import { PROP } from '../web/prop/config.js';

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

// A down-facing slope along x: 3 mm strips at 40deg (red at a 45deg threshold) and
// 50deg (not red), alternating, 42 x 24 mm, its high end 30 mm up
function rippled() {
  const W = 42, D = 24, z = [30];
  for (let x = 1; x <= W; x++) z.push(z[x - 1] - Math.tan(((Math.floor((x - 1) / 3) % 2 ? 50 : 40) * Math.PI) / 180));
  const tris = [];
  for (let x = 0; x < W; x++) for (let y = 0; y < D; y++) {
    const a = [x, y, z[x]], b = [x, y + 1, z[x]], c = [x + 1, y, z[x + 1]], d = [x + 1, y + 1, z[x + 1]];
    tris.push(...a, ...b, ...c, ...b, ...d, ...c);   // wound to face down
  }
  const pos = Float32Array.from(tris);
  return buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
}

Deno.test('trace: a rippled slope traces as one surface, its lines run across the strips and cover the red', () => {
  const topo = rippled();
  const res = analyze(topo, 45, IDENTITY);
  assert(res.regions.length >= 5, `the red should break into strips, got ${res.regions.length} regions`);
  const all = new Set(res.regions.map((_, i) => i));
  const { leaderOf, groups } = traceGroups(topo, res, IDENTITY, res.offset, all);

  // the strips' own faces: no line runs past a strip (3 mm downhill)
  for (const ri of all) {
    const tris = [], pts = [];
    const { pos } = topo, off = res.offset;
    for (const f of res.regions[ri].faces) {
      for (let i = 0; i < 3; i++) {
        const p = [pos[f * 9 + i * 3] + off.x, pos[f * 9 + i * 3 + 1] + off.y, pos[f * 9 + i * 3 + 2] + off.z];
        tris.push(...p); pts.push(p);
      }
    }
    const own = downhillLines(pts, Float64Array.from(tris)) ?? [];
    assert(own.every((l) => l.length <= 5), `strip ${ri}: a line ran ${Math.max(...own.map((l) => l.length))} mm on its own faces`);
  }

  assert(groups.size === 1, `the strips should join into one surface, got ${groups.size}`);
  const [leader, g] = [...groups][0];
  assert(g.members.length === res.regions.length && [...leaderOf.values()].every((l) => l === leader),
         'every strip should race with the one leader');
  const lines = downhillLines(g.pts, g.tris, PROP.stationStep, undefined, { h: TRACE.h, cover: g.red });
  assert(lines && Math.max(...lines.map((l) => l.length)) >= 30, `the lines should cross the strips: ${lines?.map((l) => l.length)}`);
  const reach = PROP.maxUnsupportedSpan / 2;
  const bare = g.red.filter((p) => !lines.some((l) => l.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) <= reach)));
  assert(bare.length === 0, `${bare.length} of ${g.red.length} red faces beyond every line's reach`);
});
