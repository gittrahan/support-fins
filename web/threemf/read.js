import { unzip } from '../zip.js';
import { filamentPainter } from '../paintcode.js';
import { ON_PART, PAINT_ATTRS, REL_3DMODEL, SESSION_PART, attrLocal, compose, local, parseMatrix, partName, scanXML } from './common.js';
import { addPrusa3Parts, bambuComponentSettings, parseBambuConfig, parsePrusaConfig, stripExt } from './slicers.js';

// ---------------------------------------------------------------- 3MF reader

/**
 * Reading a 3MF back in. A user who models in Fusion, Bambu Studio or FreeCAD
 * has a .3mf in hand, not an STL, and telling them to go re-export is the wrong
 * answer -- especially since a 3MF is the better input: it states its units, so
 * the 1/25-scale guess never happens on the way in either.
 *
 * Parsed with a small tag scanner rather than DOMParser, for two reasons: the
 * test suite runs outside a browser (no DOM), and a scanner cannot be talked
 * into resolving an external entity from a file a stranger sent us.
 *
 * Four things here are easy to get wrong and are what separate "works on our
 * own export" from "works on a real Bambu / Orca / MakerWorld file":
 *   1. UNITS. The unit attribute is authoritative and is not always millimetre
 *      (inch and centimetre both turn up). Everything downstream is mm.
 *   2. TRANSFORMS. Geometry lives in object space; a <build><item> and every
 *      <component> may carry a matrix, and they compose. Ignoring them is the
 *      "part imports offset from the plate / mirrored" bug.
 *   3. THE PRODUCTION EXTENSION. Bambu Studio, OrcaSlicer and everything on
 *      MakerWorld/Printables split each object into its own part inside the zip
 *      (3D/Objects/object_N.model), referenced from the root 3dmodel.model by a
 *      <component p:path="..."/>. A reader that only parses the root part throws
 *      on these -- which is most real multi-object files (see issue #14).
 *   4. PER-FILE ID SCOPING. Object ids are scoped to the part file they live in,
 *      NOT global -- Bambu reuses id="1" in every object_N.model. Resolving a
 *      component's objectid in one global id->object map (as three.js's own
 *      ThreeMFLoader does) silently assembles the WRONG geometry when two parts
 *      collide on an id. So an object is keyed by (partName, id), never id alone.
 *
 * A plate can hold several objects; this reader returns them SEPARATELY (each
 * <build><item> is one entry in `objects`) so the caller can let the user pick
 * which to fin, and also a merged `positions` for the simple single-object path.
 */

// 3MF unit vocabulary -> millimetres.
const UNIT_MM = {
  micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000,
};

/**
 * Object types that are not printable solid geometry. `support` and `surface`
 * are not closed bodies and `other` is explicitly non-printable, so pulling
 * them in as part geometry would poison the overhang analysis. `model` and
 * `solidsupport` are kept; a missing type means `model` per the spec.
 */
const SKIP_TYPES = new Set(['support', 'surface', 'other']);

