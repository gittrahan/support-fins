// Plan one baked object's manifest edits before publishing or checkpointing it.
// Original mesh members remain untouched; only this assembly's active references
// and part metadata change. Derived meshes and fins share its existing build item.
import { bakedPartXML } from './project-bake-xml.js';
import { child, children, meta } from './project-xml.js';

const identity = '1 0 0 0 1 0 0 0 1 0 0 0';
// Provenance settings are already XML-escaped by the geometry decoder.
const raw = (s) => String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;');
const attrs = (a) => Object.entries(a).map(([k, v]) => ` ${k}="${raw(v)}"`).join('');

export function sequentialEdits(baked, plan, { rootXML, configRoot, allocate, exists, prefix, support = '', disableNativeSupports = false }) {
  if (baked.compatibility?.buildIndex !== plan.number - 1 || baked.compatibility?.objectId !== plan.id ||
      !baked.parts?.length || !Array.isArray(baked.removed)) {
    throw new Error('baked conversion does not match the selected object');
  }
  const components = child(plan.object, 'components'), original = children(components, 'component');
  const parts = children(plan.config, 'part');
  const negativeIDs = new Set(parts.filter((p) => p.attrs.subtype === 'negative_part').map((p) => p.attrs.id));
  const routes = new Set([...baked.parts.map((p) => p.source), ...baked.removed].map((s) => {
    const index = s.route?.[0];
    if (!Number.isSafeInteger(index) || index < 0 || index >= original.length || negativeIDs.has(original[index].attrs.objectid)) {
      throw new Error('invalid baked component mapping');
    }
    return index;
  }));
  const normalIDs = new Set(original.filter((_, i) => routes.has(i)).map((c) => c.attrs.objectid));
  const refs = [], appended = [], members = new Map(), mappings = [];
  for (let index = 0; index < original.length; index++) {
    const component = original[index];
    if (negativeIDs.has(component.attrs.objectid)) continue;
    if (!routes.has(index)) { refs.push(rootXML.slice(component.start, component.end)); continue; }
    for (const part of baked.parts.filter((p) => p.source.route[0] === index)) {
      let id, path;
      do {
        id = allocate();
        path = `3D/SupportFins/converted-${plan.id}-${id}.model`;
      } while (exists(path) || members.has(path) || part.properties.some((r) => r.attributes.id === id));
      members.set(path, bakedPartXML(part, id, plan.transform));
      refs.push(`<component objectid="${id}" ${prefix}:path="/${path}" transform="${identity}"/>`);
      const attributes = Object.fromEntries(Object.entries(part.settings?.attributes ?? {})
        .filter(([k]) => !/^(id|uuid)$/i.test(k.split(':').pop())));
      Object.assign(attributes, { id, subtype: 'normal_part' });
      const metadata = (part.settings?.metadata ?? []).filter(([k]) =>
        k !== 'matrix' && k !== 'face_count' && !k.startsWith('source_') &&
        !(disableNativeSupports && k === 'enable_support'));
      appended.push(`<part${attrs(attributes)}>` + metadata
        .map(([k, v]) => `<metadata key="${raw(k)}" value="${raw(v)}"/>`).join('') +
        meta('matrix', '1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1') +
        (disableNativeSupports ? meta('enable_support', '0') : '') + '</part>');
      mappings.push({ id, path, source: part.source });
    }
  }
  const config = parts.filter((p) => normalIDs.has(p.attrs.id) || negativeIDs.has(p.attrs.id))
    .map((p) => [p.start, p.end, '']);
  for (const m of children(plan.config, 'metadata')) {
    if ('face_count' in m.attrs || m.attrs.key === 'face_count') config.push([m.start, m.end, '']);
  }
  // These indices and transforms describe the original volume meshes. Baking
  // changes both their coordinate frames and indices, so they must not restore
  // an old part/cutter transform onto a replacement body or the new fins.
  // Instance-level assembly placement and every unselected object stay intact.
  for (const assembly of children(configRoot, 'assemble')) {
    for (const item of children(assembly, 'assemble_item')) {
      if (item.attrs.object_id === plan.id && Object.hasOwn(item.attrs, 'volume_id')) {
        config.push([item.start, item.end, '']);
      }
    }
  }
  return {
    root: [[components.open, components.close, refs.join('') + support]], config, members, mappings,
    partsXML: appended.join(''),
    replacedParts: new Set(parts.filter((p) => normalIDs.has(p.attrs.id) || negativeIDs.has(p.attrs.id))),
  };
}
