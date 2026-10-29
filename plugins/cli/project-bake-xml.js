// Internal export primitive, exercised by the conversion harness. It does not
// enable a CLI path or edit a project's root/components/settings.
import { validateVertexIDs } from './project-bake-mesh.js';
const CORE = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
// Decoder metadata is already XML-escaped. Preserve entities, but normalize a
// literal double quote from a single-quoted source attribute for our writer.
const raw = (s) => String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;');
const attrs = (a) => Object.entries(a).map(([k, v]) => ` ${k}="${raw(v)}"`).join('');
const tree = (r) => `<${r.name}${attrs(r.attributes)}>${r.children.map(tree).join('')}</${r.name}>`;
const local = (s) => s.split(':').pop();

/** World-mm export geometry becomes a normal part in the unchanged root build
 * frame. An optional positionOrigin keeps generated coordinates relative until
 * placement is inverted, avoiding a lossy add-then-subtract of a large offset.
 * No decimal truncation: paint boundaries must not collapse in XML.
 * Resource IDs are scoped to this new member; caller allocates its member path
 * and root component ID without modifying any original/shared resource. */
export function bakedPartXML(part, id, transform = identity) {
  if (!/^\d+$/.test(String(id)) || Number(id) < 1 || !Number.isSafeInteger(Number(id))) {
    throw new Error('invalid derived part ID');
  }
  if (part.properties.some((r) => r.attributes.id === String(id))) {
    throw new Error('derived part ID collides with a material resource');
  }
  if (transform.length !== 12 || !transform.every(Number.isFinite)) {
    throw new Error('invalid derived part build transform');
  }
  const [a, b, c, d, e, f, g, h, i, tx, ty, tz] = transform;
  const origin = part.positionOrigin ?? [0, 0, 0];
  if (!Array.isArray(origin) || origin.length !== 3 || !origin.every(Number.isFinite)) {
    throw new Error('invalid derived part position origin');
  }
  const translation = [tx, ty, tz].map((v, k) => v - origin[k]);
  if (!translation.every(Number.isFinite)) throw new Error('unrepresentable derived part translation');
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) {
    throw new Error('singular derived part build transform');
  }
  const inv = [
    e * i - f * h,
    c * h - b * i,
    b * f - c * e,
    f * g - d * i,
    a * i - c * g,
    c * d - a * f,
    d * h - e * g,
    b * g - a * h,
    a * e - b * d,
  ].map((n) => n / det);
  const vertices = [], triangles = [], index = new Map();
  const p = part.positions;
  if (!p.length || p.length % 9 || part.triangleAttributes.length !== p.length / 9) {
    throw new Error('invalid derived part mesh');
  }
  if (part.vertexIDs !== undefined) validateVertexIDs(p, part.vertexIDs);
  for (let t = 0; t < p.length; t += 9) {
    const ids = [];
    for (let k = 0; k < 3; k++) {
      const off = t + k * 3,
        x = p[off] - translation[0], y = p[off + 1] - translation[1], z = p[off + 2] - translation[2];
      const v = [
        x * inv[0] + y * inv[3] + z * inv[6],
        x * inv[1] + y * inv[4] + z * inv[7],
        x * inv[2] + y * inv[5] + z * inv[8],
      ];
      if (!v.every(Number.isFinite)) throw new Error('nonfinite derived part coordinate');
      const key = part.vertexIDs ? part.vertexIDs[off / 3] : v.join(',');
      let n = index.get(key);
      if (n === undefined) {
        n = vertices.length;
        vertices.push(v);
        index.set(key, n);
      }
      ids.push(n);
    }
    if (det < 0) [ids[1], ids[2]] = [ids[2], ids[1]];
    if (new Set(ids.map((n) => vertices[n].join(','))).size !== 3) {
      throw new Error('derived part transform collapsed a triangle');
    }
    triangles.push(
      `<triangle v1="${ids[0]}" v2="${ids[1]}" v3="${ids[2]}"${attrs(part.triangleAttributes[t / 9])}/>`,
    );
  }
  const object = Object.fromEntries(
    Object.entries(part.objectAttributes).filter(([k]) => local(k) !== 'UUID'),
  );
  object.id = String(id);
  const model = { ...part.modelAttributes, xmlns: CORE, unit: 'millimeter' };
  return `<model${attrs(model)}><resources>${part.properties.map(tree).join('')}<object${attrs(object)}>` +
    `<mesh><vertices>${
      vertices.map(([x, y, z]) => `<vertex x="${x}" y="${y}" z="${z}"/>`).join('')
    }</vertices>` +
    `<triangles>${triangles.join('')}</triangles></mesh></object></resources></model>`;
}