/** Parse one 3D/*.model part into { objects, items, unit }. */
function parseModelXML(xml, strict = false, withComponents = false) {
  const objects = new Map();   // id -> { type, name, verts, tris, components, paint, rgb }
  const items = [];            // { objectid, transform }
  const groups = new Map();    // material/colour group id -> ['#RRGGBB', ...]
  const codes = new Map();     // paint string -> its own copy, shared by every repeat
  let unit = 'millimeter';
  let cur = null;              // object being filled
  let group = null;            // <basematerials>/<colorgroup> being filled
  let inVertices = false;
  // Only provenance callers retain source topology and property resources.
  const properties = [], propertyStack = [];
  let inResources = false, inObject = false, modelAttributes = null;
  const transform = (s) => {
    const m = parseMatrix(s);
    if (strict && s !== undefined) {
      const det = m && (m[0] * (m[4] * m[8] - m[5] * m[7])
        - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]));
      if (!m || !Number.isFinite(det) || Math.abs(det) < 1e-12) throw new Error('invalid component/build transform');
    }
    return m;
  };

  scanXML(xml, (tag, a, selfClosing) => {
    const name = local(tag);
    if (withComponents) {
      if (name === 'resources') inResources = !selfClosing;
      else if (name === 'object') inObject = !selfClosing;
      else if (inResources && !inObject) {
        const node = { name: tag, attributes: { ...a }, children: [] };
        if (propertyStack.length) propertyStack.at(-1).children.push(node);
        else properties.push(node);
        if (!selfClosing) propertyStack.push(node);
      }
    }
    switch (name) {
      case 'model':
        if (withComponents) modelAttributes = { ...a };
        if (a.unit) unit = a.unit;
        break;
      // Colour as the core spec states it (a material table and an index per
      // triangle). Resources precede the objects that use them, so a triangle's
      // colour resolves as it is read. Ids are per part file, like object ids.
      case 'basematerials':
      case 'colorgroup':
        group = [];
        groups.set(String(a.id), group);
        if (selfClosing) group = null;
        break;
      case 'base':
        if (group) group.push(a.displaycolor || '');
        break;
      case 'color':
        if (group) group.push(a.color || '');
        break;
      case 'object':
        if (strict && (objects.has(String(a.id)) || !/^[1-9]\d*$/.test(a.id))) {
          throw new Error('duplicate or invalid mesh object ID');
        }
        cur = { type: a.type || 'model', name: a.name || '', verts: [], tris: [], components: [],
                pid: a.pid, pindex: a.pindex, paint: null, rgb: null };
        if (withComponents) cur.source = { attributes: { ...a }, vertices: cur.verts,
          indices: cur.tris, triangleAttributes: [], properties, modelAttributes };
        objects.set(String(a.id), cur);
        if (selfClosing) cur = null;
        break;
      case 'vertices':
        inVertices = true;
        break;
      case 'vertex':
        // Guard on inVertices: the beam-lattice extension has its own <v> refs,
        // and only <vertices> children are mesh points.
        if (cur && inVertices) {
          if (strict && ['x', 'y', 'z'].some((k) => a[k] == null || a[k].trim() === '' || !Number.isFinite(+a[k]))) {
            throw new Error('invalid mesh vertex');
          }
          cur.verts.push(+a.x || 0, +a.y || 0, +a.z || 0);
        }
        break;
      case 'triangle': {
        if (!cur) break;
        if (strict && ['v1', 'v2', 'v3'].some((k) => !/^\d+$/.test(a[k]) || !Number.isSafeInteger(+a[k]))) {
          throw new Error('invalid triangle references');
        }
        const t = cur.tris.length / 3;
        cur.tris.push(+a.v1, +a.v2, +a.v3);
        if (withComponents) {
          const attrs = Object.fromEntries(Object.entries(a).filter(([k]) => !/^v[123]$/.test(k)));
          if (Object.keys(attrs).length) cur.source.triangleAttributes[t] = attrs;
        }
        // A slicer's painted colours (PAINT_ATTRS), kept verbatim: the string
        // subdivides THIS triangle against its own vertex order, which the whole
        // import -> export path keeps, so it stays valid however the part turns.
        for (const name of PAINT_ATTRS) {
          const v = a[name];
          if (!v) continue;
          // A scanned value is a slice that keeps the WHOLE decoded model file
          // alive while it lives (a V8 sliced string) -- and the colours live for
          // the session. ' ' + v flattens into a fresh string; the map shares it.
          let own = codes.get(v);
          if (own === undefined) codes.set(v, own = { name, v: (' ' + v).slice(1) });
          (cur.paint ??= [])[t] = own;
          break;
        }
        const pid = a.pid ?? cur.pid, pi = a.p1 ?? cur.pindex;
        const c = pid != null && groups.get(String(pid))?.[+(pi ?? 0)];
        if (c) (cur.rgb ??= [])[t] = c;
        break;
      }
      case 'component':
        // p:path (production extension) points the objectid at a DIFFERENT part
        // file; absent, the objectid resolves within this same file.
        if (cur) cur.components.push({
          objectid: String(a.objectid),
          path: attrLocal(a, 'path') || null,
          transform: transform(a.transform),
        });
        break;
      case 'item':
        items.push({ objectid: String(a.objectid), transform: transform(a.transform) });
        break;
      default:
        break;
    }
  }, (tag) => {
    const t = local(tag);
    if (withComponents) {
      if (t === 'object') inObject = false;
      else if (t === 'resources') inResources = false;
      else if (propertyStack.at(-1)?.name === tag) propertyStack.pop();
    }
    if (t === 'object') cur = null;
    else if (t === 'vertices') inVertices = false;
    else if (t === 'basematerials' || t === 'colorgroup') group = null;
  });

  return { objects, items, unit };
}

