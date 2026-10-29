import { block } from '../../../tests/_util.js';
import { meshXML, readThreeMFParts } from '../../../web/threemf.js';
const CORE = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const PROD = 'http://schemas.microsoft.com/3dmanufacturing/production/2015/06';
const triples = (p) => Array.from({ length: p.length / 3 }, (_, i) => Array.from(p.slice(i * 3, i * 3 + 3)));
export function bakeFixture(
  {
    mirror = false,
    transform = null,
    paint = '481',
    second = false,
    material = false,
    attributes = '',
    cutters = [block(7, 12, -1, 11, -1, 11)],
  } = {},
) {
  const body = (id, positions, annotation) =>
    `<object id="${id}" type="model"${material ? ' pid="99" pindex="0"' : ''}>` +
    meshXML(
      triples(positions),
      (face) =>
        (annotation && face === 2
          ? ` paint_color="${paint}" paint_supports="481" paint_seam="481"`
          : annotation && face === 3
          ? ' paint_color="8"'
          : '') + attributes,
    ) + '</object>';
  const members = {
    '3D/3dmodel.model':
      `<model xmlns="${CORE}" xmlns:p="${PROD}" unit="millimeter"><resources><object id="100"><components>` +
      '<component objectid="1" p:path="/3D/Objects/body.model"/>' +
      (second ? '<component objectid="2" p:path="/3D/Objects/body.model"/>' : '') +
      cutters.map((_, i) => `<component objectid="${10 + i}" p:path="/3D/Objects/cut.model"/>`).join('') +
      `</components></object></resources><build><item objectid="100"${
        transform || mirror ? ` transform="${transform ?? '-1 0 0 0 1 0 0 0 1 20 0 0'}"` : ''
      }/></build></model>`,
    '3D/Objects/body.model': `<model xmlns="${CORE}" unit="millimeter"><resources>` +
      (material
        ? '<basematerials id="99"><base name="white one" displaycolor="#FFFFFF"/><base name="white two" displaycolor="#FFFFFF"/></basematerials>'
        : '') +
      body(1, block(0, 10, 0, 10, 0, 10), true) +
      (second ? body(2, block(20, 25, 0, 5, 0, 5), false) : '') + '</resources></model>',
    '3D/Objects/cut.model': `<model xmlns="${CORE}" unit="millimeter"><resources>` +
      cutters.map((p, i) => body(10 + i, p, false)).join('') + '</resources></model>',
    'Metadata/model_settings.config': '<config><object id="100"><metadata key="extruder" value="1"/>' +
      '<part id="1" subtype="normal_part"><metadata key="extruder" value="2"/><metadata key="wall_filament" value="1"/></part>' +
      (second ? '<part id="2" subtype="normal_part"><metadata key="extruder" value="1"/></part>' : '') +
      cutters.map((_, i) => `<part id="${10 + i}" subtype="negative_part"/>`).join('') + '</object></config>',
  };
  const bytes = new Map(Object.entries(members).map(([k, v]) => [k, new TextEncoder().encode(v)]));
  const model = readThreeMFParts(bytes, {
    buildIndex: 0,
    withComponents: true,
    doublePrecision: true,
    outwardWinding: true,
  }).objects[0];
  return { model, members: bytes, expected: cutters.length };
}
