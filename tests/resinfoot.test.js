// Resin feet (GitHub #309, web/prop/resinfoot.js): with Vertical (resin) pins a wall's
// base flange is windowed -- a strip under the stem plus spaced pads -- so it flexes
// off a resin plate. Pinned: less of the plate is covered than by the solid flange,
// and every support is still closed. (FDM is untouched: the sweep vs main.)

import { loadModel, analyze, buildTopology, fins, isClosed, assert } from './_util.js';
const { windowedFlange, RESIN_FOOT } = await import('../web/prop/resinfoot.js');

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function build(name, tunables) {
  const topo = loadModel(name), res = analyze(topo, 45, IDENTITY);
  try {
    return fins.buildFins(topo, res, IDENTITY, { mode: 'auto', bedPad: false, tines: true, tunables });
  } finally {
    fins.applyTunables({ tineDir: 'horizontal', pinDepth: 0.3 });   // module state back to the default
  }
}

/** Plan area of plate the supports stand on (z ~ 0), their overlaps counted once:
 *  a 0.1 mm grid of points, each inside some bottom triangle or not. */
function plateArea(tris) {
  const bottoms = [];
  for (let i = 0; i + 2 < tris.length; i += 3) {
    const t = [tris[i], tris[i + 1], tris[i + 2]];
    if (Math.max(t[0][2], t[1][2], t[2][2]) <= 1e-6) bottoms.push(t);
  }
  const G = 0.1, cells = new Set();
  for (const [p, q, r] of bottoms) {
    const d = (q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1]);
    if (Math.abs(d) < 1e-12) continue;
    for (let i = Math.ceil(Math.min(p[0], q[0], r[0]) / G); i * G <= Math.max(p[0], q[0], r[0]); i++) {
      for (let j = Math.ceil(Math.min(p[1], q[1], r[1]) / G); j * G <= Math.max(p[1], q[1], r[1]); j++) {
        const x = i * G, y = j * G;
        const u = ((q[0] - x) * (r[1] - y) - (r[0] - x) * (q[1] - y)) / d;
        const v = ((r[0] - x) * (p[1] - y) - (p[0] - x) * (r[1] - y)) / d;
        if (u >= 0 && v >= 0 && u + v <= 1) cells.add(i * 1e6 + j);
      }
    }
  }
  return cells.size * G * G;
}

Deno.test('resin feet: the windowed flange covers less plate than the solid one', () => {
  const fdm = build('lowledge', { tineDir: 'horizontal' });
  const resin = build('lowledge', { tineDir: 'vertical' });
  const a = plateArea(fdm.triangles), b = plateArea(resin.triangles);
  assert(a > 0 && b > 0, 'both stand on the plate');
  assert(b < 0.8 * a, `windows cut the plate contact: ${b.toFixed(1)} vs ${a.toFixed(1)} mm2`);
  assert(isClosed(resin.triangles), 'every support solid is still closed');
});

Deno.test('resin feet: a full wall\'s flange is windowed too (a shelf 20 mm up)', () => {
  const t = [];
  const box = (x0, x1, y0, y1, z0, z1) => {
    const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
    for (const [a, b, c] of [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]]) t.push(...v[a], ...v[b], ...v[c]);
  };
  box(0, 10, 0, 40, 0, 22); box(10, 50, 0, 40, 20, 22);
  const pos = new Float32Array(t);
  const topo = buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
  const res = analyze(topo, 45, IDENTITY);
  const run = (tineDir) => {
    try { return fins.buildFins(topo, res, IDENTITY, { mode: 'auto', bedPad: false, tunables: { tineDir } }); }
    finally { fins.applyTunables({ tineDir: 'horizontal', pinDepth: 0.3 }); }
  };
  const fdm = run('horizontal'), resin = run('vertical');
  assert(fdm.fins.some((f) => f.height > 15), 'full-height walls under the shelf');
  const a = plateArea(fdm.triangles), b = plateArea(resin.triangles);
  assert(b < 0.8 * a, `windows cut the plate contact: ${b.toFixed(1)} vs ${a.toFixed(1)} mm2`);
  assert(isClosed(resin.triangles), 'every support solid is still closed');
});

Deno.test('resin feet: pads at both ends, windows between, a short flange stays solid', () => {
  const foot = (x) => ({ p: [x, 0, 10], sx: 0, sy: 1, foot: 2, sh: 0.5, zBed: 0, baseTop: 0.6 });
  const long = [], short = [];
  for (let x = 0; x <= 20; x += 0.5) long.push(foot(x));
  for (let x = 0; x <= 4; x += 0.5) short.push(foot(x));
  const out = [];
  assert(windowedFlange(long, out), 'a 20 mm flange is windowed');
  // the bottoms: the strip, then one pad per pitch
  const pads = [];
  for (let i = 0; i + 2 < out.length; i += 3) {
    const t = [out[i], out[i + 1], out[i + 2]];
    if (t.some((v) => v[2] > 1e-9) || t.every((v) => Math.abs(v[1]) <= 0.9 + 1e-9)) continue;
    pads.push(Math.min(...t.map((v) => v[0])));
  }
  const xs = [...new Set(pads.map((x) => x.toFixed(3)))].map(Number).sort((p, q) => p - q);
  assert(xs[0] === 0 && Math.abs(xs.at(-1) - (20 - RESIN_FOOT.pad)) < 1e-6, `pads at both ends: ${xs}`);
  for (let i = 1; i < xs.length; i++) {
    assert(xs[i] - xs[i - 1] >= RESIN_FOOT.pad + RESIN_FOOT.window - 1e-6, `a window between pads ${i - 1} and ${i}`);
  }
  assert(isClosed(out), 'strip and pads are closed solids');
  // each pad's outer edge is undercut: narrower on the plate, full width on top, so a
  // scraper slides under the lip (the print hangs upside down: a 45deg overhang)
  const wide = (z) => Math.max(...out.filter((v) => Math.abs(v[2] - z) < 1e-9).map((v) => Math.abs(v[1])));
  assert(Math.abs(wide(0) - (2 - 0.6 * RESIN_FOOT.bevel)) < 1e-6 && wide(0.6) === 2,
    `pads undercut from the top: ${wide(0)} on the plate -> ${wide(0.6)} on top`);
  assert(!windowedFlange(short, []), 'a 4 mm flange is left solid');
});
