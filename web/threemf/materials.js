/** Optional categorical source-material field. IDs are local to this package;
 * display colours are labels, never identity or a nearest-colour lookup.
 * Raw source paint and the ordinary reader/exporter are not changed here.
 */
import { local, scanXML } from './common.js';
import { decodePaint } from '../paint-tree.js';

const WHOLE = [[0, 0], [1, 0], [0, 1]];
const text = (parts, name) => parts.has(name) ? new TextDecoder().decode(parts.get(name)) : null;
const integer = (v) => /^\d+$/.test(String(v)) && Number.isSafeInteger(Number(v)) ? Number(v) : null;
const decode = (v) => String(v ?? '').replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (all, key) => {
  if (key[0] !== '#') return ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' })[key] ?? all;
  const n = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
  return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all;
});

// Keep duplicate records: conflicting settings must not turn into last-wins.
function xmlSettings(xml, flavor) {
  const objects = new Map();
  let object, part;
  scanXML(xml ?? '', (tag, a, closed) => {
    const name = local(tag);
    if (name === 'object') {
      object = { settings: [], parts: [] };
      if (!objects.has(a.id)) objects.set(a.id, []);
      objects.get(a.id).push(object);
      if (closed) object = null;
    } else if (object && name === (flavor === 'prusa' ? 'volume' : 'part')) {
      part = { id: a.id, first: integer(a.firstid), last: integer(a.lastid), settings: [] };
      object.parts.push(part);
      if (closed) part = null;
    } else if (object && name === 'metadata' && a.key !== undefined) {
      (part ?? object).settings.push([a.key, decode(a.value)]);
    }
  }, (tag) => {
    const name = local(tag);
    if (name === 'object') object = part = null;
    else if (name === 'part' || name === 'volume') part = null;
  });
  return objects;
}

function list(value) {
  const out = []; let word = '', quoted = false, escape = false;
  for (const c of value) {
    if (escape) { word += c; escape = false; }
    else if (c === '\\') escape = true;
    else if (c === '"') quoted = !quoted;
    else if (c === ';' && !quoted) { out.push(word.trim()); word = ''; }
    else word += c;
  }
  if (quoted || escape) throw new Error('malformed filament list');
  out.push(word.trim()); return out;
}

