/**
 * Regression sweep: run buildFins on every model x pose x coverage and record what
 * it placed, so two builds of the engine can be diffed case by case (compare.js).
 *
 *   deno run -A prototype/sweep/sweep.js --web <web dir> --out <json>
 *        [--export <dir> --only <keys.json>]
 *
 * WHY THIS EXISTS. Every support-fin fix so far was checked on the part in the
 * complaint -- and on 2026-09-22 a fix that looked perfect on the 35deg cube was
 * found (by an ad-hoc version of this sweep) to cost tines on most parts, drop a
 * wedge, drop a squat wall and drop a sphere's only wall. Unit tests pin known
 * cases; this looks at all of them. `--web` points at ANY checkout's web/ dir, so
 * the same script runs the base and the branch (vs-base.sh does both).
 *
 * Each case also records `hash`, a fingerprint of the exact support mesh, so a
 * refactor that should change nothing (moving code between modules) can prove it:
 * compare.js reports how many meshes are byte-identical to the base.
 *
 * Nothing here imports tests/_util.js: that resolves web/ relative to its own
 * checkout, which would silently run the branch's engine for the base.
 */
const args = Object.fromEntries(
  Deno.args.reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const WEB = args.web.replace(/\/$/, '');
const { buildTopology, analyze } = await import(`${WEB}/overhangs.js`);
const { buildFins } = await import(`${WEB}/fins.js`);

// Models always come from THIS checkout (they are untracked, so a base worktree
// has none) -- only the engine under test changes between runs.
const ROOT = new URL('../../', import.meta.url).pathname;
const MODEL_DIRS = [`${ROOT}prototype/stress/models`, `${ROOT}web/dev-models`];

function readSTL(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = dv.getUint32(80, true);
  const pos = new Float32Array(n * 9);
  for (let f = 0; f < n; f++) {
    const o = 84 + f * 50 + 12;
    for (let i = 0; i < 9; i++) pos[f * 9 + i] = dv.getFloat32(o + i * 4, true);
  }
  return pos;
}
// FNV-1a over the exact float64 bits of every vertex coordinate, in order. Any
// change to the emitted mesh -- one vertex nudged by 1e-12, one triangle added or
// reordered -- changes it, so a pure code move shows up as every case identical.
const HASH_BUF = new DataView(new ArrayBuffer(8));
function meshHash(...lists) {
  let h = 0x811c9dc5;
  for (const tris of lists) {
    for (const v of tris) {
      for (let k = 0; k < 3; k++) {
        HASH_BUF.setFloat64(0, v[k]);
        for (let b = 0; b < 8; b++) h = Math.imul(h ^ HASH_BUF.getUint8(b), 0x01000193);
      }
    }
    h = Math.imul(h ^ 0xff, 0x01000193);          // list boundary: [a][b] != [a, b]
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function writeSTL(tris) {                     // tris: flat list of [x,y,z] vertices
  const n = tris.length / 3;
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, n, true);
  for (let t = 0; t < n; t++) {
    const o = 84 + t * 50 + 12;
    for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) dv.setFloat32(o + (i * 3 + k) * 4, tris[t * 3 + i][k], true);
  }
  return new Uint8Array(buf);
}

// A 40mm cube with a 35deg tilt about X baked in (the part in Matthew's
// screenshots: cube-tines-35deg-RAW-tilted.stl), reseated to z = 0.
function tiltedCube(half = 20, deg = 35) {
  const v = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]
    .map((p) => p.map((c) => c * half));
  const q = (a, b, c, d) => [v[a], v[b], v[c], v[a], v[c], v[d]];
  const t = [...q(0, 3, 2, 1), ...q(4, 5, 6, 7), ...q(0, 1, 5, 4), ...q(2, 3, 7, 6), ...q(1, 2, 6, 5), ...q(0, 4, 7, 3)];
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const r = t.map(([x, y, z]) => [x, y * c - z * s, y * s + z * c]);
  const minZ = Math.min(...r.map((p) => p[2]));
  return Float32Array.from(r.flatMap(([x, y, z]) => [x, y, z - minZ]));
}

