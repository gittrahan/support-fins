import { assert, analyze, buildTopology, fins, rotX, block } from './_util.js';
import { partitionSupportMaterials } from '../web/support-materials.js';
import { writePlate3MF, readThreeMF, scanXML } from '../web/threemf.js';
import { unzip } from '../web/zip.js';
import { MATERIAL } from '../web/materials.js';

const triples = (positions) => Array.from({ length: positions.length / 3 }, (_, i) => Array.from(positions.slice(i * 3, i * 3 + 3)));

Deno.test('material export: stranded geometry cannot bypass conflicting-input validation', async () => {
  const source = triples(block(0, 10, 0, 10, 0, 20));
  const elevated = triples(block(12, 13, 0, 4, 12, 15));
  for (const materialFormat of ['components', 'prusa2']) for (const field of ['finTris', 'iface']) {
    let rejected = false;
    try {
      await writePlate3MF([{ name: 'conflict', partTris: source, finTris: [], [field]: elevated,
        materialFormat, materialParts: [{ role: 'body', triangles: elevated }] }], { separate: true });
    } catch (error) { rejected = /cannot replace additional support triangles/.test(error.message); }
    assert(rejected, `${materialFormat}/${field}: stranded supports bypassed validation`);
  }
});

Deno.test('material export: mixed plate retains stranded grouping and distinct material resources', async () => {
  for (const materialFormat of ['components', 'prusa2']) {
    const source = triples(block(0, 10, 0, 10, 0, 20));
    const blob = await writePlate3MF([
      { name: 'ordinary', partTris: source, finTris: [
        ...triples(block(12, 13, 0, 4, 0, 5)), ...triples(block(8, 9, 0, 4, 12, 15))] },
      { name: 'materials', partTris: source.map(([x, y, z]) => [x + 30, y, z]), finTris: [], materialFormat,
        materialParts: [{ role: 'body', triangles: triples(block(42, 43, 0, 4, 0, 5)) },
          { role: 'tine', triangles: triples(block(41, 43, 0, 4, 4, 5)) }] },
    ], { separate: true });
    const files = await unzip(new Uint8Array(await blob.arrayBuffer()));
    const xml = new TextDecoder().decode(files.get('3D/3dmodel.model'));
    const objects = new Map(), items = []; let current;
    scanXML(xml, (tag, a) => {
      if (tag === 'object') {
        assert(!objects.has(a.id), 'duplicate resource ID');
        current = { name: a.name, components: [] }; objects.set(a.id, current);
      }
      if (tag === 'component') current.components.push(a.objectid);
      if (tag === 'item') items.push(a.objectid);
    }, () => {});
    assert(items.length === 4 && new Set(items).size === 4, 'objects lost or aliased');
    assert([...objects.values()].some(o => o.name === 'ordinary supports on part'), 'upstream grouping lost');
    const ordinary = objects.get(items[0]);
    assert(ordinary.components.some(id => objects.get(id)?.name === 'ordinary supports on part'));
    assert(objects.get(items[1]).name === 'ordinary supports');
    assert(objects.get(items[2]).name === 'materials');
    assert(objects.get(items[3]).name === 'materials supports');
    for (const object of objects.values()) for (const id of object.components) assert(objects.has(id), 'dangling component');
    if (materialFormat === 'components') {
      const names = objects.get(items[3]).components.map(id => objects.get(id).name);
      assert(names.join('|') === 'materials support bodies|materials tines', 'material roles changed');
    } else {
      const cfg = new TextDecoder().decode(files.get('Metadata/Slic3r_PE_model.config'));
      assert(cfg.includes('materials support bodies') && cfg.includes('materials tines'), 'material ranges missing');
    }
  }
});

