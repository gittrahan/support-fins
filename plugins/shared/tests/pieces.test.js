// computeFins' `pieces` and `overFaces`: what a host needs to show one object per fin
// and the site's red overhangs. A piece list that dropped or doubled a triangle would
// lose a wall (or print one twice) in any host that builds objects from it.
//
//   deno test --allow-read plugins/shared/tests/
import { computeFins } from '../engine/fins_entry.js';
import { readSTL, MODELS, analyze, rotX, rotY, assert } from '../../../tests/_util.js';
import { buildTopology, IDENTITY3 } from '../../../web/overhangs.js';

function posed(name, m, dx = 40, dy = -12, dz = 5) {
  const p = readSTL(Deno.readFileSync(`${MODELS}${name}.stl`));
  const o = new Float64Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    o[i] = m[0] * x + m[3] * y + m[6] * z + dx;
    o[i + 1] = m[1] * x + m[4] * y + m[7] * z + dy;
    o[i + 2] = m[2] * x + m[5] * y + m[8] * z + dz;
  }
  return o;
}

const CASES = [['cube', 'X25', rotX(25)], ['lbracket', 'Y35', rotY(35)], ['arch', 'X25', rotX(25)],
               ['tube', 'X25', rotX(25)], ['wedge', 'X30', rotX(30)]];
const OPTIONS = [['defaults', {}], ['sway on', { sway: { on: true } }], ['coverage 1', { coverage: 1 }],
                 ['no tines', { tines: false }], ['pad off', { padStyle: 'off' }]];

for (const [name, pose, rot] of CASES) {
  for (const [label, opts] of OPTIONS) {
    Deno.test(`${name}/${pose} ${label}: every fin triangle is in exactly one piece`, () => {
      const r = computeFins(posed(name, rot), opts);
      const n = r.triangles.length / 9;
      const seen = new Uint8Array(n);
      for (const p of r.pieces) {
        assert(typeof p.id === 'string' && typeof p.kind === 'string', `bad piece ${JSON.stringify(p)}`);
        for (const [a, b] of p.ranges) {
          assert(Number.isInteger(a) && Number.isInteger(b) && a <= b && b <= n, `${p.id}: bad range ${a}..${b} of ${n}`);
          for (let i = a; i < b; i++) seen[i]++;
        }
      }
      const off = seen.findIndex((v) => v !== 1);
      assert(off < 0, `triangle ${off} is in ${seen[off]} pieces`);
      const count = (k) => r.pieces.filter((p) => p.kind === k).length;
      // the readout's counts, so a host listing objects says what the report says
      assert(count('prop') === r.stats.braces + r.stats.props, `${count('prop')} wall pieces, ${r.stats.braces + r.stats.props} walls`);
      assert(count('sway') === r.stats.swayBraces, `${count('sway')} sway pieces, ${r.stats.swayBraces} braces`);
      assert(count('pad') === (r.stats.padTriangles ? 1 : 0), 'pad piece and pad triangles disagree');
      const padPiece = r.pieces.find((p) => p.kind === 'pad');
      if (padPiece) assert(padPiece.ranges[0][1] === n, 'the pad is the end of the soup');
      assert(new Set(r.pieces.map((p) => p.id)).size === r.pieces.length, 'piece ids repeat');
    });
  }
}

Deno.test('overFaces are the input faces analyze() marks, anywhere on the plate', () => {
  for (const [name, pose, rot] of CASES) {
    const soup = posed(name, rot);
    const r = computeFins(soup, {});
    const res = analyze(buildTopology({ getAttribute: () => ({ array: posed(name, rot, 0, 0, 0) }) }), 45, IDENTITY3);
    const want = [];
    for (let f = 0; f < res.over.length; f++) if (res.over[f]) want.push(f);
    assert(want.length > 0, `${name}/${pose}: test part has no overhang`);
    assert(JSON.stringify(Array.from(r.overFaces)) === JSON.stringify(want),
      `${name}/${pose}: overFaces ${r.overFaces.length}, analyze ${want.length}`);
  }
});

Deno.test('overFaces is empty for a part with no overhang', () => {
  const r = computeFins(posed('cube', IDENTITY3), {});
  assert(r.overFaces.length === 0, `${r.overFaces.length} overhang faces on a flat cube`);
});
