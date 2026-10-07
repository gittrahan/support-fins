// The interface crest (GitHub #21, web/prop/crest.js): with PROP.iface on, the top
// band of a wall ('flat': under a level underside; 'all': every wall, and the tines)
// is its own tagged solid, for a toolchanger's second material. Pinned here:
//   - off, nothing is tagged (the rest of the suite pins that off is unchanged);
//   - on, body and crest each come out closed and wound outward, and between them
//     lose no plastic of the one-body build (a flat crest adds its untapered tip);
//   - the crest is the band at the top: no body vertex rises into it;
//   - the 3MF writes the crest as a third object, in register, and reads it back.

import { WEB, assert, block, blockTopo, loadModel, analyze, fins, prop, rotX, rotY, isClosed } from './_util.js';

const { writeThreeMF, readThreeMF } = await import(`${WEB}threemf.js`);
const { drawnWall } = await import(`${WEB}draw.js`);
const { CUT } = await import(`${WEB}cutout.js`);
const { PROP, splitInterface } = prop;

function buildAll(name, rot, { iface, mode = 'auto', cutout = 'none', ifaceW = 1.0, ifaceGap = null, layerHeight } = {}) {
  const topo = loadModel(name);
  const was = [PROP.iface, CUT.pattern, PROP.ifaceW, PROP.ifaceGap];
  [PROP.iface, CUT.pattern, PROP.ifaceW, PROP.ifaceGap] = [iface, cutout, ifaceW, ifaceGap];
  try {
    // the app's call (CLAUDE.md): analyze(topo, 45, rot), then buildFins
    return fins.buildFins(topo, analyze(topo, 45, rot), rot, { mode, bedPad: true, layerHeight });
  } finally {
    [PROP.iface, CUT.pattern, PROP.ifaceW, PROP.ifaceGap] = was;
  }
}
const build = (...a) => buildAll(...a).triangles;

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
  // the split loses no plastic; it only adds the tip a flat crest no longer narrows
  // to (the top 1.5 mm of those walls kept full width: a few percent at most)
  assert(vb + vi > 0.995 * v0 && vb + vi < 1.05 * v0,
    `body ${vb.toFixed(1)} + crest ${vi.toFixed(1)} vs one body ${v0.toFixed(1)}`);
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
  Deno.test(`interface crest: ${label}, everywhere -- no plastic lost, split into two closed solids`, () => {
    checkSplit(build(name, rot, { ...opts, iface: false }), build(name, rot, { ...opts, iface: 'all' }));
  });
}

// 'flat' on walls that mix flat and tilted stations, under cutouts (the holes keep
// their old ceiling: a flat crest's cut must not let them climb and take plastic),
// and on the near-bed ledge's squat walls.
const FLAT_CASES = [
  ['lbracket', rotY(8), { cutout: 'lattice' }],
  ['staircase', rotY(8), { cutout: 'lattice' }],
  ['plus', rotX(90), { cutout: 'diamond' }],
  ['lowledge', rotX(0), {}],
];
for (const [name, rot, opts] of FLAT_CASES) {
  Deno.test(`interface crest: ${name}${opts.cutout ? ` ${opts.cutout}` : ''}, flat contacts -- no plastic lost, split into two closed solids`, () => {
    checkSplit(build(name, rot, { ...opts, iface: false }), build(name, rot, { ...opts, iface: 'flat' }));
  });
}

// The crest never changes WHICH walls exist: a flat crest's top sits a hair lower
// (its edge keeps the gap) and dropped a 54 mm wall whose low tail station was at
// minHeight (staircase Y8), until the height check went back to the plain gap.
Deno.test('interface crest: either mode builds the same walls as off', () => {
  for (const [name, rot, opts] of [...CASES, ...FLAT_CASES]) {
    const n = (iface) => buildAll(name, rot, { ...opts, iface }).fins.length;
    const off = n(false);
    for (const m of ['flat', 'all']) assert(n(m) === off, `${name} ${m}: ${n(m)} walls, ${off} off`);
  }
});

