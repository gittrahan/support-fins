// The interface crest (GitHub #21, web/prop/crest.js): with PROP.iface on, the top
// band of every wall and its tines are their own tagged solids, for a toolchanger's
// second material. Pinned here:
//   - off, nothing is tagged (the rest of the suite pins that off is unchanged);
//   - on, body and crest each come out closed and wound outward, and between them
//     they are the same plastic as the one-body build (only the 0.01 mm overlap);
//   - the crest is the band at the top: no body vertex rises into it;
//   - the 3MF writes the crest as a third object, in register, and reads it back.

import { WEB, assert, block, blockTopo, loadModel, analyze, fins, prop, rotX, isClosed } from './_util.js';

const { writeThreeMF, readThreeMF } = await import(`${WEB}threemf.js`);
const { drawnWall } = await import(`${WEB}draw.js`);
const { CUT } = await import(`${WEB}cutout.js`);
const { PROP, splitInterface } = prop;

function build(name, rot, { iface, mode = 'auto', cutout = 'none' } = {}) {
  const topo = loadModel(name);
  const was = [PROP.iface, CUT.pattern];
  PROP.iface = iface;
  CUT.pattern = cutout;
  try {
    // the app's call (CLAUDE.md): analyze(topo, 45, rot), then buildFins
    return fins.buildFins(topo, analyze(topo, 45, rot), rot, { mode, bedPad: true }).triangles;
  } finally {
    [PROP.iface, CUT.pattern] = was;
  }
}

/** Signed volume of a closed, outward-wound triangle soup. */
function volume(tris) {
  let V = 0;
  for (let i = 0; i < tris.length; i += 3) {
    const [a, b, c] = [tris[i], tris[i + 1], tris[i + 2]];
    V += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2])
        + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return V;
}

/** Triangles with (near) zero area: a slicer reports them as degenerate facets. */
function zeroArea(tris) {
  let n = 0;
  for (let i = 0; i < tris.length; i += 3) {
    const [a, b, c] = [tris[i], tris[i + 1], tris[i + 2]];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const x = u[1] * v[2] - u[2] * v[1], y = u[2] * v[0] - u[0] * v[2], z = u[0] * v[1] - u[1] * v[0];
    if (Math.hypot(x, y, z) / 2 < 1e-6) n++;
  }
  return n;
}

/** Off tags nothing; on splits the same plastic into a closed body and crest. */
function checkSplit(off, on) {
  assert(off.length > 0, 'no supports to split');
  assert(off.every((v) => v[3] === undefined), 'the crest is off but a vertex is tagged');
  const { body, iface } = splitInterface(on);
  assert(iface.length > 0, 'the crest is on but nothing is tagged');
  assert(isClosed(body), 'the body is not closed');
  assert(isClosed(iface), 'the crest is not closed');
  const vb = volume(body), vi = volume(iface), v0 = volume(off);
  assert(vb > 0 && vi > 0, `wound inward: body ${vb}, crest ${vi}`);
  // the split adds no sliver the one-body build did not have (a collinear corner in
  // a section made one in each ribbon end cap)
  const z0 = zeroArea(off), zb = zeroArea(body), zi = zeroArea(iface);
  assert(zb + zi <= z0, `zero-area triangles: ${z0} off, ${zb} body + ${zi} crest on`);
  // the split moves plastic between the two, it does not add or lose any
  assert(Math.abs(vb + vi - v0) < 0.005 * v0, `body ${vb.toFixed(1)} + crest ${vi.toFixed(1)} vs one body ${v0.toFixed(1)}`);
}

// Prop walls with tines (cube), a wedge (plate stood at 60), Full (lbracket), a
// cut wall (tshape, diamond cutouts), squat walls on the near-bed ledge (lowledge).
const CASES = [
  ['cube', rotX(35), {}],
  ['plate', rotX(60), {}],
  ['lbracket', rotX(40), { mode: 'full' }],
  ['tshape', rotX(30), { cutout: 'diamond' }],
  ['lowledge', rotX(0), {}],
];

for (const [name, rot, opts] of CASES) {
  const label = `${name}${opts.mode ? ` ${opts.mode}` : ''}${opts.cutout ? ` ${opts.cutout}` : ''}`;
  Deno.test(`interface crest: ${label} -- the same plastic, split into two closed solids`, () => {
    checkSplit(build(name, rot, { ...opts, iface: false }), build(name, rot, { ...opts, iface: true }));
  });
}

