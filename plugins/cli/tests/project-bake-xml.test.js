import { assert } from '../../../tests/_util.js';
import { bakedPartXML } from '../project-bake-xml.js';
import { child, children, xmlTree } from '../project-xml.js';
import { canonicalCutMesh } from '../project-bake-mesh.js';

const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const part = (positions, positionOrigin) => ({
  positions: Float64Array.from(positions),
  positionOrigin,
  properties: [],
  objectAttributes: {},
  modelAttributes: {},
  triangleAttributes: [{ paint_color: '8', paint_seam: '4', paint_supports: '8' }],
});
function read(xml) {
  const mesh = child(child(child(xmlTree(xml), 'resources'), 'object'), 'mesh');
  return {
    vertices: children(child(mesh, 'vertices'), 'vertex').map((v) =>
      ['x', 'y', 'z'].map((k) => Number(v.attrs[k]))
    ),
    face: children(child(mesh, 'triangles'), 'triangle')[0].attrs,
  };
}
function throws(fn, pattern) {
  try {
    fn();
  } catch (e) {
    assert(pattern.test(e.message), e.message);
    return;
  }
  throw new Error('invalid part accepted');
}
Deno.test('bake XML: origin inversion preserves distinct vertices lost by world addition', () => {
  const points = [0, -20, 10, -9, -7, 10, -9, -7 - 2 ** -50, 10];
  const transform = [...identity.slice(0, 9), 80, 80, 0];
  const translated = points.map((v, i) => v + transform[9 + i % 3]);
  assert(translated[4] === translated[7], 'fixture must demonstrate actual rounding loss');
  throws(() => bakedPartXML(part(translated), 1, transform), /collapsed a triangle/);
  const { vertices, face } = read(bakedPartXML(part(points, [80, 80, 0]), 1, transform));
  assert(vertices.flat().every((v, i) => v === points[i]));
  assert(vertices.length === 3 && new Set([face.v1, face.v2, face.v3]).size === 3);
  assert(face.paint_color === '8' && face.paint_seam === '4' && face.paint_supports === '8');
});
Deno.test('bake XML: relative origins retain rotation, mirroring and ordinary output', () => {
  const points = [1, 2, 3, 2, 2, 3, 1, 3, 3], origin = [80, 90, 4];
  for (const linear of [identity.slice(0, 9), [0, 1, 0, -1, 0, 0, 0, 0, 1], [-1, 0, 0, 0, 1, 0, 0, 0, 1]]) {
    const transform = [...linear, 77, 91, 2];
    const world = points.map((v, i) => v + origin[i % 3]);
    assert(bakedPartXML(part(points, origin), 1, transform) === bakedPartXML(part(world), 1, transform));
  }
  assert(bakedPartXML(part(points), 1) === bakedPartXML(part(points, [0, 0, 0]), 1));
});
Deno.test('bake XML: malformed origins and collapsed geometry still fail', () => {
  const points = [0, 0, 0, 1, 0, 0, 0, 1, 0];
  for (const origin of [[0, 0], [0, NaN, 0], [Infinity, 0, 0], '0,0,0']) {
    throws(() => bakedPartXML(part(points, origin), 1), /invalid derived part position origin/);
  }
  throws(
    () =>
      bakedPartXML(part(points, [-Number.MAX_VALUE, 0, 0]), 1, [
        ...identity.slice(0, 9),
        Number.MAX_VALUE,
        0,
        0,
      ]),
    /unrepresentable derived part translation/,
  );
  throws(() => bakedPartXML(part([0, 0, 0, 0, 0, 0, 1, 1, 0], [80, 80, 0]), 1), /collapsed a triangle/);
});

Deno.test('bake XML: explicit contact topology and painting round-trip under mirroring', () => {
  const vertices = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1],
    [0, 0, 0], [1, 0, 0], [0, -1, 0], [0, 0, -1]];
  const one = [0, 2, 1, 0, 1, 3, 1, 2, 3, 2, 0, 3];
  const ids = Uint32Array.from([...one, ...one.map((i) => i + 4)]);
  const input = { ...part(Array.from(ids).flatMap((i) => vertices[i])), vertexIDs: ids,
    sourceFaces: Int32Array.from({ length: 8 }, (_, i) => i),
    triangleAttributes: Array.from({ length: 8 }, (_, i) => ({ paint_color: i < 4 ? '4' : '8' })) };
  for (const sign of [1, -1]) {
    const xml = bakedPartXML(input, 1, [sign, 0, 0, 0, 1, 0, 0, 0, 1, 17, 23, 31]);
    const { vertices: output } = read(xml);
    assert(output.length === 8, 'distinct contact vertices were welded');
    const mesh = child(child(child(xmlTree(xml), 'resources'), 'object'), 'mesh');
    const faces = children(child(mesh, 'triangles'), 'triangle');
    const indices = Uint32Array.from(faces.flatMap((f, i) => {
      assert(f.attrs.paint_color === input.triangleAttributes[i].paint_color);
      return ['v1', 'v2', 'v3'].map((key) => Number(f.attrs[key]));
    }));
    const decoded = { positions: Float64Array.from(Array.from(indices).flatMap((i) => output[i])),
      sourceFaces: input.sourceFaces, vertexIDs: indices };
    assert(canonicalCutMesh(decoded).collapsedFaces === 0);
  }
});
Deno.test('bake XML: IDs cannot hide inconsistent coordinates or transform collapse', () => {
  const p = part([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  throws(() => bakedPartXML({ ...p, vertexIDs: Uint32Array.of(0, 0, 2) }, 1), /inconsistent/);
  throws(() => bakedPartXML({ ...p, vertexIDs: Uint32Array.of(0) }, 1), /identities/);
  const tiny = part([0, 0, 0, 2 ** -53, 0, 0, 0, 1, 0]);
  throws(() => bakedPartXML({ ...tiny, vertexIDs: Uint32Array.of(0, 1, 2) }, 1,
    [...identity.slice(0, 9), 10, 0, 0]), /collapsed a triangle/);
});