// The calibration knobs (prototype/calibration/interface/): a 3 mm crest at gap 0
// under the portal's flat ceiling -- 3 mm wide, its top ON the ceiling, the wall
// flaring out to it, all still closed.
Deno.test('interface crest: a 3 mm crest at gap 0 touches a flat ceiling, on a flared wall', () => {
  const rot = rotX(90);
  const on = build('portal', rot, { iface: 'flat', ifaceW: 3, ifaceGap: 0 });
  const { body, iface } = splitInterface(on);
  assert(isClosed(body) && isClosed(iface), 'not closed');
  const off = build('portal', rot, { iface: false });
  // the plain wall's top is the ceiling minus the 0.2 gap
  const ceiling = Math.max(...off.map((v) => v[2])) + PROP.gap;
  const zTop = Math.max(...iface.map((v) => v[2]));
  assert(Math.abs(zTop - ceiling) < 1e-6, `crest top ${zTop.toFixed(3)}, ceiling ${ceiling.toFixed(3)}`);
  const top0 = iface.find((v) => zTop - v[2] < 1e-6);
  const top = iface.filter((v) => zTop - v[2] < 1e-6 && Math.hypot(v[0] - top0[0], v[1] - top0[1]) < 5);
  const span = (k) => Math.max(...top.map((v) => v[k])) - Math.min(...top.map((v) => v[k]));
  assert(Math.abs(Math.min(span(0), span(1)) - 3) < 1e-6, `crest ${Math.min(span(0), span(1)).toFixed(3)} mm wide, want 3`);
  // the body under it is 3 mm wide at its top too (the flare): the bond's area
  const bTop = Math.max(...body.map((v) => v[2]));
  const btop = body.filter((v) => bTop - v[2] < 1e-6 && Math.hypot(v[0] - top0[0], v[1] - top0[1]) < 5);
  const bspan = (k) => Math.max(...btop.map((v) => v[k])) - Math.min(...btop.map((v) => v[k]));
  assert(Math.abs(Math.min(bspan(0), bspan(1)) - 3) < 1e-6, `body top ${Math.min(bspan(0), bspan(1)).toFixed(3)} mm wide, want 3`);
});

// 'flat': the portal on its side stands two walls under a flat ceiling -- the case
// a PETG interface is for -- and its crest keeps the wall's full width (no tip).
Deno.test('interface crest: flat contacts -- a flat ceiling gets a full-width crest', () => {
  const rot = rotX(90);
  const off = build('portal', rot, { iface: false });
  const on = build('portal', rot, { iface: 'flat' });
  checkSplit(off, on);
  const { iface } = splitInterface(on);
  const zTop = Math.max(...iface.map((v) => v[2]));
  // the crest's top face near one point of one wall (the two stand 12 mm apart):
  // the walls run along x or y, so the narrower of the two spans is its width
  const top0 = iface.find((v) => zTop - v[2] < 1e-6);
  const top = iface.filter((v) => zTop - v[2] < 1e-6 && Math.hypot(v[0] - top0[0], v[1] - top0[1]) < 3);
  const span = (k) => Math.max(...top.map((v) => v[k])) - Math.min(...top.map((v) => v[k]));
  const width = Math.min(span(0), span(1));
  assert(Math.abs(width - PROP.th) < 1e-6, `crest top ${width.toFixed(3)} mm wide, want the wall's ${PROP.th}`);
});

// ...one layer of the print tall (PROP.ifaceLayers, the Layer height field): one
// tool change each way per flat contact. It reaches CREST_OVERLAP (0.01) into the body.
for (const layerHeight of [0.2, 0.3]) {
  Deno.test(`interface crest: flat contacts -- the crest is one ${layerHeight} mm layer`, () => {
    const { iface } = splitInterface(build('portal', rotX(90), { iface: 'flat', layerHeight }));
    const zTop = Math.max(...iface.map((v) => v[2]));
    const top0 = iface.find((v) => zTop - v[2] < 1e-6);
    const near = iface.filter((v) => Math.hypot(v[0] - top0[0], v[1] - top0[1]) < 3);
    const h = zTop - Math.min(...near.map((v) => v[2]));
    assert(Math.abs(h - (layerHeight + 0.01)) < 1e-6, `crest ${h.toFixed(3)} mm tall, want ${layerHeight} + 0.01`);
  });
}

