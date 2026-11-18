import { assert, analyze, buildTopology, fins, rotX, block } from './_util.js';
import { partitionSupportMaterials } from '../web/support-materials.js';
import { writePlate3MF, scanXML } from '../web/threemf.js';
import { unzip } from '../web/zip.js';
import { MATERIAL } from '../web/materials.js';

// A closed ledge adapted from prototype/calibration/grip/gen.py. Small changes
// to its dimensions expose partition vertices less than 0.000001 mm apart.
async function ledge(reach, seat) {
  const yz = [[-5, 0], [5, 0], [5, seat], [5 + reach, seat + reach / 2],
    [5 + reach, seat + reach / 2 + 2], [-5, seat + reach / 2 + 2]], tris = [];
  for (let i = 1; i + 1 < yz.length; i++) {
    tris.push([0, ...yz[0]], [0, ...yz[i + 1]], [0, ...yz[i]],
      [24, ...yz[0]], [24, ...yz[i]], [24, ...yz[i + 1]]);
  }
  for (let i = 0; i < yz.length; i++) {
    const j = (i + 1) % yz.length, a = [0, ...yz[i]], b = [0, ...yz[j]],
      c = [24, ...yz[j]], d = [24, ...yz[i]];
    tris.push(a, b, c, a, c, d);
  }
  const source = (await partitionSupportMaterials(tris)).parts[0].triangles;
  const array = Float32Array.from(source.flat()), topo = buildTopology({ getAttribute: () => ({ array }) }), rot = rotX(0);
  const built = fins.buildFins(topo, analyze(topo, 45, rot), rot, {
    mode: 'auto', coverage: .5, tines: true, tineDensity: 0, bedPad: false, layerHeight: .2,
    tunables: { nozzle: .4, iface: 'all', separateTines: true, tineDir: 'horizontal',
      ...MATERIAL.petg, tinesPerWall: 4, sideClearance: .35, bottomGap: .2, cutout: 'none' },
  });
  return { source, parts: (await partitionSupportMaterials([...built.triangles, ...built.padTriangles])).parts };
}

Deno.test('material export: touching shells retain distinct topology and tiny finite coordinates', async () => {
  const triangles = [], vertexIds = [];
  for (const bounds of [[0, 1, 0, 1, 0, 1], [1, 2, 1, 2, 0, 1]]) {
    const pos = block(...bounds), ids = new Map();
    const offset = vertexIds.length;
    for (let i = 0; i < pos.length; i += 3) {
      const p = Array.from(pos.slice(i, i + 3)).map((x, k) => k === 2 ? x * 1e-8 : x);
      const key = p.join(',');
      if (!ids.has(key)) ids.set(key, offset + ids.size);
      triangles.push(p); vertexIds.push(ids.get(key));
    }
  }
  for (const materialFormat of ['components', 'prusa2']) {
    const model = { name: 'thin', partTris: [], finTris: [], materialFormat,
      materialParts: [{ role: 'body', triangles, vertexIds }] };
    const blob = await writePlate3MF([model], { separate: true });
    const files = await unzip(new Uint8Array(await blob.arrayBuffer()));
    const [m] = writtenMeshes(new TextDecoder().decode(files.get('3D/3dmodel.model')));
    const faces = m.faces.map((f) => f.map((v) => m.vertices[v]));
    assertClosed(faces, m.faces);
    assert(m.vertices.length === 16, 'touching shells were welded together');
    assert(JSON.stringify(faces) === JSON.stringify(expectedFaces(triangles)), 'thin surface lost its exact coordinates');
    for (const invalid of [vertexIds.slice(1), vertexIds.map((v, i) => i ? v : -1), vertexIds.map(() => 0)]) {
      let rejected = false;
      try { await writePlate3MF([{ ...model, materialParts: [{ role: 'body', triangles, vertexIds: invalid }] }], { separate: true }); }
      catch { rejected = true; }
      assert(rejected, `${materialFormat} accepted invalid vertex identities`);
    }
  }
});

