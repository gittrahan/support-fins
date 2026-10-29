import { assert, assertClose, block } from '../../../tests/_util.js';
import { bakeFixture } from './_bake-fixture.js';
import { bakeProjectNegatives } from '../project-bake.js';
import { prepareProjectPaint, remapProjectPaint } from '../project-paint.js';
import { decodePaint } from '../bambu-paint.js';
import { clipPolygon, conformPolygons, cross, frame, polygonArea, sub, triangle } from '../paint-geometry.js';
import { cutNegatives } from '../../../web/cut.js';
import { readThreeMFParts } from '../../../web/threemf.js';
import { bakeExportMembers } from './_bake-export.js';
import { children, metadata, xmlTree } from '../project-xml.js';
import { canonicalCutMesh } from '../project-bake-mesh.js';
const equal = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const area = (p) => Math.hypot(...cross(sub(p[1], p[0]), sub(p[2], p[0]))) / 2;
async function fails(fn, pattern) {
  try {
    await fn();
  } catch (e) {
    assert(pattern.test(e.message), e.stack);
    return;
  }
  throw new Error('invalid conversion accepted');
}

Deno.test('bake: default material policy warns while retaining painting and inherited assignments', async () => {
  for (const [partSlot, objectSlot] of [['2', '1'], ['0', '2'], ['0', '0']]) {
    const { model, expected } = bakeFixture();
    const component = model.components.find((c) => c.kind === 'model');
    component.objectSettings = [['extruder', objectSlot], ['sparse_infill_filament', '2']];
    component.settings[0].metadata = [
      ['extruder', partSlot], ['wall_filament', '1'], ['solid_infill_filament', '0'],
    ];
    const before = JSON.stringify(model), originalSettings = structuredClone(component.settings[0]);
    const baked = await bakeProjectNegatives(model, expected, { filamentCount: 2 });
    assert(baked.materialPolicy === 'base-material-on-cuts');
    assert(baked.warnings.length === 1);
    assert(/may differ/.test(baked.warnings[0]) && /inspect the sliced preview/.test(baked.warnings[0]));
    assert(/manually correct painting or material assignments/.test(baked.warnings[0]));
    assert(JSON.stringify(model) === before, 'the warning policy changed source data');
    assert(JSON.stringify(baked.parts[0].settings) === JSON.stringify(originalSettings), 'inherited settings were flattened');
    const part = baked.parts[0];
    assert(part.triangleAttributes.some((a) => a.paint_color === '4'));
    assert(part.triangleAttributes.some((a) => a.paint_color === '8'));
    let cutArea = 0;
    for (let f = 0; f < part.sourceFaces.length; f++) {
      if (part.sourceFaces[f] !== -1) continue;
      assert(Object.keys(part.triangleAttributes[f]).length === 0, 'new cut faces gained invented painting');
      cutArea += area(triangle(part.positions, f));
    }
    assertClose(cutArea, 100, 1e-6);
  }
});

Deno.test('bake: default material warning cannot replace invalid-assignment rejection', async () => {
  const { model, expected } = bakeFixture();
  model.components.find((c) => c.kind === 'model').settings[0].metadata.push(['solid_infill_filament', '3']);
  await fails(() => bakeProjectNegatives(model, expected, { filamentCount: 2 }), /unavailable filament assignment/);
});

