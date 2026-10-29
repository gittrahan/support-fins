import { assert } from "../../../tests/_util.js";
import { canonicalCutMesh } from "../project-bake-mesh.js";
const options = { cancelOppositeFaces: true };
const soup = (faces) => ({
  positions: Float64Array.from(faces.flat(2)),
  sourceFaces: Int32Array.from(faces, (_, i) => i + 10),
});
function fails(mesh, options) {
  let error;
  try {
    canonicalCutMesh(mesh, options);
  } catch (e) {
    error = e;
  }
  assert(error instanceof Error, "invalid surface accepted");
}
const C = [0, 0, 0],
  B = [1, 0, 0],
  A = [2, 0, 0],
  D = [1, 0, 1],
  E = [0, -1, 0];
const tetra = [[C, D, B], [C, B, E], [C, E, D], [B, D, E]];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function signatures(m) {
  return Array.from(m.sourceFaces, (_, f) => {
    const points = [0, 1, 2].map((k) =>
      Array.from(m.positions.slice(f * 9 + k * 3, f * 9 + k * 3 + 3))
    );
    return [0, 1, 2].map((k) =>
      JSON.stringify([...points.slice(k), ...points.slice(0, k)])
    ).sort()[0];
  }).sort();
}
for (const tiny of [false, true]) {
  Deno.test(`generated interfaces: exact reversed facets exposed by subdivision, tiny=${tiny}`, () => {
    const map = ([x, y, z]) => [tiny ? 1 + x * 2 ** -52 : x, y, z];
    const faces = [[C, D, A], [A, D, B], [C, A, B], ...tetra.slice(1)].map(
      (t) => t.map(map),
    );
    const input = soup(faces), before = structuredClone(input);
    fails(input);
    fails(input, { cancelOppositeFaces: false });
    const out = canonicalCutMesh(input, options);
    assert(out.collapsedFaces === 1 && out.cancelledFaces === 2);
    assert(
      same(signatures(out), signatures(soup(tetra.map((t) => t.map(map))))),
    );
    assert(same(input, before), "source was modified");
    assert(
      same(Array.from(out.sourceFaces), [10, 13, 14, 15]),
      "source provenance changed",
    );
    assert(canonicalCutMesh(out).collapsedFaces === 0);
  });
}
Deno.test("generated interfaces: only exact opposite pairs cancel, including cyclic corner order", () => {
  const t = [[3, 0, 0], [4, 0, 0], [3, 1, 0]];
  const mesh = soup([...tetra, t, [t[1], t[0], t[2]]]);
  const out = canonicalCutMesh(mesh, options);
  assert(out.collapsedFaces === 0 && out.cancelledFaces === 2);
  assert(same(signatures(out), signatures(soup(tetra))));
  assert(same(Array.from(out.sourceFaces), [10, 11, 12, 13]));
  assert(
    canonicalCutMesh(mesh).positions === mesh.positions,
    "ordinary validation changed",
  );
  fails(soup([...tetra, t, t]), options);
  fails(
    soup([...tetra, t, t.map(([x, y, z]) => [x, y, z + 2 ** -52]).reverse()]),
    options,
  );
  fails(soup([...tetra, t, t, t.toReversed()]), options);
  fails(soup([...tetra.slice(1), t, t.toReversed()]), options);
  fails(soup([t, t.toReversed()]), options);
});
Deno.test("generated interfaces: no cancellation is the default and valid mesh identity is retained", () => {
  const mesh = soup(tetra), omitted = canonicalCutMesh(mesh);
  assert(same(omitted, canonicalCutMesh(mesh, { cancelOppositeFaces: false })));
  assert(!("cancelledFaces" in omitted));
  const enabled = canonicalCutMesh(mesh, options);
  assert(enabled.cancelledFaces === 0 && enabled.collapsedFaces === 0);
  assert(
    enabled.positions === mesh.positions &&
      enabled.sourceFaces === mesh.sourceFaces,
  );
});

function indexedShells(shells) {
  const faces = [], ids = [];
  let next = 0;
  for (const shell of shells) {
    const known = new Map();
    for (const face of shell) {
      faces.push(face);
      for (const p of face) {
        const key = p.join(',');
        if (!known.has(key)) known.set(key, next++);
        ids.push(known.get(key));
      }
    }
  }
  return { ...soup(faces), vertexIDs: Uint32Array.from(ids) };
}
const touching = tetra.map((t) => t.map(([x, y, z]) => [x, -y, -z]));
Deno.test('indexed interfaces: coincident contact vertices retain distinct closed fans', () => {
  const mesh = indexedShells([tetra, touching]), before = structuredClone(mesh);
  fails({ positions: mesh.positions, sourceFaces: mesh.sourceFaces });
  const out = canonicalCutMesh(mesh);
  assert(out.collapsedFaces === 0);
  assert(out.positions === mesh.positions && out.vertexIDs === mesh.vertexIDs);
  assert(same(mesh, before), 'indexed input was modified');
});
Deno.test('indexed interfaces: exact collinear subdivision preserves IDs and source faces', () => {
  const M = [0.5, 0, 0];
  const split = [[C, D, M], [M, D, B], [C, M, B], ...tetra.slice(1)];
  const mesh = indexedShells([split, touching]);
  const out = canonicalCutMesh(mesh);
  assert(out.collapsedFaces === 1 && out.positions.length / 9 === 10);
  assert(!out.sourceFaces.includes(12), 'zero-area source survived');
  assert(Array.from(out.sourceFaces).filter((s) => s === 13).length === 2);
  assert(out.vertexIDs.length === out.positions.length / 3);
  assert(canonicalCutMesh(out).collapsedFaces === 0);
  const original = new Map(Array.from(mesh.vertexIDs, (id, i) =>
    [id, Array.from(mesh.positions.slice(i * 3, i * 3 + 3))]));
  for (let i = 0; i < out.vertexIDs.length; i++) {
    assert(same(Array.from(out.positions.slice(i * 3, i * 3 + 3)), original.get(out.vertexIDs[i])));
  }
});
Deno.test('indexed interfaces: invalid identities never substitute for closure', () => {
  const mesh = indexedShells([tetra]);
  fails({ ...mesh, vertexIDs: new Uint32Array(2) });
  fails({ ...mesh, vertexIDs: Array.from(mesh.vertexIDs) });
  fails({ ...mesh, vertexIDs: Uint32Array.from(mesh.vertexIDs, (_, i) => i) });
  const conflicting = mesh.vertexIDs.slice();
  conflicting[1] = conflicting[0];
  fails({ ...mesh, vertexIDs: conflicting });
  fails({ ...mesh, positions: mesh.positions.slice(9), sourceFaces: mesh.sourceFaces.slice(1),
    vertexIDs: mesh.vertexIDs.slice(3) });
});
