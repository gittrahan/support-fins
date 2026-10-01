// computeFins' `pieces` and `overFaces`: what a host needs to show one object per fin
// and the site's red overhangs. A piece list that dropped or doubled a triangle would
// lose a wall (or print one twice) in any host that builds objects from it.
//
//   deno test --allow-read plugins/shared/tests/
import { computeFins } from '../engine/fins_entry.js';
import { readSTL, MODELS, analyze, rotX, rotY, assert, block } from '../../../tests/_util.js';
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

// The site's colours (web/ui/part.js paintOverhangs): red = res.kept, amber = over
// but in a region too small to fin.
function siteFaces(soup) {
  const res = analyze(buildTopology({ getAttribute: () => ({ array: soup }) }), 45, IDENTITY3);
  const red = [], amber = [];
  for (let f = 0; f < res.over.length; f++) if (res.kept[f]) red.push(f); else if (res.over[f]) amber.push(f);
  return { red, amber };
}

// A tower with a broad shelf (red) and a 2x2 mm nub (4 mm^2 underside, under
// MIN_REGION_AREA: amber) sticking out of it.
function shelfAndNub(dx = 0, dy = 0) {
  const parts = [block(0, 20, 0, 20, 0, 20), block(20, 30, 0, 20, 15, 20), block(-2, 0, 8, 10, 10, 12)];
  const out = new Float64Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) for (let j = 0; j < p.length; j += 3) {
    out[i++] = p[j] + dx; out[i++] = p[j + 1] + dy; out[i++] = p[j + 2];
  }
  return out;
}

Deno.test('overFaces / smallFaces are the faces the site paints red / amber, anywhere on the plate', () => {
  let amber = 0;
  const cases = [...CASES.map(([name, pose, rot]) => [`${name}/${pose}`, posed(name, rot), posed(name, rot, 0, 0, 0)]),
                 ['shelf + nub', shelfAndNub(40, -12), shelfAndNub()]];
  for (const [label, soup, atOrigin] of cases) {
    const r = computeFins(soup, {});
    const want = siteFaces(atOrigin);
    assert(want.red.length > 0, `${label}: test part has no overhang`);
    assert(JSON.stringify(Array.from(r.overFaces)) === JSON.stringify(want.red),
      `${label}: overFaces ${r.overFaces.length}, site red ${want.red.length}`);
    assert(JSON.stringify(Array.from(r.smallFaces)) === JSON.stringify(want.amber),
      `${label}: smallFaces ${r.smallFaces.length}, site amber ${want.amber.length}`);
    amber += want.amber.length;
  }
  assert(amber > 0, 'no case has an amber face: the smallFaces check never ran');
});

Deno.test('overFaces is empty for a part with no overhang', () => {
  const r = computeFins(posed('cube', IDENTITY3), {});
  assert(r.overFaces.length === 0 && r.smallFaces.length === 0, 'overhang faces on a flat cube');
});
