// Experiment (Full coverage, 2026-10-15): parallel rows of walls along one heading, each row
// built by Draw's drawnWall and kept as its longest buildable pieces (bisect, then re-merge),
// rows picked greedily by red held; scored with held.js like probe.js. Auto walls first.
// deno run -A prototype/fill-rows/rows.js <checkout> <stl> <out.json> [dirDeg=0] [yStep=1] [zStep=3]
const [root, stl, out, dirDeg = '0', yStepS = '1', zStepS = '3'] = Deno.args;
const W = `${root}/web`;
const { buildTopology, analyze } = await import(`${W}/overhangs.js`);
const { buildFins } = await import(`${W}/fins.js`);
const { drawnWall } = await import(`${W}/draw.js`);
const { PROP } = await import(`${W}/prop.js`);
const { classify, reachOf, MUST, PLATE_Z } = await import(`${W}/fins/coverage.js`);
const { seatedPartTris } = await import(`${W}/fins/seating.js`);
const { heldFaces } = await import(`${root}/prototype/examples/held.js`);
const b0 = Deno.readFileSync(stl), dv = new DataView(b0.buffer), n = dv.getUint32(80, true);
const pos = new Float32Array(n * 9);
for (let f = 0; f < n; f++) for (let i = 0; i < 9; i++) pos[f * 9 + i] = dv.getFloat32(84 + f * 50 + 12 + i * 4, true);
const topo = buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
const rot = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const res = analyze(topo, 45, rot);
const R = PROP.maxUnsupportedSpan / 2;
const auto = buildFins(topo, res, rot, { mode: 'auto', bedPad: true, tines: true });
const tris = seatedPartTris(topo, rot, res.offset);
const th = +dirDeg * Math.PI / 180, ux = Math.cos(th), uy = Math.sin(th);
// MUST red faces as points (subdivided like fill.js would be overkill: centroids, small faces on a mini)
const cls = classify(topo, res, rot), off = res.offset;
const red = [];
for (let f = 0; f < topo.nFaces; f++) {
  if (!res.over[f] || cls[f] !== MUST) continue;
  let c = [0, 0, 0];
  for (let v = 0; v < 3; v++) { const o = f * 9 + v * 3;
    c[0] += (pos[o] + 0) / 3; c[1] += pos[o + 1] / 3; c[2] += pos[o + 2] / 3; }
  c = [c[0] + off.x, c[1] + off.y, c[2] + off.z];
  if (c[2] < PLATE_Z) continue;
  red.push([...c, topo.area[f]]);
}
const autoTops = []; for (const w of auto.fins ?? []) for (const p of w.line ?? []) autoTops.push(p);
const nearAuto = reachOf(autoTops, R);
const bare0 = red.filter((p) => !nearAuto(p[0], p[1], p[2]));
console.log('red', red.length, 'bare after auto', bare0.length, 'area', bare0.reduce((s, p) => s + p[3], 0).toFixed(0));
// candidates: lines along (ux,uy) at across-offset v, z hint h, spanning the bare red within R across and 6 mm in z
const acr = (p) => -uy * p[0] + ux * p[1], alo = (p) => ux * p[0] + uy * p[1];
const vs = bare0.map(acr), zs = bare0.map((p) => p[2]);
const ys = +yStepS, zsS = +zStepS;
const cands = [], fails = {}, MINLEAF = +(Deno.env.get('MINLEAF') ?? 3);
const t0 = performance.now();
const drawOpts = { under: true, tines: true, topo, rot, offset: res.offset };
for (let v = Math.min(...vs); v <= Math.max(...vs); v += ys) {
  for (let h = Math.max(1, Math.min(...zs)); h <= Math.max(...zs) + 0.01; h += zsS) {
    const near = bare0.filter((p) => Math.abs(acr(p) - v) <= R && Math.abs(p[2] - h) <= 6);
    if (!near.length) continue;
    const ts = near.map(alo); const t1 = Math.min(...ts) - 1, t2 = Math.max(...ts) + 1;
    if (t2 - t1 < 3) continue;
    const at = (t) => [ux * t - uy * v, uy * t + ux * v, h];
    const build = (p, q) => { const r = drawnWall(at(p), at(q), tris, 0, drawOpts); return r.ok ? r : (fails[r.reason.split(' — ')[0]] = (fails[r.reason.split(' — ')[0]] ?? 0) + 1, null); };
    // leaves: bisect a failed range down to MINLEAF; then merge adjacent built leaves left to right
    const leaves = [];
    const rec = (p, q) => { const r = build(p, q); if (r) { leaves.push({ p, q, r }); return; } if (q - p < 2 * MINLEAF) return; const m = (p + q) / 2; rec(p, m); rec(m, q); };
    rec(t1, t2);
    let cur = null;
    for (const L of leaves) {
      if (cur && Math.abs(cur.q - L.p) < 1e-6) { const r = build(cur.p, L.q); if (r) { cur = { p: cur.p, q: L.q, r }; continue; } }
      if (cur) cands.push({ v, h, r: cur.r, len: cur.r.length });
      cur = L;
    }
    if (cur) cands.push({ v, h, r: cur.r, len: cur.r.length });
  }
}
const ok = cands.filter((c) => c.r);
console.log('candidates', cands.length, 'built', ok.length, ((performance.now() - t0) / 1000).toFixed(0) + 's', JSON.stringify(fails));
// collision: per-triangle AABBs (split to <=2mm) gridded
function boxes(t, fn, d = 0) {
  const [a, b, c] = t; const bx = [0, 1, 2].map((k) => Math.min(a[k], b[k], c[k])).concat([0, 1, 2].map((k) => Math.max(a[k], b[k], c[k])));
  if (d >= 12 || Math.max(bx[3] - bx[0], bx[4] - bx[1], bx[5] - bx[2]) <= 2) return fn(bx);
  const L = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
  let [p, q, s] = [a, b, c]; if (L(b, c) >= L(a, b) && L(b, c) >= L(c, a)) [p, q, s] = [b, c, a]; else if (L(c, a) >= L(a, b)) [p, q, s] = [c, a, b];
  const m = p.map((x, k) => (x + q[k]) / 2); boxes([p, m, s], fn, d + 1); boxes([m, q, s], fn, d + 1);
}
const grid = new Map(), C = 5, key = (i, j) => i * 100003 + j;
const FL = PROP.baseH + 0.05;
const addT = (T) => { for (let i = 0; i + 2 < T.length; i += 3) boxes([T[i], T[i + 1], T[i + 2]], (bx) => {
  for (let i2 = Math.floor(bx[0] / C); i2 <= Math.floor(bx[3] / C); i2++) for (let j = Math.floor(bx[1] / C); j <= Math.floor(bx[4] / C); j++) {
    const k = key(i2, j); let g = grid.get(k); if (!g) grid.set(k, (g = [])); g.push(bx); } }); };
