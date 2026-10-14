// A slicer's negative parts cut out of the part (web/cut.js, GitHub #104). These
// pin: the cut is the slicer's (the part's volume drops by exactly the overlap);
// a scanned negative of closed shells plus sliver debris still cuts; a part or a
// negative that is not a closed solid is said, never cut wrong; colours stay on
// the faces the cut leaves alone; and the fins are built for the cut shape.

import { WEB, assert, assertClose, block, buildTopology, analyze, fins } from './_util.js';

const { readThreeMF } = await import(`${WEB}threemf.js`);
const { cutNegatives } = await import(`${WEB}cut.js`);

const FIX = new URL('./fixtures/negative-parts/', import.meta.url);
const posAttr = (arr) => ({ getAttribute: (k) => (k === 'position' ? { array: arr } : null) });

/** Signed volume of a closed soup (positive when wound outward). */
function volume(p) {
  let v = 0;
  for (let i = 0; i < p.length; i += 9) {
    const [a, b, c, d, e, f, g, h, k] = p.subarray(i, i + 9);
    v += (a * (e * k - f * h) - b * (d * k - f * g) + c * (d * h - e * g)) / 6;
  }
  return v;
}

function bounds(p) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[i + k]); hi[k] = Math.max(hi[k], p[i + k]); }
  }
  return { lo, hi };
}

const overlap = (a, b) => [0, 1, 2].reduce((v, k) =>
  v * Math.max(0, Math.min(a.hi[k], b.hi[k]) - Math.max(a.lo[k], b.lo[k])), 1);

const cat = (...arrs) => {
  const out = new Float32Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
};

const neg = (positions) => ({ kind: 'negative', name: 'n', positions });

// --- the slicers' own files ------------------------------------------------

for (const file of ['bambu.3mf', 'orca.3mf', 'prusaslicer3.3mf']) {
  Deno.test(`cut: ${file} -- the cube loses exactly the negative cube's overlap`, async () => {
    const o = (await readThreeMF(await Deno.readFile(new URL(file, FIX)))).objects[0];
    const c = await cutNegatives(o);
    assert(c.cut === 1 && c.uncut === 0 && !c.open, `cut ${c.cut}, uncut ${c.uncut}, open ${c.open}`);
    const want = 40 ** 3 - overlap(bounds(o.positions), bounds(o.extras[0].positions));
    assert(want < 40 ** 3 - 1, 'fixture: the negative should cut into the cube');
    assertClose(volume(c.positions), want, 0.05, 'cut volume');
  });
}

Deno.test('cut: an object with no negative part comes back as it was, untouched', async () => {
  const positions = block(0, 10, 0, 10, 0, 10);
  const c = await cutNegatives({ positions, colors: null,
    extras: [{ kind: 'modifier', name: 'm', positions: block(2, 4, 2, 4, 2, 4) }] });
  assert(c.positions === positions && c.cut === 0 && c.uncut === 0, 'a modifier changed the shape');
});

// --- meshes that are not one clean solid ------------------------------------

Deno.test('cut: a negative of closed shells touching on an edge, plus sliver debris, still cuts', async () => {
  // Two cubes sharing one edge: that edge has four faces, so as ONE mesh it is not
  // manifold (a scanned candle mould is 4 such shells + 52 stray triangles).
  const stray = new Float32Array([5, 5, 25, 6, 5, 25, 5, 6, 25]);
  const tool = cat(block(-1, 5, -1, 5, 5, 15), block(5, 11, 5, 11, 5, 15), stray);
  const c = await cutNegatives({ positions: block(0, 10, 0, 10, 0, 20), colors: null, extras: [neg(tool)] });
  assert(c.cut === 1 && c.uncut === 0, `cut ${c.cut}, uncut ${c.uncut}`);
  assertClose(volume(c.positions), 2000 - 2 * 5 * 5 * 10, 1e-3, 'cut volume');
});

Deno.test('cut: a negative that is open (not just debris) is not cut, and says so', async () => {
  const open = block(2, 8, 2, 8, -1, 5).slice(0, 9 * 8);   // 8 of its 12 faces
  const positions = block(0, 10, 0, 10, 0, 10);
  const c = await cutNegatives({ positions, colors: null, extras: [neg(open)] });
  assert(c.cut === 0 && c.uncut === 1 && !c.open && c.positions === positions, JSON.stringify({ ...c, positions: 0 }));
});

Deno.test('cut: a part that is not a closed solid is not cut at all, and says so', async () => {
  const positions = block(0, 10, 0, 10, 0, 10).slice(0, 9 * 10);
  const c = await cutNegatives({ positions, colors: null, extras: [neg(block(2, 8, 2, 8, -1, 5))] });
  assert(c.open && c.cut === 0 && c.positions === positions, JSON.stringify({ ...c, positions: 0 }));
});

// --- colours ----------------------------------------------------------------

Deno.test('cut: paint stays on the faces the cut leaves whole, exactly as it was', async () => {
  const positions = block(0, 10, 0, 10, 0, 10);
  const paint = [], rgb = [];
  for (let t = 0; t < 12; t++) { paint[t] = { name: 'paint_color', v: String(t) }; rgb[t] = '#FF0000'; }
  // a notch in the +x top edge: the top and +x faces are cut, the rest untouched
  const c = await cutNegatives({ positions, colors: { paint, rgb }, extras: [neg(block(8, 11, -1, 11, 8, 11))] });
  assert(c.cut === 1 && c.colors, 'no colours came through');
  let painted = 0;
  for (let t = 0; t < c.positions.length / 9; t++) {
    const p = c.colors.paint[t];
    if (!p) continue;
    painted++;
    // painted only where it IS its source triangle, corner for corner
    const f = Number(p.v);
    for (let k = 0; k < 9; k++) assert(c.positions[t * 9 + k] === positions[f * 9 + k], `tri ${t} painted as ${f} but moved`);
  }
  assert(painted >= 4, `only ${painted} triangles kept their paint`);   // -x, -y/+y halves, bottom...
  const walls = c.positions.length / 9 - c.colors.rgb.filter(Boolean).length;
  assert(walls > 0, 'the cut walls came out coloured');
});

// --- the engine sees the cut ------------------------------------------------

Deno.test('INTEGRATION: the fins are built for the cut cube (the Orca file), not the solid one', async () => {
  const o = (await readThreeMF(await Deno.readFile(new URL('orca.3mf', FIX)))).objects[0];
  const c = await cutNegatives(o);
  const rot = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const walls = (p) => {
    const topo = buildTopology(posAttr(p));
    const res = analyze(topo, 45, rot);
    return fins.buildFins(topo, res, rot, { mode: 'auto', bedPad: true }).props.length;
  };
  assert(walls(o.positions) === 0, 'the solid cube has nothing to support');
  // the negative cube cuts the cube's corner up to z 30: a ceiling 30 mm up
  assert(walls(c.positions) > 0, 'no wall under the ceiling the cut opened');
});
