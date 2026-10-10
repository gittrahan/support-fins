// Raster placement (web/prop/raster.js): walls across a region's whole footprint,
// raced per region against the normal pass. Pinned: it wins where it should (a
// curved underside the tube route gave nothing), it never costs grip or wedges,
// and `raster: false` builds the normal pass alone. The short-wall last resort
// (fins/shortwalls.js) is off throughout: it fills what raster:false leaves bare.
import { fileURLToPath } from 'node:url';
import { buildTopology, analyze, fins, prop, assert, readSTL, rotX, loadModel } from './_util.js';
import { gripRise } from '../web/prop/raster.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));   // gen_curved.py
const example = (name) => {
  const pos = readSTL(Deno.readFileSync(`${FIXTURES}${name}.stl`));
  return buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
};
const build = (topo, rot, raster) =>
  fins.buildFins(topo, analyze(topo, 45, rot), rot, { mode: 'auto', bedPad: true, tines: true, raster, lastResort: false });

// Overhang area within reach of a wall top: prototype/examples/probe.js's rule.
function heldFrac(topo, rot, b) {
  const res = analyze(topo, 45, rot), o = res.offset, { pos } = topo;
  const tops = b.props.flatMap((q) => q.line ?? []);
  const R = prop.PROP.maxUnsupportedSpan / 2;
  let area = 0, held = 0;
  for (const g of res.regions) for (const f of g.faces) {
    const c = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const j = f * 9 + i * 3, x = pos[j], y = pos[j + 1], z = pos[j + 2];
      c[0] += (rot[0] * x + rot[3] * y + rot[6] * z + o.x) / 3;
      c[1] += (rot[1] * x + rot[4] * y + rot[7] * z + o.y) / 3;
      c[2] += (rot[2] * x + rot[5] * y + rot[8] * z + o.z) / 3;
    }
    area += topo.area[f];
    if (tops.some((p) => { const dz = c[2] - p[2]; return dz >= -0.05 && dz <= 1.5 && Math.hypot(c[0] - p[0], c[1] - p[1]) <= R; })) held += topo.area[f];
  }
  return held / area;
}

Deno.test('raster: a flat torus tilted 30deg gets its underside held (tube route gave 4%)', () => {
  const topo = example('torus_flat'), rot = rotX(30);
  const before = heldFrac(topo, rot, build(topo, rot, false));
  const after = heldFrac(topo, rot, build(topo, rot, true));
  assert(before < 0.10, `normal pass changed: ${before}`);
  assert(after > 0.45, `raster should hold the torus underside: ${after}`);
});

Deno.test('raster: raster:false builds the normal pass alone', () => {
  const topo = example('torus_flat'), rot = rotX(30);
  const res = analyze(topo, 45, rot);
  const a = prop.buildProps(topo, res, rot, { tines: true, raster: false });
  const b = prop.buildProps(topo, res, rot, { tines: true, raster: true });
  assert(b.rasterRegions > 0, 'torus_flat X30 should swap a region to raster');
  assert(a.rasterRegions === undefined, 'raster:false ran the race');
  assert(b.props.some((q) => q.raster), 'the swapped region has no raster wall');
  assert(a.props.length !== b.props.length || a.triangles.length !== b.triangles.length,
    'raster:false built the same supports as the race');
});

Deno.test('raster: a swap never raises the lowest grip or drops a wedge (bore_bracket-like)', () => {
  // Every pose: the lowest tine with raster on may not sit above the one with it
  // off by more than gripRise (0.1 mm near the bed, 5% of its height up high --
  // compare.js's base-grip rule), and no wedge disappears. The curved fixtures
  // plus the stress models that swap (sphere, torus) or wedge (tube, portal).
  const shapes = [...['bowl', 'dome_ceiling', 'torus_flat'].map((n) => [n, () => example(n)]),
                  ...['sphere', 'torus', 'tube', 'portal'].map((n) => [n, () => loadModel(n)])];
  for (const [name, load] of shapes) {
    for (const deg of [0, 30, 45]) {       // most swaps happen at 45 and steeper
      const topo = load(), rot = rotX(deg);
      const low = (raster) => {
        globalThis.__TINECAP = [];
        const b = build(topo, rot, raster);
        const caps = globalThis.__TINECAP;
        globalThis.__TINECAP = undefined;
        return { z: caps.length ? Math.min(...caps.map((t) => t.z)) : Infinity,
                 wedges: b.fins.filter((f) => f.kind === 'wedge').length };
      };
      const off = low(false), on = low(true);
      assert(on.z <= off.z + gripRise(off.z), `${name} X${deg}: lowest tine rose ${off.z} -> ${on.z}`);
      assert(on.wedges >= off.wedges, `${name} X${deg}: wedges ${off.wedges} -> ${on.wedges}`);
    }
  }
});

Deno.test('tines: square to the wall, not angled off it (raster torus X30)', () => {
  // A raster track crosses a curved underside at an angle, and the part's
  // down-slope heading put 12 of 22 tines diagonally off the wall. Tines now take
  // the wall's nearest axis (along or across); an angled one is only the fallback
  // where no square tine reaches the part.
  const topo = example('torus_flat'), rot = rotX(30);
  globalThis.__TINECAP = [];
  const b = build(topo, rot, true);
  const caps = globalThis.__TINECAP;
  globalThis.__TINECAP = undefined;
  let square = 0, angled = 0;
  for (const t of caps) {
    let run = null, best = Infinity;
    for (const q of b.props) for (let i = 0; i + 1 < q.line.length; i++) {
      const a = q.line[i], c = q.line[i + 1], dx = c[0] - a[0], dy = c[1] - a[1], L = Math.hypot(dx, dy);
      if (L < 1e-6) continue;
      const u = Math.max(0, Math.min(1, ((t.x - a[0]) * dx + (t.y - a[1]) * dy) / (L * L)));
      const d = Math.hypot(t.x - a[0] - u * dx, t.y - a[1] - u * dy);
      if (d < best) { best = d; run = [dx / L, dy / L]; }
    }
    const cos = Math.abs(run[0] * t.biteX + run[1] * t.biteY);
    if (cos > 0.999 || cos < 0.001) square++; else angled++;
  }
  assert(square >= 15, `too few square tines: ${square}`);
  assert(angled <= square / 3, `too many angled tines: ${angled} of ${square + angled}`);
});