const hits = (T, pad) => { let hit = false;
  for (let i = 0; i + 2 < T.length && !hit; i += 3) boxes([T[i], T[i + 1], T[i + 2]], (b) => { if (hit) return;
    for (let i2 = Math.floor((b[0] - pad) / C); i2 <= Math.floor((b[3] + pad) / C) && !hit; i2++) for (let j = Math.floor((b[1] - pad) / C); j <= Math.floor((b[4] + pad) / C) && !hit; j++)
      for (const o of grid.get(key(i2, j)) || []) if (b[0] - pad <= o[3] && o[0] <= b[3] + pad && b[1] - pad <= o[4] && o[1] <= b[4] + pad && b[2] - pad <= o[5] && o[2] <= b[5] + pad
        && !(Math.max(b[2], o[2]) <= FL && Math.min(b[5], o[5]) <= FL)) { hit = true; break; } });
  return hit; };
addT(auto.triangles ?? []);
// greedy
const tops = [...autoTops]; let near = reachOf(tops, R);
const kept = [];
for (;;) {
  let best = null;
  for (const c of ok) {
    if (c.used || c.dead) continue;
    const reach = reachOf(c.r.top, R);
    let g = 0; for (const p of bare0) if (!near(p[0], p[1], p[2]) && reach(p[0], p[1], p[2])) g += p[3];
    c.gain = g; if (g >= 0.5 && (!best || g > best.gain)) best = c;
  }
  if (!best) break;
  if (hits(best.r.tris, PROP.sideClear)) { best.dead = true; continue; }
  best.used = true; kept.push(best); addT(best.r.tris); for (const p of best.r.top) near.add(p);
}
const fins = [...(auto.fins ?? []), ...kept.map((c) => ({ line: c.r.top }))];
const allTris = [...(auto.triangles ?? []), ...kept.flatMap((c) => c.r.tris)];
const h = heldFaces(topo, res, rot, { fins, padTriangles: auto.padTriangles }, R);
const vol = (t) => { let s = 0; for (let i = 0; i < t.length; i += 3) { const [a, b, c] = [t[i], t[i + 1], t[i + 2]];
  s += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]); } return Math.abs(s) / 6; };
console.log(`dir ${dirDeg}: walls ${kept.length} (+${(auto.fins ?? []).length} auto), lengths ${kept.map((c) => c.len.toFixed(1)).join(' ')}`);
console.log(`must-hold ${(100 * h.mustHeld / h.must).toFixed(0)}% of ${h.must.toFixed(0)} mm2, g ${((vol(allTris) + vol(auto.padTriangles ?? [])) * 1.24 / 1000).toFixed(1)}`);
const foot = []; for (let i = 0; i < pos.length; i += 9 * Math.max(1, Math.floor(n / 20000))) foot.push([pos[i] + off.x, pos[i + 1] + off.y, pos[i + 2] + off.z]);
Deno.writeTextFileSync(out, JSON.stringify({ walls: kept.map((c) => ({ fill: true, line: c.r.top })), foot, tris: kept.flatMap((c) => c.r.tris).map((p) => p.map((x) => +x.toFixed(2))) }));
