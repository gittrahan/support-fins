/** 3MF reader, slicer side: what Bambu Studio / OrcaSlicer and PrusaSlicer 2 / 3
 *  record about each part in their own config files (kind, name, settings,
 *  filament), read so the part and its non-printing parts come in as the slicer had them. */

import { local, scanXML } from './common.js';

/**
 * A slicer's non-printing parts (GitHub #104). Bambu Studio, OrcaSlicer and
 * PrusaSlicer let a user add a negative part (subtracted from the object), a
 * modifier (settings for the region it covers) or a support blocker/enforcer --
 * and every one of them is an ordinary type="model" mesh in the 3D model. What
 * makes it one is a slicer config beside it:
 *   Bambu/Orca  Metadata/model_settings.config, <object id=ROOT><part id=N
 *               subtype="negative_part">, N being the objectid of one of the root
 *               object's <component>s (each part is a component);
 *   PrusaSlicer 3 Metadata/PrusaSlicer3_project.json, the same shape as Bambu's
 *               as JSON: objects[{ id: ROOT, volumes[{ id: N, type: "NegativeVolume" }] }];
 *   PrusaSlicer 2 Metadata/Slic3r_PE_model.config, <object id=ROOT><volume
 *               firstid lastid> + metadata volume_type="NegativeVolume", a range
 *               of the root object's OWN triangles (one mesh holds every part).
 * Read as part geometry, a negative part comes in as solid -- the hole it cut is
 * filled, the fins are analysed against it, and the export prints it. So these
 * are kept apart from the part, by kind. A missing or unknown type is a part.
 */
const PART_KIND = {
  negative_part: 'negative', modifier_part: 'modifier',
  support_blocker: 'blocker', support_enforcer: 'enforcer',
  NegativeVolume: 'negative', ParameterModifier: 'modifier',
  SupportBlocker: 'blocker', SupportEnforcer: 'enforcer',
};

export const stripExt = (s) => s.replace(/\.(stl|3mf|obj|step|stp)$/i, '');

/**
 * A non-printing part's own settings ride along with it, verbatim, so the export
 * can hand it back to the slicer it came from (a modifier IS its settings: the
 * infill or walls it sets for its region). `settings` holds them by the config
 * they are in -- each slicer has its own words for them: { bambu:
 * model_settings.config's [key, value] pairs, prusa3: PrusaSlicer3_project.json's
 * volume_settings object, prusa2: Slic3r_PE_model.config's [key, value] pairs },
 * only the ones the file had. Where the part sits and what it is called are not
 * settings: the export writes those afresh, the part in print space.
 */
const PLACEMENT_KEY = /^(name|matrix|volume_type|modifier|source_\w+)$/;

/** Raw Bambu part attributes/settings, including normal parts. Keep duplicate
 * records and XML-escaped values: an exporter must resolve ambiguity explicitly,
 * not silently choose a material or discard metadata. Used only withComponents. */
export function bambuComponentSettings(xml) {
  const objects = new Map();
  let object = null, part = null;
  if (!xml) return objects;
  scanXML(xml, (tag, attributes, closed) => {
    const name = local(tag);
    if (name === 'object') {
      object = { metadata: [], parts: [] }; objects.set(attributes.id, object);
      if (closed) object = null;
    } else if (name === 'part' && object) {
      part = { attributes: { ...attributes }, metadata: [] }; object.parts.push(part);
      if (closed) part = null;
    } else if (name === 'metadata' && object && attributes.key !== undefined) {
      (part ?? object).metadata.push([attributes.key, attributes.value ?? '']);
    }
  }, (tag) => {
    if (local(tag) === 'part') part = null;
    else if (local(tag) === 'object') object = part = null;
  });
  return objects;
}

/**
 * Each root object's filament (paintcode.js), from whichever slicer config says:
 *   rootId -> { object: n, parts: partId -> n, ranges: [{ first, last, n }] }
 * `parts` by component objectid (Bambu/Orca, PrusaSlicer 3), `ranges` by triangle
 * of the root's own mesh (PrusaSlicer 2). 0 or absent is "the object's own".
 */
function filamentOf(filaments, id) {
  if (!filaments.has(id)) filaments.set(id, { object: 0, parts: new Map(), ranges: [] });
  return filaments.get(id);
}
const filamentNo = (v) => (/^\d+$/.test(String(v ?? '')) ? +v : 0);

/**
 * Bambu/Orca's Metadata/model_settings.config: the human object names, keyed by
 * the ROOT object id (the same id the build item references), each root
 * object's non-printing parts, keyed by the part id (= the component objectid),
 * and the filament of each object and part, into `filaments` (filamentOf).
 * Best-effort: absent config or unknown id just falls back to a generic label /
 * a printing part at the call site.
 *   { names: id -> name, parts: rootId -> (partId -> { kind, name }) }
 */