const d2r = (d) => (d * Math.PI) / 180;
const rotX = (d) => { const c = Math.cos(d2r(d)), s = Math.sin(d2r(d)); return [1, 0, 0, 0, c, s, 0, -s, c]; };
const rotY = (d) => { const c = Math.cos(d2r(d)), s = Math.sin(d2r(d)); return [c, 0, -s, 0, 1, 0, s, 0, c]; };
const rotZ = (d) => { const c = Math.cos(d2r(d)), s = Math.sin(d2r(d)); return [c, s, 0, -s, c, 0, 0, 0, 1]; };
const mul = (a, b) => {                        // 3x3 col-major, as stress/run.js
  const m = new Array(9).fill(0);
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) m[c * 3 + r] += a[k * 3 + r] * b[c * 3 + k];
  return m;
};
const POSES = {
  flat: [1, 0, 0, 0, 1, 0, 0, 0, 1], x25: rotX(25), x45: rotX(45), x60: rotX(60), y35: rotY(35), y45: rotY(45),
  x45y30: mul(rotY(30), rotX(45)), x60z30: mul(rotZ(30), rotX(60)), x30y60: mul(rotY(60), rotX(30)),
};
const COVERAGES = [0, 0.5, 1];               // sparse, default, dense

const models = [['cube35', tiltedCube()]];
for (const d of MODEL_DIRS) {
  for (const e of [...Deno.readDirSync(d)].sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name.endsWith('.stl')) models.push([e.name.slice(0, -4), readSTL(Deno.readFileSync(`${d}/${e.name}`))]);
  }
}

// OVERHANG COVERAGE, the number the gate should judge by. Tines and wall length
// are proxies: a layout change that trades a wedge for real walls loses tines and
// still covers more (tube X25 sparse: 30 -> 20 tines, 51% -> 76%). This mirrors
// check_stl.py coverage() constant-for-constant -- an overhang face (normal below
// 45deg, clear of the bed) is served when some support vertex sits within
// maxUnsupportedSpan of its centroid in plan AND 0..3mm below it (so a foot
// standing nearby doesn't count) -- without loading trimesh, so all 837 cases
// get it in the ~1 min sweep. The span comes from THIS checkout, so base and
// head are measured with one ruler.
const { PROP: HERE_PROP } = await import(`${ROOT}web/prop.js`);
const SPAN = HERE_PROP.maxUnsupportedSpan;
const OVER_COS = Math.cos(Math.PI / 4) + 1e-4, BED_EPS = 0.35, SUB = 3;
function coverage(part, sup) {
  let zmin = Infinity;
  for (const p of part) if (p[2] < zmin) zmin = p[2];
  const cell = SPAN, grid = new Map();
  const key = (i, j) => i * 100003 + j;
  for (const v of sup) {
    const k = key(Math.floor(v[0] / cell), Math.floor(v[1] / cell));
    let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(v);
  }
  const servedAt = (cx, cy, cz) => {
    const gi = Math.floor(cx / cell), gj = Math.floor(cy / cell);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      for (const v of grid.get(key(gi + di, gj + dj)) || []) {
        if (v[2] > cz - 3 && v[2] < cz + 0.5 && Math.hypot(v[0] - cx, v[1] - cy) <= SPAN) return true;
      }
    }
    return false;
  };
  let total = 0, served = 0;
  for (let i = 0; i < part.length; i += 3) {
    const a = part[i], b = part[i + 1], c = part[i + 2];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12 || nz / len >= -OVER_COS) continue;
    if (Math.max(a[2], b[2], c[2]) - zmin < BED_EPS) continue;
    // Judge the WHOLE face, not its centroid: a low-poly face is one huge
    // triangle (bigplate's underside is two), and its centroid alone flipped
    // bigplate Y35 sparse 100% -> 58% while the branch had MORE walls under it.
    // Split into n x n sub-triangles (~SUB mm edges), each judged at its own
    // centroid with its share of the area.
    const n = Math.max(1, Math.ceil(Math.max(Math.hypot(ux, uy, uz), Math.hypot(vx, vy, vz),
      Math.hypot(c[0] - b[0], c[1] - b[1], c[2] - b[2])) / SUB));
    const piece = len / 2 / (n * n);
    for (let i1 = 0; i1 < n; i1++) for (let j1 = 0; j1 < n - i1; j1++) {
      // upright piece at (i1, j1), plus the inverted one beside it
      for (const [s1, t1] of j1 < n - i1 - 1 ? [[i1 + 1 / 3, j1 + 1 / 3], [i1 + 2 / 3, j1 + 2 / 3]] : [[i1 + 1 / 3, j1 + 1 / 3]]) {
        const cx = a[0] + (ux * s1 + vx * t1) / n, cy = a[1] + (uy * s1 + vy * t1) / n, cz = a[2] + (uz * s1 + vz * t1) / n;
        total += piece;
        if (servedAt(cx, cy, cz)) served += piece;
      }
    }
  }
  return total > 0 ? r2((100 * served) / total) : null;
}

