// Bambu project augmentation. Original meshes are only read for analysis: their
// bytes, painting and resource references never pass through a geometry writer.
import { computeFins, optionsFromDialog } from '../shared/engine/fins_entry.js';
import { readThreeMFParts, scanXML, meshXML } from '../../web/threemf.js';
import { ProjectZip } from './project-zip.js';
import { xmlTree, child, children, metadata, meta, attr, escapeXML as esc, insert, editXML } from './project-xml.js';

const ROOT = '3D/3dmodel.model', CONFIG = 'Metadata/model_settings.config';
const SETTINGS = 'Metadata/project_settings.config', MARKER = 'Metadata/support_fins_project.json';
const SUPPORTS = '3D/SupportFins/supports.model';
const CORE = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const PROD = 'http://schemas.microsoft.com/3dmanufacturing/production/2015/06';
const REL = 'http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel';
const enc = new TextEncoder();
const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const enabled = (v) => v === true || v === 1 || v === '1' || v === 'true';
const positive = (v) => typeof v !== 'boolean' && v != null && String(v).trim() !== '' && Number.isFinite(+v) && +v > 0;

function matrix(text) {
  const m = text ? text.trim().split(/\s+/).map(Number) : identity;
  if (m.length !== 12 || m.some((v) => !Number.isFinite(v))) throw new Error('invalid build transform');
  return m;
}

// Row-vector inverse: convert the engine's world-mm supports into the original
// build object's local frame. Its existing build transform is left untouched.
function inverse(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) throw new Error('singular build transform');
  return [(e * i - f * h), (c * h - b * i), (b * f - c * e),
    (f * g - d * i), (a * i - c * g), (c * d - a * f),
    (d * h - e * g), (b * g - a * h), (a * e - b * d)].map((v) => v / det);
}

function supportMesh(tris, offset, m) {
  const inv = inverse(m), points = [];
  for (let j = 0; j < tris.length; j += 3) {
    const x = tris[j] - offset.x - m[9], y = tris[j + 1] - offset.y - m[10], z = tris[j + 2] - offset.z - m[11];
    points.push([x * inv[0] + y * inv[3] + z * inv[6],
      x * inv[1] + y * inv[4] + z * inv[7], x * inv[2] + y * inv[5] + z * inv[8]]);
  }
  // A mirrored parent must also mirror the local winding to stay outward in world space.
  const determinant = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6])
    + m[2] * (m[3] * m[7] - m[4] * m[6]);
  if (determinant < 0) for (let j = 0; j < points.length; j += 3) [points[j + 1], points[j + 2]] = [points[j + 2], points[j + 1]];
  return meshXML(points);
}