export function parseBambuConfig(configXML, filaments) {
  const names = new Map(), parts = new Map();
  if (!configXML) return { names, parts };
  let curId = null, curPart = null, curPartId = null;
  scanXML(configXML, (tag, a, selfClosing) => {
    const t = local(tag);
    // a part's filament is also one of its settings (below): recorded, not taken
    if (t === 'metadata' && curId && a.key === 'extruder') {
      const n = filamentNo(a.value), f = filamentOf(filaments, curId);
      if (curPartId) f.parts.set(curPartId, n);
      else f.object = n;
    }
    if (t === 'object') curId = a.id != null ? String(a.id) : null;
    else if (t === 'part' && curId) {
      curPartId = selfClosing || a.id == null ? null : String(a.id);
      const kind = PART_KIND[a.subtype];
      curPart = kind ? { kind, name: '', settings: { bambu: [] } } : null;
      if (curPart) {
        if (!parts.has(curId)) parts.set(curId, new Map());
        parts.get(curId).set(String(a.id), curPart);
      }
      if (selfClosing) curPart = null;
    } else if (t === 'metadata' && curId && a.key === 'name' && a.value) {
      if (curPart) curPart.name ||= stripExt(a.value);
      // The object-level <metadata key="name"> comes before any <part>'s, and we
      // keep only the first, so a part filename never shadows the object name.
      else if (!names.has(curId)) names.set(curId, stripExt(a.value));
    } else if (t === 'metadata' && curPart && a.key && !PLACEMENT_KEY.test(a.key)) {
      curPart.settings.bambu.push([a.key, a.value ?? '']);
    }
  }, (tag) => {
    const t = local(tag);
    if (t === 'object') curId = null;
    else if (t === 'part') curPart = curPartId = null;
  });
  return { names, parts };
}

/**
 * PrusaSlicer 3's Metadata/PrusaSlicer3_project.json: objects[{ id, volumes[{ id,
 * type }] }], the same shape as Bambu's -- the object is the build item's, each
 * volume one of its components. Merged into `parts` (parseBambuConfig's). The
 * name is not in the JSON; emitObject takes it from the volume's own object.
 */
export function addPrusa3Parts(json, parts, filaments) {
  if (!json) return;
  let d;
  try { d = JSON.parse(json); } catch { return; }
  for (const o of Array.isArray(d?.objects) ? d.objects : []) {
    if (o?.id == null) continue;
    const f = filamentOf(filaments, String(o.id));
    f.object = filamentNo(o.object_settings?.extruder);
    for (const v of Array.isArray(o?.volumes) ? o.volumes : []) {
      if (v?.id != null) f.parts.set(String(v.id), filamentNo(v.volume_settings?.extruder));
      const kind = PART_KIND[v?.type];
      if (!kind || o.id == null || v.id == null) continue;
      const id = String(o.id);
      if (!parts.has(id)) parts.set(id, new Map());
      const settings = v.volume_settings && typeof v.volume_settings === 'object' && !Array.isArray(v.volume_settings)
        ? v.volume_settings : {};
      // our own export names a part in both configs: one part, both settings
      const had = parts.get(id).get(String(v.id));
      if (had) had.settings.prusa3 = settings;
      else parts.get(id).set(String(v.id), { kind, name: '', settings: { prusa3: settings } });
    }
  }
}

/**
 * PrusaSlicer's Metadata/Slic3r_PE_model.config: each root object's non-printing
 * volumes as triangle ranges (firstid..lastid, inclusive) of its own mesh.
 *   rootId -> [{ first, last, kind, name }]
 * Older files mark a modifier with key="modifier" value="1" and no volume_type.
 */
export function parsePrusaConfig(configXML, filaments) {
  const vols = new Map();
  if (!configXML) return vols;
  let curId = null, cur = null;
  scanXML(configXML, (tag, a) => {
    const t = local(tag);
    if (t === 'object') curId = a.id != null ? String(a.id) : null;
    else if (t === 'volume' && curId) {
      cur = { first: +a.firstid, last: +a.lastid, kind: null, name: '', legacy: null, settings: [] };
      if (!vols.has(curId)) vols.set(curId, []);
      vols.get(curId).push(cur);
    } else if (t === 'metadata' && curId && !cur && a.key === 'extruder') {
      filamentOf(filaments, curId).object = filamentNo(a.value);
    } else if (t === 'metadata' && cur) {
      if (a.key === 'extruder') {
        const n = filamentNo(a.value);
        if (n && Number.isFinite(cur.first) && Number.isFinite(cur.last)) {
          filamentOf(filaments, curId).ranges.push({ first: cur.first, last: cur.last, n });
        }
      }
      if (a.key === 'volume_type') cur.kind = PART_KIND[a.value] ?? null;
      else if (a.key === 'modifier' && a.value === '1') cur.legacy = 'modifier';
      else if (a.key === 'name' && a.value) cur.name = stripExt(a.value);
      else if (a.key && !PLACEMENT_KEY.test(a.key)) cur.settings.push([a.key, a.value ?? '']);
    }
  }, (tag) => {
    const t = local(tag);
    if (t === 'object') curId = null;
    else if (t === 'volume') cur = null;
  });
  for (const [id, list] of vols) {
    const kept = list
      .map((v) => ({ first: v.first, last: v.last, kind: v.kind ?? v.legacy, name: v.name, settings: { prusa2: v.settings } }))
      .filter((v) => v.kind && Number.isFinite(v.first) && Number.isFinite(v.last));
    if (kept.length) vols.set(id, kept); else vols.delete(id);
  }
  return vols;
}
