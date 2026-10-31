// Body-only conversion harness, independent of the production sequential path
// (project-sequential.js), for testing baking before fins are attached.
import { bakedPartXML } from '../project-bake-xml.js';
import { child, children, editXML, escapeXML, insert, xmlTree } from '../project-xml.js';
const ROOT = '3D/3dmodel.model', CONFIG = 'Metadata/model_settings.config';
const identity = '1 0 0 0 1 0 0 0 1 0 0 0';
const enc = new TextEncoder(), dec = new TextDecoder();
const raw = (s) => String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;');
const attributes = (attrs) => Object.entries(attrs).map(([k, v]) => ` ${k}="${raw(v)}"`).join('');

export function bakeExportMembers(members, conversion, buildIndex = 0) {
  const root = dec.decode(members.get(ROOT)), config = dec.decode(members.get(CONFIG));
  const rootTree = xmlTree(root), configTree = xmlTree(config);
  const item = children(child(rootTree, 'build'), 'item')[buildIndex];
  const object = children(child(rootTree, 'resources'), 'object').find((o) =>
    o.attrs.id === item.attrs.objectid
  );
  const own = children(configTree, 'object').find((o) => o.attrs.id === item.attrs.objectid);
  const transform = (item.attrs.transform ?? identity).split(/\s+/).map(Number);
  const components = child(object, 'components'), sourceComponents = children(components, 'component');
  const originalParts = children(own, 'part');
  const negativeIDs = new Set(
    originalParts.filter((p) => p.attrs.subtype === 'negative_part').map((p) => p.attrs.id),
  );
  const normalRoutes = new Set([
    ...conversion.parts.map((p) => p.source.route[0]),
    ...conversion.removed.map((p) => p.route[0]),
  ]);
  const changes = new Map(), refs = [], partXML = [], mappings = [];
  const used = new Set([
    ...originalParts.map((p) => Number(p.attrs.id)),
    ...children(child(rootTree, 'resources'), 'object').map((p) => Number(p.attrs.id)),
    ...conversion.parts.flatMap((p) => p.properties.map((r) => Number(r.attributes.id))),
  ]);
  let next = Math.max(0, ...used) + 1;
  for (const part of conversion.parts) {
    const id = String(next++), path = `3D/SupportFins/converted-${item.attrs.objectid}-${id}.model`;
    if (members.has(path)) throw new Error('derived fixture path already exists');
    changes.set(path, enc.encode(bakedPartXML(part, id, transform)));
    refs.push(`<component objectid="${id}" p:path="/${path}" transform="${identity}"/>`);
    const attrs = Object.fromEntries(
      Object.entries(part.settings?.attributes ?? {}).filter(([k]) => !/^(id|uuid)$/i.test(k)),
    );
    attrs.id = id;
    attrs.subtype = 'normal_part';
    const metadata = part.settings?.metadata ?? [];
    partXML.push(
      `<part${attributes(attrs)}>` + metadata.filter(([k]) => k !== 'matrix' && !k.startsWith('source_'))
        .map(([k, v]) => `<metadata key="${raw(k)}" value="${raw(v)}"/>`).join('') +
        '<metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/></part>',
    );
    mappings.push({ id, path, source: part.source });
  }
  const kept = sourceComponents.filter((c, i) => !normalRoutes.has(i) && !negativeIDs.has(c.attrs.objectid));
  const rootEdits = [[
    components.start,
    components.end,
    `<components>${refs.join('')}${kept.map((c) => root.slice(c.start, c.end)).join('')}</components>`,
  ]];
  const normalIDs = new Set(
    sourceComponents.filter((_, i) => normalRoutes.has(i)).map((c) => c.attrs.objectid),
  );
  const configEdits = originalParts.filter((p) => normalIDs.has(p.attrs.id) || negativeIDs.has(p.attrs.id))
    .map((p) => [p.start, p.end, '']);
  // Bambu's importer erases a volume extruder override on single-volume
  // objects. This body-only validation export must promote the effective slot;
  // the eventual finned export has body and fin volumes and keeps both settings.
  if (conversion.parts.length === 1 && !kept.length) {
    const slot = conversion.parts[0].settings?.metadata.find(([k]) => k === 'extruder')?.[1];
    if (Number(slot) > 0) {
      const current = children(own, 'metadata').find((m) => m.attrs.key === 'extruder');
      const text = `<metadata key="extruder" value="${raw(slot)}"/>`;
      if (current) configEdits.push([current.start, current.end, text]);
      else partXML.unshift(text);
    }
  }
  for (const m of children(own, 'metadata')) {
    if ('face_count' in m.attrs) configEdits.push([m.start, m.end, '']);
  }
  configEdits.push(insert(own, partXML.join('')));
  changes.set(ROOT, enc.encode(editXML(root, rootEdits)));
  changes.set(CONFIG, enc.encode(editXML(config, configEdits)));
  const relPath = '3D/_rels/3dmodel.model.rels',
    relSource = members.has(relPath)
      ? dec.decode(members.get(relPath))
      : '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  const rel = xmlTree(relSource);
  changes.set(
    relPath,
    enc.encode(editXML(relSource, [insert(
      rel,
      mappings.map(({ id, path }) =>
        `<Relationship Id="converted-${
          escapeXML(id)
        }" Target="/${path}" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>`
      ).join(''),
    )])),
  );
  return { members: new Map([...members, ...changes]), changes, mappings };
}
