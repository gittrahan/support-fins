// A LOW edge: where a near-flat underside sinks toward the plate, no wall fits
// (under the squat floor), so the band between the contact and the first row
// prints into air. A curved face lying on the bed is the case (a customer's DRO
// housing on its bowed back at X-90: at the default coverage one side got no row
// at all and the other its first at 18 mm). The row nearest the band goes at
// its edge -- ADDED, never moved, so every row that built before still does.
import { buildTopology, analyze, fins, prop, isClosed, assert } from './_util.js';

const { PROP } = prop;
const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const topoOf = (tris) => buildTopology({ getAttribute: (k) => (k === 'position' ? { array: tris } : null) });

// A slab x -L..L, y -W..W, flat top at H, its underside a shallow cylinder
// about x of radius R touching the plate along y = 0: z = R - sqrt(R^2 - y^2).
function bowedSlab(L = 50, W = 24, H = 10, R = 130, dy = 0.5) {
  const ys = [];
  for (let y = -W; y < W - 1e-9; y += dy) ys.push(y);
  ys.push(W);
  const zb = (y) => R - Math.sqrt(R * R - y * y);
  const t = [];
  const tri = (a, b, c) => t.push(...a, ...b, ...c);
  for (let i = 0; i < ys.length - 1; i++) {
    const y0 = ys[i], y1 = ys[i + 1];
    // underside (normal down) and top (normal up)
    tri([-L, y0, zb(y0)], [L, y1, zb(y1)], [L, y0, zb(y0)]);
    tri([-L, y0, zb(y0)], [-L, y1, zb(y1)], [L, y1, zb(y1)]);
    tri([-L, y0, H], [L, y0, H], [L, y1, H]);
    tri([-L, y0, H], [L, y1, H], [-L, y1, H]);
    // the two x ends
    tri([-L, y0, zb(y0)], [-L, y0, H], [-L, y1, H]);
    tri([-L, y0, zb(y0)], [-L, y1, H], [-L, y1, zb(y1)]);
    tri([L, y0, zb(y0)], [L, y1, H], [L, y0, H]);
    tri([L, y0, zb(y0)], [L, y1, zb(y1)], [L, y1, H]);
  }
  // the two long sides at y = -W and y = +W
  tri([-L, -W, zb(-W)], [L, -W, H], [-L, -W, H]);
  tri([-L, -W, zb(-W)], [L, -W, zb(-W)], [L, -W, H]);
  tri([-L, W, zb(W)], [-L, W, H], [L, W, H]);
  tri([-L, W, zb(W)], [L, W, H], [L, W, zb(W)]);
  return new Float32Array(t);
}

// wall centre y's, back in the model's own frame (buildFins works seated)
const wallYs = (tris, coverage) => {
  const topo = topoOf(tris), res = analyze(topo, 45, I);
  const b = fins.buildFins(topo, res, I, { mode: 'auto', bedPad: true, tines: true, coverage });
  return b.props.map((q) => q.line.reduce((s, p) => s + p[1], 0) / q.line.length - res.offset.y).sort((a, c) => a - c);
};

Deno.test('low edge: the bowed slab is a closed solid', () => {
  assert(isClosed(bowedSlab()), 'bowedSlab is not closed');
});

Deno.test('low edge: a bowed face on the bed gets a wall at each edge of its low band, at every coverage', () => {
  // the squat floor (0.6 wall + 0.2 gap) is crossed at |y| = sqrt(2 R 0.82) = 14.6
  const floorY = Math.sqrt(2 * 130 * (PROP.minHeightSquat + PROP.gap + 0.02));
  for (const cov of [0, 0.5, 1]) {
    const ys = wallYs(bowedSlab(), cov);
    for (const side of [-1, 1]) {
      const near = ys.filter((y) => y * side > 0).map((y) => Math.abs(y)).sort((a, b) => a - b)[0];
      assert(near !== undefined, `cov ${cov}: no wall on the ${side < 0 ? '-' : '+'}y side: ${ys.map((y) => y.toFixed(1))}`);
      assert(near > floorY - 0.5 && near < floorY + 2 * PROP.squatBrimW,
        `cov ${cov}: nearest ${side < 0 ? '-' : '+'}y wall at ${near.toFixed(2)}, low edge ~${floorY.toFixed(2)}: ${ys.map((y) => y.toFixed(1))}`);
    }
  }
});