// A wall standing ON the part (sweepBetween), lifted footGap off it and welded (0).
// An L: a base block the wall stands on (top z=5), a shelf 30 mm above it.
const L = new Float32Array([...block(-40, 40, -10, 10, 0, 5), ...block(-40, 40, -10, 10, 35, 39)]);
for (const footGap of [PROP.footGap, 0]) {
  Deno.test(`interface crest: a wall on the part (footGap ${footGap}) -- the same plastic, split`, () => {
    const was = [PROP.footGap, PROP.iface];
    PROP.footGap = footGap;
    try {
      const wall = (iface) => {
        PROP.iface = iface;
        const r = drawnWall([-30, 0, 35], [30, 0, 35], L, 0);
        assert(r.ok, r.reason);
        return r.tris;
      };
      checkSplit(wall(false), wall(true));
    } finally { [PROP.footGap, PROP.iface] = was; }
  });
}

Deno.test('interface crest: the body stops under the crest of every wall', () => {
  // Prop walls without tines, so every tagged solid is a wall's crest: under each
  // crest's footprint, no body vertex stands higher than the crest's bottom.
  const topo = loadModel('cube');
  const rot = rotX(35);
  PROP.iface = true;
  let tris;
  try {
    tris = fins.buildFins(topo, analyze(topo, 45, rot), rot, { mode: 'auto', bedPad: true, tines: false }).triangles;
  } finally { PROP.iface = false; }
  const { body, iface } = splitInterface(tris);
  assert(iface.length > 0, 'no crest');
  // the crest's lowest point in each 0.25 mm cell of its footprint
  const cells = new Map();
  const key = (v) => `${Math.round(v[0] * 4)},${Math.round(v[1] * 4)}`;
  for (const v of iface) {
    const k = key(v);
    cells.set(k, Math.min(cells.get(k) ?? Infinity, v[2]));
  }
  let worst = -Infinity;
  for (const v of body) {
    const lo = cells.get(key(v));
    if (lo !== undefined) worst = Math.max(worst, v[2] - lo);
  }
  assert(worst <= 0.011, `a body vertex stands ${worst.toFixed(3)} mm into the crest`);
});

Deno.test('interface crest: sway brace tines are interface too', () => {
  // a 150 mm post, the tall part tests/sway.test.js braces
  const topo = blockTopo(-20, 20, -15, 15, 0, 150);
  const rot = rotX(0);
  const res = analyze(topo, 45, rot);
  const run = (iface) => {
    PROP.iface = iface;
    try {
      return fins.buildFins(topo, res, rot, { mode: 'auto', bedPad: true, tines: true, layerHeight: 0.2, sway: { on: true } });
    } finally { PROP.iface = false; }
  };
  const off = run(false), on = run(true);
  assert(on.sway.tines > 0, `no sway tines to tag (${on.sway.reason ?? 'no brace'})`);
  // with nothing overhanging on the post, every tagged triangle is a brace tine
  const tagged = on.triangles.filter((v) => v[3] === 1).length / 3;
  assert(tagged === on.sway.tines * 12, `${tagged} tagged triangles, want ${on.sway.tines} tines x 12`);
  assert(off.triangles.every((v) => v[3] === undefined), 'off, a brace tine is tagged');
});

Deno.test('interface crest: the 3MF writes it as a third object, in register', async () => {
  const on = build('cube', rotX(35), { iface: true });
  const { body, iface } = splitInterface(on);
  const part = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
  const bytes = new Uint8Array(await writeThreeMF(part, body, 'cube', { separate: true, iface }).arrayBuffer());
  const xml = new TextDecoder().decode(bytes);
  const items = [...xml.matchAll(/<item objectid="(\d+)" transform="([^"]+)"\/>/g)];
  assert(items.length === 3, `${items.length} build items, want 3 (part, supports, interface)`);
  assert(new Set(items.map((m) => m[2])).size === 1, 'the three objects do not share one transform');
  assert(xml.includes('name="cube interface"'), 'no "cube interface" object');
  const r = await readThreeMF(bytes);
  assert(r.objects.length === 3, `read ${r.objects.length} objects, want 3`);

  // locked (the CLI's form), the crest is just more of the supports
  const locked = new TextDecoder().decode(new Uint8Array(
    await writeThreeMF(part, body, 'cube', { iface }).arrayBuffer()));
  assert(!locked.includes('interface'), 'the locked form wrote an interface object');
});
