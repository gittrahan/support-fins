// A LOW edge: where a near-flat underside sinks toward the plate, no wall fits
// (under the squat floor), so the band between the contact and the first row
// prints into air. A curved face lying on the bed is the case (a customer's DRO
// housing on its bowed back at X-90: at the default coverage one side got no row
// at all and the other its first at 18 mm). The row nearest the band goes at
// its edge -- ADDED, never moved, so every row that built before still does.
import { buildTopology, analyze, fins, prop, block, isClosed, rotX, assert } from './_util.js';

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

const build = (tris, rot, coverage) => {
  const topo = topoOf(tris), res = analyze(topo, 45, rot);
  return fins.buildFins(topo, res, rot, { mode: 'auto', bedPad: true, tines: true, coverage });
};

// Two squat walls whose brims (2 x squatBrimW wide) overlap: parallel, closer
// than a brim width, and running side by side for some length. One fused slab.
function fusedSquats(b) {
  const sq = b.props.filter((q) => q.squat);
  const out = [];
  for (let i = 0; i < sq.length; i++) for (let j = i + 1; j < sq.length; j++) {
    const A = sq[i].line, B = sq[j].line;
    const a0 = A[0], a1 = A[A.length - 1];
    let ux = a1[0] - a0[0], uy = a1[1] - a0[1];
    const un = Math.hypot(ux, uy); ux /= un; uy /= un;
    const b0 = B[0], b1 = B[B.length - 1];
    const vx = b1[0] - b0[0], vy = b1[1] - b0[1], vn = Math.hypot(vx, vy);
    if (Math.abs(ux * vy - uy * vx) / vn > 0.1) continue;            // not parallel
    const off = Math.abs((b0[0] - a0[0]) * -uy + (b0[1] - a0[1]) * ux);
    const s = (p) => (p[0] - a0[0]) * ux + (p[1] - a0[1]) * uy;
    const lap = Math.min(un, Math.max(s(b0), s(b1))) - Math.max(0, Math.min(s(b0), s(b1)));
    if (off < 2 * PROP.squatBrimW && lap > 1) out.push(`${off.toFixed(2)} mm apart over ${lap.toFixed(1)} mm`);
  }
  return out;
}

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

Deno.test('low edge: no two squat brims fuse -- the bowed slab, and a tilted cube whose old squat wall stands behind the edge', () => {
  for (const cov of [0, 0.5, 1]) {
    const f = fusedSquats(build(bowedSlab(), I, cov));
    assert(!f.length, `bowed slab cov ${cov}: fused squat walls ${f}`);
  }
  // the sweep's cube35 at X60Z30, sparse: the first version added a squat wall
  // 1.6 mm from the one main builds over a PART row behind the edge
  const d = 35 * Math.PI / 180, c = Math.cos(d), sn = Math.sin(d);
  const raw = block(-20, 20, -20, 20, -20, 20);
  let minZ = Infinity;
  for (let i = 0; i < raw.length; i += 3) {
    const y = raw[i + 1], z = raw[i + 2];
    raw[i + 1] = y * c - z * sn; raw[i + 2] = y * sn + z * c;
    minZ = Math.min(minZ, raw[i + 2]);
  }
  for (let i = 2; i < raw.length; i += 3) raw[i] -= minZ;
  const z30 = Math.PI / 6, rz = [Math.cos(z30), Math.sin(z30), 0, -Math.sin(z30), Math.cos(z30), 0, 0, 0, 1];
  const rx = rotX(60), rot = new Array(9).fill(0);                       // rotZ(30) * rotX(60), col-major
  for (let col = 0; col < 3; col++) for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) rot[col * 3 + r] += rz[k * 3 + r] * rx[col * 3 + k];
  const b = build(raw, rot, 0);
  assert(b.props.some((q) => q.squat), 'the tilted cube lost its squat wall');
  const f = fusedSquats(b);
  assert(!f.length, `tilted cube: fused squat walls ${f}`);
});
