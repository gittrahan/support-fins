// FIN KEYS (local issue 045): a removed Auto fin stays removed when a rebuild
// moves it a little. The key used to be matched exactly and held the wall top's z
// and height, both measured below the part by the support gap, so a gap change
// re-keyed every fin and every removed fin came back. Pinned here:
//   - a gap change 0.2 -> 0.3 keeps the removals (exact keys kept none);
//   - when the removed fin is gone, its key does NOT hide a neighbour;
//   - a key matches its own fin, and nothing in another pose;
//   - two walls stacked at one x/y stay two fins; a reversed line is the same fin;
//   - an older session's key (taken at the middle VERTEX) still matches.
// The page glue (ui/remove.js) needs a DOM; this is the matching under it.

import { WEB, assert, loadModel, analyze, rotX } from './_util.js';

const { buildFins } = await import(`${WEB}fins.js`);
const { assignKeys, matchRemoved, parseKey, finKey } = await import(`${WEB}ui/finkeys.js`);

const records = (topo, res, rot, gap) => assignKeys(
  buildFins(topo, res, rot, { mode: 'auto', bedPad: true, tunables: { propGap: gap } })
    .fins.map((f) => ({ ...f })).filter((f) => f.line?.length));

// torus: one of its eight walls grows 0.9 mm taller at gap 0.3 (its mirror twin
// doesn't) -- past the height tolerance, so that removal comes back. The safe
// way to miss: a fin returning beats a kept fin silently hidden.
const MISSES = { torus: 1 };
for (const name of ['lowledge', 'tshape', 'torus']) {
  Deno.test(`fin keys: ${name} X30 -- removals hold across a gap change, and stay in their pose`, () => {
    const topo = loadModel(name), rot = rotX(30), res = analyze(topo, 45, rot);
    const A = records(topo, res, rot, 0.2), B = records(topo, res, rot, 0.3);
    assert(A.length > 0 && A.length === B.length, `${name}: fins ${A.length} -> ${B.length}`);
    const keys = new Set(A.map((r) => r.sig));
    assert(B.filter((r) => keys.has(r.sig)).length < A.length, `${name}: exact keys already survive -- not the 045 case`);
    const m = matchRemoved(B, keys);
    assert(m.size === A.length - (MISSES[name] ?? 0), `${name}: ${m.size}/${A.length} removals kept at gap 0.3`);
    const self = matchRemoved(A, keys);
    assert(A.every((r) => self.get(r.id) === r.sig), `${name}: a key matched another fin of its own build`);
    const up = rotX(0), other = records(topo, analyze(topo, 45, up), up, 0.2);
    assert(matchRemoved(other, keys).size === 0, `${name}: a removal reached into the upright pose`);
  });
}

const rec = (id, line, height = 10, kind = 'prop') => ({ id, kind, line, height });

Deno.test('fin keys: stacked walls at one x/y stay two fins; a reversed line is the same fin', () => {
  const low = rec(0, [[0, 0, 10], [10, 0, 10]]), high = rec(1, [[0, 0, 30], [10, 0, 30]]);
  const [a, b] = assignKeys([low, high]);
  const m = matchRemoved([low, high], new Set([b.sig]));
  assert(m.size === 1 && m.has(1), `the high wall's key matched ${JSON.stringify([...m])}`);
  const flipped = assignKeys([rec(5, [[10, 0.3, 10.1], [0, 0.3, 10.1]])]);
  assert(matchRemoved(flipped, new Set([a.sig])).get(5) === a.sig, 'a wall run the other way lost its removal');
  const turned = assignKeys([rec(6, [[5, -5, 10], [5, 5, 10]])]);
  assert(matchRemoved(turned, new Set([a.sig])).size === 0, 'a crossing wall took the removal');
});

Deno.test("fin keys: a #n twin's removal hides that twin, not its first copy", () => {
  // one midpoint, bearing and height, different lengths: one key text, then `#1`
  const twins = assignKeys([rec(0, [[0, 0, 5], [4, 0, 5]]), rec(1, [[-1, 0, 5], [5, 0, 5]])]);
  assert(twins[1].sig === `${twins[0].sig}#1`, `twins keyed ${twins.map((r) => r.sig)}`);
  const m = matchRemoved(twins, new Set([twins[1].sig]));
  assert(m.size === 1 && m.get(1) === twins[1].sig, `the #1 removal matched ${JSON.stringify([...m])}`);
});

Deno.test('fin keys: a removed fin gone from the rebuild hides no neighbour', () => {
  // Full coverage's short fill walls side by side, 0.5 mm apart: remove one, then
  // a rebuild without it -- the other must stay
  const a = rec(0, [[0, 0, 10], [2.5, 0, 10]], 3), b = rec(1, [[0, 0.5, 10], [2.5, 0.5, 10]], 3.4);
  const [ka] = assignKeys([a, { ...b }]);
  assert(matchRemoved(assignKeys([b]), new Set([ka.sig])).size === 0, 'a side-by-side neighbour took the removal');
  // end to end along one line, 1.8 mm on, a mm higher
  const c = rec(2, [[1.8, 0, 11], [4.3, 0, 11]], 4);
  assert(matchRemoved(assignKeys([c]), new Set([ka.sig])).size === 0, 'an end-to-end neighbour took the removal');
});

Deno.test('fin keys: one key per fin, repeats and suffixes parse', () => {
  const twins = assignKeys([rec(0, [[0, 0, 5], [4, 0, 5]]), rec(1, [[0, 0, 5], [4, 0, 5]])]);
  assert(twins[0].sig !== twins[1].sig && twins[1].sig.endsWith('#1'), `twins keyed ${twins.map((r) => r.sig)}`);
  const m = matchRemoved(twins, new Set(twins.map((r) => r.sig)));
  assert(m.size === 2, 'both twins removable');
  const p = parseKey('wedge:1.5,-2,3:4:0.7#1~2');
  assert(p && p.kind === 'wedge' && p.x === 1.5 && p.y === -2 && p.z === 3 && p.bearing === 0.7, JSON.stringify(p));
});

Deno.test("fin keys: an older session's key (the middle vertex) still matches", () => {
  // a 2-point wall: the old key sat at its END, half a wall from the mid-length point
  const wall = rec(0, [[0, 0, 10], [20, 0, 10]]);
  const old = finKey(wall, true);
  assert(parseKey(old).x === 20, `legacy key ${old}`);
  const [now] = assignKeys([{ ...wall }]);
  assert(matchRemoved([now], new Set([old])).get(0) === old, 'the saved removal came back');
});