for (const mirror of [false, true]) {
  Deno.test(`bake: cut paint regions and original corner order, mirror=${mirror}`, async () => {
    const { model, expected } = bakeFixture({ mirror });
    const before = model.positions.slice(), ordinary = await cutNegatives(model);
    const baked = await bakeProjectNegatives(model, expected, { filamentCount: 2 });
    assert(equal(baked.analysisPositions, ordinary.positions), 'paint tessellation changed support analysis');
    assert(equal(model.positions, before), 'original mesh was modified');
    assert(baked.parts.length === 1);
    const part = baked.parts[0];
    let first = 0, second = 0, newWall = 0;
    for (let f = 0; f < part.triangleAttributes.length; f++) {
      const points = triangle(part.positions, f).map(([x, y, z]) => [mirror ? 20 - x : x, y, z]);
      const attrs = part.triangleAttributes[f];
      if (points.every((p) => Math.abs(p[2] - 10) < 1e-6)) {
        const state = decodePaint(attrs.paint_color ?? '')[0].state;
        // Independent analytic region: first original top triangle splits on
        // y=x/2. Cutting x>7 leaves exactly 49/4 square mm of filament slot 1.
        if (state === 1) {
          assert(points.every(([x, y]) => y <= x / 2 + 1e-6), 'slot 1 crossed its paint boundary');
          first += area(points);
        } else {
          assert(
            state === 2 && points.every(([x, y]) => y >= x / 2 - 1e-6),
            'slot 2 crossed its paint boundary',
          );
          second += area(points);
        }
        if (attrs.paint_supports) assert(decodePaint(attrs.paint_supports)[0].state === state);
        if (attrs.paint_seam) assert(decodePaint(attrs.paint_seam)[0].state === state);
      }
      if (points.every((p) => Math.abs(p[0] - 7) < 1e-6)) {
        assert(
          !attrs.paint_color && !attrs.paint_supports && !attrs.paint_seam,
          'new cut surface retained cutter painting',
        );
        newWall += area(points);
      }
    }
    assertClose(first, 12.25, 1e-6);
    assertClose(second, 57.75, 1e-6);
    assertClose(newWall, 100, 1e-6);
    assert(part.settings.metadata.some(([k, v]) => k === 'extruder' && v === '2'));
    assert(part.settings.metadata.some(([k, v]) => k === 'wall_filament' && v === '1'));
  });
}

Deno.test('bake: coplanar provenance hints cannot overwrite neighboring face painting', async () => {
  const { model } = bakeFixture();
  const component = model.components[0], cut = await cutNegatives(model, { provenance: true });
  // Deliberately point every retained top face at the first top source face.
  // This is allowed by a coplanar boolean merge, but not sufficient for paint.
  for (let f = 0; f < cut.sourceFaces.length; f++) {
    if (triangle(cut.positions, f).every((p) => p[2] === 10)) cut.sourceFaces[f] = 2;
  }
  const mapped = remapProjectPaint(component, cut, 2);
  let total = 0;
  for (let f = 0; f < mapped.triangleAttributes.length; f++) {
    const p = triangle(mapped.positions, f);
    if (p.every((v) => v[2] === 10) && mapped.triangleAttributes[f].paint_color === '4') total += area(p);
  }
  assertClose(total, 12.25, 1e-6);
});

Deno.test('bake: component-scoped paint reuse preserves results and validates every cut', async () => {
  for (const options of [{}, { mirror: true, paint: '480C0381' }]) {
    const { model } = bakeFixture(options), component = model.components[0];
    const cut = await cutNegatives(model, { provenance: true });
    const expected = remapProjectPaint(component, cut, 3),
      remap = prepareProjectPaint(component, 3);
    for (let pass = 0; pass < 3; pass++) {
      const actual = remap(cut);
      assert(equal(actual.positions, expected.positions));
      assert(equal(actual.sourceFaces, expected.sourceFaces));
      assert(
        JSON.stringify(actual.triangleAttributes) ===
          JSON.stringify(expected.triangleAttributes),
      );
    }
    await fails(
      () => remap({ ...cut, sourceFaces: new Int32Array([0]) }),
      /missing subtraction face provenance/,
    );
    const invalid = cut.sourceFaces.slice();
    invalid[0] = component.sourceFaces.length;
    await fails(
      () => remap({ ...cut, sourceFaces: invalid }),
      /invalid subtraction face provenance/,
    );
    assert(
      equal(remap(cut).positions, expected.positions),
      'a rejected cut poisoned the prepared component',
    );
  }
});

