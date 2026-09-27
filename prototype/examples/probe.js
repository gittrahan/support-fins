/**
 * Area coverage on the example models: what fraction of overhang AREA sits within
 * reach of a wall top, not just "did the region get a wall". A face counts as held
 * when a wall-top point lies within maxUnsupportedSpan/2 in plan and 0..1.5 mm
 * below it. Also reports bed-to-part stilt height (what branching would save).
 *
 *   deno run -A prototype/examples/probe.js [model ...]
 */
const WEB = new URL('../../web/', import.meta.url).pathname;
const { buildTopology, analyze } = await import(`${WEB}overhangs.js`);
const { buildFins } = await import(`${WEB}fins.js`);
const { PROP } = await import(`${WEB}prop.js`);
// prop/surface.js's seat, inlined so the probe also runs on pre-split branches.
function seat(pos, i, rot, off, out) {
  const x = pos[i], y = pos[i + 1], z = pos[i + 2];
  out[0] = rot[0] * x + rot[3] * y + rot[6] * z + off.x;
  out[1] = rot[1] * x + rot[4] * y + rot[7] * z + off.y;
  out[2] = rot[2] * x + rot[5] * y + rot[8] * z + off.z;
  return out;
}

function readSTL(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), n = dv.getUint32(80, true);
  const pos = new Float32Array(n * 9);
  for (let f = 0; f < n; f++) for (let i = 0; i < 9; i++) pos[f * 9 + i] = dv.getFloat32(84 + f * 50 + 12 + i * 4, true);
  return pos;
}
const rotX = (d) => { const r = d * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return [1, 0, 0, 0, c, s, 0, -s, c]; };
const vol = (t) => { let v = 0; for (let i = 0; i < t.length; i += 3) { const [a, b, c] = [t[i], t[i + 1], t[i + 2]];
  v += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]); } return Math.abs(v) / 6; };

const dir = new URL('./models/', import.meta.url).pathname;
const want = Deno.args.filter((a) => !a.startsWith('-'));
const files = [...Deno.readDirSync(dir)].map((f) => f.name).filter((n) => n.endsWith('.stl'))
  .filter((n) => !want.length || want.includes(n.replace('.stl', ''))).sort();
const R = PROP.maxUnsupportedSpan / 2;
const pad = (s, n) => String(s).padEnd(n);
console.log(pad('model', 18) + pad('pose', 6) + pad('ovh mm2', 9) + pad('held%', 7) + pad('walls', 6) + pad('onPart', 7)
  + pad('stilt mm', 9) + pad('g', 6) + 'skipped');
for (const f of files) {
  const pos = readSTL(Deno.readFileSync(dir + f));
  const topo = buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
  for (const [pose, rot] of [['up', rotX(0)], ['X30', rotX(30)]]) {
    const res = analyze(topo, 45, rot);
    const b = buildFins(topo, res, rot, { mode: 'auto', bedPad: true, tines: true });
    const tops = [];
    for (const w of b.fins) for (const p of w.line ?? []) tops.push(p);
    let area = 0, held = 0; const v = [0, 0, 0];
    for (const g of res.regions) for (const fc of g.faces) {
      let cx = 0, cy = 0, cz = 0;
      for (let i = 0; i < 3; i++) { seat(pos, fc * 9 + i * 3, rot, res.offset, v); cx += v[0] / 3; cy += v[1] / 3; cz += v[2] / 3; }
      const a = topo.area[fc]; area += a;
      if (cz < 0.6) { held += a; continue; }
      for (const p of tops) { const dz = cz - p[2];
        if (dz >= -0.05 && dz <= 1.5 && Math.hypot(cx - p[0], cy - p[1]) <= R) { held += a; break; } }
    }
    const walls = b.props ?? [];
    const onPart = walls.filter((w) => w.partAttached).length;
    const stilt = walls.filter((w) => !w.partAttached).reduce((s, w) => s + (w.height ?? 0), 0);
    const g = (vol(b.triangles) + vol(b.padTriangles)) * 1.24 / 1000;
    const sk = Object.entries(b.skipped ?? {}).filter(([, n]) => n).map(([k, n]) => `${k}:${n}`).join(' ');
    console.log(pad(f.replace('.stl', ''), 18) + pad(pose, 6) + pad(area.toFixed(0), 9)
      + pad(area ? (100 * held / area).toFixed(0) : '-', 7) + pad(walls.length, 6) + pad(onPart, 7)
      + pad(stilt.toFixed(0), 9) + pad(g.toFixed(1), 6) + sk);
  }
}
