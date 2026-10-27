// A wall standing ON THE PART keeps its ends off the part's side walls (#119). In a
// recessed box the walls cross the slicer's bridge (038) and run to the box's end
// wall; parity probing saw nothing, since the last station sat exactly ON that
// wall, outside the part, so the end cap was built flush against it and welded.
import { WEB, buildTopology, assert } from './_util.js';

const { buildPartAttached } = await import(`${WEB}prop/attached.js`);
const { drawnWall } = await import(`${WEB}draw.js`);

// the reporter's shape in section: a 50 mm deep box with a 4 mm floor, end walls
// 4 mm thick, and a lip 10 mm deep off each end 16 mm over the floor (the lips are
// the overhangs), run 70 mm along x. ONE closed solid: blocks stacked into it leave
// coincident faces at y = 21 that parity reads as solid, and the bug never shows.
const SECTION = [[-25, 0], [25, 0], [25, 25], [11, 25], [11, 20], [21, 20], [21, 4],
  [-21, 4], [-21, 20], [-11, 20], [-11, 25], [-25, 25]];          // (y, z), counter-clockwise
const CAPS = [[-25, 25, 0, 4], [21, 25, 4, 25], [-25, -21, 4, 25], [11, 21, 20, 25], [-21, -11, 20, 25]];
function extrude(x0, x1) {
  const t = [];
  // a triangle wound so its normal points along `n`
  const tri = (a, b, c, n) => {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const m = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    t.push(...(m[0] * n[0] + m[1] * n[1] + m[2] * n[2] >= 0 ? [a, b, c] : [a, c, b]));
  };
  SECTION.forEach(([ya, za], i) => {
    const [yb, zb] = SECTION[(i + 1) % SECTION.length], n = [0, zb - za, -(yb - ya)];   // outward
    tri([x0, ya, za], [x1, ya, za], [x1, yb, zb], n);
    tri([x0, ya, za], [x1, yb, zb], [x0, yb, zb], n);
  });
  for (const [y0, y1, z0, z1] of CAPS) {
    for (const [x, n] of [[x0, [-1, 0, 0]], [x1, [1, 0, 0]]]) {
      tri([x, y0, z0], [x, y1, z0], [x, y1, z1], n);
      tri([x, y0, z0], [x, y1, z1], [x, y0, z1], n);
    }
  }
  return new Float32Array(t.flat());
}
const box = extrude(-35, 35);

Deno.test('part wall ends: a wall run up to the end wall stops short of it', () => {
  // under the +y lip, its last station 0.1 mm short of the end wall's face (y = 21):
  // clearly outside the part, so parity passes it, and 0.1 mm welds. (The reporter's
  // box put it exactly ON the face; whether parity reads that inside depends on the
  // triangulation, so this pins the case it cannot see.) Seated as-is.
  const topo = buildTopology({ getAttribute: (k) => (k === 'position' ? { array: box } : null) });
  const rot = [1, 0, 0, 0, 1, 0, 0, 0, 1], offset = { x: 0, y: 0, z: 0 };
  const line = [];
  for (let y = 11.9; y < 21; y += 1) line.push([0, y, 20]);
  const out = [];
  const r = buildPartAttached(line, Float64Array.from(box), topo, rot, offset, out);
  assert(r.ok, `no wall under the lip: ${JSON.stringify(r)}`);
  const end = Math.max(...out.map((p) => p[1]));
  assert(end <= 21 - 0.205, `the wall's end is ${(21 - end).toFixed(3)} mm off the end wall -- it welds`);
});

Deno.test('part wall ends: a DRAWN wall run to the end wall stops short of it too', () => {
  // Draw's part path (Draw mode, and the Full fill pass's walls) built from the line as
  // given: drawn to y = 21 it ended flush on the end wall, and a line past it (y = 22)
  // ended there as well. With the topology it trims its ends like Auto's.
  const topo = buildTopology({ getAttribute: (k) => (k === 'position' ? { array: box } : null) });
  const rot = [1, 0, 0, 0, 1, 0, 0, 0, 1], offset = { x: 0, y: 0, z: 0 };
  for (const [y0, y1, sign] of [[12, 21, 1], [12, 22, 1], [-12, -21, -1]]) {
    const r = drawnWall([0, y0, 20], [0, y1, 20], topo.pos, 0, { tines: false, topo, rot, offset });
    assert(r.ok && r.partAttached, `no part wall for ${y0}..${y1}: ${JSON.stringify(r.reason)}`);
    const end = Math.max(...r.tris.map((p) => sign * p[1]));
    assert(end <= 21 - 0.205, `drawn ${y0}..${y1}: the wall's end is ${(21 - end).toFixed(3)} mm off the end wall -- it welds`);
  }
  // a line that already stops clear is left as drawn
  const ok = drawnWall([0, 12, 20], [0, 20.5, 20], topo.pos, 0, { tines: false, topo, rot, offset });
  assert(ok.ok && Math.max(...ok.tris.map((p) => p[1])) > 20.4, 'a clear drawn line was trimmed');
});