Deno.test('bake: float64 provenance cannot absorb a thin neighboring painted region', () => {
  const { model } = bakeFixture({ paint: '4' }), original = model.components[0];
  const component = {
    ...original,
    positions: Float64Array.from(
      original.positions,
      (v, i) => v + (i % 3 === 2 ? 0 : 1000),
    ),
  };
  const positions = [], sourceFaces = [], center = [1005, 1005.00001, 10];
  for (let f = 0; f < component.positions.length / 9; f++) {
    if (f === 2 || f === 3) continue;
    positions.push(...component.positions.subarray(f * 9, f * 9 + 9));
    sourceFaces.push(f);
  }
  const corners = [[1000, 1000, 10], [1010, 1000, 10], [1010, 1010, 10], [
    1000,
    1010,
    10,
  ]];
  for (let i = 0; i < 4; i++) {
    positions.push(...corners[i], ...corners[(i + 1) % 4], ...center);
    sourceFaces.push(i < 2 ? 2 : 3);
  }
  const cut = {
    positions: new Float64Array(positions),
    sourceFaces: new Int32Array(sourceFaces),
  };
  const mapped = prepareProjectPaint(component, 2, { precision: 'float64' })(
    cut,
  );
  const states = new Set();
  for (let f = 0; f < mapped.triangleAttributes.length; f++) {
    const points = triangle(mapped.positions, f);
    if (!points.every((p) => p[2] === 10)) continue;
    const state = decodePaint(mapped.triangleAttributes[f].paint_color ?? '')[0].state;
    states.add(state);
    assert(
      points.every(([x, y]) => state === 1 ? y <= x + 1e-10 : state === 2 && y >= x - 1e-10),
    );
  }
  assert(
    states.has(1) && states.has(2),
    'a narrow painted region was lost to the provenance tolerance',
  );
});

Deno.test('bake: fully proved uniform coverage retains the original Boolean triangles', () => {
  const { model } = bakeFixture({ paint: '4' }), component = model.components[0];
  component.source.triangleAttributes = Array.from({ length: component.source.indices.length / 3 }, () => ({ paint_color: '4' }));
  const positions = [], sourceFaces = [], centre = [5, 6, 10];
  for (let f = 0; f < component.positions.length / 9; f++) {
    if (f === 2 || f === 3) continue;
    positions.push(...component.positions.subarray(f * 9, f * 9 + 9));
    sourceFaces.push(f);
  }
  const corners = [[0, 0, 10], [10, 0, 10], [10, 10, 10], [0, 10, 10]];
  for (let i = 0; i < corners.length; i++) {
    positions.push(...corners[i], ...corners[(i + 1) % 4], ...centre);
    sourceFaces.push(2); // Deliberately spans the original coplanar diagonal.
  }
  const cut = { positions: Float64Array.from(positions), sourceFaces: Int32Array.from(sourceFaces) };
  const result = remapProjectPaint(component, cut, 2, { precision: 'float64' });
  assert(equal(result.positions, cut.positions), 'invisible source diagonal changed the exported mesh');
  assert(result.triangleAttributes.every((a) => a.paint_color === '4'));
  canonicalCutMesh(result);
});

Deno.test('bake: separate parts, identical material colours and extended filament slots retain identity', async () => {
  const { model, expected } = bakeFixture({ second: true, material: true, paint: '42FC1' });
  const result = await bakeProjectNegatives(model, expected, { filamentCount: 20 });
  assert(result.parts.length === 2 && result.parts.map((p) => p.source.partId).join(',') === '1,2');
  assert(result.parts[0].triangleAttributes.some((a) => a.paint_color === '2FC'));
  assert(result.parts[0].properties[0].children.length === 2, 'same-color material slots collapsed');
  assert(result.parts[0].objectAttributes.pid === '99' && result.parts[0].objectAttributes.pindex === '0');
  assert(result.parts[0].settings.metadata[0][1] === '2' && result.parts[1].settings.metadata[0][1] === '1');
});

Deno.test('bake: fully cut component can disappear, but the whole object cannot', async () => {
  const { model, expected } = bakeFixture({ second: true, cutters: [block(-1, 11, -1, 11, -1, 11)] });
  const result = await bakeProjectNegatives(model, expected, { filamentCount: 2 });
  assert(result.parts.length === 1 && result.parts[0].source.partId === '2');
  assert(result.removed.length === 1 && result.removed[0].objectId === '1');
  const whole = bakeFixture({ cutters: [block(-1, 11, -1, 11, -1, 11)] });
  await fails(
    () => bakeProjectNegatives(whole.model, whole.expected, { filamentCount: 2 }),
    /entire printable mesh/,
  );
});

