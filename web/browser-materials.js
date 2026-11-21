/** Browser-only material mapping. Destination slots are explicit slicer slots;
 * source identities and source paint are never deduplicated or recoloured. */
export const MATERIAL_FORM_IDS = [
  'match-contact-materials',
  'material-body',
  'material-fallback',
  'material-palette',
  'material-mapping',
];
const slot = (v, count) => /^\d+$/.test(String(v)) && Number.isSafeInteger(+v) && +v > 0 && +v <= count;
export function sourcePalette(field) {
  const slots = (field?.materials ?? []).filter((m) => m.kind === 'filament' && m.declared);
  if (slots.some((m) => !slot(m.slot, 255))) throw new Error('Invalid source filament slot');
  const count = slots.reduce((n, m) => Math.max(n, m.slot), 1);
  return Array.from({ length: count }, (_, i) => {
    const m = slots.find((m) => m.slot === i + 1);
    return {
      color: /^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(m?.displayColor)
        ? m.displayColor.slice(0, 7)
        : '#bdbdbd',
      name: m?.name ?? `Filament ${i + 1}`,
    };
  });
}
export function readPalette(text, field = null) {
  const palette = text ? JSON.parse(text) : sourcePalette(field);
  if (
    !Array.isArray(palette) || !palette.length || palette.length > 255 ||
    palette.some((p) => !p || !/^#[\da-f]{6}$/i.test(p.color) || typeof p.name !== 'string')
  ) throw new Error('Invalid destination filament palette');
  return palette.map((p) => ({ color: p.color, name: p.name }));
}
export function materialMapping(text) {
  const value = text ? JSON.parse(text) : {};
  if (
    !value || typeof value !== 'object' || Array.isArray(value) ||
    Object.values(value).some((v) => v !== '' && !slot(v, 255))
  ) throw new Error('Invalid source material mapping');
  return value;
}
export const materialKey = (field, id) => JSON.stringify([field?.key ?? '', id]);
export function mappedSlot(field, id, mapping, count) {
  if (id === null) return null;
  const key = materialKey(field, id), m = field?.materials.find((m) => m.id === id);
  const value = Object.hasOwn(mapping, key)
    ? mapping[key]
    : m?.kind === 'filament' && m.declared
    ? m.slot
    : null;
  return slot(value, count) ? +value : null;
}
export function browserMaterialOptions(form, field) {
  if (!form['match-contact-materials'] || form['tine-dir'] === 'vertical') return null;
  const palette = readPalette(form['material-palette'], field), count = palette.length;
  if (!slot(form['material-body'], count)) throw new Error('Choose an existing body filament');
  if (!slot(form['material-fallback'], count)) throw new Error('Choose an explicit fallback filament');
  const mapping = materialMapping(form['material-mapping']);
  const id = (source) => {
    const n = mappedSlot(field, source, mapping, count);
    return n === null ? null : `filament:${n}`;
  };
  return {
    bodyMaterial: `filament:${+form['material-body']}`,
    fallbackMaterial: `filament:${+form['material-fallback']}`,
    palette,
    regions: (field?.regions ?? []).map((r) => ({
      ...r,
      material: id(r.material),
      ...(r.roleMaterials
        ? {
          roleMaterials: Object.fromEntries(
            Object.entries(r.roleMaterials).map(([role, value]) => [role, id(value)]),
          ),
        }
        : {}),
    })),
  };
}
export function assignedBrowserParts(result, palette) {
  return {
    ...result,
    parts: result.parts.map(({ material, ...part }) => {
      const filament = /^filament:[1-9]\d*$/.test(material) ? +material.slice(9) : NaN;
      if (!slot(filament, palette.length)) throw new Error('Unmapped support material');
      return { ...part, filament };
    }),
  };
}
export function transformMaterialField(field, point) {
  return field &&
    { ...field, regions: field.regions.map((r) => ({ ...r, triangle: r.triangle.map(point) })) };
}
export function validateMaterialField(field) {
  if (
    !field || field.version !== 1 || typeof field.key !== 'string' || !Array.isArray(field.materials) ||
    !Array.isArray(field.regions)
  ) throw new Error('Invalid saved material field');
  const ids = new Set();
  for (const m of field.materials) {
    if (!m || typeof m.id !== 'string' || ids.has(m.id)) {
      throw new Error('Invalid saved material identity');
    }
    ids.add(m.id);
  }
  const identity = (id) => id === null || ids.has(id);
  for (const r of field.regions) {
    if (
      !identity(r.material) || r.triangle?.length !== 3 || r.triangle.some((p) =>
        p?.length !== 3 || !p.every(Number.isFinite)
      ) ||
      r.roleMaterials && Object.values(r.roleMaterials).some((id) => !identity(id))
    ) throw new Error('Invalid saved material region');
  }
  return field;
}