const only = args.only ? new Set(JSON.parse(Deno.readTextFileSync(args.only))) : null;
if (args.export) Deno.mkdirSync(args.export, { recursive: true });
const r2 = (v) => Math.round(v * 100) / 100;
const out = {};
for (const [name, pos] of models) {
  const topo = buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
  for (const [pn, rot] of Object.entries(POSES)) {
    for (const cov of COVERAGES) {
      const key = `${name}|${pn}|cov${cov}`;
      if (only && !only.has(key)) continue;
      try {
        globalThis.__TINECAP = [];
        const t0 = performance.now();
        const res = analyze(topo, 45, rot);
        const b = buildFins(topo, res, rot, { mode: 'auto', bedPad: true, tines: true, coverage: cov });
        const ms = performance.now() - t0;
        const caps = globalThis.__TINECAP;
        const walls = (b.props || []).filter((p) => p.line && p.line.length && !p.squat);
        const squat = (b.props || []).filter((p) => p.squat);
        const part = [];
        for (let i = 0; i < pos.length; i += 3) {
          const x = pos[i], y = pos[i + 1], z = pos[i + 2], o = res.offset;
          part.push([rot[0] * x + rot[3] * y + rot[6] * z + o.x,
                     rot[1] * x + rot[4] * y + rot[7] * z + o.y,
                     rot[2] * x + rot[5] * y + rot[8] * z + o.z]);
        }
        const len = (p) => Math.hypot(p.line.at(-1)[0] - p.line[0][0], p.line.at(-1)[1] - p.line[0][1]);
        out[key] = {
          ms: Math.round(ms),
          walls: walls.length, squat: squat.length, braces: b.fins.length,
          wallLen: r2(walls.reduce((s, p) => s + len(p), 0) + squat.reduce((s, p) => s + len(p), 0)),
          lowTop: walls.length ? r2(Math.min(...walls.flatMap((p) => p.line.map((q) => q[2])))) : null,
          tines: b.tines ?? 0,
          lowTine: caps.length ? r2(Math.min(...caps.map((t) => t.z))) : null,
          unserved: typeof b.unserved === 'number' ? b.unserved : (b.unserved?.length ?? 0),
          tris: b.triangles.length / 3,
          grams: r2(Math.abs(b.volume ?? 0) * 1.24 / 1000),
          cov: coverage(part, b.triangles),
          hash: meshHash(b.triangles, b.padTriangles || []),
        };
        if (args.export) {
          // check_stl.py naming: <case>.stl (part+added), -part, -fins, -pad
          const base = `${args.export}/${key.replaceAll('|', '__')}`;
          Deno.writeFileSync(`${base}.stl`, writeSTL([...part, ...b.triangles, ...(b.padTriangles || [])]));
          Deno.writeFileSync(`${base}-part.stl`, writeSTL(part));
          Deno.writeFileSync(`${base}-fins.stl`, writeSTL(b.triangles));
          if ((b.padTriangles || []).length) Deno.writeFileSync(`${base}-pad.stl`, writeSTL(b.padTriangles));
        }
      } catch (e) {
        out[key] = { error: String(e && e.stack || e).split('\n').slice(0, 3).join(' | ') };
      }
    }
  }
}
globalThis.__TINECAP = undefined;
Deno.writeTextFileSync(args.out, JSON.stringify(out));
console.log(`${Object.keys(out).length} cases -> ${args.out}`);