/**
 * Flatten one object (mesh or assembly) into `out` as a triangle soup, applying
 * `m`. `getPart(name)` returns a parsed part's { objects } (lazily, cached);
 * `path` is the part file the id lives in. A component may point at a DIFFERENT
 * part via p:path, so id lookup and cycle detection are both keyed by (path,id),
 * never id alone -- two Bambu parts legally reuse id="1".
 *
 * `seen` breaks a component cycle: a malformed file can reference itself, the
 * spec forbids it, so bailing is correct rather than recursing forever.
 *
 * `sink(role)` is where a triangle goes: role null is the part, any other is one
 * non-printing part's { kind, name } (PART_KIND), its own soup. `role` is the
 * one this subtree inherits. `roles` is what the slicer configs say: `parts`,
 * only at a BUILD ITEM's object, names its components by objectid (Bambu/Orca,
 * PrusaSlicer 3); `ranges(path, id)` names a mesh's triangles by index at any
 * depth (PrusaSlicer 2: a second instance is a wrapper object pointing at the
 * first one's mesh, and the config names only the mesh's object).
 * A part used twice is two extras, each its own shell, as the slicer has them.
 *
 * `fil` is the filament this subtree is on (filamentOf: the build item's object,
 * then a component's part, then a PrusaSlicer 2 range of the mesh), and
 * `roles.paint(p, n)` a triangle's paint for it (paintcode.js filamentPainter).
 */
// a config's role, copied per use: each occurrence gets its own soup (and name)
const named = (r) => r && { ...r };

