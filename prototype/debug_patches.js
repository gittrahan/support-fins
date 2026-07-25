/** Instrument the patch grower: where do the upright faces actually go? */
const WEB = '/Users/matthewtrahan/projects/support-fins/web';
const { buildTopology, analyze } = await import(`${WEB}/overhangs.js`);
const { findWallPatches, MAX_LEAN_DEG } = await import(`${WEB}/planes.js`);

function readBinarySTL(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = dv.getUint32(80, true);
  const pos = new Float32Array(n * 9);
  for (let f = 0; f < n; f++) {
    const o = 84 + f * 50 + 12;
    for (let i = 0; i < 9; i++) pos[f * 9 + i] = dv.getFloat32(o + i * 4, true);
  }
  return pos;
}

const path = Deno.args[0];
const tilt = Number(Deno.args[1] ?? 0);
const a = (tilt * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
const rot = [1, 0, 0, 0, c, s, 0, -s, c];

const pos = readBinarySTL(Deno.readFileSync(path));
const topo = buildTopology({ getAttribute: () => ({ array: pos }) });
const res = analyze(topo, 45, rot);

// how many faces are even eligible, and how much area do they carry?
const leanCut = Math.sin((MAX_LEAN_DEG * Math.PI) / 180);
let up = 0, upArea = 0, tot = 0;
const byNormal = new Map();
for (let f = 0; f < topo.nFaces; f++) {
  const i = f * 3;
  const x = topo.nrm[i], y = topo.nrm[i + 1], z = topo.nrm[i + 2];
  const nz = rot[2] * x + rot[5] * y + rot[8] * z;
  const nx = rot[0] * x + rot[3] * y + rot[6] * z;
  const ny = rot[1] * x + rot[4] * y + rot[7] * z;
  tot += topo.area[f];
  if (Math.abs(nz) <= leanCut && Math.hypot(nx, ny) > 1e-9) {
    up++; upArea += topo.area[f];
    const k = `${Math.round(nx * 8)},${Math.round(ny * 8)},${Math.round(nz * 8)}`;
    byNormal.set(k, (byNormal.get(k) ?? 0) + topo.area[f]);
  }
}
console.log(`faces ${topo.nFaces}  upright ${up} (${(100 * up / topo.nFaces).toFixed(0)}%)`);
console.log(`area  ${tot.toFixed(0)} mm2  upright ${upArea.toFixed(0)} mm2`);
console.log(`adjacency pairs ${topo.adjA.length}  (2-manifold would be ~${(topo.nFaces * 3 / 2) | 0})`);
console.log(`welded vertices ${topo.vertexCount}  edges ${topo.edgeCount}`);

const top = [...byNormal.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
console.log('\nupright area by normal bucket (n*8 rounded):');
for (const [k, v] of top) console.log(`  ${k.padEnd(14)} ${v.toFixed(0)} mm2`);

const patches = findWallPatches(topo, rot, res.offset);
console.log(`\npatches kept: ${patches.length}`);
for (const p of patches.slice(0, 10)) {
  console.log(`  area ${p.area.toFixed(0).padStart(6)}  faces ${String(p.faces.length).padStart(4)}` +
              `  z ${p.z0.toFixed(1)}..${p.z1.toFixed(1)}  len ${(p.u1 - p.u0).toFixed(1)}` +
              `  lean ${p.lean.toFixed(0)}  flat ${p.flatness.toFixed(3)}`);
}
