/**
 * Build one model with raster placement off and on (web/prop/raster.js) and dump
 * both, seated, for render.py: the part, every wall (tagged raster or not) and
 * each overhang face's held flag (probe.js's rule).
 *
 *   deno run -A prototype/examples/compare.js <model.stl> <xdeg> <out.json>
 *   python3 prototype/examples/render.py out.json out.png
 */
const WEB = new URL('../../web/', import.meta.url).pathname;
const { buildTopology, analyze } = await import(`${WEB}overhangs.js`);
const { buildFins } = await import(`${WEB}fins.js`);
const { PROP } = await import(`${WEB}prop.js`);

const [file, xdeg = '0', outPath = 'compare.json'] = Deno.args;
const b = Deno.readFileSync(file);
const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), n = dv.getUint32(80, true);
const pos = new Float32Array(n * 9);
for (let f = 0; f < n; f++) for (let i = 0; i < 9; i++) pos[f * 9 + i] = dv.getFloat32(84 + f * 50 + 12 + i * 4, true);
const d = Number(xdeg) * Math.PI / 180, c = Math.cos(d), s = Math.sin(d);
const rot = [1, 0, 0, 0, c, s, 0, -s, c];
const topo = buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
const res = analyze(topo, 45, rot);
const off = res.offset;
const seat = (i) => [rot[0] * pos[i] + rot[3] * pos[i + 1] + rot[6] * pos[i + 2] + off.x,
  rot[1] * pos[i] + rot[4] * pos[i + 1] + rot[7] * pos[i + 2] + off.y,
  rot[2] * pos[i] + rot[5] * pos[i + 1] + rot[8] * pos[i + 2] + off.z];
const part = [];
for (let f = 0; f < topo.nFaces; f++) part.push([seat(f * 9), seat(f * 9 + 3), seat(f * 9 + 6)]);

function build(raster) {
  const r = buildFins(topo, res, rot, { mode: 'auto', bedPad: true, tines: true, raster });
  const walls = [];
  for (const q of r.props) for (const [a, e] of q.triRanges) for (let i = a; i < e; i += 3)
    walls.push([r.triangles[i], r.triangles[i + 1], r.triangles[i + 2], q.raster ? 1 : 0]);
  const tops = r.props.flatMap((q) => q.line ?? []);
  const R = PROP.maxUnsupportedSpan / 2;
  const held = [];
  let area = 0, got = 0;
  for (const g of res.regions) for (const f of g.faces) {
    const t = part[f];
    const cx = (t[0][0] + t[1][0] + t[2][0]) / 3, cy = (t[0][1] + t[1][1] + t[2][1]) / 3, cz = (t[0][2] + t[1][2] + t[2][2]) / 3;
    const h = cz < 0.6 || tops.some((p) => { const dz = cz - p[2]; return dz >= -0.05 && dz <= 1.5 && Math.hypot(cx - p[0], cy - p[1]) <= R; });
    area += topo.area[f]; if (h) got += topo.area[f];
    held.push([f, h ? 1 : 0]);
  }
  return { walls, held, heldFrac: area ? got / area : null, nWalls: r.props.length };
}

Deno.writeTextFileSync(outPath, JSON.stringify({ title: `${file.split('/').pop()} X${xdeg}`, part,
                                                 off: build(false), on: build(true) }));