function emitObject(getPart, path, id, m, sink, seen, stats, role = null, roles = null, orient = false,
  fil = 0, components = null, route = [], partId = null) {
  const part = getPart(path);
  const obj = part && part.objects.get(id);
  if (!obj) { stats.missing++; return; }        // dangling ref: a broken file
  const key = `${path} ${id}`;
  if (seen.has(key)) { stats.cycles = (stats.cycles ?? 0) + 1; return; }
  // Bambu writes a non-printing part as type="other": the config naming it wins,
  // so it is kept by kind instead of skipped as unknown geometry.
  if (SKIP_TYPES.has(obj.type) && !role) { stats.skipped++; return; }
  // our own export's supports moved into the part object (write.js strandedFrom): a
  // component of it, never the part. (An object of that name picked on its own still loads.)
  if (seen.size && ON_PART.test(obj.name)) { stats.skipped++; return; }
  if (role && !role.name && obj.name) role.name = stripExt(obj.name);
  seen.add(key);

  const { verts, tris } = obj;
  const ranges = role ? null : roles?.ranges?.(path, id);
  const filRanges = roles?.filRanges?.(path, id);
  // PrusaSlicer 2 names the mesh's object, which a second instance only points at
  fil ||= roles?.filObject?.(path, id) ?? 0;
  const mirrored = orient && m && (
    m[0] * (m[4] * m[8] - m[5] * m[7])
    - m[1] * (m[3] * m[8] - m[5] * m[6])
    + m[2] * (m[3] * m[7] - m[4] * m[6])) < 0;
  const groups = components ? new Map() : null;
  const record = (r, target) => {
    let c = groups.get(r);
    if (!c) {
      c = { path, objectId: id, partId, route: [...route], kind: r?.kind ?? 'model',
        transform: m ? [...m] : null, cornerOrder: mirrored ? [0, 2, 1] : [0, 1, 2],
        source: obj.source, sourceFaces: [], firstTriangle: target.out.length / 9, target };
      groups.set(r, c); components.push(c);
    }
    return c;
  };
  // Keep empty leaf occurrences visible to a strict project caller.
  if (components && !tris.length && !obj.components.length) record(role, sink(role));
  let partTris = 0;
  for (let t = 0; t < tris.length; t += 3) {
    // A triangle indexing a vertex that does not exist is a broken file. Check
    // all three FIRST and drop the whole face -- pushing NaN would silently
    // blank the render, and pushing a partial face would shift every vertex
    // after it by one, shearing the rest of the mesh.
    const o0 = tris[t] * 3, o1 = tris[t + 1] * 3, o2 = tris[t + 2] * 3;
    if (!(o0 >= 0 && o1 >= 0 && o2 >= 0)
        || o0 + 3 > verts.length || o1 + 3 > verts.length || o2 + 3 > verts.length) {
      stats.dropped++;
      continue;
    }
    const r = ranges ? ranges.find((v) => t / 3 >= v.first && t / 3 <= v.last) ?? role : role;
    if (r?.kind === 'ours') continue;              // our supports in the part (slicers.js)
    const target = sink(r), { out, col } = target;
    if (components) record(r, target).sourceFaces.push(t / 3);
    if (!r) partTris++;
    if (col) {
      const k = out.length / 9;
      const n = filRanges?.find((v) => t / 3 >= v.first && t / 3 <= v.last)?.n || fil;
      const p = roles?.paint ? roles.paint(obj.paint?.[t / 3], n) : obj.paint?.[t / 3];
      if (p) col.paint[k] = p;
      if (obj.rgb?.[t / 3]) col.rgb[k] = obj.rgb[t / 3];
    }
    for (const o of mirrored ? [o0, o2, o1] : [o0, o1, o2]) {
      const x = verts[o], y = verts[o + 1], z = verts[o + 2];
      if (m) {
        out.push(x * m[0] + y * m[3] + z * m[6] + m[9],
                 x * m[1] + y * m[4] + z * m[7] + m[10],
                 x * m[2] + y * m[5] + z * m[8] + m[11]);
      } else {
        out.push(x, y, z);
      }
    }
  }
  if (partTris) stats.meshes++;

  for (const [componentIndex, c] of obj.components.entries()) {
    const childPath = c.path ? partName(c.path) : path;
    emitObject(getPart, childPath, c.objectid, compose(c.transform, m), sink, seen, stats,
      named(roles?.parts?.get(c.objectid)) ?? role,
      roles && { ranges: roles.ranges, filRanges: roles.filRanges, filObject: roles.filObject, paint: roles.paint }, orient,
      roles?.filament?.parts.get(c.objectid) || fil,
      components, components ? [...route, componentIndex] : route, route.length ? partId : c.objectid);
  }
  seen.delete(key);
}

const bbox = (positions) => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (positions[i + k] < lo[k]) lo[k] = positions[i + k];
      if (positions[i + k] > hi[k]) hi[k] = positions[i + k];
    }
  }
  return { lo, hi, size: hi.map((h, k) => h - lo[k]) };
};

/** Locate the root 3dmodel.model part name (the one carrying <build>). */
function findRootPart(parts) {
  if (parts.has('3D/3dmodel.model')) return '3D/3dmodel.model';
  // The root relationship names it; use that before guessing.
  const rels = parts.get('_rels/.rels');
  if (rels) {
    let target = null;
    scanXML(new TextDecoder().decode(rels), (tag, a) => {
      if (local(tag) === 'Relationship' && a.Type === REL_3DMODEL && a.Target) target = a.Target;
    }, () => {});
    if (target && parts.has(partName(target))) return partName(target);
  }
  // Odd writer that renamed it: among the .model parts, the root is the one with
  // a <build> section (the object_N.model parts have none). Fall back to first.
  let first = null;
  for (const [name] of parts) {
    if (!name.toLowerCase().endsWith('.model')) continue;
    if (first === null) first = name;
    if (/<\s*build[\s>]/.test(new TextDecoder().decode(parts.get(name)))) return name;
  }
  return first;
}