function writtenMeshes(xml) {
  const meshes = []; let current;
  scanXML(xml, (tag, a) => {
    if (tag === 'object') current = { name: a.name, vertices: [], faces: [] };
    if (tag === 'vertex') current.vertices.push(['x', 'y', 'z'].map((k) => Number(a[k])));
    if (tag === 'triangle') current.faces.push(['v1', 'v2', 'v3'].map((k) => Number(a[k])));
  }, (tag) => { if (tag === 'object' && current.faces.length) meshes.push(current); });
  return meshes;
}

function expectedFaces(tris) {
  const result = [];
  for (let i = 0; i < tris.length; i += 3) {
    const face = tris.slice(i, i + 3).map((p) => p.slice(0, 3));
    if (new Set(face.map((p) => p.join(','))).size === 3) result.push(face);
  }
  return result;
}

function assertClosed(faces, indices = null) {
  const edges = new Map();
  for (let t = 0; t < faces.length; t++) {
    const [a, b, c] = faces[t];
    const u = b.map((v, k) => v - a[k]), v = c.map((v, k) => v - a[k]);
    assert(Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0]) > 0, 'serialized triangle became a line');
    const ps = indices ? indices[t] : [a, b, c].map((p) => p.join(','));
    for (let i = 0; i < 3; i++) {
      const x = ps[i], y = ps[(i + 1) % 3], key = x < y ? `${x}/${y}` : `${y}/${x}`;
      const edge = edges.get(key) ?? { count: 0, direction: 0 };
      edge.count++; edge.direction += x < y ? 1 : -1; edges.set(key, edge);
    }
  }
  assert([...edges.values()].every((e) => e.count === 2 && e.direction === 0), 'serialized part lost closed, consistent topology');
}

for (const [reach, seat] of [[25, 5.15], [25, 5.125], [33, 5.175]]) {
  Deno.test(`material export: ledge ${reach}/${seat} preserves closed partition vertices in both layouts`, async () => {
    const { source, parts } = await ledge(reach, seat);
    const expected = parts.map((p) => expectedFaces(p.triangles));
    parts.forEach((p, i) => assertClosed(expected[i], Array.from({ length: p.vertexIds.length / 3 }, (_, k) => p.vertexIds.slice(k * 3, k * 3 + 3))));
    for (const materialFormat of ['components', 'prusa2']) {
      const blob = await writePlate3MF([{ name: 'ledge', partTris: source, finTris: [], materialParts: parts, materialFormat }], { separate: true });
      const files = await unzip(new Uint8Array(await blob.arrayBuffer()));
      const xml = new TextDecoder().decode(files.get('3D/3dmodel.model'));
      const meshes = writtenMeshes(xml).filter((m) => m.name !== 'ledge');
      const actual = meshes.map((m) => m.faces.map((f) => f.map((i) => m.vertices[i])));
      const want = materialFormat === 'components' ? expected : [expected.flat()];
      assert(JSON.stringify(actual) === JSON.stringify(want), '3MF rounded validated material vertices or changed faces');
      if (materialFormat === 'components') actual.forEach((faces, i) => assertClosed(faces, meshes[i].faces));
      else {
        const cfg = new TextDecoder().decode(files.get('Metadata/Slic3r_PE_model.config'));
        const ranges = [...cfg.matchAll(/firstid="(\d+)" lastid="(\d+)"/g)].map((m) => m.slice(1).map(Number));
        assert(ranges.length === parts.length);
        ranges.forEach(([first, last], i) => {
          const region = actual[0].slice(first, last + 1);
          assert(JSON.stringify(region) === JSON.stringify(expected[i]), 'Prusa volume range lost its material');
          assertClosed(region, meshes[0].faces.slice(first, last + 1));
        });
      }
    }
  });
}