Deno.test('bake: unsupported attributes, malformed paint and ambiguous materials fail conversion', async () => {
  for (
    const [options, message] of [
      [{ attributes: ' paint_fuzzy_skin="4"' }, /unsupported triangle attribute/],
      [{ attributes: ' unknown="copying would be unsafe"' }, /unsupported triangle attribute/],
      [{ paint: 'FC' }, /truncated/],
      [{ paint: '1C' }, /unavailable state/],
      [{ attributes: ' pid="7" p1="0"' }, /material resource/],
      [{ attributes: ' p2="1"' }, /ambiguous face material/],
      [{ material: true, attributes: ' p1="0" p2="1"' }, /per-corner material/],
    ]
  ) {
    const { model, expected } = bakeFixture(options);
    await fails(() => bakeProjectNegatives(model, expected, { filamentCount: 2 }), message);
  }
});

Deno.test('bake: incomplete or invalid per-component subtraction is never exported', async () => {
  for (const failure of ['partial', 'exception', 'nan']) {
    const { model, expected } = bakeFixture();
    let calls = 0;
    const cut = async (...args) => {
      calls++;
      if (calls === 1) return cutNegatives(...args);
      if (failure === 'exception') throw new Error('boolean failed');
      const result = await cutNegatives(...args);
      if (failure === 'partial') result.uncut = 1;
      else result.positions[0] = NaN;
      return result;
    };
    await fails(
      () => bakeProjectNegatives(model, expected, { filamentCount: 2, cut }),
      /incomplete|invalid geometry|boolean failed/,
    );
  }
});

for (const mirror of [false, true]) {
  Deno.test(`bake: internal export/reimport retains shape, paint and material identities; mirror=${mirror}`, async () => {
    const { model, expected, members } = bakeFixture({ mirror, second: true, material: true });
    const baked = await bakeProjectNegatives(model, expected, { filamentCount: 2 });
    const exported = bakeExportMembers(members, baked);
    const read = readThreeMFParts(exported.members, {
      withComponents: true,
      doublePrecision: true,
      outwardWinding: true,
    }).objects[0];
    assert(read.components.length === 2 && read.extras.length === 0, 'active cutters remain');
    for (let i = 0; i < read.components.length; i++) {
      const actual = read.components[i], intended = baked.parts[i];
      assert(actual.positions.length === intended.positions.length);
      for (let v = 0; v < actual.positions.length; v++) {
        assertClose(actual.positions[v], intended.positions[v], 1e-12);
      }
      for (let f = 0; f < intended.triangleAttributes.length; f++) {
        assert(
          JSON.stringify(actual.source.triangleAttributes[f] ?? {}) ===
            JSON.stringify(intended.triangleAttributes[f]),
          'paint changed on reimport',
        );
      }
      assert(actual.source.attributes.pid === '99' && actual.source.properties[0].children.length === 2);
      assert(actual.settings[0].metadata.some(([k, v]) => k === 'extruder' && v === String(i ? 1 : 2)));
    }
    for (const [name, bytes] of members) {
      if (name.startsWith('3D/Objects/')) {
        assert(exported.members.get(name) === bytes, 'original member rewritten');
      }
    }
  });
}

Deno.test('bake: body-only harness retains the effective filament when Bambu normalizes single-part objects', async () => {
  const { model, expected, members } = bakeFixture();
  const baked = await bakeProjectNegatives(model, expected, { filamentCount: 2 });
  const result = bakeExportMembers(members, baked);
  const config = xmlTree(new TextDecoder().decode(result.members.get('Metadata/model_settings.config')));
  assert(metadata(children(config, 'object')[0]).extruder === '2');
});

Deno.test('bake: nested paint and independent seam/support regions survive a crossing cutter', async () => {
  const { model, expected } = bakeFixture({ paint: '480C0381' });
  const baked = await bakeProjectNegatives(model, expected, { filamentCount: 3 });
  const p = baked.parts[0], areas = [0, 0, 0, 0];
  for (let f = 0; f < p.triangleAttributes.length; f++) {
    const points = triangle(p.positions, f);
    if (points.every((v) => v[2] === 10)) {
      areas[decodePaint(p.triangleAttributes[f].paint_color ?? '')[0].state] += area(points);
    }
  }
  // Analytic areas of the four nested regions after x>7 is removed.
  for (const [state, want] of [4, 6.25, 58.75, 1].entries()) assertClose(areas[state], want, 1e-6);
  assert(p.sourceFaces.length === p.triangleAttributes.length && p.sourceFaces.some((f) => f === -1));
});