/**
 * Read a .3mf package into per-object triangle soups in millimetres.
 *
 * @param bytes  Uint8Array of the whole .3mf file
 * @returns {
 *   unit,
 *   objects: [{ name, positions:Float32Array, tris, meshes, skipped, dropped, bbox, colors }],
 *   positions: Float32Array,   // every object merged -- the simple single-part path
 *   meshes, items, skipped, dropped,  // aggregate across objects
 *   session,                   // SESSION_PART's object when the site wrote one, else null
 * }
 *   Each object's `positions` is flat [x,y,z] x 3 per triangle, the same layout
 *   STLLoader produces, so the caller builds a BufferGeometry from any of them.
 *   `colors` is null, or the object's colours by triangle index (see PartColors).
 *   `extras` is the object's non-printing parts (PART_KIND): [{ kind, name,
 *   settings, positions }], in the same space as `positions` but NOT in it
 *   (`settings`: PLACEMENT_KEY's note).
 */
export async function readThreeMF(bytes) {
  const parts = await unzip(bytes);
  return readThreeMFParts(parts);
}

/**
 * Already opened package members. The CLI project editor loads just the selected
 * build item's dependencies, one item at a time; it never rewrites these meshes.
 * doublePrecision keeps float64 positions; outwardWinding flips triangles under a
 * mirrored transform so they stay outward for analysis. The normal browser import
 * uses neither and retains its existing float32/paint order.
 * withComponents adds one record per leaf mesh occurrence (including empty
 * leaves), with its buildIndex/route, root partId, source mesh, world-mm positions
 * and original sourceFaces. cornerOrder maps each emitted corner to the source
 * triangle's corners; transform is composed BEFORE unitScale. firstTriangle is
 * relative to the main mesh or that extra's mesh. Source topology/property tables
 * are shared between occurrences; positions are views of the existing arrays.
 * Settings and source attributes retain XML-escaped values, including unknown
 * attributes, for a later exporter to interpret or explicitly reject. This is
 * opt-in: ordinary callers neither retain this data nor pay for its parsing.
 */
