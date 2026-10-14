// kissEnds (web/kiss.js): a tine's end stops at the FIRST solid along its heading.
// It used to probe once at 2x the reach and bisect back from there: a part thinner
// than that put the probe in air past it (the full reach, run through the part), and
// a second piece beyond a thin near one pulled the end out through the near one.

import { block, buildTopology, insidePart, loadModel, rotX, analyze, tineBoxes, assert, assertClose } from './_util.js';
import { kissEnds } from '../web/kiss.js';
import { findWallPatches } from '../web/planes.js';
import { buildPerpFins, PERP } from '../web/fins/wedges.js';

const I = [1, 0, 0, 0, 1, 0, 0, 0, 1], O = { x: 0, y: 0, z: 0 };
const topoOf = (...boxes) => {
  const parts = boxes.map((b) => block(...b));
  const pos = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { pos.set(p, at); at += p.length; }
  return buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
};
// a 0.6-layer tine at the origin biting +Y: reach 1.5, so the old far probe sat at 3.0
const ends = (topo) => kissEnds(topo, I, O, 0, 0, 0, 1, 4.6, 5.2, { half: 0.25, back: 0.3, reach: 1.5 });
const all = (e) => [...e.bot, ...e.top];

Deno.test('kissEnds: a part thinner than the far probe still stops the tine at its face', () => {
  // solid from y 0.5 to 1.3: both the old 3.0 and 1.5 probes land in air past it
  for (const d of all(ends(topoOf([-5, 5, 0.5, 1.3, 0, 10])))) assertClose(d, 0.51, 1e-3, 'end');
});

Deno.test('kissEnds: a thin near piece stops the tine, not a block beyond it', () => {
  // a 0.2 slab at y 0.5, then a block from y 2: the old far probe found the block
  for (const d of all(ends(topoOf([-5, 5, 0.5, 0.7, 0, 10], [-5, 5, 2, 10, 0, 10])))) assertClose(d, 0.51, 1e-3, 'end');
});

Deno.test('kissEnds: no solid within reach keeps the full reach; solid behind the seed pulls back', () => {
  for (const d of all(ends(topoOf([-5, 5, 4, 10, 0, 10])))) assertClose(d, 1.5, 1e-9, 'bare');
  for (const d of all(ends(topoOf([-5, 5, -1, 10, 0, 10])))) assertClose(d, -0.25, 1e-9, 'behind');
});

// The review of the wedge-tine change: the `wedge` model's +28 wedge at X45, 0.6
// layers, built from its patch -- 3 tines ran their full reach 0.3 mm into the part.
Deno.test('kissEnds: a wedge on a thin part keeps its tines out of it at 0.6 layers', () => {
  const topo = loadModel('wedge'), rot = rotX(45), res = analyze(topo, 45, rot);
  const p = findWallPatches(topo, rot, res.offset)
    .filter((q) => q.n.z < -0.05 && q.area >= PERP.minArea && (q.u1 - q.u0) >= PERP.minWidth)[0];
  const on = buildPerpFins(p, topo, rot, res.offset, { tines: true, layerHeight: 0.6 });
  const off = buildPerpFins(p, topo, rot, res.offset, { tines: false });
  let n = 0;
  on.wedges.forEach((w, i) => {
    const pre = off.wedges[i].triRange[1] - off.wedges[i].triRange[0];
    for (const t of tineBoxes(on.triangles.slice(w.triRange[0] + pre, w.triRange[1])).tines) {
      n++;
      const mid = (t.lo[2] + t.hi[2]) / 2, cx = (t.lo[0] + t.hi[0]) / 2, cy = (t.lo[1] + t.hi[1]) / 2;
      for (const v of t.verts.filter((q) => q[2] > t.hi[2] - 1e-6)) {
        // 0.02 back toward the tine's centre: the end overlaps the part by 0.01 on purpose
        const dx = cx - v[0], dy = cy - v[1], d = Math.hypot(dx, dy) || 1;
        assert(!insidePart(topo, rot, res.offset, v[0] + (dx / d) * 0.02, v[1] + (dy / d) * 0.02, mid),
               `a tine top corner at x ${v[0].toFixed(2)} is inside the part at its mid-layer`);
      }
    }
  });
  assert(n >= 20, `wedge X45 at 0.6 built ${n} wedge tines`);
});