function partPath(path) {
  const name = path.replace(/^\//, '');
  if (!name || name.includes('\\') || /[:?#%]/.test(name)
      || name.split('/').some((p) => !p || p === '..' || p === '.')) throw new Error(`unsupported model path: ${path}`);
  return name;
}

function pick(items, selectors) {
  if (!selectors.length) return items.filter((o) => o.printable);
  const chosen = new Set();
  for (const s of selectors) {
    const matches = /^\d+$/.test(s) ? items.filter((o) => o.number === +s) : items.filter((o) => o.name === s);
    if (matches.length !== 1) throw new Error(`object ${JSON.stringify(s)} is ${matches.length ? 'ambiguous' : 'missing'}; use --list-objects`);
    if (!matches[0].printable) throw new Error(`object ${s} is not printable`);
    chosen.add(matches[0]);
  }
  return items.filter((o) => chosen.has(o));
}

function regularHeight(settings, config, explicit, variable) {
  if (explicit !== undefined) return explicit;
  if (variable) throw new Error('variable layer heights need an explicit --layer-height for fin generation');
  const own = metadata(config);
  const base = own.layer_height ?? settings.layer_height;
  const heights = children(config, 'part').filter((p) => p.attrs.subtype === 'normal_part' || !p.attrs.subtype)
    .map((p) => metadata(p).layer_height ?? base);
  if (!heights.length) heights.push(base);
  if (heights.some((h) => !positive(h)) || new Set(heights.map(Number)).size !== 1) {
    throw new Error('missing or conflicting regular layer heights; supply --layer-height');
  }
  return +heights[0];
}

function filament(settings, config, explicit) {
  const count = Array.isArray(settings.filament_colour) ? settings.filament_colour.length : 0;
  const own = metadata(config);
  let n = explicit;
  if (n == null) {
    // Zero means inherited. Prefer the object's base, not a painted triangle.
    n = +own.extruder > 0 ? +own.extruder : null;
    if (n == null) {
      const slots = children(config, 'part').filter((p) => p.attrs.subtype === 'normal_part' || !p.attrs.subtype)
        .map((p) => +metadata(p).extruder).filter((v) => v > 0);
      const unique = [...new Set(slots)];
      if (unique.length === 1) n = unique[0];
      else if (unique.length === 0 && count === 1) n = 1;
    }
  }
  if (!Number.isInteger(n) || n < 1 || n > count) throw new Error(`cannot resolve an existing filament slot (1..${count}); supply --fin-extruder`);
  return n;
}

function setMetadata(node, key, value, edits, appended) {
  const existing = children(node, 'metadata').filter((m) => m.attrs.key === key);
  if (existing.length > 1) throw new Error(`duplicate ${key} setting`);
  if (existing.length) edits.push([existing[0].start, existing[0].end, meta(key, value)]);
  else appended.push(meta(key, value));
}

export async function finProject(input, args, io) {
  if (!/\.3mf$/i.test(input)) throw new Error('--preserve-project reads a Bambu Studio/MakerWorld .3mf');
  const output = args.output ?? input.replace(/\.3mf$/i, '-fins-project.3mf');
  if (!/\.3mf$/i.test(output)) throw new Error('--preserve-project writes a .3mf');
  if (!args.listObjects) {
    if (!io.checkProjectOutput || !io.writeProject) throw new Error('project output requires an atomic file-system writer');
    // In a batch, this output may alias a different input (including by hard link).
    // --overwrite authorizes replacing old outputs, never any of the source files.
    for (const source of args.inputs) await io.checkProjectOutput(source, output, args.overwrite);
  }
  const zip = new ProjectZip(await io.read(input));
  if (zip.entries.has(MARKER) || zip.entries.has(SUPPORTS)) throw new Error('this project already has generated fins; use the original project');
  const [rootXML, configXML, settingsText] = await Promise.all([zip.text(ROOT), zip.text(CONFIG), zip.text(SETTINGS)]);
  const root = xmlTree(rootXML), config = xmlTree(configXML);
  if (root.attrs.unit !== 'millimeter') throw new Error('project mode currently requires millimeter units');
  const app = children(root, 'metadata').find((m) => m.attrs.name === 'Application');
  if (!app || !/BambuStudio|Bambu Studio/i.test(rootXML.slice(app.open, app.close))) {
    throw new Error('--preserve-project currently supports Bambu Studio/MakerWorld projects only');
  }
  const settings = JSON.parse(settingsText);
  const resources = child(root, 'resources'), build = child(root, 'build');
  if (!resources || !build) throw new Error('missing project resources/build');
  const objects = new Map(children(resources, 'object').map((o) => [o.attrs.id, o]));
  const configs = new Map(children(config, 'object').map((o) => [o.attrs.id, o]));
  if (objects.size !== children(resources, 'object').length || configs.size !== children(config, 'object').length) {
    throw new Error('duplicate project object IDs');
  }
  const plates = children(config, 'plate');
  const membership = new Map();
  plates.forEach((p, i) => {
    for (const instance of children(p, 'model_instance')) {
      const md = metadata(instance), key = `${md.object_id}:${md.instance_id}`;
      if (membership.has(key)) throw new Error('ambiguous plate membership');
      membership.set(key, { plate: metadata(p).plater_id ?? String(i + 1), node: p });
    }
  });
  const occurrences = new Map();
  const items = children(build, 'item').map((item, index) => {
    const id = item.attrs.objectid, instance = occurrences.get(id) ?? 0;
    occurrences.set(id, instance + 1);
    const cfg = configs.get(id), object = objects.get(id);
    return { number: index + 1, id, item, config: cfg, object, instance,
      name: cfg ? metadata(cfg).name || object?.attrs.name || `Object ${index + 1}` : `Object ${index + 1}`,
      printable: item.attrs.printable !== '0' && item.attrs.printable !== 'false',
      plate: membership.get(`${id}:${instance}`)?.plate ?? null };
  });
  if (args.listObjects) return { input, output: null, objects: items.map(({ number, id, name, printable, plate }) =>
    ({ number, id, name, printable, plate })), report: items.map((o) =>
      `${o.number}: ${o.name} (resource ${o.id}, plate ${o.plate ?? '?'}, ${o.printable ? 'printable' : 'not printable'})`).join('\n') };
  const selected = pick(items, args.objects);
  if (!selected.length) throw new Error('no printable objects selected');
  const variable = [...zip.entries.keys()].some((n) => /(?:layer_heights_profile|layer_config_ranges)/i.test(n));
  const plans = selected.map((o) => {
    try {
      if (!o.object || !o.config || !o.plate) throw new Error('missing object settings or plate assignment');
      if (occurrences.get(o.id) !== 1) throw new Error('shared build instances are not supported yet; make each instance independent in Bambu Studio');
      if (!child(o.object, 'components') || child(o.object, 'mesh')) throw new Error('expected a Bambu component assembly');
      if (children(o.config, 'part').some((p) => p.attrs.subtype === 'negative_part')) {
        throw new Error('negative parts would cut the added fins; project mode does not yet support them');
      }
      const transform = matrix(o.item.attrs.transform); inverse(transform);
      const height = regularHeight(settings, o.config, args.dialog.layerHeight, variable);
      const slot = filament(settings, o.config, args.finExtruder);
      const options = optionsFromDialog({ ...args.dialog, layerHeight: height });
      const own = metadata(o.config);
      const native = enabled(own.enable_support ?? settings.enable_support)
        || children(o.config, 'part').some((p) => enabled(metadata(p).enable_support));
      return { ...o, transform, height, slot, options, native };
    } catch (e) { throw new Error(`object ${o.number} (${o.name}): ${e.message}`); }
  });
  const warn = (s) => io.err(`support-fins: ${input}: ${s}`);
  if (plans.some((p) => p.native) && !args.disableNativeSupports) {
    warn('native slicer supports remain enabled; both native supports and fins may print. Use --disable-native-supports to turn them off on selected objects.');
  }
  const rootEdits = [], configEdits = [], supportObjects = [], results = [];
  let nextID = Math.max(0, ...[...objects.keys(), ...children(config, 'object')
    .flatMap((o) => children(o, 'part').map((p) => p.attrs.id))].map((id) => {
      if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(+id)) throw new Error('invalid resource ID');
      return +id;
    })) + 1;
  let prefix = Object.entries(root.attrs).find(([k, v]) => k.startsWith('xmlns:') && v === PROD)?.[0].slice(6);
  if (!prefix) {
    if (root.attrs['xmlns:p']) throw new Error('unsupported production namespace');
    prefix = 'p';
    rootEdits.push([root.open - 1, root.open - 1, ` xmlns:p="${PROD}"`]);
  }
  const rootBytes = enc.encode(rootXML), configBytes = enc.encode(configXML);
  // Load only this object's dependency tree. Discard the inflated meshes and
  // parsed geometry before the next object, instead of retaining an entire plate.
  for (const p of plans) {
    warn(`object ${p.number}/${items.length}, plate ${p.plate}: ${p.name}; layer ${p.height} mm, filament ${p.slot}`);
    try {
      const members = new Map([[ROOT, rootBytes], [CONFIG, configBytes]]);
      const visiting = new Set(), visited = new Set();
      const load = async (name) => {
        if (visiting.has(name)) throw new Error('cyclic model-part references');
        if (visited.has(name)) return;
        visiting.add(name);
        if (!members.has(name)) members.set(name, await zip.read(name));
        const paths = new Set();
        scanXML(new TextDecoder().decode(members.get(name)), (tag, attrs) => {
          if (tag.split(':').pop() === 'model' && attrs.unit && attrs.unit !== 'millimeter') {
            throw new Error(`project mode requires millimeter units in ${name}`);
          }
          if (tag.split(':').pop() === 'component') {
            const path = Object.entries(attrs).find(([k]) => k.split(':').pop() === 'path')?.[1];
            if (path) paths.add(partPath(path));
          }
        }, () => {});
        for (const path of paths) await load(path);
        visiting.delete(name); visited.add(name);
      };
      for (const component of children(child(p.object, 'components'), 'component')) {
        const path = attr(component, 'path');
        if (!path) throw new Error('inline component meshes are not yet supported in project mode');
        await load(partPath(path));
      }
      const model = readThreeMFParts(members, { buildIndex: p.number - 1, doublePrecision: true }).objects[0];
      if (model.extras.some((e) => e.kind === 'negative')) throw new Error('negative parts are not supported in project mode');
      const { triangles, offset, stats } = computeFins(model.positions, p.options);
      const appended = [];
      if (triangles.length) {
        const id = String(nextID++), name = `${p.name} supports`;
        const mesh = supportMesh(triangles, offset, p.transform);
        supportObjects.push(`<object id="${id}" type="model" name="${esc(name)}" p:UUID="${crypto.randomUUID()}">${mesh}</object>`);
        rootEdits.push(insert(child(p.object, 'components'),
          `<component objectid="${id}" ${prefix}:path="/${SUPPORTS}" ${prefix}:UUID="${crypto.randomUUID()}" transform="${identity.join(' ')}"/>`));
        appended.push(`<part id="${id}" subtype="normal_part">${meta('name', name)}${meta('extruder', p.slot)}`
          + `${meta('matrix', '1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1')}</part>`);
      }
      if (args.disableNativeSupports) {
        setMetadata(p.config, 'enable_support', '0', configEdits, appended);
        for (const part of children(p.config, 'part')) {
          const own = children(part, 'metadata').filter((m) => m.attrs.key === 'enable_support');
          for (const m of own) configEdits.push([m.start, m.end, meta('enable_support', '0')]);
        }
      }
      if (appended.length) configEdits.push(insert(p.config, appended.join('')));
      results.push({ number: p.number, id: p.id, name: p.name, plate: p.plate,
        layerHeight: p.height, filament: p.slot, triangles: triangles.length / 9, stats });
    } catch (e) { throw new Error(`object ${p.number} (${p.name}): ${e.message}`); }
  }
  const changes = new Map();
  // Slicing caches cannot describe the augmented model. Keep custom_gcode_per_layer.xml:
  // it contains user-authored pauses/filament changes, not the generated toolpath.
  const stale = new Set([...zip.entries.keys()].filter((n) =>
    /\.(?:gcode|bgcode)$/i.test(n) || /^Metadata\/(?:slice_info\.config|plate_\d+\.json)$/i.test(n)));
  for (const plate of plates) {
    for (const m of children(plate, 'metadata')) {
      if (/^(?:gcode_file|thumbnail_file|thumbnail_no_light_file|top_file|pick_file|slice_prediction|slice_weight)$/.test(m.attrs.key)) {
        if (m.attrs.value && zip.entries.has(m.attrs.value)) stale.add(m.attrs.value);
        configEdits.push([m.start, m.end, '']);
      }
    }
  }
  for (const name of stale) changes.set(name, null);
  changes.set(ROOT, editXML(rootXML, rootEdits));
  changes.set(CONFIG, editXML(configXML, configEdits));
  changes.set(MARKER, JSON.stringify({ version: 1, objects: results, needsReslice: true }));
  if (supportObjects.length) {
    changes.set(SUPPORTS, `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xmlns="${CORE}" xmlns:p="${PROD}"><resources>${supportObjects.join('')}</resources></model>`);
    const name = '3D/_rels/3dmodel.model.rels';
    const text = zip.entries.has(name) ? await zip.text(name)
      : '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
    const node = xmlTree(text), used = new Set(children(node, 'Relationship').map((r) => r.attrs.Id));
    let id = 'support-fins'; while (used.has(id)) id += '-1';
    changes.set(name, editXML(text, [insert(node, `<Relationship Id="${id}" Type="${REL}" Target="/${SUPPORTS}"/>`)]));
  }
  const typesText = await zip.text('[Content_Types].xml'), types = xmlTree(typesText), typeEdits = [];
  if (!children(types, 'Default').some((n) => n.attrs.Extension === 'json')) {
    typeEdits.push(insert(types, '<Default Extension="json" ContentType="application/json"/>'));
  }
  for (const node of children(types, 'Override')) if (stale.has(node.attrs.PartName?.replace(/^\//, ''))) typeEdits.push([node.start, node.end, '']);
  if (typeEdits.length) changes.set('[Content_Types].xml', editXML(typesText, typeEdits));
  // Remove relationships to discarded preview/toolpath members.
  for (const name of zip.entries.keys()) {
    if (!name.endsWith('.rels')) continue;
    const text = changes.get(name) ?? await zip.text(name), node = xmlTree(text);
    const base = name.includes('/_rels/') ? name.slice(0, name.lastIndexOf('/_rels/') + 1) : '';
    const edits = children(node, 'Relationship').filter((n) => {
      const target = n.attrs.Target ?? '';
      return stale.has(target.startsWith('/') ? target.slice(1) : base + target);
    }).map((n) => [n.start, n.end, '']);
    if (edits.length) changes.set(name, editXML(text, edits));
  }
  const blob = await zip.patch(changes);
  await io.writeProject(input, output, new Uint8Array(await blob.arrayBuffer()), args.overwrite);
  warn('project preserved; slice it again in Bambu Studio before printing.');
  return { input, output, objects: results, report: `${results.length} objects processed, `
    + `${results.filter((r) => r.triangles).length} support parts added; re-slice in Bambu Studio` };
}
