// buildTopology (web/overhangs.js) welds the STL's triangle soup through numeric
// hash tables; it used to key a Map on strings. The topology has to be the SAME --
// vertex ids, edge count, every adjacency pair in order -- or regions, and so
// every support, shift.
import { assert, buildTopology, MODELS, readSTL } from './_util.js';

// The string-keyed weld it replaced, verbatim in effect.
function reference(pos) {
  const nFaces = pos.length / 9;
  const key3 = (x, y, z) => `${Math.round(x * 1000)},${Math.round(y * 1000)},${Math.round(z * 1000)}`;
  const weld = new Map(), vid = new Int32Array(nFaces * 3);
  for (let f = 0; f < nFaces; f++) {
    for (let i = 0; i < 3; i++) {
      const o = f * 9 + i * 3, k = key3(pos[o], pos[o + 1], pos[o + 2]);
      let id = weld.get(k);
      if (id === undefined) weld.set(k, (id = weld.size));
      vid[f * 3 + i] = id;
    }
  }
  const firstFace = new Map(), adjA = [], adjB = [];
  for (let f = 0; f < nFaces; f++) {
    for (let i = 0; i < 3; i++) {
      const a = vid[f * 3 + i], b = vid[f * 3 + ((i + 1) % 3)];
      const k = a < b ? `${a}_${b}` : `${b}_${a}`;
      const prev = firstFace.get(k);
      if (prev === undefined) firstFace.set(k, f);
      else { adjA.push(prev); adjB.push(f); }
    }
  }
  return { adjA, adjB, vertexCount: weld.size, edgeCount: firstFace.size };
}

function same(pos, what) {
  const t = buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
  const r = reference(pos);
  assert(t.vertexCount === r.vertexCount, `${what}: ${t.vertexCount} vertices vs ${r.vertexCount}`);
  assert(t.edgeCount === r.edgeCount, `${what}: ${t.edgeCount} edges vs ${r.edgeCount}`);
  assert(t.adjA.length === r.adjA.length, `${what}: ${t.adjA.length} adjacencies vs ${r.adjA.length}`);
  for (let i = 0; i < r.adjA.length; i++) {
    assert(t.adjA[i] === r.adjA[i] && t.adjB[i] === r.adjB[i], `${what}: adjacency ${i} differs`);
  }
}

Deno.test('the weld matches the string-keyed one on every stress model', () => {
  for (const e of Deno.readDirSync(MODELS)) {
    if (!e.name.endsWith('.stl')) continue;
    same(readSTL(Deno.readFileSync(`${MODELS}${e.name}`)), e.name);
  }
});

Deno.test('the weld keeps the old key edge cases: -0, half-micron rounding, NaN, huge, duplicates', () => {
  const tri = (...v) => v.flat();
  const pos = new Float64Array([
    ...tri([0, 0, 0], [1, 0, 0], [0, 1, 0]),
    ...tri([-0, -0.0004, 0], [1, 0, 0], [0, 0, 1]),         // rounds to -0: welds with 0
    ...tri([0.0005, 0, 0], [0.0015, 0, 0], [0, 0.0025, 0]),   // .5 rounding up, as Math.round does
    ...tri([NaN, 0, 0], [NaN, 0, 0], [0, 0, 5]),             // every NaN welds together
    ...tri([1e30, 2e30, -3e30], [1e30, 2e30, -3e30], [1, 0, 0]),
    ...tri([0, 0, 0], [1, 0, 0], [0, 1, 0]),                 // an exact duplicate face
    ...tri([5, 5, 5], [5, 5, 5], [5, 5, 5]),                 // a point
  ]);
  same(pos, 'edge cases');
});

Deno.test('the weld matches on a dense random-ish soup with many shared vertices', () => {
  // a 120 x 120 grid of quads, each corner jittered below the 1e-3 weld step, faces shuffled
  const n = 120, pos = [];
  let s = 7;
  const r = () => ((s = Math.imul(s ^ (s >>> 13), 0x5bd1e995) + 12345 >>> 0) / 2 ** 32 - 0.5) * 4e-4;
  const p = (i, j) => [i * 0.7 + r(), j * 0.7 + r(), Math.sin(i * 0.3) * Math.cos(j * 0.2) * 5 + r()];
  const faces = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    faces.push([p(i, j), p(i + 1, j), p(i + 1, j + 1)], [p(i, j), p(i + 1, j + 1), p(i, j + 1)]);
  }
  for (let k = faces.length - 1; k > 0; k--) {
    const m = (Math.imul(k, 2654435761) >>> 0) % (k + 1);
    [faces[k], faces[m]] = [faces[m], faces[k]];
  }
  for (const f of faces) for (const v of f) pos.push(...v);
  same(new Float32Array(pos), 'dense grid');
});
