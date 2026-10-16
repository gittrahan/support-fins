// FIN KEYS (local issue 045): a removed Auto fin stays removed when a rebuild
// moves it a little. The key used to be matched exactly and held the wall top's z
// and height, both measured below the part by the support gap, so a gap change
// re-keyed every fin and every removed fin came back. Pinned here:
//   - a gap change 0.2 -> 0.3 keeps every removal (exact keys kept none);
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

for (const name of ['lowledge', 'tshape', 'torus']) {
  Deno.test(`fin keys: ${name} X30 -- removals hold across a gap change, and stay in their pose`, () => {
    const topo = loadModel(name), rot = rotX(30), res = analyze(topo, 45, rot);
    const A = records(topo, res, rot, 0.2), B = records(topo, res, rot, 0.3);
    assert(A.length > 0 && A.length === B.length, `${name}: fins ${A.length} -> ${B.length}`);
    const keys = new Set(A.map((r) => r.sig));
    assert(B.filter((r) => keys.has(r.sig)).length < A.length, `${name}: exact keys already survive -- not the 045 case`);
    const m = matchRemoved(B, keys);
    assert(m.size === A.length, `${name}: ${m.size}/${A.length} removals kept at gap 0.3`);
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
