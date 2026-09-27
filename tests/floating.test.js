// PIECES IN MID-AIR (MorbidJ-hub, Sept 2026, from 3DBenchy in the Fusion add-in):
// a piece that starts in mid-air (a cut clean through a wall, a loose body)
// printed onto nothing with no word from the readout. floatingPieces finds it.
import { buildTopology, analyze, fins, assert } from './_util.js';
import { floatingPieces } from '../web/overhangs.js';

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