// ...and a tilted underside gets none: on the 35deg cube every contact leans, and the
// first print showed PETG won't lay down on PLA climbing every layer. The tines stay
// in the body too (they grip sideways faces).
Deno.test('interface crest: flat contacts -- a tilted underside and its tines get none', () => {
  const on = build('cube', rotX(35), { iface: 'flat' });
  assert(on.every((v) => v[3] === undefined), 'a wall under the 35deg cube got a crest in flat mode');
  const all = build('cube', rotX(35), { iface: 'all' });
  assert(all.some((v) => v[3] === 1), 'everywhere mode left the cube bare');
});

// A wall standing ON the part (sweepBetween), lifted footGap off it and welded (0).
// An L: a base block the wall stands on (top z=5), a shelf 30 mm above it.
const L = new Float32Array([...block(-40, 40, -10, 10, 0, 5), ...block(-40, 40, -10, 10, 35, 39)]);
for (const footGap of [PROP.footGap, 0]) {
  Deno.test(`interface crest: a wall on the part (footGap ${footGap}) -- no plastic lost, split`, () => {
    const was = [PROP.footGap, PROP.iface];
    PROP.footGap = footGap;
    try {
      const wall = (iface) => {
        PROP.iface = iface;
        const r = drawnWall([-30, 0, 35], [30, 0, 35], L, 0);
        assert(r.ok, r.reason);
        return r.tris;
      };
      checkSplit(wall(false), wall('flat'));   // the shelf is a flat ceiling
    } finally { [PROP.footGap, PROP.iface] = was; }
  });
}

Deno.test('interface crest: the body stops under the crest of every wall', () => {
  // Prop walls without tines, so every tagged solid is a wall's crest: under each
  // crest's footprint, no body vertex stands higher than the crest's bottom.
  const topo = loadModel('cube');
  const rot = rotX(35);
  PROP.iface = 'all';
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

Deno.test('interface crest: everywhere, sway brace tines are interface too', () => {
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
  const off = run(false), on = run('all');
  assert(on.sway.tines > 0, `no sway tines to tag (${on.sway.reason ?? 'no brace'})`);
  // with nothing overhanging on the post, every tagged triangle is a brace tine
  const tagged = on.triangles.filter((v) => v[3] === 1).length / 3;
  assert(tagged === on.sway.tines * 12, `${tagged} tagged triangles, want ${on.sway.tines} tines x 12`);
  assert(off.triangles.every((v) => v[3] === undefined), 'off, a brace tine is tagged');
});

Deno.test('interface crest: the 3MF writes it as a part of the supports object, in register', async () => {
  const on = build('cube', rotX(35), { iface: 'all' });
  const { body, iface } = splitInterface(on);
  const part = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
  const bytes = new Uint8Array(await writeThreeMF(part, body, 'cube', { separate: true, iface }).arrayBuffer());
  const xml = new TextDecoder().decode(bytes);
  // two build items, so the crest -- in mid-air on its own -- stands on the plate
  // with the supports (Orca refused a floating interface object: "empty first layer")
  const items = [...xml.matchAll(/<item objectid="(\d+)" transform="([^"]+)"\/>/g)];
  assert(items.length === 2, `${items.length} build items, want 2 (part, supports)`);
  assert(items[0][2] === items[1][2], 'the part and supports do not share one transform');
  const sup = xml.match(/<object id="(\d+)" type="model" name="cube supports"><components>(.*?)<\/components>/);
  assert(sup && sup[1] === items[1][1], 'the supports item is not the body + interface assembly');
  assert(xml.includes('name="cube interface"'), 'no "cube interface" part');
  const r = await readThreeMF(bytes);
  assert(r.objects.length === 2, `read ${r.objects.length} objects, want 2`);
  // the supports object reads back as body + crest, every triangle of both
  const tris = r.objects[1].positions.length / 9;
  assert(tris === (body.length + iface.length) / 3, `supports read back ${tris} triangles, want ${(body.length + iface.length) / 3}`);

  // locked (the CLI's form), the crest is just more of the supports
  const locked = new TextDecoder().decode(new Uint8Array(
    await writeThreeMF(part, body, 'cube', { iface }).arrayBuffer()));
  assert(!locked.includes('interface'), 'the locked form wrote an interface object');
});
