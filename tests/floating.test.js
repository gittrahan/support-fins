// PIECES IN MID-AIR (MorbidJ-hub, Sept 2026, from 3DBenchy in the Fusion add-in):
// a piece that starts in mid-air (a cut clean through a wall, a loose body)
// printed onto nothing with no word from the readout. floatingPieces finds it.
import { buildTopology, analyze, fins, assert } from './_util.js';
import { floatingPieces } from '../web/pieces.js';

const quad = (a, b, c, d) => [a, b, c, a, c, d];
function block(x0, x1, y0, y1, z0, z1) {
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
             [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  return [...quad(v[0], v[3], v[2], v[1]), ...quad(v[4], v[5], v[6], v[7]), ...quad(v[0], v[1], v[5], v[4]),
          ...quad(v[2], v[3], v[7], v[6]), ...quad(v[1], v[2], v[6], v[5]), ...quad(v[0], v[4], v[7], v[3])];
}
const topoOf = (tris) => {
  const arr = Float32Array.from(tris.flat());
  return buildTopology({ getAttribute: (k) => (k === 'position' ? { array: arr } : null) });
};
const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const build = (topo) => fins.buildFins(topo, analyze(topo, 45, I), I,
  { mode: 'auto', bedPad: true, tines: true, coverage: 0.5 });

Deno.test('floating: a piece that starts in mid-air is found, with its drop', () => {
  // a foot, and a bar hanging 5 mm over it with nothing joining them
  const topo = topoOf([...block(-15, 15, -10, 10, 0, 8), ...block(-15, 15, -10, 10, 13, 20)]);
  const res = analyze(topo, 45, I);
  const f = floatingPieces(topo, res, I);
  assert(f.length === 1, `expected one floating piece, got ${f.length}`);
  assert(Math.abs(f[0].drop - 5) < 1e-6, `drop ${f[0].drop}, expected 5`);
  assert(build(topo).floating.length === 1, 'buildFins must carry floating pieces to the readout');
});

Deno.test('floating: over bare plate the drop is the height; one piece or a stack is fine', () => {
  const beside = topoOf([...block(-15, -5, -10, 10, 0, 8), ...block(5, 15, -10, 10, 6, 12)]);
  const f = floatingPieces(beside, analyze(beside, 45, I), I);
  assert(f.length === 1 && Math.abs(f[0].drop - 6) < 1e-6, `beside: ${JSON.stringify(f)}`);

  const one = topoOf(block(-15, 15, -10, 10, 0, 8));
  assert(floatingPieces(one, analyze(one, 45, I), I).length === 0, 'a single piece never floats');

  const stack = topoOf([...block(-15, 15, -10, 10, 0, 8), ...block(-10, 10, -5, 5, 8.1, 14)]);
  assert(floatingPieces(stack, analyze(stack, 45, I), I).length === 0,
    'a piece 0.1 mm over another rests on it (print-in-place gap)');
});

// the six faces of a block wound INWARD: the wall of a sealed cavity
const cavity = (...b) => {
  const t = block(...b);
  for (let i = 0; i < t.length; i += 3) [t[i + 1], t[i + 2]] = [t[i + 2], t[i + 1]];
  return t;
};

Deno.test('floating: a hollow part is one piece -- its sealed void is not flagged', () => {
  // a 30 mm box with a 20 mm void: two shells, but the inner one faces inward
  const hollow = topoOf([...block(-15, 15, -15, 15, 0, 30), ...cavity(-10, 10, -10, 10, 5, 25)]);
  const f = floatingPieces(hollow, analyze(hollow, 45, I), I);
  assert(f.length === 0, `hollow box flagged as floating: ${JSON.stringify(f)}`);
});

Deno.test('floating: a loose piece inside a void is still found', () => {
  // the same hollow box with a block hanging 3 mm over the void's floor
  const topo = topoOf([...block(-15, 15, -15, 15, 0, 30), ...cavity(-10, 10, -10, 10, 5, 25),
                       ...block(-4, 4, -4, 4, 8, 14)]);
  const f = floatingPieces(topo, analyze(topo, 45, I), I);
  assert(f.length === 1 && Math.abs(f[0].drop - 3) < 1e-6, `loose piece: ${JSON.stringify(f)}`);
});

Deno.test('floating: 1,800 stacked pieces check in well under a second', () => {
  // a 60 x 30 grid of posts, each carrying a cap 0.1 mm above it: 3,600 pieces,
  // 1,800 of them lifted, none floating. Testing every lifted piece against every
  // triangle took ~1.5 s here (8 s on an 800-piece, 1M-triangle part).
  const tris = [];
  for (let i = 0; i < 60; i++) {
    for (let j = 0; j < 30; j++) {
      const x = i * 3, y = j * 3;
      tris.push(...block(x, x + 2, y, y + 2, 0, 4), ...block(x, x + 2, y, y + 2, 4.1, 5));
    }
  }
  const topo = topoOf(tris);
  const res = analyze(topo, 45, I);
  const t0 = performance.now();
  const f = floatingPieces(topo, res, I);
  const ms = performance.now() - t0;
  assert(f.length === 0, `${f.length} caps flagged`);
  assert(ms < 500, `floatingPieces took ${ms.toFixed(0)} ms`);
});