export function readThreeMFParts(parts, { buildIndex = null, doublePrecision = false, outwardWinding = false,
  withComponents = false } = {}) {

  const rootName = findRootPart(parts);
  if (!rootName || !parts.has(rootName)) throw new Error('no 3D model part found in this 3MF');

  // Parse each part on demand and cache it -- a plate can reference the same
  // object_N.model many times, and most parts in a big package go untouched.
  const parsed = new Map();
  const getPart = (name) => {
    if (parsed.has(name)) return parsed.get(name);
    const data = parts.get(name);
    const p = data ? parseModelXML(new TextDecoder().decode(data), buildIndex !== null, withComponents) : null;
    parsed.set(name, p);
    return p;
  };

  const root = getPart(rootName);
  const unit = root.unit;
  const scale = UNIT_MM[unit] ?? 1;
  const text = (name) => (parts.has(name) ? new TextDecoder().decode(parts.get(name)) : null);
  const filaments = new Map();
  const bambu = text('Metadata/model_settings.config');
  const { names, parts: slicerParts } = parseBambuConfig(bambu, filaments);
  const componentSettings = withComponents ? bambuComponentSettings(bambu) : null;
  addPrusa3Parts(text('Metadata/PrusaSlicer3_project.json'), slicerParts, filaments);
  const prusaVols = parsePrusaConfig(text('Metadata/Slic3r_PE_model.config'), filaments);
  // a part's filament goes out as paint (paintcode.js), in the file's slicer's words
  const paint = filaments.size ? filamentPainter(bambu ? 'paint_color' : 'slic3rpe:mmu_segmentation') : null;

  // Each <build><item> is one pickable object. No <build> is a valid-but-empty
  // plate; a few CAD exporters omit it, so fall back to the mesh/assembly objects
  // in the root part rather than refusing a file that plainly contains geometry.
  const roots = root.items.length
    ? root.items
    : [...root.objects.entries()]
        .filter(([, o]) => o.tris.length || o.components.length)
        .map(([id]) => ({ objectid: id, transform: null }));

  const toMM = (out) => {
    const positions = doublePrecision ? new Float64Array(out.length) : new Float32Array(out.length);
    for (let i = 0; i < out.length; i++) positions[i] = out[i] * scale;
    return positions;
  };

  const objects = [];
  const agg = { meshes: 0, skipped: 0, dropped: 0 };
  for (const [index, item] of roots.entries()) {
    if (buildIndex !== null && index !== buildIndex) continue;
    const main = { out: [], col: { paint: [], rgb: [] } };
    const components = withComponents ? [] : null;
    const extra = new Map();        // role -> { out }: one soup per non-printing part
    const sink = (role) => {
      if (!role) return main;
      if (!extra.has(role)) extra.set(role, { out: [], col: null });
      return extra.get(role);
    };
    const stats = { meshes: 0, skipped: 0, dropped: 0, missing: 0 };
    const filament = filaments.get(item.objectid);
    const roles = { parts: slicerParts.get(item.objectid),
      ranges: (path, id) => (path === rootName ? prusaVols.get(id) : null),
      filament, paint,
      filRanges: (path, id) => (path === rootName ? filaments.get(id)?.ranges : null),
      filObject: (path, id) => (path === rootName ? filaments.get(id)?.object : 0) };
    emitObject(getPart, rootName, item.objectid, item.transform, sink, new Set(), stats, null, roles, outwardWinding,
      filament?.object ?? 0, components);
    if (buildIndex !== null && (stats.missing || stats.dropped || stats.cycles)) {
      throw new Error('selected object has missing resources, cyclic components or invalid triangle references');
    }
    // Fold stats first: a build item that was ALL support/dangling emits nothing
    // but its skipped count still has to be reported, not dropped with the item.
    agg.meshes += stats.meshes; agg.skipped += stats.skipped; agg.dropped += stats.dropped;
    // all-skipped/dangling item, or one with only non-printing parts: not a pickable body
    if (!main.out.length) continue;

    const positions = toMM(main.out);
    const extraPositions = new Map([...extra].map(([role, s]) => [s, toMM(s.out)]));
    const componentInfo = components?.map(({ target, sourceFaces, ...c }) => {
      const all = target === main ? positions : extraPositions.get(target);
      const config = componentSettings.get(item.objectid);
      return { ...c, buildIndex: index, unitScale: scale, sourceFaces: Uint32Array.from(sourceFaces),
        positions: all.subarray(c.firstTriangle * 9, (c.firstTriangle + sourceFaces.length) * 9),
        settings: config?.parts.filter((p) => p.attributes.id === c.partId) ?? [],
        objectSettings: config?.metadata ?? [] };
    });
    const { col } = main;
    const rootObj = root.objects.get(item.objectid);
    objects.push({
      name: names.get(item.objectid) || (rootObj && rootObj.name) || `Object ${objects.length + 1}`,
      positions,
      tris: positions.length / 9,
      meshes: stats.meshes,
      skipped: stats.skipped,
      dropped: stats.dropped,
      bbox: bbox(positions),
      colors: col.paint.length || col.rgb.length ? col : null,
      extras: [...extra].filter(([, s]) => s.out.length)
        .map(([role, s]) => ({ kind: role.kind, name: role.name, settings: role.settings, positions: extraPositions.get(s) })),
      ...(components ? { components: componentInfo } : {}),
    });
  }

  if (!objects.length) throw new Error('this 3MF contains no printable mesh geometry');

  return {
    unit,
    objects,
    positions: buildIndex !== null ? objects[0].positions : mergePositions(objects),
    meshes: agg.meshes,
    items: objects.length,
    skipped: agg.skipped,
    dropped: agg.dropped,
    session: readSession(parts),
  };
}

/** SESSION_PART, parsed; null when absent or unreadable (the file is still a part). */
function readSession(parts) {
  const data = parts.get(SESSION_PART);
  if (!data) return null;
  try {
    const s = JSON.parse(new TextDecoder().decode(data));
    return s && typeof s === 'object' && s.v === 1 ? s : null;
  } catch { return null; }
}

/** Concatenate the per-object position arrays into one merged soup. */
function mergePositions(objects) {
  let total = 0;
  for (const o of objects) total += o.positions.length;
  const all = new Float32Array(total);
  let off = 0;
  for (const o of objects) { all.set(o.positions, off); off += o.positions.length; }
  return all;
}