function settingsPairs(value) {
  if (value === undefined) return [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid component settings');
  return Object.entries(value);
}

/** One reader per package/selected object; no global cache retains input meshes. */
export function createMaterialReader(parts, rootPath) {
  const catalog = new Map(), configIssues = [];
  const bambu = xmlSettings(text(parts, 'Metadata/model_settings.config'), 'bambu');
  const prusa = xmlSettings(text(parts, 'Metadata/Slic3r_PE_model.config'), 'prusa');
  const prusa3 = new Map();
  let orca = false;
  scanXML(text(parts, rootPath) ?? '', (tag, a) => {
    if (local(tag) === 'metadata' && a.name === 'OrcaSlicer') orca = true;
  }, () => {});
  let settings = {}, flavor = bambu.size ? 'bambu' : prusa.size ? 'prusa' : 'core';
  try {
    const json = text(parts, 'Metadata/project_settings.config');
    const ini = text(parts, 'Metadata/Slic3r_PE.config');
    if (json) {
      settings = JSON.parse(json); flavor = 'bambu';
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('invalid project settings');
    } else if (ini) {
      flavor = 'prusa';
      for (const line of ini.split(/\r?\n/)) {
        const m = line.match(/^\s*;?\s*([\w]+)\s*=\s*(.*?)\s*$/);
        if (m) {
          if (Object.hasOwn(settings, m[1]) && settings[m[1]] !== m[2]) throw new Error('conflicting project setting');
          settings[m[1]] = m[2];
        }
      }
      for (const key of ['filament_colour', 'filament_type', 'filament_settings_id']) {
        if (settings[key] !== undefined) settings[key] = list(settings[key]);
      }
    }
  } catch (error) { settings = {}; configIssues.push({ code: 'invalid-project-materials', detail: error.message }); }
  try {
    const json = text(parts, 'Metadata/PrusaSlicer3_project.json');
    if (json) {
      const data = JSON.parse(json);
      if (!Array.isArray(data?.objects)) throw new Error('invalid Prusa component settings');
      for (const object of data.objects) {
        if (!object || integer(object.id) === null || (object.volumes !== undefined && !Array.isArray(object.volumes))) throw new Error('invalid Prusa component record');
        const id = String(object.id);
        if (!prusa3.has(id)) prusa3.set(id, []);
        prusa3.get(id).push({ settings: settingsPairs(object.object_settings),
          parts: (object.volumes ?? []).map((v) => {
            if (!v || integer(v.id) === null) throw new Error('invalid Prusa volume record');
            return { id: String(v.id), settings: settingsPairs(v.volume_settings) };
          }) });
      }
    }
  } catch (error) { configIssues.push({ code: 'invalid-component-materials', detail: error.message }); }

  const colors = settings.filament_colour;
  const count = Array.isArray(colors) && colors.length && colors.every((c) => typeof c === 'string') ? colors.length : null;
  if (colors !== undefined && count === null) configIssues.push({ code: 'invalid-filament-palette', detail: 'filament_colour must be a nonempty string array' });
  // Names/types are descriptive only. Some slicers save just one profile name
  // for several slots. Missing descriptions must not merge or renumber slots.
  const slotId = (slot) => {
    if (!Number.isSafeInteger(slot) || slot < 1 || (count !== null && slot > count)) throw new Error(`unavailable filament slot ${slot}`);
    const id = `filament:${slot}`;
    if (!catalog.has(id)) catalog.set(id, { id, kind: 'filament', slot, declared: count !== null,
      displayColor: count === null ? null : colors[slot - 1],
      name: Array.isArray(settings.filament_settings_id) ? settings.filament_settings_id[slot - 1] ?? null : null,
      materialType: Array.isArray(settings.filament_type) ? settings.filament_type[slot - 1] ?? null : null });
    return id;
  };
  if (count !== null) for (let slot = 1; slot <= count; slot++) slotId(slot);

  const objects = (table, id) => table.get(String(id)) ?? [];
  const level = (records) => records.flatMap((r) => r.settings);
  const slotSetting = (levels, keys, inherited = null, explicitDefault = false) => {
    for (const pairs of levels) {
      const values = pairs.filter(([key]) => keys.includes(key)).map(([, v]) => integer(v));
      if (values.some((n) => n === null)) throw new Error(`invalid ${keys[0]} assignment`);
      const nonzero = [...new Set(values.filter((n) => n > 0))];
      if (nonzero.length > 1) throw new Error(`conflicting ${keys[0]} assignments`);
      if (nonzero.length) return slotId(nonzero[0]);
      // Bambu's explicit feature Default (0) selects the part filament and
      // blocks an object/global feature override. Base extruder 0 still inherits.
      if (explicitDefault && values.length) return inherited;
    }
    return inherited ?? (count === 1 ? slotId(1) : null);
  };
  const featureSlot = (levels, keys, base) => {
    if (orca) {
      let value = base, overridden = false;
      for (const pairs of levels.toReversed()) {
        const selections = pairs.filter(([key]) => keys.includes(key)).map(([key, raw]) => {
          const n = integer(raw);
          if (n === null) throw new Error(`invalid ${key} assignment`);
          return !key.endsWith('_id') && n === 1 ? 0 : n;
        });
        if (new Set(selections).size > 1) throw new Error(`conflicting ${keys[0]} assignments`);
        if (selections.length) {
          overridden = selections[0] > 0;
          if (overridden) value = slotId(selections[0]);
        }
        const own = pairs.filter(([key]) => key === 'extruder').map(([, raw]) => integer(raw));
        if (own.some((n) => n === null)) throw new Error('invalid extruder assignment');
        const positive = [...new Set(own.filter((n) => n > 0))];
        if (positive.length > 1) throw new Error('conflicting extruder assignments');
        if (positive.length && !overridden) value = slotId(positive[0]);
      }
      return value;
    }
    if (flavor !== 'prusa') return slotSetting(levels, keys, base, flavor === 'bambu');
    // Prusa applies an explicit part/object extruder to all feature roles at
    // that level, then applies positive feature overrides at the same level.
    // Thus a part extruder takes precedence over a parent's feature filament.
    for (const pairs of levels) for (const names of [keys, ['extruder']]) {
      const values = pairs.filter(([key]) => names.includes(key)).map(([, v]) => integer(v));
      if (values.some((v) => v === null)) throw new Error(`invalid ${names[0]} assignment`);
      const positive = [...new Set(values.filter((v) => v > 0))];
      if (positive.length > 1) throw new Error(`conflicting ${names[0]} assignments`);
      if (positive.length) return slotId(positive[0]);
    }
    return base;
  };

  function coreMaterial(component, attrs) {
    const source = component.source, pid = attrs.pid ?? source.attributes.pid;
    if (pid === undefined) {
      if (['p1', 'p2', 'p3'].some((key) => attrs[key] !== undefined)) throw new Error('core material index has no resource');
      return null;
    }
    const index = integer(attrs.p1 ?? source.attributes.pindex ?? 0);
    if (integer(pid) === null || index === null) throw new Error('invalid core material reference');
    const groups = source.properties.filter((p) => p.attributes.id === String(pid));
    if (groups.length !== 1) throw new Error('missing or conflicting core material resource');
    const group = groups[0], kind = local(group.name);
    if (!['basematerials', 'colorgroup'].includes(kind)) throw new Error(`unsupported material resource ${kind}`);
    if ([attrs.p2, attrs.p3].some((v) => v !== undefined && integer(v) !== index)) throw new Error('interpolated corner materials require an explicit mapping');
    const entry = group.children[index];
    if (!entry || local(entry.name) !== (kind === 'basematerials' ? 'base' : 'color')) throw new Error('core material index is out of range');
    const id = `resource:${JSON.stringify([component.path, String(pid), index])}`;
    if (!catalog.has(id)) catalog.set(id, { id, kind, path: component.path, resourceId: String(pid), index,
      name: decode(entry.attributes.name), displayColor: decode(entry.attributes.displaycolor ?? entry.attributes.color) || null });
    return id;
  }

  return (components, rootId) => {
    const issues = configIssues.map((i) => ({ ...i })), summaries = new Map();
    const note = (component, face, code, detail) => {
      const key = JSON.stringify([component, code, detail]);
      if (!summaries.has(key)) {
        const issue = { component, firstSourceFace: face, faces: 0, code, detail };
        summaries.set(key, issue); issues.push(issue);
      }
      summaries.get(key).faces++;
    };
    const roots = [...objects(bambu, rootId), ...objects(prusa, rootId), ...objects(prusa3, rootId)];
    const occurrences = components.map((component, componentIndex) => {
      const nativeParts = roots.flatMap((o) => o.parts).filter((p) => p.id === component.partId);
      const meshObjects = component.path === rootPath ? objects(prusa, component.objectId) : [];
      const ranges = meshObjects.flatMap((o) => o.parts);
      const invalidRanges = ranges.some((p) => p.first === null || p.last === null
        || p.first > p.last || p.last >= component.source.indices.length / 3);
      // Bambu/Orca discard a sole volume's extruder on import; its object owns
      // that assignment. Other part settings, including feature Default, remain.
      const partLevel = level(nativeParts).filter(([key]) => !(flavor === 'bambu' && components.length === 1 && key === 'extruder'));
      const baseLevels = [partLevel, level(roots), level(meshObjects), Object.entries(settings)];
      const cache = new Map();
      const faces = Array.from(component.sourceFaces, (sourceFace) => {
        const attrs = component.source.triangleAttributes[sourceFace] ?? {};
        const ownRanges = ranges.filter((p) => p.first !== null && p.last !== null && sourceFace >= p.first && sourceFace <= p.last);
        const levels = [level(ownRanges), ...baseLevels];
        const key = JSON.stringify([attrs, levels.map((p) => p.filter(([k]) => /extruder|filament(?:_id)?$/.test(k)))]);
        let value = cache.get(key);
        if (!value) {
          const problems = [];
          const attempt = (fn) => { try { return fn(); } catch (e) { problems.push(e.message); return null; } };
          const base = attempt(() => slotSetting(levels, ['extruder']));
          const core = attempt(() => coreMaterial(component, attrs));
          try {
            const roles = {
              wall: attempt(() => featureSlot(levels, ['wall_filament', 'perimeter_extruder', ...(orca ? ['outer_wall_filament_id', 'outer_wall_filament', 'wall_filament_id'] : [])], base)),
              infill: attempt(() => featureSlot(levels, ['sparse_infill_filament', 'infill_extruder', ...(orca ? ['sparse_infill_filament_id'] : [])], base)),
              solidInfill: attempt(() => featureSlot(levels, ['solid_infill_filament', 'solid_infill_extruder', ...(orca ? ['internal_solid_filament_id'] : [])], base)),
              ...(orca ? { bottomSurface: attempt(() => featureSlot(levels, ['bottom_surface_filament_id', 'bottom_solid_infill_filament'], base)) } : {}),
            };
            const paint = Object.entries(attrs).filter(([name]) => name === 'paint_color' || local(name) === 'mmu_segmentation');
            if (paint.length > 1) throw new Error('conflicting colour-paint channels');
            const format = paint[0]?.[0] === 'paint_color' ? 'bambu' : 'prusa';
            const leaves = paint.length ? decodePaint(paint[0][1], count ?? Number.MAX_SAFE_INTEGER, { format })
              : [{ triangle: WHOLE, state: 0 }];
            const inherited = core && base ? null : core ?? base;
            value = { base, core, roles, regions: leaves.map(({ triangle, state }) => ({ triangle,
              material: state > 0 ? slotId(state) : inherited, inherited: state === 0 })) };
            if (leaves.some((r) => r.state === 0) && core && base) problems.push('core resource has no explicit filament mapping');
            if (value.regions.some((r) => r.material === null)) problems.push('missing inherited material assignment');
            if (count === null && value.regions.some((r) => r.material?.startsWith('filament:'))) problems.push('filament palette is missing');
          } catch (error) {
            value = { base, core, roles: {}, regions: [{ triangle: WHOLE, material: null, inherited: true }] };
            problems.push(error.message);
          }
          if (invalidRanges) problems.push('invalid component triangle range');
          if (ownRanges.length > 1) problems.push('overlapping component triangle ranges');
          if (configIssues.length) problems.push('project material metadata is invalid');
          if (problems.length) value.unresolved = [...new Set(problems)].join('; ');
          cache.set(key, value);
        }
        if (value.unresolved) note(componentIndex, sourceFace, 'unresolved-material', value.unresolved);
        return value;
      });
      return { key: JSON.stringify([component.buildIndex, component.route, component.path, component.objectId]),
        kind: component.kind, sourceFaces: component.sourceFaces, cornerOrder: component.cornerOrder, faces };
    });
    return { version: 1, flavor, materials: [...catalog.values()], occurrences, issues,
      complete: !issues.length };
  };
}

/** Original paint coordinates mapped through the reader's mirrored corner order.
 * No nearest-face lookup or material interpolation is involved. */
export function worldMaterialRegions(component, localFace, faceMaterials) {
  if (!Number.isSafeInteger(localFace) || localFace < 0 || localFace >= component.sourceFaces.length) throw new Error('invalid material face');
  const corners = [];
  for (let k = 0; k < 3; k++) corners[component.cornerOrder[k]] = Array.from(component.positions.subarray(localFace * 9 + k * 3, localFace * 9 + k * 3 + 3));
  return faceMaterials.regions.map((region) => ({ ...region, triangle: region.triangle.map(([u, v]) =>
    corners[0].map((a, k) => a + u * (corners[1][k] - a) + v * (corners[2][k] - a))) }));
}