Deno.test('bake: rotated, translated and nonuniformly scaled parts preserve paint boundaries', async () => {
  const c = Math.SQRT1_2;
  const { model, expected } = bakeFixture({ transform: `${2 * c} ${2 * c} 0 ${-c} ${c} 0 0 0 3 100 200 0` });
  const baked = await bakeProjectNegatives(model, expected, { filamentCount: 2 });
  const p = baked.parts[0];
  const originalCut = canonicalCutMesh(
    await cutNegatives(model, { provenance: true }),
  );
  for (let v = 0; v < originalCut.positions.length; v += 3) {
    const old = originalCut.positions.subarray(v, v + 3);
    let nearest = Infinity;
    for (let i = 0; i < p.positions.length; i += 3) {
      nearest = Math.min(
        nearest,
        Math.hypot(...old.map((n, a) => n - p.positions[i + a])),
      );
    }
    assertClose(
      nearest,
      0,
      1e-10,
      'paint remapping moved an existing boolean vertex',
    );
  }
  let first = 0, total = 0;
  for (let f = 0; f < p.triangleAttributes.length; f++) {
    const points = triangle(p.positions, f);
    if (points.every((v) => Math.abs(v[2] - 30) < 1e-6)) {
      total += area(points);
      if (p.triangleAttributes[f].paint_color === '4') first += area(points);
    }
  }
  assertClose(first, 24.5, 0.002);
  assertClose(total, 140, 0.002);
});

Deno.test('bake: exact zero-area export artifacts are canonicalized without changing a surface', () => {
  const body = block(0, 10, 0, 10, 0, 10), positions = new Float32Array(body.length + 18);
  positions.set(body);
  positions.set([0, 0, 0, 0, 0, 0, 0, 10, 0, 0, 10, 0, 0, 0, 0, 0, 0, 0], body.length);
  const result = canonicalCutMesh({
    positions,
    sourceFaces: Int32Array.from({ length: positions.length / 9 }, (_, i) => i),
  });
  assert(result.collapsedFaces === 2 && equal(result.positions, body));
  assert(result.sourceFaces.length === 12 && result.sourceFaces.every((f, i) => f === i));
});

Deno.test('bake: cancellation cannot erase a positive-area face or its provenance', () => {
  const d = 2 ** -27;
  // Rounded products cancel, although the exact determinant is 2^-54.
  const points = [[0, 0, 0], [1, 1 - d, 0], [1 + d, 1, 0], [0, 0, 1]];
  assert(1 - (1 - d) * (1 + d) === 0);
  const faces = [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]];
  for (const reverse of [false, true]) {
    const positions = Float64Array.from(faces.flatMap((f) =>
      (reverse ? f.toReversed() : f).flatMap((v) => points[v])));
    const sourceFaces = new Int32Array([17, 4, 29, 6]);
    const result = canonicalCutMesh({ positions, sourceFaces });
    assert(result.collapsedFaces === 0, 'a positive-area facet was removed');
    assert(result.positions === positions, 'original coordinates changed');
    assert(result.sourceFaces === sourceFaces, 'source face identity changed');
  }
});

Deno.test('bake: canonicalization cannot repair an open or inconsistently wound mesh', async () => {
  const p = block(0, 10, 0, 10, 0, 10), f = Int32Array.from({ length: 12 }, (_, i) => i);
  await fails(() => canonicalCutMesh({ positions: p.subarray(9), sourceFaces: f.subarray(1) }), /not closed/);
  const reversed = p.slice();
  reversed.set(p.subarray(3, 6), 6);
  reversed.set(p.subarray(6, 9), 3);
  await fails(() => canonicalCutMesh({ positions: reversed, sourceFaces: f }), /not closed/);
});

