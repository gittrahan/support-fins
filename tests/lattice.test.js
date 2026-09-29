// LATTICE NETS (issue #121, a headset's ring-and-strut shell): struts that meet at
// nodes join into one big overhang region, which went to splitRegion and was
// shattered into slivers -- the net got almost nothing while a lone strut of the
// same shape got a wall. prop/lattice.js cuts the net back into struts and routes
// each as a lone strut would, along its own length; the raster race keeps it only
// where it holds more. Pinned on a voxel strut net (one shared surface, so the
// struts' undersides really are one region, as on the headset).
import { buildTopology, analyze, fins, prop, assert, block } from './_util.js';
import { latticeStruts } from '../web/prop/lattice.js';

const V = 2;                                   // mm per voxel
function voxelTopo(filled, nx, ny, nz) {
  const at = (i, j, k) => i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz && filled(i, j, k);
  const P = (i, j, k) => [i * V, j * V, k * V], t = [];
  const q = (a, b, c, d) => t.push(a, b, c, a, c, d);
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) {
    if (!at(i, j, k)) continue;
    if (!at(i, j, k - 1)) q(P(i, j, k), P(i, j + 1, k), P(i + 1, j + 1, k), P(i + 1, j, k));
    if (!at(i, j, k + 1)) q(P(i, j, k + 1), P(i + 1, j, k + 1), P(i + 1, j + 1, k + 1), P(i, j + 1, k + 1));
    if (!at(i - 1, j, k)) q(P(i, j, k), P(i, j, k + 1), P(i, j + 1, k + 1), P(i, j + 1, k));
    if (!at(i + 1, j, k)) q(P(i + 1, j, k), P(i + 1, j + 1, k), P(i + 1, j + 1, k + 1), P(i + 1, j, k + 1));
    if (!at(i, j - 1, k)) q(P(i, j, k), P(i + 1, j, k), P(i + 1, j, k + 1), P(i, j, k + 1));
    if (!at(i, j + 1, k)) q(P(i, j + 1, k), P(i, j + 1, k + 1), P(i + 1, j + 1, k + 1), P(i + 1, j + 1, k));
  }
  const pos = new Float32Array(t.length * 3);
  t.forEach((p, n) => pos.set(p, n * 3));
  return buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
}
const topoOf = (pos) => buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });

// A 64 mm square net of 4 mm struts at a 20 mm pitch, 24 mm up on four corner posts.
const N = 32, bar = (u) => u % 10 < 2;
const net = () => voxelTopo((i, j, k) =>
  (k >= 12 && k < 14 && (bar(i) || bar(j))) ||
  (k < 12 && bar(i) && bar(j) && (i < 2 || i >= 30) && (j < 2 || j >= 30)), N, N, 14);
const rotX = (d) => { const r = (d * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r); return [1, 0, 0, 0, c, s, 0, -s, c]; };

const seatedOf = (topo, res, rot) => (f) => [0, 1, 2].map((k) => {
  const p = topo.pos, o = res.offset, x = p[f * 9 + k * 3], y = p[f * 9 + k * 3 + 1], z = p[f * 9 + k * 3 + 2];
  return [rot[0] * x + rot[3] * y + rot[6] * z + o.x, rot[1] * x + rot[4] * y + rot[7] * z + o.y,
          rot[2] * x + rot[5] * y + rot[8] * z + o.z];
});
const struts = (topo, rot) => {
  const res = analyze(topo, 45, rot);
  return latticeStruts(topo, res.regions[0].faces, seatedOf(topo, res, rot));
};

Deno.test('lattice: a strut net is cut into struts; a plate and a lone bar are not nets', () => {
  const g = struts(net(), rotX(20));
  assert(g && g.length >= 16, `the net should give ~20 struts: ${g?.length}`);
  const plate = topoOf(new Float32Array([...block(0, 60, 0, 60, 20, 24), ...block(0, 4, 0, 4, 0, 20)]));
  assert(struts(plate, rotX(0)) === null, 'a broad plate is not a net');
  const bar1 = topoOf(new Float32Array([...block(0, 60, 0, 4, 20, 24), ...block(0, 4, 0, 4, 0, 20)]));
  assert(struts(bar1, rotX(0)) === null, 'a lone bar is not a net');
});

// The net tilted 20 degrees about X: its struts along X now slope ACROSS their
// 4 mm width -- the headset's struts running around the dome.
Deno.test('lattice: a tilted net gets a wall along each strut (the normal pass gave none)', () => {
  const topo = net(), rot = rotX(20), res = analyze(topo, 45, rot);
  const build = (raster) => fins.buildFins(topo, res, rot, { mode: 'auto', bedPad: true, raster });
  const before = build(false), after = build(true);
  assert(before.props.length === 0, `normal pass changed: ${before.props.length} walls`);
  assert(after.props.length >= 16, `the struts should get walls: ${after.props.length}`);
  // every wall runs ALONG a strut (X or Y), never across one
  const dir = (q) => { const a = q.line[0], b = q.line[q.line.length - 1]; return Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1]) ? 'x' : 'y'; };
  for (const q of after.props) {
    const a = q.line[0], b = q.line[q.line.length - 1];
    const ang = (Math.atan2(Math.abs(b[1] - a[1]), Math.abs(b[0] - a[0])) * 180) / Math.PI;
    assert(ang < 10 || ang > 80, `a wall runs across a strut at ${ang.toFixed(0)}deg`);
  }
  // identical struts, the same support: both directions get their walls
  const nx = after.props.filter((q) => dir(q) === 'x').length, ny = after.props.length - nx;
  assert(nx >= 8 && ny >= 8, `struts along X got ${nx} walls, along Y ${ny}`);
  assert(after.props.every((q) => q.span >= prop.PROP.minSpan), 'strut walls keep minSpan');
});