for (const materialFormat of ['components', 'prusa2']) for (const elevated of [true, false]) {
  Deno.test(`material export: ${materialFormat} regroups ${elevated ? 'elevated' : 'upper'} roles without changing meshes`, async () => {
    const source = triples(block(0, 10, 0, 10, 0, 20));
    const make = (role, bounds) => {
      const triangles = triples(block(...bounds)), ids = new Map();
      const vertexIds = triangles.map(p => {
        const key = p.join(','); if (!ids.has(key)) ids.set(key, ids.size);
        return ids.get(key);
      });
      return { role, triangles, vertexIds };
    };
    const parts = [make('body', [12, 13, 0, 4, 12, 15]),
      make('tine', [11, 12, 0, 4, 14, 15]), make('interface', [12, 13, 0, 4, 15, 15.2])];
    if (!elevated) {
      const low = make('body', [12, 13, 0, 4, 0, 5]);
      parts[0].triangles.push(...low.triangles);
      parts[0].vertexIds.push(...low.vertexIds.map(v => v + 8));
    }
    const before = JSON.stringify(parts);
    const blob = await writePlate3MF([{ name: 'grouped', partTris: source, finTris: [], materialParts: parts, materialFormat }], { separate: true });
    const bytes = new Uint8Array(await blob.arrayBuffer()), files = await unzip(bytes);
    const xml = new TextDecoder().decode(files.get('3D/3dmodel.model'));
    const objects = new Map(), items = []; let current;
    scanXML(xml, (tag, a) => {
      if (tag === 'object') { assert(!objects.has(a.id)); current = { name: a.name, components: [] }; objects.set(a.id, current); }
      if (tag === 'component') current.components.push(a.objectid);
      if (tag === 'item') items.push(a.objectid);
    }, () => {});
    assert(items.length === (elevated ? 1 : 2), 'stranded supports remained a build object');
    const config = new TextDecoder().decode(files.get(materialFormat === 'prusa2' ? 'Metadata/Slic3r_PE_model.config' : 'Metadata/model_settings.config'));
    for (const name of ['support bodies', 'tines', 'top interfaces']) assert(config.includes(`grouped ${name} supports on part`), 'regrouping lost role names');
    for (const object of objects.values()) for (const id of object.components) assert(objects.has(id), 'dangling component');
    const meshes = writtenMeshes(xml);
    for (const mesh of meshes) assertClosed(mesh.faces.map(f => f.map(i => mesh.vertices[i])), mesh.faces);
    const faces = meshes.flatMap(mesh => mesh.faces.map(f => f.map(i => mesh.vertices[i]).flat().join(','))).sort();
    const expected = expectedFaces([...source, ...parts.flatMap(p => p.triangles)]).map(f => f.flat().join(',')).sort();
    assert(JSON.stringify(faces) === JSON.stringify(expected), 'regrouping changed coordinates or triangles');
    const read = await readThreeMF(bytes);
    assert(read.objects[0].positions.length === source.length * 3, 'reimport treated support roles as model geometry');
    assert(JSON.stringify(parts) === before, 'regrouping mutated validated inputs');
  });
}

Deno.test('material export: a plate-level tine alone does not strand the upper support body', async () => {
  for (const materialFormat of ['components', 'prusa2']) {
    const blob = await writePlate3MF([{ name: 'tine-base', partTris: triples(block(0, 10, 0, 10, 0, 20)), finTris: [], materialFormat,
      materialParts: [{ role: 'body', triangles: triples(block(12, 13, 0, 4, 12, 15)) },
        { role: 'tine', triangles: triples(block(12, 13, 0, 1, 0, 1)) }] }], { separate: true });
    const xml = new TextDecoder().decode((await unzip(new Uint8Array(await blob.arrayBuffer()))).get('3D/3dmodel.model'));
    assert((xml.match(/<item /g) ?? []).length === 1, 'left a tine-only supports object');
  }
});

