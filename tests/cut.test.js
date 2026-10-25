// A slicer's negative parts cut out of the part (web/cut.js, GitHub #104). These
// pin: the cut is the slicer's (the part's volume drops by exactly the overlap);
// a scanned negative of closed shells plus sliver debris still cuts; a part or a
// negative that is not a closed solid is said, never cut wrong; colours stay on
// the faces the cut leaves alone; and the fins are built for the cut shape.

import { WEB, assert, assertClose, block, buildTopology, analyze, fins } from './_util.js';

const { readThreeMF } = await import(`${WEB}threemf.js`);
const { cutNegatives, setManifoldWasm } = await import(`${WEB}cut.js`);

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
    assert(c.cut === 1 && c.uncut === 0 && !c.why, `cut ${c.cut}, uncut ${c.uncut}, why ${c.why}`);
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
  assert(c.cut === 0 && c.uncut === 1 && !c.why && c.positions === positions, JSON.stringify({ ...c, positions: 0 }));
});

Deno.test('cut: a part that is not a closed solid is not cut at all, and says so', async () => {
  const positions = block(0, 10, 0, 10, 0, 10).slice(0, 9 * 10);
  const c = await cutNegatives({ positions, colors: null, extras: [neg(block(2, 8, 2, 8, -1, 5))] });
  assert(c.why === 'open' && c.cut === 0 && c.positions === positions, JSON.stringify({ ...c, positions: 0 }));
});

Deno.test('cut: the part is never repaired -- a part with sliver debris is not cut, and says so', async () => {
  // the shell-and-debris repair is for negatives only: dropping any of the part
  // would change what prints without a word
  const positions = cat(block(0, 10, 0, 10, 0, 10), new Float32Array([20, 0, 0, 21, 0, 0, 20, 1, 0]));
  const c = await cutNegatives({ positions, colors: null, extras: [neg(block(2, 8, 2, 8, -1, 5))] });
  assert(c.why === 'open' && c.positions === positions, JSON.stringify({ ...c, positions: 0 }));
});

Deno.test('cut: a negative wound inside out still cuts (it does not add its volume)', async () => {
  const inside = block(5, 15, 5, 15, 5, 15);
  for (let i = 0; i < inside.length; i += 9) {          // swap corners 2 and 3 of every face
    for (let k = 0; k < 3; k++) [inside[i + 3 + k], inside[i + 6 + k]] = [inside[i + 6 + k], inside[i + 3 + k]];
  }
  assert(volume(inside) < 0, 'fixture: the tool should be inside out');
  const c = await cutNegatives({ positions: block(0, 10, 0, 10, 0, 10), colors: null, extras: [neg(inside)] });
  assertClose(volume(c.positions), 1000 - 125, 1e-3, 'cut volume');
});

Deno.test('cut: negatives that remove the whole part leave it uncut, and say so', async () => {
  const positions = block(0, 10, 0, 10, 0, 10);
  const c = await cutNegatives({ positions, colors: null, extras: [neg(block(-1, 11, -1, 11, -1, 11))] });
  assert(c.why === 'whole' && c.positions === positions, JSON.stringify({ ...c, positions: 0 }));
});

Deno.test('cut: a cutter that will not load leaves the part uncut, says so, and is retried', async () => {
  const positions = block(0, 10, 0, 10, 0, 10);
  const obj = { positions, colors: null, extras: [neg(block(5, 15, 5, 15, 5, 15))] };
  setManifoldWasm(new Uint8Array([0, 1, 2, 3]));        // not WASM: the load fails
  const c = await cutNegatives(obj);
  assert(c.why === 'load' && c.positions === positions, JSON.stringify({ ...c, positions: 0 }));
  setManifoldWasm(null);                                  // back to the vendor folder
  const d = await cutNegatives(obj);
  assert(d.cut === 1, `not retried after a failed load: ${JSON.stringify({ ...d, positions: 0 })}`);
});

// --- colours ----------------------------------------------------------------

