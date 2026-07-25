/**
 * Headless check of the M4 fin pipeline. Runs the SAME modules the browser runs
 * -- overhangs.js, planes.js, fins.js are all plain mesh math with no three.js
 * import -- so what this validates is the shipping code, not a reimplementation.
 *
 *   deno run --allow-read --allow-write verify_fins.js <model.stl> [tiltDeg]
 */
const WEB = '/Users/matthewtrahan/projects/support-fins/web';
const { buildTopology, analyze } = await import(`${WEB}/overhangs.js`);
const { buildFins } = await import(`${WEB}/fins.js`);
const { findWallPatches } = await import(`${WEB}/planes.js`);

function readBinarySTL(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = dv.getUint32(80, true);
  if (84 + n * 50 !== bytes.byteLength) throw new Error('not a binary STL');
  const pos = new Float32Array(n * 9);
  for (let f = 0; f < n; f++) {
    const o = 84 + f * 50 + 12;
    for (let i = 0; i < 9; i++) pos[f * 9 + i] = dv.getFloat32(o + i * 4, true);
  }
  return pos;
}

function writeBinarySTL(tris) {
  // tris is a flat list of VERTICES, three per triangle. Sizing the buffer by
  // its length instead of by the triangle count leaves a tail of zeros, and a
  // binary STL whose byte length disagrees with its header count is rejected
  // outright -- trimesh reads it as an empty mesh rather than erroring.
  const n = tris.length / 3;
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, n, true);
  for (let t = 0; t < n; t++) {
    const o = 84 + t * 50 + 12;
    for (let i = 0; i < 3; i++) {
      for (let k = 0; k < 3; k++) {
        dv.setFloat32(o + (i * 3 + k) * 4, tris[t * 3 + i][k], true);
      }
    }
  }
  return new Uint8Array(buf);
}

/** Column-major rotation about X, matching THREE.Matrix3.elements. */
function rotX(deg) {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [1, 0, 0, 0, c, s, 0, -s, c];
}

const path = Deno.args[0];
const tilt = Number(Deno.args[1] ?? 30);
const pos = readBinarySTL(Deno.readFileSync(path));

// the browser hands buildTopology a three.js BufferGeometry; it only ever reads
// the position array, so a two-line shim exercises the real code path
const geometry = { getAttribute: (k) => (k === 'position' ? { array: pos } : null) };

const topo = buildTopology(geometry);
const rot = rotX(tilt);
const res = analyze(topo, 45, rot);
const patches = findWallPatches(topo, rot, res.offset);

console.log(`${path.split('/').pop()}  tilt ${tilt}deg`);
console.log(`  faces ${topo.nFaces}  overhang regions ${res.regions.length}` +
            `  bed contact ${res.bedArea.toFixed(1)} mm2`);
console.log(`  wall patches ${patches.length}`);
for (const p of patches.slice(0, 6)) {
  console.log(`    area ${p.area.toFixed(0).padStart(6)} mm2  ` +
              `z ${p.z0.toFixed(1)}..${p.z1.toFixed(1)}  ` +
              `len ${(p.u1 - p.u0).toFixed(1)}  flat ${p.flatness.toFixed(3)}`);
}

const t0 = performance.now();
const built = buildFins(topo, res, rot, { mode: 'stabilize', bedPad: true });
const ms = performance.now() - t0;

console.log(`  -> ${built.fins.length} fins, ${built.tines} tines, ` +
            `pad ${built.pad ? 'yes' : 'no'}  (${ms.toFixed(0)} ms)`);
for (const f of built.fins) {
  console.log(`     ${f.height.toFixed(1)}mm tall x ${f.length.toFixed(1)}mm  ` +
              `${f.tines} tines / ${f.rows} rows  bearing ${f.bearing}deg  ` +
              `stilt ${f.stilt.toFixed(1)}`);
}
console.log(`  unserved overhang regions: ${built.unserved}`);

// part, as oriented and seated, plus everything the tool added
const { x: dx, y: dy, z: dz } = res.offset;
const tris = [];
for (let f = 0; f < topo.nFaces; f++) {
  for (let i = 0; i < 3; i++) {
    const o = f * 9 + i * 3;
    const x = pos[o], y = pos[o + 1], z = pos[o + 2];
    tris.push([
      rot[0] * x + rot[3] * y + rot[6] * z + dx,
      rot[1] * x + rot[4] * y + rot[7] * z + dy,
      rot[2] * x + rot[5] * y + rot[8] * z + dz,
    ]);
  }
}
const partTris = tris.length;
for (const t of built.triangles) tris.push(t);
for (const t of built.padTriangles) tris.push(t);

const out = Deno.args[2] ?? '/tmp/sf-check.stl';
Deno.writeFileSync(out, writeBinarySTL(tris));
console.log(`  wrote ${out}  (${partTris / 3} part tris + ` +
            `${(tris.length - partTris) / 3} added)`);

// fins and pad SEPARATELY. The pad is meant to fuse to the part -- lumping it in
// with the fins makes every pad look like a fin welded on by mistake.
Deno.writeFileSync(out.replace('.stl', '-fins.stl'), writeBinarySTL(built.triangles));
if (built.padTriangles.length) {
  Deno.writeFileSync(out.replace('.stl', '-pad.stl'), writeBinarySTL(built.padTriangles));
}
