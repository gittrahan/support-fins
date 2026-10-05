/**
 * Area coverage on real models: what fraction of overhang AREA sits within reach of
 * a wall top, not just "did the region get a wall" (held.js has the rule). EVERY
 * overhang face counts, including regions under MIN_REGION_AREA the engine drops
 * unseen; `small%` is their share of the overhang, `held%` the share held overall.
 * Also reports bed-to-part stilt height (what branching would save).
 *
 *   deno run -A prototype/examples/probe.js [model ...]
 *   deno run -A prototype/examples/probe.js --fixtures [model ...]   # tests/fixtures/ curved shapes
 *   deno run -A prototype/examples/probe.js --dir <folder> [model ...] # any folder of STLs
 *     --poses up,X30,X45,Y45,suggested   (default up,X30)
 *     --dump <folder>                    one JSON per case, for render_held.py
 *     --web <checkout>/web               build with another checkout's engine (scored by THIS
 *                                        checkout's held.js, so both runs use one ruler)
 *     --json <file>                      every row as JSON, for probe_diff.js
 *
 * Columns: `must%` is the policy number (2026-10-05: every red face gets something):
 * held share of the MUST-hold overhang, i.e. all of it but tiny holes' ceilings
 * (`hole`, exempt) and the strip under the squat floor (`low`, reported apart); see
 * held.js classify. `held%` / `small%` are the old columns, kept for the baselines.
 *
 * The user-reported parts (GitHub #18 #50 #121 #157, and figures) live in the
 * git-ignored prototype/examples/reports/ -- other people's files, never committed.
 */
import { heldFaces } from './held.js';

const webArg = Deno.args.includes('--web') ? Deno.args[Deno.args.indexOf('--web') + 1] : null;
if (Deno.args.includes('--web') && (!webArg || webArg.startsWith('--'))) throw new Error('--web needs a path: --web <checkout>/web');
const WEB = webArg ? new URL(webArg.replace(/\/?$/, '/'), `file://${Deno.cwd()}/`).pathname
  : new URL('../../web/', import.meta.url).pathname;
const { buildTopology, analyze } = await import(`${WEB}overhangs.js`);
const { buildFins } = await import(`${WEB}fins.js`);
const { PROP } = await import(`${WEB}prop.js`);
const { suggestOrientations } = await import(`${WEB}orient.js`);

function readSTL(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), n = dv.getUint32(80, true);
  const pos = new Float32Array(n * 9);
  for (let f = 0; f < n; f++) for (let i = 0; i < 9; i++) pos[f * 9 + i] = dv.getFloat32(84 + f * 50 + 12 + i * 4, true);
  return pos;
}
const rotX = (d) => { const r = d * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return [1, 0, 0, 0, c, s, 0, -s, c]; };
const rotY = (d) => { const r = d * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return [c, 0, -s, 0, 1, 0, s, 0, c]; };
const vol = (t) => { let v = 0; for (let i = 0; i < t.length; i += 3) { const [a, b, c] = [t[i], t[i + 1], t[i + 2]];
  v += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]); } return Math.abs(v) / 6; };

const args = Deno.args;
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const dir = opt('--dir') ? opt('--dir').replace(/\/?$/, '/')
  : new URL(args.includes('--fixtures') ? '../../tests/fixtures/' : './real/', import.meta.url).pathname;
const POSES = (opt('--poses') ?? 'up,X30').split(',');
const dump = opt('--dump');
const jsonOut = opt('--json');
const rows = [];
if (dump) Deno.mkdirSync(dump, { recursive: true });
const valued = new Set(['--dir', '--poses', '--dump', '--web', '--json'].map((k) => opt(k)).filter(Boolean));
const want = args.filter((a) => !a.startsWith('-') && !valued.has(a));
const files = [...Deno.readDirSync(dir)].map((f) => f.name).filter((n) => n.toLowerCase().endsWith('.stl'))
  .filter((n) => !want.length || want.includes(n.replace(/\.stl$/i, ''))).sort();
