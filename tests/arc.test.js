import { fileURLToPath } from 'node:url';
import { assert, insideCount, readSTL, rotX } from './_util.js';
import { buildTopology, analyze, IDENTITY3 } from '../web/overhangs.js';
import { buildFins } from '../web/fins.js';
import { arcLine } from '../web/prop/arc.js';
import { lineBend } from '../web/prop/curved.js';
import { seat } from '../web/prop/surface.js';

// Arc walls (web/prop/arc.js): a slot through a tube's wall has a level ceiling
// that curves in plan. Fixtures from tests/fixtures/gen_slot.py: an upright cup,
// its slot's ceiling at z 24, centred on the tube's axis at x = y = 0.
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));   // gen_slot.py
const SLOTS = [
  { file: 'slot_d30_t1.6.stl', R: 15, T: 1.6, W: 22 },   // straight tracks: no line at all
  { file: 'slot_d50_t2.5.stl', R: 25, T: 2.5, W: 32 },   // straight tracks: pieces, gaps between
];

function build(file, mode, rot = IDENTITY3) {
  const pos = readSTL(Deno.readFileSync(FIXTURES + file));
  const topo = buildTopology({ getAttribute: () => ({ array: pos }) });
  const result = analyze(topo, 45, rot);              // the site's call
  const built = buildFins(topo, result, rot, { mode, bedPad: true });
  return { topo, result, built, off: result.offset };
}

// Share of the ceiling's centre line with a wall top right under it: within half
// the strip (0.6 mm at least) in plan, and up to 1.2 mm below.
function heldUnder({ built, off }, { R, T, W }) {
  let n = 0, held = 0;
  for (let x = -W / 2 + 1; x <= W / 2 - 1; x += 0.5) {
    const r = R - T / 2, y = -Math.sqrt(r * r - x * x);
    n++;
    if (built.triangles.some((v) => Math.hypot(v[0] - off.x - x, v[1] - off.y - y) < Math.max(0.6, T / 2)
                                    && v[2] - off.z > 24 - 1.2 && v[2] - off.z < 24)) held++;
  }
  return held / n;
}

for (const s of SLOTS) {
  for (const mode of ['auto', 'full']) {
    Deno.test(`arc walls: ${s.file} ${mode} -- one wall along the slot's ceiling, inside its strip`, () => {
      const b = build(s.file, mode);
      const under = b.built.props.filter((p) => p.line?.length && p.line.every((q) => Math.abs(q[2] - b.off.z - 24) < 0.5));
      assert(under.length === 1, `${under.length} walls under the ceiling`);
      const line = under[0].line;
      assert(lineBend(line) > 30, `bend ${lineBend(line).toFixed(0)} deg`);
      for (const q of line) {
        const r = Math.hypot(q[0] - b.off.x, q[1] - b.off.y);
        assert(r > s.R - s.T && r < s.R, `station at r ${r.toFixed(2)}, off the ${s.R - s.T}..${s.R} strip`);
      }
      const held = heldUnder(b, s);
      assert(held >= 0.95, `${(held * 100).toFixed(0)}% of the ceiling right over a wall`);
      assert(insideCount(b.topo, IDENTITY3, b.off, b.built.triangles) === 0, 'support inside the part');
    });
  }
}

// 30 deg is near the level gate (the thin slot's ceiling rises ~1.0 mm against 0.9), 45 well past it
for (const deg of [30, 45]) {
  Deno.test(`arc walls: the slot tilted ${deg} deg slopes, so no arc (a slope is downhill.js's)`, () => {
    const rot = rotX(deg);
    const { topo, result, off } = build(SLOTS[0].file, 'auto', rot);
    const v = [0, 0, 0];
    for (const r of result.regions) {
      const tris = new Float64Array(r.faces.length * 9), pts = [];
      r.faces.forEach((f, k) => {
        for (let i = 0; i < 3; i++) { seat(topo.pos, f * 9 + i * 3, rot, off, v); tris.set(v, k * 9 + i * 3); pts.push([...v]); }
      });
      assert(arcLine(pts, tris) === null, 'an arc on a sloping region');
    }
  });
}
