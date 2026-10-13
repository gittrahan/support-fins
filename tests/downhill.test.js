// Downhill walls (issue #25): walls that run DOWN an overhang and follow it to the
// plate (web/prop/downhill.js), raced per region against the other placements
// (prop/raster.js raceAgainst) and kept only when the whole build is no worse for
// them (fins/downhill.js judgeDownhill).
import { fileURLToPath } from 'node:url';
import { buildTopology, analyze, fins, prop, assert, readSTL } from './_util.js';
import { downhillLines } from '../web/prop/downhill.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const example = (name) => {
  const pos = readSTL(Deno.readFileSync(`${FIXTURES}${name}.stl`));
  return buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
};

// Overhang area within reach of a wall top: prototype/examples/probe.js's rule.
function heldFrac(topo, rot, b) {
  const res = analyze(topo, 45, rot), o = res.offset, { pos } = topo;
  const tops = b.fins.flatMap((q) => q.line ?? []);
  const R = prop.PROP.maxUnsupportedSpan / 2;
  let area = 0, held = 0;
  for (const g of res.regions) for (const f of g.faces) {
    const c = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const j = f * 9 + i * 3, x = pos[j], y = pos[j + 1], z = pos[j + 2];
      c[0] += (rot[0] * x + rot[3] * y + rot[6] * z + o.x) / 3;
      c[1] += (rot[1] * x + rot[4] * y + rot[7] * z + o.y) / 3;
      c[2] += (rot[2] * x + rot[5] * y + rot[8] * z + o.z) / 3;
    }
    area += topo.area[f];
    if (tops.some((p) => { const dz = c[2] - p[2]; return dz >= -0.05 && dz <= 1.5 && Math.hypot(c[0] - p[0], c[1] - p[1]) <= R; })) held += topo.area[f];
  }
  return held / area;
}

const build = (topo, extra = {}) => {
  globalThis.__TINECAP = [];
  const b = fins.buildFins(topo, analyze(topo, 45, IDENTITY), IDENTITY, { mode: 'auto', bedPad: true, tines: true, ...extra });
  const caps = globalThis.__TINECAP;
  globalThis.__TINECAP = undefined;
  let low = Infinity;
  for (const t of caps) if (t.z < low) low = t.z;
  return { b, low };
};

Deno.test('downhill: the #25 part gets its curved end held (90% -> 97%+), never less grip', () => {
  // A long strip of overhang that slopes down to the plate across its width, its end
  // bending round a notch: the rows left the bend bare (90% held on main).
  const topo = example('issue25_curve');
  const off = build(topo, { downhill: false }), on = build(topo);
  const hOff = heldFrac(topo, IDENTITY, off.b), hOn = heldFrac(topo, IDENTITY, on.b);
  assert(hOff < 0.92, `downhill:false should be main's 90%, got ${(100 * hOff).toFixed(1)}%`);
  assert(on.b.props.some((q) => q.downhill), 'no region swapped to downhill walls');
  assert(hOn >= 0.97, `downhill held only ${(100 * hOn).toFixed(1)}%`);
  assert(on.low <= off.low + 0.1, `lowest tine rose ${off.low} -> ${on.low}`);
});

Deno.test('downhill: a plain slope gets straight lines down it, one at each end of its top edge', () => {
  // A 40 x 30 mm plane, 45deg-ish, sloping down along +x: z = 30 - 0.9 x.
  const tri = (a, b, c) => [...a, ...b, ...c];
  const z = (x) => 30 - 0.9 * x;
  const P = (x, y) => [x, y, z(x)];
  const tris = Float64Array.from([...tri(P(0, 0), P(40, 0), P(40, 30)), ...tri(P(0, 0), P(40, 30), P(0, 30))]);
  const pts = [P(0, 0), P(40, 0), P(40, 30), P(0, 30)];
  const lines = downhillLines(pts, tris);
  assert(lines && lines.length >= 3, `expected >= 3 lines across 30 mm, got ${lines?.length}`);
  const ys = lines.map((l) => l[0][1]).sort((a, b) => a - b);
  assert(ys[0] < 2 && ys.at(-1) > 28, `end lines at y ${ys[0].toFixed(1)} and ${ys.at(-1).toFixed(1)}, not the edge's ends`);
  for (let i = 1; i < ys.length; i++) assert(ys[i] - ys[i - 1] <= prop.PROP.maxUnsupportedSpan + 1e-6, 'lines wider apart than the span cap');
  for (const l of lines) {
    for (let k = 1; k < l.length; k++) {
      assert(l[k][2] < l[k - 1][2], 'a line climbed');
      assert(Math.abs(l[k][1] - l[0][1]) < 1e-6, 'a line on a plane bent sideways');
    }
  }
});

Deno.test('downhill: a level ceiling has no downhill to follow', () => {
  const tris = Float64Array.from([0, 0, 10, 20, 0, 10, 20, 20, 10, 0, 0, 10, 20, 20, 10, 0, 20, 10]);
  const pts = [[0, 0, 10], [20, 0, 10], [20, 20, 10], [0, 20, 10]];
  assert(downhillLines(pts, tris) === null, 'a flat ceiling got downhill lines');
});

Deno.test('downhill: downhill:false builds exactly what the race-free placement does', () => {
  // the judge's fallback: off must be the plain build, with no downhill wall in it
  const topo = example('issue25_curve');
  const { b } = build(topo, { downhill: false });
  assert(!b.props.some((q) => q.downhill), 'downhill:false placed a downhill wall');
});
