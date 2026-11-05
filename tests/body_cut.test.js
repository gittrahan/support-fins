import { assert, assertEquals } from 'jsr:@std/assert';
import { bodyCut, CUT_DEPTH } from '../web/prop/bodycut.js';
import { buildTopology } from '../web/overhangs.js';
import { cutEnds, wallsAcrossCuts } from '../web/fins/stepsplit.js';

// a closed box, 0..20 on every axis, in the print frame
const box = (s = 20) => {
  const v = (x, y, z) => [x * s, y * s, z * s];
  const q = (a, b, c, d) => [a, b, c, a, c, d];
  const P = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]].map((p) => v(...p));
  const f = [q(0,3,2,1), q(4,5,6,7), q(0,1,5,4), q(1,2,6,5), q(2,3,7,6), q(3,0,4,7)].flat();
  const pos = new Float32Array(f.length * 3);
  f.forEach((i, k) => pos.set(P[i], k * 3));
  return buildTopology({ getAttribute: (n) => (n === 'position' ? { array: pos } : null) });
};
const ID = [1, 0, 0, 0, 1, 0, 0, 0, 1], O = { x: 0, y: 0, z: 0 };
// a vertical wall face, poking `into` mm into the box from below (the box's underside is z 0)
const face = (into) => [[5, 10, -30], [15, 10, -30], [15, 10, into], [5, 10, -30], [15, 10, into], [5, 10, into]];

Deno.test('bodyCut: a body deep inside the part is a cut, and says where', () => {
  const at = bodyCut(box(), ID, O, face(3));
  assert(at, 'a 3 mm intrusion was not seen');
  assert(at[2] >= CUT_DEPTH && at[2] <= 3, `the point it named is not in the intrusion: z ${at[2]}`);
  assert(at[0] >= 5 && at[0] <= 15);
});

Deno.test('bodyCut: past the skin by less than CUT_DEPTH, or short of it, is not a cut', () => {
  assertEquals(bodyCut(box(), ID, O, face(CUT_DEPTH / 2)), null);
  assertEquals(bodyCut(box(), ID, O, face(-0.03)), null);   // within reach, never crosses
  assertEquals(bodyCut(box(), ID, O, face(-5)), null);      // nowhere near
});

Deno.test('bodyCut: a long sliver of a triangle is sampled along its length, not skipped', () => {
  // 18 mm long, 1 mm tall, its one deep stretch far from the corners
  const sliver = [[1, 10, -0.5], [19, 10, -0.5], [10, 10, 1.5]];
  assert(bodyCut(box(), ID, O, sliver));
});

// stand-in for drawnWall: stations every 1 mm along x; refuses a line crossing a cut x
const stations = (a, b) => {
  const out = [];
  for (let x = a[0]; x <= b[0] + 1e-9; x += 1) out.push([x, 0, 10]);
  return out;
};
const stub = (cuts) => {
  const calls = [];
  const build = (a, b) => {
    calls.push([a[0], b[0]]);
    const top = stations(a, b);
    const c = cuts.find((x) => x > a[0] && x < b[0]);
    return c === undefined ? { ok: true, top } : { ok: false, reason: 'cut', cutAt: [c, 0, 5], top };
  };
  return { build, calls };
};

Deno.test('cutEnds: stops two stations short of the cut on each side', () => {
  const { before, after } = cutEnds({ cutAt: [10.2, 0, 5], top: stations([0], [20]) });
  assertEquals(before[0], 8);
  assertEquals(after[0], 12);
});

Deno.test('wallsAcrossCuts: a cut line builds both pieces and neither spans the cut', () => {
  const { build, calls } = stub([50]);
  const r = wallsAcrossCuts([0, 0, 10], [100, 0, 10], [], {}, build);
  assertEquals(r.refused, null);
  assertEquals(r.parted, 1);
  assertEquals(r.tries, 3);
  assertEquals(calls, [[0, 100], [0, 48], [52, 100]]);
  assertEquals(r.walls.length, 2);
});

Deno.test('wallsAcrossCuts: a line that builds, or is refused for another reason, is left alone', () => {
  const ok = wallsAcrossCuts([0, 0, 10], [100, 0, 10], [], {}, stub([]).build);
  assertEquals([ok.walls.length, ok.tries, ok.parted, ok.refused], [1, 1, 0, null]);
  const no = wallsAcrossCuts([0, 0, 10], [100, 0, 10], [], {}, () => ({ ok: false, reason: 'at the plate' }));
  assertEquals([no.walls.length, no.tries, no.refused.reason], [0, 1, 'at the plate']);
});

Deno.test('wallsAcrossCuts: a stub too short for a wall is dropped and the other side kept', () => {
  const { build, calls } = stub([3]);
  const r = wallsAcrossCuts([0, 0, 10], [100, 0, 10], [], {}, build);
  assertEquals(calls, [[0, 100], [5, 100]]);   // 0 -> 1 is under the minimum wall length
  assertEquals(r.walls.length, 1);
});

Deno.test('wallsAcrossCuts: pieces cut again part again, up to its limit, and a line with no way round stays refused', () => {
  const many = wallsAcrossCuts([0, 0, 10], [100, 0, 10], [], {}, stub([25, 50, 75]).build);
  assertEquals(many.walls.length, 4);
  // every station cut: each try refused, and the budget ends it
  const all = { calls: 0 };
  const r = wallsAcrossCuts([0, 0, 10], [100, 0, 10], [], {}, (a, b) => {
    all.calls++;
    return { ok: false, reason: 'cut', cutAt: [(a[0] + b[0]) / 2, 0, 5], top: stations(a, b) };
  });
  assertEquals(r.walls.length, 0);
  assertEquals(r.refused.reason, 'cut');
  assert(all.calls <= 15, `${all.calls} builds for one line`);
});