const R = PROP.maxUnsupportedSpan / 2;
const pad = (s, n) => String(s).padEnd(n);
const W = Math.max(18, ...files.map((f) => Math.min(40, f.length - 2)));
console.log(pad('model', W) + pad('pose', 10) + pad('ovh mm2', 9) + pad('must%', 7) + pad('hole', 6) + pad('low', 6)
  + pad('held%', 7) + pad('small%', 8) + pad('walls', 6)
  + pad('onPart', 7) + pad('stilt mm', 9) + pad('g', 6) + 'skipped');
for (const f of files) {
  const pos = readSTL(Deno.readFileSync(dir + f));
  const topo = buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
  for (const pose of POSES) {
    const rot = pose === 'up' ? rotX(0) : pose[0] === 'X' ? rotX(+pose.slice(1)) : pose[0] === 'Y' ? rotY(+pose.slice(1))
      : pose === 'suggested' ? suggestOrientations(topo, { top: 1 }).candidates[0]?.rot : null;
    if (!rot) { console.log(pad(f.slice(0, W), W) + pad(pose, 10) + '(no such pose)'); continue; }
    const res = analyze(topo, 45, rot);
    const b = buildFins(topo, res, rot, { mode: 'auto', bedPad: true, tines: true });
    const h = heldFaces(topo, res, rot, b, R);
    const walls = b.props ?? [];
    const onPart = walls.filter((w) => w.partAttached).length;
    const stilt = walls.filter((w) => !w.partAttached).reduce((s, w) => s + (w.height ?? 0), 0);
    const g = (vol(b.triangles) + vol(b.padTriangles ?? [])) * 1.24 / 1000;
    const sk = Object.entries(b.skipped ?? {}).filter(([, n]) => n).map(([k, n]) => `${k}:${n}`).join(' ');
    const pct = (x) => (h.area ? (100 * x / h.area).toFixed(0) : '-');
    const must = h.must ? (100 * h.mustHeld / h.must).toFixed(0) : '-';
    console.log(pad(f.replace(/\.stl$/i, '').slice(0, W), W) + pad(pose, 10) + pad(h.area.toFixed(0), 9)
      + pad(must, 7) + pad(h.hole.toFixed(0), 6) + pad(h.low.toFixed(0), 6)
      + pad(pct(h.held), 7) + pad(pct(h.small), 8) + pad(walls.length, 6) + pad(onPart, 7)
      + pad(stilt.toFixed(0), 9) + pad(g.toFixed(1), 6) + sk);
    rows.push({ model: f.replace(/\.stl$/i, ''), pose, area: h.area, held: h.held, must: h.must, mustHeld: h.mustHeld,
      hole: h.hole, low: h.low, lowHeld: h.lowHeld, walls: walls.length, grams: g });
    if (dump) {
      // the seated part (every face, for context), the overhang faces' held/small
      // flags, and the support triangles -- what render_held.py draws
      const off = res.offset, s = (i) => [0, 1, 2].map((k) => +(rot[k] * pos[i] + rot[3 + k] * pos[i + 1] + rot[6 + k] * pos[i + 2]
        + [off.x, off.y, off.z][k]).toFixed(3));
      const tri = (f9) => [s(f9), s(f9 + 3), s(f9 + 6)];
      const step = Math.max(1, Math.floor(topo.nFaces / 40000));   // context only: thin a 1M-face mini
      const part = []; for (let k = 0; k < topo.nFaces; k += step) part.push(tri(k * 9));
      const sup = []; for (let i = 0; i < b.triangles.length; i += 3) sup.push([b.triangles[i], b.triangles[i + 1], b.triangles[i + 2]].map((v) => v.map((x) => +x.toFixed(3))));
      Deno.writeTextFileSync(`${dump}/${f.replace(/\.stl$/i, '').replace(/[^a-zA-Z0-9]+/g, '_')}-${pose}.json`, JSON.stringify({
        title: `${f} ${pose}`, area: h.area, held: h.held, small: h.small, walls: walls.length,
        must: h.must, mustHeld: h.mustHeld, hole: h.hole, low: h.low,
        part, over: h.faces.map(([fc, hd, sm, cl]) => [tri(fc * 9), hd, sm, cl]), sup }));
    }
  }
}
if (jsonOut) Deno.writeTextFileSync(jsonOut, JSON.stringify(rows, null, 1));
