// The judge's scorer (web/prop/judge.js) reads its anchors through height-banded
// buckets (web/prop/judgegrid.js) instead of the plain 3 x 3 plan cells. The races
// swap walls on its verdicts, so every sample must get EXACTLY the verdict a scan of
// every anchor gives -- on real builds (the stress models tilted, Auto's walls as
// tops, the part's own anchors), and at the band and reach edges, where a point
// sits exactly on a test's boundary.
import { assert, loadModel, analyze, fins, prop, WEB } from './_util.js';

const { buildFins } = fins;
const { PROP } = prop;
const { JUDGE, scorer, partAnchors, faceSamples, judgeRuler } = await import(`${WEB}prop/judge.js`);

// The scorer as it stood over the plain cells: every point, the same tests.
function scan(tops, partPts) {
  const SPAN = PROP.maxUnsupportedSpan;
  const bridgeMax = SPAN + PROP.th, cantMax = JUDGE.cantilever + PROP.th / 2;
  const pts = [];
  for (const line of tops) {
    for (let i = 0; i < line.length; i++) {
      const p = line[i]; pts.push(p);
      const q = line[i + 1]; if (!q) break;
      const n = Math.floor(Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) / 0.5);
      for (let k = 1; k < n; k++) { const t = k / n; pts.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]); }
    }
  }
  const all = [...pts, ...partPts];
  const N = JUDGE.sectors, apart = Math.ceil((JUDGE.bridgeDeg / 360) * N);
  const best = new Float64Array(N);
  return (x, y, z) => {
    best.fill(Infinity);
    for (const p of all) {
      const dz = z - p[2];
      if (dz < -0.05 || dz > 1.5) continue;
      const d = Math.hypot(p[0] - x, p[1] - y);
      if (d > bridgeMax) continue;
      const s = Math.floor(((Math.atan2(p[1] - y, p[0] - x) + Math.PI) / (2 * Math.PI)) * N) % N;
      if (d < best[s]) best[s] = d;
    }
    let nearest = Infinity;
    for (const d of best) if (d < nearest) nearest = d;
    if (nearest <= cantMax) return 'near';
    for (let i = 0; i < N; i++) {
      if (best[i] === Infinity) continue;
      for (let k = i + 1; k < N; k++) if (Math.min(k - i, N - (k - i)) >= apart && best[i] + best[k] <= bridgeMax) return 'bridged';
    }
    return nearest <= SPAN / 2 ? 'cant' : 'bare';
  };
}

const d2r = (d) => (d * Math.PI) / 180;
const rotX = (d) => { const c = Math.cos(d2r(d)), s = Math.sin(d2r(d)); return [1, 0, 0, 0, c, s, 0, -s, c]; };
const rotY = (d) => { const c = Math.cos(d2r(d)), s = Math.sin(d2r(d)); return [c, 0, -s, 0, 1, 0, s, 0, c]; };
const mul = (a, b) => [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => a[j] * b[i * 3] + a[3 + j] * b[i * 3 + 1] + a[6 + j] * b[i * 3 + 2]));

Deno.test('the judge scores every sample of a real build exactly as a scan of every anchor', () => {
  let n = 0;
  const seen = new Set();
  for (const [name, rot] of [['torus', rotX(45)], ['staircase', mul(rotY(60), rotX(30))], ['portal', rotY(90)],
                             ['sphere', rotX(25)], ['tube', rotX(60)], ['lbracket', mul(rotY(60), rotX(30))]]) {
    const topo = loadModel(name);
    const res = analyze(topo, 45, rot);
    const built = buildFins(topo, res, rot, { mode: 'auto', bedPad: true, tines: true, coverage: 0.5 });
    const tops = (built.fins ?? []).map((w) => w.line ?? []);
    const partPts = partAnchors(topo, res, rot);
    const held = scorer(tops, partPts), want = scan(tops, partPts);
    // the samples the ruler scores, and the same points a little off their face
    let s = 3;
    const r = () => ((s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9 >>> 0) / 2 ** 32);
    for (let f = 0; f < topo.nFaces; f++) {
      if (!res.over[f]) continue;
      for (const [x, y, z] of faceSamples(topo, res, rot, f)) {
        for (const [px, py, pz] of [[x, y, z], [x + (r() - 0.5) * 4, y + (r() - 0.5) * 4, z + (r() - 0.5) * 3]]) {
          const g = held(px, py, pz), w = want(px, py, pz);
          assert(g === w, `${name}: (${px}, ${py}, ${pz}) judged ${g}, the scan ${w}`);
          seen.add(g); n++;
        }
      }
    }
    // and the ruler's sum, which is what a race compares
    const faces = [];
    for (let f = 0; f < topo.nFaces; f++) if (res.over[f]) faces.push([0, 0, 0, topo.area[f], 0, f]);
    // (the ruler takes the tops flattened, each point its own line: nothing densified)
    const flat = tops.flat(), wantFlat = scan(flat.map((p) => [p]), partPts);
    let sum = 0;
    for (const fc of faces) for (const [x, y, z, w] of faceSamples(topo, res, rot, fc[5])) { const c = wantFlat(x, y, z); if (c === 'near' || c === 'bridged') sum += w; }
    const got = judgeRuler(topo, res, rot)(faces, flat);
    assert(Object.is(got, sum), `${name}: the ruler held ${got} mm2, the scan ${sum}`);
  }
  assert(n > 2000 && seen.size >= 3, `too few samples or verdicts: ${n}, ${[...seen]}`);
});

Deno.test('the judge sees an anchor exactly on a band or reach edge, and ignores a non-finite one', () => {
  const b = PROP.maxUnsupportedSpan + PROP.th;
  const at = (x, y, z) => [[[x, y, z]]];                // one wall top, one point
  for (const [tops, partPts, x, y, z] of [
    [at(0, 0, 10), [], 0.3, 0, 10 + 1.5],               // dz = 1.5 exactly: still in
    [at(0, 0, 10), [], 0.3, 0, 10 - 0.05],              // dz = -0.05 exactly: still in
    [at(0, 0, 10), [], 0.3, 0, 10 + 1.5000001],         // a hair past: out
    [at(b, 0, 10), [], 0, 0, 10],                       // d = bridgeMax exactly
    [at(b + 1e-9, 0, 10), [], 0, 0, 10],                // a hair past
    [[], [[0, 0, 10], [b, 0, 10.4]], 0, 0, 10.5],       // part anchors, two sides
    [[], [[0, 0, 10], [-b, 0, 10.4]], -0.01, 0, 10.5],
    [at(2, 0, 10), [[NaN, 0, 10], [0, Infinity, 10], [0, 0, NaN], [-2, 0, 10]], 0, 0, 10.5],
    [[[[1e9, 0, 10]]], [], 1e9 + 1, 0, 10],             // far out in plan: cell keys wrap
    [[[[0, 0, 1e6]]], [], 0.5, 0, 1e6 + 0.1],           // far up: height keys wrap
  ]) {
    const g = scorer(tops, partPts)(x, y, z), w = scan(tops, partPts)(x, y, z);
    assert(g === w, `tops ${JSON.stringify(tops)} part ${JSON.stringify(partPts)} at (${x}, ${y}, ${z}): judged ${g}, the scan ${w}`);
  }
});