Deno.test('cut: paint stays on the faces the cut leaves whole, exactly as it was', async () => {
  const positions = block(0, 10, 0, 10, 0, 10);
  const paint = [], rgb = [];
  // stroked codes (the last digit's low bits say "split"), the source triangle in front
  for (let t = 0; t < 12; t++) { paint[t] = { name: 'paint_color', v: `${t.toString(16)}1` }; rgb[t] = '#FF0000'; }
  // a notch in the +x top edge: the top and +x faces are cut, the rest untouched
  const c = await cutNegatives({ positions, colors: { paint, rgb }, extras: [neg(block(8, 11, -1, 11, 8, 11))] });
  assert(c.cut === 1 && c.colors, 'no colours came through');
  let painted = 0;
  for (let t = 0; t < c.positions.length / 9; t++) {
    const p = c.colors.paint[t];
    if (!p) continue;
    painted++;
    // painted only where it IS its source triangle, corner for corner
    const f = parseInt(p.v.slice(0, -1), 16);
    for (let k = 0; k < 9; k++) assert(c.positions[t * 9 + k] === positions[f * 9 + k], `tri ${t} painted as ${f} but moved`);
  }
  assert(painted >= 4, `only ${painted} triangles kept their paint`);   // -x, -y/+y halves, bottom...
  const walls = c.positions.length / 9 - c.colors.rgb.filter(Boolean).length;
  assert(walls > 0, 'the cut walls came out coloured');
});

Deno.test('cut: a whole-triangle code (a part\'s filament) stays on every piece of a cut face', async () => {
  const positions = block(0, 10, 0, 10, 0, 10);
  const paint = [];
  for (let t = 0; t < 12; t++) paint[t] = { name: 'paint_color', v: '8' };
  const c = await cutNegatives({ positions, colors: { paint, rgb: [] }, extras: [neg(block(8, 11, -1, 11, 8, 11))] });
  assert(c.cut === 1 && c.colors, 'no colours came through');
  const n = c.positions.length / 9, painted = c.colors.paint.filter((p) => p?.v === '8').length;
  // every triangle of the cube's own surface, cut or not; only the cut's walls bare
  assert(painted > 12 && painted < n, `${painted} of ${n} on filament 2`);
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

// The export (#104): the part goes out as the file had it, uncut beside its
// negative part, for the slicer to cut again. Opened here again, it must cut to
// the same part the fins were built for -- or the saved session ("the part changed")
// would not restore. Done as the site does it (ui/export.js): the part centred on
// its cut box, posed, seated; the uncut part and the negative moved the same way.
for (const file of ['bambu.3mf', 'orca.3mf', 'prusaslicer3.3mf']) {
  Deno.test(`cut: ${file} exported uncut with its negative, opened again, cuts to the same part`, async () => {
    const { writeThreeMF } = await import(`${WEB}threemf.js`);
    const o = (await readThreeMF(await Deno.readFile(new URL(file, FIX)))).objects[0];
    const c = await cutNegatives(o);
    const b = bounds(c.positions);
    const centre = b.lo.map((v, k) => (v + b.hi[k]) / 2);
    // a quarter turn about x, seated 3 mm up and off to one side
    const place = (p) => {
      const out = [];
      for (let i = 0; i < p.length; i += 3) {
        const x = p[i] - centre[0], y = p[i + 1] - centre[1], z = p[i + 2] - centre[2];
        out.push([x + 5, -z, y + 3]);
      }
      return out;
    };
    const blob = writeThreeMF(place(o.positions), [[0, 0, 0], [1, 0, 0], [0, 1, 0]], 'cube', { separate: true,
      extras: o.extras.map((e) => ({ ...e, tris: place(e.positions) })) });
    const back = (await readThreeMF(new Uint8Array(await blob.arrayBuffer()))).objects.find((x) => !/ supports$/.test(x.name));
    assert(back.tris === 12 && back.extras.length === 1, `read back ${back.tris} tris, ${back.extras.length} extras`);
    const again = await cutNegatives(back);
    assert(again.cut === 1, `cut ${again.cut} on the way back in`);
    // float32 coordinates, ~127 mm from the origin in the PrusaSlicer file
    assertClose(volume(again.positions), volume(c.positions), 1e-6 * volume(c.positions), 'the cut part\'s volume');
    const size = (p) => { const q = bounds(p); return q.hi.map((h, k) => h - q.lo[k]); };
    const [sx, sy, sz] = size(c.positions), s2 = size(again.positions);
    // the quarter turn: x stays, y and z swap
    [sx, sz, sy].forEach((v, k) => assertClose(s2[k], v, 1e-3, `size ${'xyz'[k]}`));
  });
}
