// A wedge drops straight from the face it holds to the bed, so it must stand clear
// of any of the part under that face (GH #254): a channel stood at 45deg got a wedge
// under its upper plate that ran straight through the lower one -- inside the part,
// impossible to break away. Its vertices were all outside (the blade just passes
// through the plate), so this samples points across each blade triangle instead.

import { assert, buildTopology, analyze, fins, insidePart, rotX } from './_util.js';

// A U-channel along x: two plates (z 0-3 and z 14-17) joined at one end (y 60-63),
// the lower one running on past the joint. Built from grid cells so every face is
// shared whole (no T-junctions): a closed solid.
function channelTopo() {
  const Y = [0, 60, 63, 80], Z = [0, 3, 14, 17], X0 = -20, X1 = 20;
  const cells = new Set(['0,0', '1,0', '2,0', '1,1', '0,2', '1,2']);
  const on = (i, k) => cells.has(`${i},${k}`);
  const t = [];
  const quad = (a, b, c, d) => t.push(a, b, c, a, c, d);
  for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) {
    if (!on(i, k)) continue;
    const y0 = Y[i], y1 = Y[i + 1], z0 = Z[k], z1 = Z[k + 1];
    quad([X0, y0, z0], [X0, y0, z1], [X0, y1, z1], [X0, y1, z0]);         // -x cap
    quad([X1, y0, z0], [X1, y1, z0], [X1, y1, z1], [X1, y0, z1]);         // +x cap
    if (!on(i - 1, k)) quad([X0, y0, z0], [X1, y0, z0], [X1, y0, z1], [X0, y0, z1]);
    if (!on(i + 1, k)) quad([X0, y1, z0], [X0, y1, z1], [X1, y1, z1], [X1, y1, z0]);
    if (!on(i, k - 1)) quad([X0, y0, z0], [X0, y1, z0], [X1, y1, z0], [X1, y0, z0]);
    if (!on(i, k + 1)) quad([X0, y0, z1], [X1, y0, z1], [X1, y1, z1], [X0, y1, z1]);
  }
  const pos = new Float32Array(t.flat());
  return buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
}

// Points across every blade-sized triangle (tines are tiny and bite on purpose).
function bladeInside(topo, rot, offset, tris) {
  let n = 0;
  for (let i = 0; i < tris.length; i += 3) {
    const [a, b, c] = [tris[i], tris[i + 1], tris[i + 2]];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const area = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    if (area < 2) continue;
    const N = 12;
    for (let p = 1; p < N; p++) for (let q = 1; p + q < N; q++) {
      const s = p / N, r = q / N;
      if (insidePart(topo, rot, offset, a[0] + ux * s + vx * r, a[1] + uy * s + vy * r, a[2] + uz * s + vz * r)) n++;
    }
  }
  return n;
}

// A plate leaning at 45deg over a thin rib standing on the bed across the wedge's run:
// a one-perimeter wall fits between contact stations 1.5 mm apart up the face, so the
// clearance check samples the run between them too (review of #254).
function plateOverRibTopo(ribY, ribW) {
  const s = Math.SQRT1_2, t = [];
  const box = (R) => {
    const v = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]].map(R);
    const q = (a, b, c, d) => t.push(v[a], v[b], v[c], v[a], v[c], v[d]);
    q(0, 3, 2, 1); q(4, 5, 6, 7); q(0, 1, 5, 4); q(2, 3, 7, 6); q(1, 2, 6, 5); q(0, 4, 7, 3);
  };
  box(([a, b, c]) => { const y = 60 * b, z = 3 * c; return [-20 + 40 * a, y * s - z * s, 2 + y * s + z * s]; });
  box(([a, b, c]) => [-20 + 40 * a, ribY + ribW * b, 12 * c]);
  const pos = new Float32Array(t.flat());
  return buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
}

for (const ribY of [10, 10.2, 10.45]) {
  Deno.test(`wedges: a 0.3 mm rib under a leaning plate (y ${ribY}) stays out of the blade`, () => {
    const topo = plateOverRibTopo(ribY, 0.3), rot = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const res = analyze(topo, 45, rot);
    const b = fins.buildFins(topo, res, rot, { mode: 'auto', bedPad: true, tines: true });
    for (const f of b.fins.filter((g) => g.kind === 'wedge')) {
      const tris = f.triRanges.flatMap(([s, e]) => b.triangles.slice(s, e));
      const n = bladeInside(topo, rot, res.offset, tris);
      assert(n === 0, `wedge ${f.id}: ${n} points of its blade inside the rib`);
    }
  });
}

for (const deg of [45, -45]) {
  Deno.test(`wedges: a channel at X${deg} gets no wedge through its other plate (#254)`, () => {
    const topo = channelTopo(), rot = rotX(deg);
    const res = analyze(topo, 45, rot);
    const b = fins.buildFins(topo, res, rot, { mode: 'auto', bedPad: true, tines: true });
    const wedges = b.fins.filter((f) => f.kind === 'wedge');
    assert(wedges.length >= 1, 'no wedge at all: the clear ones should stay');
    for (const f of wedges) {
      const tris = f.triRanges.flatMap(([s, e]) => b.triangles.slice(s, e));
      const n = bladeInside(topo, rot, res.offset, tris);
      assert(n === 0, `wedge ${f.id}: ${n} points of its blade inside the part`);
    }
  });
}