Deno.test('material export: intersecting cutters keep material supports separate', async () => {
  for (const materialFormat of ['components', 'prusa2']) {
    const source = triples(block(0, 10, 0, 10, 0, 20)), elevated = triples(block(12, 13, 0, 4, 12, 15));
    const blob = await writePlate3MF([{ name: 'cut', partTris: source, finTris: [], materialFormat,
      extras: [{ kind: 'negative', name: 'cut', tris: elevated, settings: materialFormat === 'prusa2' ? { prusa2: [] } : {} }],
      materialParts: [{ role: 'body', triangles: elevated }] }], { separate: true });
    const files = await unzip(new Uint8Array(await blob.arrayBuffer()));
    const xml = new TextDecoder().decode(files.get('3D/3dmodel.model'));
    assert((xml.match(/<item /g) ?? []).length === 2, 'regrouped supports would be cut away');
    assert(!xml.includes('supports on part'), 'intersecting cutter was ignored');
  }
});

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
  for (const shift of [0, 10]) for (const materialFormat of ['components', 'prusa2']) {
    const moved = triangles.map(([x, y, z]) => [x, y, z + shift]);
    const model = { name: 'thin', partTris: [], finTris: [], materialFormat,
      materialParts: [{ role: 'body', triangles: moved, vertexIds }] };
    const blob = await writePlate3MF([model], { separate: true });
    const files = await unzip(new Uint8Array(await blob.arrayBuffer()));
    const [m] = writtenMeshes(new TextDecoder().decode(files.get('3D/3dmodel.model')));
    const faces = m.faces.map((f) => f.map((v) => m.vertices[v]));
    assertClosed(faces, m.faces);
    assert(m.vertices.length === 16, 'touching shells were welded together');
    assert(JSON.stringify(faces) === JSON.stringify(expectedFaces(moved)), 'thin surface lost its exact coordinates');
    for (const invalid of [vertexIds.slice(1), vertexIds.map((v, i) => i ? v : -1), vertexIds.map(() => 0)]) {
      let rejected = false;
      try { await writePlate3MF([{ ...model, materialParts: [{ role: 'body', triangles: moved, vertexIds: invalid }] }], { separate: true }); }
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
  const edges = new Map(), links = new Map();
  for (let t = 0; t < faces.length; t++) {
    const [a, b, c] = faces[t];
    const u = b.map((v, k) => v - a[k]), v = c.map((v, k) => v - a[k]);
    assert(Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0]) > 0, 'serialized triangle became a line');
    const ps = indices ? indices[t] : [a, b, c].map((p) => p.join(','));
    for (let i = 0; i < 3; i++) {
      const v = ps[i], a = ps[(i + 1) % 3], b = ps[(i + 2) % 3];
      if (!links.has(v)) links.set(v, new Map());
      const link = links.get(v);
      for (const [x, y] of [[a, b], [b, a]]) {
        if (!link.has(x)) link.set(x, new Set());
        link.get(x).add(y);
      }
      const x = ps[i], y = ps[(i + 1) % 3], key = x < y ? `${x}/${y}` : `${y}/${x}`;
      const edge = edges.get(key) ?? { count: 0, direction: 0 };
      edge.count++; edge.direction += x < y ? 1 : -1; edges.set(key, edge);
    }
  }
  assert([...edges.values()].every((e) => e.count === 2 && e.direction === 0), 'serialized part lost closed, consistent topology');
  for (const link of links.values()) {
    assert([...link.values()].every(neighbors => neighbors.size === 2), 'non-manifold vertex link');
    const visited = new Set(), queue = [link.keys().next().value];
    while (queue.length) {
      const v = queue.pop();
      if (visited.has(v)) continue;
      visited.add(v); queue.push(...link.get(v));
    }
    assert(visited.size === link.size, 'distinct touching vertex fans were joined');
  }
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

Deno.test('material export: rotated sloping contacts retain closed parts across collapsed sheets', async () => {
  // Rooted cube/ledge control from prototype/material-parts: its rotation exposes
  // coincident opposite faces and an existing diagonal in the Boolean result.
  const soup = p => Array.from({ length: p.length / 3 }, (_, i) => Array.from(p.slice(i * 3, i * 3 + 3)));
  const tilt = rotX(35), cube = soup(block(-12, 12, -12, 12, 0, 24))
    .map(([x, y, z]) => [x, tilt[4] * y + tilt[7] * z, tilt[5] * y + tilt[8] * z]);
  const floor = Math.min(...cube.map(p => p[2]));
  for (const p of cube) p[2] -= floor;
  const bodies = [cube, soup(block(-14, 14, -14, 14, 0, 2)), soup(block(8, 30, -8, 8, 20, 24))]
    .flatMap(tris => { const role = { role: 'body' }; return tris.map(p => [...p, 0, role]); });
  const source = (await partitionSupportMaterials(bodies)).parts[0].triangles;
  const array = Float32Array.from(source.flat()), topo = buildTopology({ getAttribute: () => ({ array }) });
  const c = Math.cos(.37), s = Math.sin(.37), rot = [c, s, 0, -s, c, 0, 0, 0, 1];
  const built = fins.buildFins(topo, analyze(topo, 45, rot), rot, {
    mode: 'auto', coverage: 1, tines: true, bedPad: false,
    tunables: { ...MATERIAL.pla, iface: 'flat', separateTines: true, tineDir: 'horizontal',
      nozzle: .4, wallLines: 2, tinesPerWall: 0, sideClearance: .35, bottomGap: .2, cutout: 'none' },
  });
  const original = structuredClone(built.triangles);
  const { parts, residual } = await partitionSupportMaterials(built.triangles);
  assert(residual.missingVolume <= residual.roundoff && residual.extraVolume <= residual.roundoff);
  assert(JSON.stringify(original) === JSON.stringify(built.triangles));
  for (const materialFormat of ['components', 'prusa2']) {
    const blob = await writePlate3MF([{ name: 'rotated', partTris: [], finTris: [], materialParts: parts, materialFormat }], { separate: true });
    const files = await unzip(new Uint8Array(await blob.arrayBuffer()));
    const meshes = writtenMeshes(new TextDecoder().decode(files.get('3D/3dmodel.model')));
    for (const m of meshes) assertClosed(m.faces.map(f => f.map(i => m.vertices[i])), m.faces);
  }
});