Deno.test('bake: an exactly collinear boolean face becomes matching edge subdivisions, without moving vertices', async () => {
  const body = block(0, 10, 0, 10, 0, 10), p = Array.from(body.subarray(0, 18));
  const a = [0, 0, 10], b = [10, 0, 10], c = [10, 10, 10], m = [5, 0, 10];
  // Top has A-M and M-B; front still has B-A. A-B-M is a zero-area
  // topological bridge, like a face collapsed by float32 boolean export.
  p.push(...a, ...m, ...c, ...m, ...b, ...c, ...a, ...b, ...m, ...body.subarray(27));
  const positions = Float32Array.from(p),
    sourceFaces = Int32Array.from({ length: p.length / 9 }, (_, i) => i);
  const result = canonicalCutMesh({ positions, sourceFaces });
  assert(result.collapsedFaces === 1 && result.positions.length === positions.length);
  assert(!result.sourceFaces.includes(4), 'zero-area face was retained');
  let surface = 0;
  const allowed = new Set(
    Array.from(
      { length: positions.length / 3 },
      (_, i) => Array.from(positions.subarray(i * 3, i * 3 + 3)).join(','),
    ),
  );
  for (let f = 0; f < result.sourceFaces.length; f++) {
    const t = triangle(result.positions, f);
    assert(area(t) > 0);
    surface += area(t);
    for (const v of t) assert(allowed.has(v.join(',')), 'a vertex was moved or invented');
  }
  assertClose(surface, 600, 1e-12);
  await fails(
    () => canonicalCutMesh({ positions: positions.subarray(9), sourceFaces: sourceFaces.subarray(1) }),
    /not closed/,
  );
});

Deno.test('bake: closed edge counts cannot hide two shells pinched at a single vertex', async () => {
  const p = new Float32Array([...block(0, 1, 0, 1, 0, 1), ...block(1, 2, 1, 2, 1, 2)]);
  await fails(
    () => canonicalCutMesh({ positions: p, sourceFaces: new Int32Array(p.length / 9) }),
    /nonmanifold vertex/,
  );
});

Deno.test('bake: near-collinear float32 output uses geometric containment rather than an unstable normal', () => {
  const { model } = bakeFixture(), component = model.components[0];
  const positions = new Float32Array([1, 2, 10, 2, 4, 10, 2.000001, 4, 10]);
  const result = remapProjectPaint(component, { positions, sourceFaces: new Int32Array([3]) }, 2);
  assert(equal(result.positions, positions), 'paint mapping changed boolean coordinates');
  assert(result.triangleAttributes[0].paint_color === '8');
});

Deno.test('bake: a shared paint edge cannot become a fictitious region through projection', () => {
  const a = Math.fround(1.6), b = Math.fround(1.8);
  const left = [[0, 0, 0], [5, 0, 0], [5, 0, 10]];
  const right = [[5, 0, a], [10, 0, b], [5, 0, b]];
  const f = frame(right), boundary = left.map(f.project);
  if (polygonArea(boundary) < 0) boundary.reverse();
  assert(
    clipPolygon(right.map(f.project), boundary).length === 0,
    'shared edge gained paint area',
  );
  // A real, narrow overlap must still survive. No size cutoff hides the
  // projection artifact; it previously appeared even on exactly disjoint faces.
  const overlap = right.map((
    [x, y, z],
  ) => [x === 5 ? Math.fround(5 - 0.000001) : x, y, z]);
  assert(
    clipPolygon(overlap.map(f.project), boundary).length >= 3,
    'real paint region discarded',
  );
});

Deno.test('bake: projected coordinates round-trip on all dominant axes and windings', () => {
  for (
    const t of [
      [[1, 2, 3], [5, 3, 4], [2, 6, 5]],
      [[3, 1, 2], [4, 5, 3], [5, 2, 6]],
      [[2, 3, 1], [3, 4, 5], [6, 5, 2]],
    ]
  ) {
    for (const points of [t, t.toReversed()]) {
      const f = frame(points);
      assert(polygonArea(points.map(f.project)) > 0);
      for (const p of points) {
        const q = f.world(f.project(p));
        for (let axis = 0; axis < 3; axis++) {
          assertClose(p[axis], q[axis], 1e-12);
        }
      }
    }
  }
});

