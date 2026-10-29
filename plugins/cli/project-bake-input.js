// Internal archive-to-conversion boundary. No project, checkpoint or CLI output
// is written here; sequential export remains a separate integration.
import { createHash } from 'node:crypto';
import { ProjectZip } from './project-zip.js';
import { projectModel, negativeComponents } from './project-analysis.js';
import { bakeProjectNegatives } from './project-bake.js';
import { runtimeIdentity } from './project-cache.js';
import { child, children, xmlTree } from './project-xml.js';

const ROOT = '3D/3dmodel.model', CONFIG = 'Metadata/model_settings.config';
const digest = (value) => createHash('sha256').update(value).digest('hex');
const stable = (value) => Array.isArray(value) ? value.map(stable)
  : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;
const hashSettings = (value) => digest(JSON.stringify(stable(value)));
const roles = ['wall_filament', 'sparse_infill_filament', 'solid_infill_filament'];

function pairs(values) {
  if (new Set(values.map(([key]) => key)).size !== values.length) {
    throw new Error('duplicate converted object or part setting');
  }
  return Object.fromEntries(values);
}
function positive(value, key) {
  if (!['string', 'number'].includes(typeof value) || String(value).trim() === '' ||
      !Number.isFinite(Number(value)) || Number(value) <= 0) {
    throw new Error(`missing or invalid fixed layer setting: ${key}`);
  }
  return Number(value);
}
function slot(value, count, key) {
  if (!['string', 'number'].includes(typeof value) || !/^\d+$/.test(String(value)) ||
      !Number.isSafeInteger(Number(value)) || Number(value) > count) {
    throw new Error(`missing or unavailable filament assignment: ${key}`);
  }
  return Number(value);
}

function resolvedSettings(settings, component, count) {
  if (component.settings.length !== 1) throw new Error('missing or ambiguous converted part settings');
  const object = pairs(component.objectSettings), part = pairs(component.settings[0].metadata);
  const inherited = [part.extruder, object.extruder, settings.extruder]
    .filter((v) => v !== undefined).map((v) => slot(v, count, 'extruder')).find((v) => v > 0);
  const filament = inherited ?? (count === 1 ? 1 : null);
  if (filament === null) throw new Error('ambiguous inherited filament assignment');
  const merged = { ...settings, ...object, ...part };
  return {
    source: { path: component.path, objectId: component.objectId, route: [...component.route] },
    filament,
    roles: Object.fromEntries(roles.map((key) => [key, slot(merged[key], count, key) || filament])),
    layerHeight: positive(merged.layer_height, 'layer_height'),
    firstLayerHeight: positive(merged.initial_layer_print_height, 'initial_layer_print_height'),
  };
}

/** Convert one selected Bambu assembly using saved settings only. Input bytes
 * are read-only, and no decoded source meshes escape this call. Runtime identity
 * hashes source files (or the complete standalone bundle); the identity function
 * is injectable only for deterministic tests. This fingerprint is not a resume
 * record and does not change the existing checkpoint format. */
export async function bakeProjectObject(bytes, { buildIndex = 0, identity = runtimeIdentity } = {}) {
  if (!Number.isSafeInteger(buildIndex) || buildIndex < 0) throw new Error('invalid selected build index');
  const zip = new ProjectZip(bytes), rootBytes = await zip.read(ROOT), configBytes = await zip.read(CONFIG);
  const root = xmlTree(new TextDecoder().decode(rootBytes));
  const config = xmlTree(new TextDecoder().decode(configBytes));
  if (root.attrs.unit && root.attrs.unit !== 'millimeter') throw new Error('conversion requires millimeter units');
  if (!child(root, 'build') || !child(root, 'resources')) throw new Error('missing project build or resources');
  const items = children(child(root, 'build'), 'item'), item = items[buildIndex];
  if (!item || item.attrs.printable === '0') throw new Error('selected printable build item is missing');
  if (items.filter((i) => i.attrs.objectid === item.attrs.objectid).length !== 1) {
    throw new Error('shared build instances are not supported for conversion');
  }
  const objects = children(child(root, 'resources'), 'object').filter((o) => o.attrs.id === item.attrs.objectid);
  const configs = children(config, 'object').filter((o) => o.attrs.id === item.attrs.objectid);
  if (objects.length !== 1 || configs.length !== 1) throw new Error('missing or ambiguous selected object/settings');
  const object = objects[0], own = configs[0];
  if (!child(object, 'components') || child(object, 'mesh')) throw new Error('conversion requires a component assembly');
  for (const part of children(own, 'part')) {
    if (!['normal_part', 'negative_part'].includes(part.attrs.subtype)) {
      throw new Error('modifiers are not supported for conversion');
    }
  }
  // Conservative initial compatibility: do not infer profile ownership or
  // silently discard an unrecognized variable-layer record in an archive.
  for (const name of zip.entries.keys()) {
    if (/layer_heights_profile\.txt$/i.test(name) && (await zip.text(name)).trim()) {
      throw new Error('variable layer profiles are not supported for conversion');
    }
    if (/layer_config_ranges\.xml$/i.test(name) && children(xmlTree(await zip.text(name)), 'object').length) {
      throw new Error('layer setting ranges are not supported for conversion');
    }
  }
  const expected = negativeComponents(object, own);
  if (!expected) throw new Error('selected object has no negative parts to bake');
  const settings = JSON.parse(await zip.text('Metadata/project_settings.config'));
  if (!settings || typeof settings !== 'object' || Array.isArray(settings) ||
      !Array.isArray(settings.filament_colour) || !settings.filament_colour.length ||
      settings.filament_colour.some((color) => typeof color !== 'string' || !color)) {
    throw new Error('project filament slots are missing or invalid');
  }
  const model = await projectModel(zip, rootBytes, configBytes, { object, number: buildIndex + 1, negativeCount: expected });
  if (model.dropped || model.skipped) throw new Error('conversion cannot omit invalid or missing source faces');
  if (model.components.some((c) => !['model', 'negative'].includes(c.kind))) {
    throw new Error('unsupported component kind in conversion');
  }
  const materials = model.components.filter((c) => c.kind === 'model')
    .map((c) => resolvedSettings(settings, c, settings.filament_colour.length));
  if (new Set(materials.map((m) => m.layerHeight)).size !== 1 ||
      new Set(materials.map((m) => m.firstLayerHeight)).size !== 1) {
    throw new Error('conflicting fixed layer settings on converted parts');
  }
  const runtime = await identity();
  if (typeof runtime !== 'string' || !/^[a-f0-9]{64}$/.test(runtime)) throw new Error('invalid conversion runtime identity');
  const sourceSHA256 = digest(bytes);
  const settingsSHA256 = hashSettings({ settings, materials, object: model.components[0]?.objectSettings,
    parts: model.components.map((c) => ({ route: c.route, settings: c.settings })) });
  const runtimeVersions = globalThis.Deno?.version ?? globalThis.process?.versions;
  const fingerprint = hashSettings({ version: 1, sourceSHA256, settingsSHA256, buildIndex, runtime, runtimeVersions,
    materialPolicy: 'base-material-on-cuts' });
  const result = await bakeProjectNegatives(model, expected, { filamentCount: settings.filament_colour.length });
  return { ...result, sourceSHA256, settingsSHA256, fingerprint, runtime,
    compatibility: { target: 'Bambu Studio', fixedLayers: true, buildIndex, objectId: item.attrs.objectid,
      negativeOccurrences: expected, materials } };
}