Deno.test('bake: paint subdivision preserves distinct nearby vertices of an unpainted face', () => {
  const { model } = bakeFixture(), component = model.components[0];
  const [a, b] = triangle(component.positions, 6);
  const middle = a.map((n, i) => Math.fround(n + (b[i] - n) * 1e-7));
  const same = (p, q) => p.every((n, i) => n === q[i]);
  assert(!same(a, middle) && !same(b, middle));
  const positions = [], sourceFaces = [];
  // Split both sides of a shared edge to make a valid, closed mesh with a
  // short edge. Its actual coordinates are distinct at float32 precision.
  for (let face = 0; face < component.positions.length / 9; face++) {
    const t = triangle(component.positions, face);
    const edge = t.findIndex((p, i) =>
      (same(p, a) && same(t[(i + 1) % 3], b)) ||
      (same(p, b) && same(t[(i + 1) % 3], a))
    );
    if (edge === -1) {
      positions.push(...t.flat());
      sourceFaces.push(face);
    } else {
      const [u, v, w] = [0, 1, 2].map((k) => t[(edge + k) % 3]);
      positions.push(...u, ...middle, ...w, ...middle, ...v, ...w);
      sourceFaces.push(face, face);
    }
  }
  const cut = {
    positions: Float32Array.from(positions),
    sourceFaces: Int32Array.from(sourceFaces),
  };
  canonicalCutMesh(cut);
  const result = remapProjectPaint(component, cut, 2);
  canonicalCutMesh(result);
  assert(
    Array.from(
      { length: result.positions.length / 3 },
      (_, i) => same(result.positions.subarray(i * 3, i * 3 + 3), middle),
    ).some(Boolean),
    'a valid unpainted mesh vertex was collapsed by paint welding',
  );
});

Deno.test('bake: paint conformity does not join unrelated original mesh edges', () => {
  // Two separately closed shells touch geometrically, but have no shared mesh
  // edges or vertices. Global insertion would join their touching edges into
  // an edge with four incident faces. Preserve the supplied topology instead.
  const positions = new Float64Array([
    ...block(0, 1, 0, 1, 0, 1),
    ...block(1, 2, 0.25, 0.75, 0, 0.5),
  ]);
  const sourceFaces = Int32Array.from(
    { length: positions.length / 9 },
    (_, i) => i,
  );
  canonicalCutMesh({ positions, sourceFaces });
  const polygons = Array.from(sourceFaces, (face) => ({
    points: triangle(positions, face),
    attributes: { paint_color: face < 12 ? '4' : '8' },
    sourceFace: face,
    outputFace: face,
  }));
  const result = conformPolygons(polygons, 64 * Number.EPSILON, positions);
  assert(
    equal(result.positions, positions),
    'paint conformity changed original topology',
  );
  assert(equal(result.sourceFaces, sourceFaces));
  assert(
    result.triangleAttributes.every((a, face) => a.paint_color === (face < 12 ? '4' : '8')),
  );
  canonicalCutMesh(result);
});

Deno.test('bake: conformity preserves original vertices closer than subdivision roundoff', () => {
  // This closed tetrahedron is thin, not degenerate. Two original vertices
  // lie inside the arithmetic tolerance used for *new* subdivision points.
  const points = [[1, 1, 0], [1 + 2 ** -50, 1, 0], [1, 2, 0], [1, 1, 1]];
  const faces = [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]];
  const positions = Float64Array.from(faces.flatMap((f) => f.flatMap((v) => points[v])));
  const polygons = faces.map((_, outputFace) => ({
    points: triangle(positions, outputFace), attributes: { paint_color: '8' }, outputFace,
  }));
  const result = conformPolygons(polygons, 128 * Number.EPSILON, positions);
  assert(equal(result.positions, positions), 'existing coordinates were welded or moved');
  assert(result.triangleAttributes.every((a) => a.paint_color === '8'));
  canonicalCutMesh({ ...result, sourceFaces: new Int32Array(4) });
});

Deno.test('bake: a positive-area painted face has no minimum area cutoff', () => {
  const s = 2 ** -50;
  const points = [[0, 0, 0], [s, 0, 0], [0, s, 0], [0, 0, 1]];
  const faces = [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]];
  const positions = Float64Array.from(faces.flatMap((f) => f.flatMap((v) => points[v])));
  const result = conformPolygons(faces.map((_, outputFace) => ({
    points: triangle(positions, outputFace), attributes: { paint_color: '4' }, outputFace,
  })), 64 * Number.EPSILON, positions);
  assert(equal(result.positions, positions), 'valid tiny surface was changed');
  canonicalCutMesh({ ...result, sourceFaces: new Int32Array(4) });
});
