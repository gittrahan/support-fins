/**
 * 3MF writer (core spec, 2015/02 namespace).
 *
 * Why 3MF alongside the STL: it carries the two things a raw STL cannot, both
 * of which matter to this tool specifically --
 *   1. UNITS. STL is unitless, so a slicer has to guess millimeters; a mis-guess
 *      is the classic "my part imported at 1/25 scale" bug. 3MF states mm.
 *   2. SEPARATE BODIES, two ways (opts.separate):
 *      - LOCKED (default here; the CLI and plugins): the part and the fins are
 *        two meshes assembled by <components> into ONE build item, so they stay
 *        locked in place. But a slicer unions the parts of one object, so it runs
 *        one perimeter through part and tine -- the tine welds (GitHub #38).
 *      - SEPARATE (the site's default 3MF): two build items, two objects, the
 *        way Clough42 splits his support ("Split to objects"). Each keeps its own
 *        perimeter and a tine only touches the part: a cleaner release (the grip
 *        coupon's split print, prototype/calibration/README.md). Both items carry
 *        the same transform, so they open in register (Arrange can pull them
 *        apart; the export's tooltip says so). With the interface crest on
 *        (GitHub #21) the supports object is an assembly of two parts, the body
 *        and "<name> interface" (the walls' tops and the tines), so a toolchanger
 *        can give the interface its own filament.
 *        Supports the slicer would refuse as an object of their own (a first layer
 *        in mid-air, or empty layers between walls) join the part's object instead:
 *        strandedFrom (GitHub #476).
 *
 * We do NOT embed slicer-specific print profiles (Bambu/Orca bind "supports off"
 * to a full printer-specific project config, which breaks across printers and
 * slicers). Bambu and Prusa factory profiles default to no supports, and the
 * fins are ordinary model geometry -- so the exported file prints as intended
 * without reaching into any slicer's settings.
 *
 * Geometry in, same as the STL path: flat arrays of [x,y,z], three vertices per
 * triangle, already in print space (oriented, seated on the plate).
 */

import { zipDeflate } from '../zip.js';
import { REL_3DMODEL, SESSION_PART } from './common.js';

const NS_CORE = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const CT_MODEL = 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml';
const CT_RELS = 'application/vnd.openxmlformats-package.relationships+xml';

// Trim a coordinate to a compact decimal string. 6 decimals is well under the
// ~1um that matters for a print and keeps the model file small.
function fmt(n) {
  if (!Number.isFinite(n)) return '0';
  let s = n.toFixed(6);
  if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}

/**
 * Build an indexed <mesh> from a flat triangle-soup array. Vertices that share
 * exact coordinates are merged (they do, because every vertex is produced by the
 * identical transform of the same source point), which restores shared topology
 * and shrinks the file; anything that doesn't merge is left as-is and slices fine.
 */
export function meshXML(tris, triAttrs = null, kept = null) {
  const index = new Map();
  const verts = [];
  const faces = [];
  for (let t = 0; t < tris.length; t += 3) {
    const idx = [];
    for (let i = 0; i < 3; i++) {
      const p = tris[t + i];
      const key = `${p[0]},${p[1]},${p[2]}`;
      let vi = index.get(key);
      if (vi === undefined) {
        vi = verts.length;
        index.set(key, vi);
        verts.push(p);
      }
      idx.push(vi);
    }
    // Drop any triangle that collapsed to a line/point after the merge; a
    // degenerate face is invalid 3MF and some readers reject the whole model.
    if (idx[0] !== idx[1] && idx[1] !== idx[2] && idx[0] !== idx[2]) {
      if (triAttrs) idx.push(triAttrs(t / 3));
      faces.push(idx);
      kept?.push(t / 3);
    }
  }

  const v = new Array(verts.length);
  for (let i = 0; i < verts.length; i++) {
    const p = verts[i];
    v[i] = `<vertex x="${fmt(p[0])}" y="${fmt(p[1])}" z="${fmt(p[2])}"/>`;
  }
  const f = new Array(faces.length);
  for (let i = 0; i < faces.length; i++) {
    const t = faces[i];
    f[i] = `<triangle v1="${t[0]}" v2="${t[1]}" v3="${t[2]}"${t[3] || ''}/>`;
  }
  return `<mesh><vertices>${v.join('')}</vertices><triangles>${f.join('')}</triangles></mesh>`;
}

const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

const NS_SLIC3RPE = 'http://schemas.slic3r.org/3mf/2017/06';
const MATERIALS_ID = 5;     // past the objects' ids 1-4 (one id space per file)

/** Several objects' PartColors as one, in the order their triangles are merged;
 *  null when none of them has any. */
export function mergeColors(objs) {
  if (!objs.some((o) => o.colors)) return null;
  const all = { paint: [], rgb: [] };
  let off = 0;
  for (const o of objs) {
    if (o.colors) {
      o.colors.paint.forEach((p, i) => { all.paint[off + i] = p; });
      o.colors.rgb.forEach((c, i) => { all.rgb[off + i] = c; });
    }
    off += o.positions.length / 9;
  }
  return all;
}

/** The part's colours as a <basematerials> table (resource `id`) + a per-triangle
 *  attribute string. */
function colorXML(colors, id = MATERIALS_ID) {
  if (!colors) return { table: '', pid: '', triAttrs: null };
  const palette = [...new Set(colors.rgb.filter(Boolean))];
  const at = new Map(palette.map((c, i) => [c, i]));
  return {
    table: palette.length ? `<basematerials id="${id}">` +
      palette.map((c, i) => `<base name="Color ${i + 1}" displaycolor="${esc(c)}"/>`).join('') +
      '</basematerials>' : '',
    pid: palette.length ? ` pid="${id}" pindex="0"` : '',
    triAttrs: (i) => {
      const c = colors.rgb[i], p = colors.paint[i];
      return (c ? ` p1="${at.get(c)}"` : '') + (p ? ` ${p.name}="${esc(p.v)}"` : '');
    },
  };
}

/**
 * The supports a SEPARATE export can't keep in their own object (GitHub #476). Bambu
 * Studio, OrcaSlicer and its forks check every object on its own: its first layer must
 * print ("empty first layer") and no layer between its bottom and top may be empty
 * ("The object has empty layers between 3.6 and 14.8 and can't be printed"). Walls
 * standing on the part above every wall on the plate leave the supports object a gap;
 * walls in a bore start it in mid-air. Only z counts (each layer of the object, wherever
 * it is), so this sweeps the triangles' z spans up from the plate: everything from the
 * first gap over STRAND_GAP up is stranded -- all of it when nothing starts within
 * PLATE_Z of the plate. A connected piece's spans have no gap, so a piece is never cut.
 * The stranded triangles go into the PART object as a part of their own (modelXML):
 * a slicer unions them with the part, so their tines fuse to it, as in the locked
 * form; their feet already stand welded on it (FIN-SPEC foot gap 0).
 * @returns { cut } the z from which a triangle is stranded (Infinity: none is)
 */
export const PLATE_Z = 0.05, STRAND_GAP = 0.1;
export function strandedFrom(...lists) {
  const spans = [];
  for (const tris of lists) {
    for (let t = 0; t + 2 < tris.length; t += 3) {
      const a = tris[t][2], b = tris[t + 1][2], c = tris[t + 2][2];
      spans.push([Math.min(a, b, c), Math.max(a, b, c)]);
    }
  }
  if (!spans.length) return Infinity;
  spans.sort((p, q) => p[0] - q[0]);
  if (spans[0][0] > PLATE_Z) return -Infinity;
  let reach = spans[0][1];
  for (const [lo, hi] of spans) {
    if (lo > reach + STRAND_GAP) return lo;
    if (hi > reach) reach = hi;
  }
  return Infinity;
}

/** `tris` split at `cut` (strandedFrom): [kept, stranded], whole triangles. */
function splitAt(tris, cut) {
  if (cut === Infinity) return [tris, []];
  const kept = [], off = [];
  for (let t = 0; t + 2 < tris.length; t += 3) {
    const lo = Math.min(tris[t][2], tris[t + 1][2], tris[t + 2][2]);
    (lo >= cut ? off : kept).push(tris[t], tris[t + 1], tris[t + 2]);
  }
  return [kept, off];
}

// Where a SEPARATE export opens: two objects keep their 3MF positions (a single one
// gets centred by the slicer), and print space is centred on the origin, so the pair
// would sit half off the bed. Shift both by one transform: the footprint's centre to
// (90, 90) -- on any bed 180 mm or bigger -- but never closer than 5 mm to the bed's
// 0 edge, so a footprint wider than 170 mm still starts on the bed.
export const SEPARATE_CENTRE = 90;
function bedShift(lists) {
  let lx = Infinity, ly = Infinity, hx = -Infinity, hy = -Infinity;
  for (const tris of lists) {
    for (const p of tris) {
      if (p[0] < lx) lx = p[0]; if (p[0] > hx) hx = p[0];
      if (p[1] < ly) ly = p[1]; if (p[1] > hy) hy = p[1];
    }
  }
  if (!Number.isFinite(lx)) return [0, 0];
  return [Math.max(SEPARATE_CENTRE - (lx + hx) / 2, 5 - lx), Math.max(SEPARATE_CENTRE - (ly + hy) / 2, 5 - ly)];
}

/**
 * The model file for a plate's `models` (writePlate3MF). Each model's ids are a
 * block of their own past the one before: the first keeps the ids a one-model file
 * always had (1 the part, 2-4 the supports, MATERIALS_ID its colours, then its
 * slicer parts), so a one-model file is what it always was. Every item of a plate
 * of several shares one bed shift, so the models keep their places to each other.
 * @returns { xml, configs }: configs the slicer config files (extrasXML), each
 * written once with an entry for every model that has slicer parts
 */
function modelXML(models, title, separate, bed) {
  const tables = [], objects = [], items = [], footprint = [];
  const cfg = { prusa2: [], bambu: [], prusa3: [] };
  let base = 0, prusa2 = false, slic3rpe = false;
  for (const m of models) {
    const id = (k) => base + k;
    const name = esc(m.name);
    const col = colorXML(m.colors, id(MATERIALS_ID));
    let iface = m.iface ?? [];
    let finTris = m.finTris;
    let extras = m.extras ?? [];
    if (separate) {
      // supports the slicer would refuse as an object of their own join the part
      // (strandedFrom); a supports object left with only crest goes whole
      let cut = strandedFrom(finTris ?? [], iface);
      let [body, onPart] = splitAt(finTris ?? [], cut);
      if (!body.length && cut !== Infinity) { cut = -Infinity; [body, onPart] = [[], finTris ?? []]; }
      const [crest, crestOn] = splitAt(iface, cut);
      // ...unless a negative part of the object reaches them: it cuts every part of the
      // object, so walls built in its hole would be cut away. They stay apart (the slicer
      // may refuse the supports object, as before, but no wall is lost)
      const box = (tris) => {
        const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
        for (const p of tris) for (let k = 0; k < 3; k++) { b[k] = Math.min(b[k], p[k]); b[k + 3] = Math.max(b[k + 3], p[k]); }
        return b;
      };
      const cuts = (a, b) => [0, 1, 2].every((k) => a[k] <= b[k + 3] && b[k] <= a[k + 3]);
      const moved = box([...onPart, ...crestOn]);
      const negative = extras.some((e) => e.kind === 'negative' && e.tris?.length && cuts(box(e.tris), moved));
      if ((onPart.length || crestOn.length) && !negative) {
        finTris = body; iface = crest;
        extras = [...extras,
          ...(onPart.length ? [{ kind: 'part', name: `${m.name} supports on part`, tris: onPart }] : []),
          ...(crestOn.length ? [{ kind: 'part', name: `${m.name} interface on part`, tris: crestOn }] : [])];
      }
    }
    // a negative part cuts every part of its object: only apart from the supports
    // can it ride along without cutting the walls built in its hole
    const slicer = separate && extras.length ? extrasXML(m.partTris, extras, m.name, col, base) : null;
    let nextMaterialID = (slicer?.root ?? id(MATERIALS_ID)) + 1;
    tables.push(col.table);
    objects.push(slicer?.prusa2 ?? `<object id="${id(1)}" type="model" name="${name}"${col.pid}>${meshXML(m.partTris, col.triAttrs)}</object>`);
    // the part with its slicer parts is an assembly of them (extrasXML)
    if (slicer?.objects) objects.push(...slicer.objects);
    if (slicer?.prusa2) { prusa2 = true; cfg.prusa2.push(slicer.config); }
    else if (slicer) { cfg.bambu.push(slicer.bambu); cfg.prusa3.push(slicer.prusa3); }
    if (m.colors?.paint.some((p) => p.name.startsWith('slic3rpe:'))) slic3rpe = true;
    const partId = slicer?.root ?? id(1);
    let own = [partId];
    // the interface crest is its own object only in the separate form; locked, it
    // is just more of the supports
    if (iface.length && !separate) finTris = [...finTris, ...iface];

    if (m.materialParts?.length) {
      if (!separate) throw new Error('support material parts require separate-object 3MF export');
      if (finTris?.length || iface.length) throw new Error('support material parts cannot replace additional support triangles');
      if (m.materialFormat !== undefined && !['components', 'prusa2'].includes(m.materialFormat)) throw new Error('unknown support material format');
      const roles = new Set(), components = [], volumes = [], triangles = [];
      for (const part of m.materialParts) {
        if (!['body', 'tine', 'interface'].includes(part.role) || roles.has(part.role) || !part.triangles?.length) {
          throw new Error('invalid support material parts');
        }
        roles.add(part.role);
        const label = `${m.name} ${{ body: 'support bodies', tine: 'tines', interface: 'top interfaces' }[part.role]}`;
        if (m.materialFormat === 'prusa2') {
          const first = triangles.length / 3;
          for (const p of part.triangles) triangles.push(p);
          volumes.push({ name: label, first, end: triangles.length / 3 });
        } else {
          const id = nextMaterialID++;
          objects.push(`<object id="${id}" type="model" name="${esc(label)}">${meshXML(part.triangles)}</object>`);
          components.push(`<component objectid="${id}"/>`);
          volumes.push({ id, name: label });
        }
        footprint.push(part.triangles);
      }
      const resource = nextMaterialID++;
      if (m.materialFormat === 'prusa2') {
        // PrusaSlicer 2 flattens core component assemblies into separate objects.
        // Its named triangle ranges keep every upper material with its support.
        if (m.extras?.some((e) => !e.settings?.prusa2)) throw new Error('PrusaSlicer 2 export cannot preserve another slicer’s part settings');
        if (m.colors?.paint.some((p) => !p.name.startsWith('slic3rpe:'))) throw new Error('PrusaSlicer 2 export cannot preserve another slicer’s painting');
        const kept = [], mesh = meshXML(triangles, null, kept);
        const ranges = volumes.map((v) => {
          const first = kept.findIndex((i) => i >= v.first), end = kept.findIndex((i) => i >= v.end);
          return { ...v, first, last: (end < 0 ? kept.length : end) - 1 };
        });
        if (ranges.some((v) => v.first < 0 || v.last < v.first)) throw new Error('empty support material part');
        objects.push(`<object id="${resource}" type="model" name="${name} supports">${mesh}</object>`);
        cfg.prusa2.push(`<object id="${resource}" instances_count="1">${metaXML([['name', `${m.name} supports`]], ' type="object"')}` +
          ranges.map((v) => `<volume firstid="${v.first}" lastid="${v.last}">${metaXML([['name', v.name], ['volume_type', 'ModelPart']], ' type="volume"')}</volume>`).join('') + '</object>');
        prusa2 = true;
      } else {
        objects.push(`<object id="${resource}" type="model" name="${name} supports"><components>${components.join('')}</components></object>`);
        // Bambu/Orca use the assembly's name for every child unless their part
        // metadata names the volumes explicitly. Keep role names on reimport.
        cfg.bambu.push(`<object id="${resource}">${metaXML([['name', `${m.name} supports`]])}` +
          volumes.map((v) => `<part id="${v.id}" subtype="normal_part">${metaXML([['name', v.name]])}</part>`).join('') + '</object>');
        cfg.prusa3.push({ id: resource, object_settings: {}, volumes: volumes.map((v) =>
          ({ id: v.id, type: 'ModelPart', volume_settings: {} })) });
      }
      own = [partId, resource];
    } else if (finTris && finTris.length) {
      objects.push(`<object id="${id(2)}" type="model" name="${name} supports">${meshXML(finTris)}</object>`);
      if (separate) {
        // two objects (three with the interface crest), one shared transform: in
        // register, sliced apart
        own = [partId, id(2)];
        if (iface.length) {
          // The crest is a PART of the supports object, not an object of its own: a
          // slicer drops every object to the plate or refuses it (Orca: "empty first
          // layer"), and the crest starts in mid-air. As a second component of the
          // supports it stands on the plate with them, and takes its own filament
          // per part.
          objects.push(`<object id="${id(3)}" type="model" name="${name} interface">${meshXML(iface)}</object>`,
            `<object id="${id(4)}" type="model" name="${name} supports"><components>` +
            `<component objectid="${id(2)}"/><component objectid="${id(3)}"/></components></object>`);
          own = [partId, id(4)];
        }
      } else {
        // An assembly object so the part and fins import as one locked unit while
        // remaining two distinct meshes.
        objects.push(
          `<object id="${id(3)}" type="model" name="${name}"><components>` +
          `<component objectid="${id(1)}"/><component objectid="${id(2)}"/></components></object>`);
        own = [id(3)];
      }
    }
    // the slicer's parts too: a modifier reaching past the part stays on the bed
    footprint.push(m.partTris, finTris ?? [], slicer?.tris ?? []);
    items.push(...own);
    base = m.materialParts?.length ? nextMaterialID - 1 : slicer?.root ?? id(MATERIALS_ID);
  }

  // One model in the separate form, with supports, or several in either: the items
  // keep their 3MF positions (a single object gets centred by the slicer). On a bed
  // of known size every file is placed, a lone part without supports too: it stands
  // where it was moved to (ui/move.js)
  let t = '';
  if (bed || models.length > 1 || (separate && models.some((m) => m.finTris?.length || m.materialParts?.length))) {
    // placed on a bed of known size (the site's plate, its centre the origin): each
    // where it stands on it, from the bed's corner, as a slicer's bed counts
    const [tx, ty] = bed ? [bed.x / 2, bed.y / 2] : bedShift(footprint);
    t = ` transform="1 0 0 0 1 0 0 0 1 ${fmt(tx)} ${fmt(ty)} 0"`;
  }
  const build = items.map((i) => `<item objectid="${i}"${t}/>`).join('');

  const ns = prusa2 || slic3rpe ? ` xmlns:slic3rpe="${NS_SLIC3RPE}"` : '';
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<model unit="millimeter" xml:lang="en-US" xmlns="${NS_CORE}"${ns}>` +
    '<metadata name="Application">Support Fins</metadata>' +
    (prusa2 ? '<metadata name="slic3rpe:Version3mf">1</metadata>' : '') +
    `<metadata name="Title">${esc(title)}</metadata>` +
    `<resources>${tables.join('')}${objects.join('')}</resources>` +
    `<build>${build}</build></model>`;
  const configs = [];
  if (cfg.prusa2.length) {
    configs.push({ name: 'Metadata/Slic3r_PE_model.config', data: XML_HEAD + `<config>${cfg.prusa2.join('')}</config>` });
  }
  if (cfg.bambu.length) {
    configs.push({ name: 'Metadata/model_settings.config', data: XML_HEAD + `<config>${cfg.bambu.join('')}</config>` });
    if (cfg.prusa3.length) configs.push({ name: 'Metadata/PrusaSlicer3_project.json', data: JSON.stringify({ objects: cfg.prusa3 }) });
  }
  return { xml, configs };
}

const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  `<Default Extension="rels" ContentType="${CT_RELS}"/>` +
  `<Default Extension="model" ContentType="${CT_MODEL}"/>` +
  '<Default Extension="json" ContentType="application/json"/>' +
  '<Default Extension="config" ContentType="application/xml"/></Types>';

const ROOT_RELS = '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  `<Relationship Id="rel0" Target="/3D/3dmodel.model" Type="${REL_3DMODEL}"/></Relationships>`;

/**
 * @param partTris  the model geometry, print space
 * @param finTris   the fins + pad, print space (may be empty)
 * @param name      written as the model Title (and the objects' names)
 * @param opts      { separate, session }: separate true = part and fins as two
 *                  objects (see the header), default false = one locked object;
 *                  session = the site's state, written to SESSION_PART
 *                  { iface }: the interface crest's triangles (prop/crest.js),
 *                  written separate as a second part of the supports object,
 *                  "<name> interface", for the slicer to give a second filament
 *                  { colors }: the part's PartColors, by triangle of partTris
 *                  { extras }: a slicer's parts to write back beside the part
 *                  (readThreeMF's, with `tris` in print space; extrasXML), in
 *                  the separate form only
 *                  { materialParts }: optional validated {role, triangles} parts,
 *                  replacing finTris/iface; requires separate=true. materialFormat
 *                  is 'components' (Bambu/Orca) or 'prusa2' (named volume ranges).
 * @returns Promise<Blob>  a .3mf package (deflated: zip.js zipDeflate, which is async)
 */
export function writeThreeMF(partTris, finTris, name = 'Support Fins',
  { separate = false, session = null, iface = [], colors = null, extras = [], materialParts = null, materialFormat = 'components' } = {}) {
  return writePlate3MF([{ partTris, finTris, name, iface, colors, extras, materialParts, materialFormat }], { title: name, separate, session });
}

/**
 * Several models on one plate in one 3MF: `models` is a list of { partTris, finTris,
 * name, iface, colors, extras }, as writeThreeMF takes one, each already where it
 * stands on the plate (print space). Each keeps its own objects -- the part, its
 * supports, its slicer parts -- and every item one shared bed shift: the arrangement opens with its spacing kept, its footprint
 * centred on the bed as a one-model file's is (bedShift) -- or, given the `bed` the
 * models were placed on ({ x, y } mm, print space's origin its centre), each where
 * it stands on it.
 * @param opts { title, separate, session, bed }: as writeThreeMF's, and `bed`
 * @returns Promise<Blob> a .3mf package (deflated)
 */
export function writePlate3MF(models, { title = models[0]?.name ?? 'Support Fins', separate = false, session = null, bed = null } = {}) {
  const { xml, configs } = modelXML(models, title, separate, bed);
  const entries = [
    { name: '[Content_Types].xml', data: CONTENT_TYPES },
    { name: '_rels/.rels', data: ROOT_RELS },
    { name: '3D/3dmodel.model', data: xml },
    ...configs,
  ];
  if (session) entries.push({ name: SESSION_PART, data: JSON.stringify(session) });
  return zipDeflate(entries);
}

/**
 * A slicer's non-printing parts written back (GitHub #104), each in the same
 * kind it came in as, its settings verbatim (PLACEMENT_KEY's note), its mesh in
 * print space beside the part's. Two layouts, by where they came from:
 *   - Bambu Studio, OrcaSlicer, PrusaSlicer 3: the part object is an assembly,
 *     one component per part, and BOTH configs name them -- each slicer reads
 *     its own (a Bambu file opened in PrusaSlicer 3 keeps its negative parts;
 *     its modifiers come without settings, which are in Bambu's own words).
 *     Neither config is read for a file whose Application is the slicer's own
 *     but has no printer profile beside it (PrusaSlicer 3 refuses it, Bambu and
 *     Orca leave the parts solid), so the Application stays "Support Fins".
 *   - PrusaSlicer 2: one mesh holding every part, each a triangle range in
 *     Slic3r_PE_model.config, the layout PrusaSlicer 2 writes and reads.
 * The part keeps its colours; the slicer parts are uncoloured. Ids, past the
 * model's `base` (modelXML): 1 the part, 2-4 the supports, MATERIALS_ID the
 * colours, then the slicer parts, then their assembly.
 * @returns { root, objects, tris, bambu, prusa3 } for the assembly, or { prusa2,
 * tris, config }; `tris` every slicer part's, for the bed shift; bambu / prusa3 /
 * config this model's entry in its slicer's config, which modelXML writes once
 * for every model of the plate
 */
const BAMBU_SUBTYPE = { part: 'normal_part', negative: 'negative_part', modifier: 'modifier_part', blocker: 'support_blocker', enforcer: 'support_enforcer' };
const PRUSA_TYPE = { part: 'ModelPart', negative: 'NegativeVolume', modifier: 'ParameterModifier', blocker: 'SupportBlocker', enforcer: 'SupportEnforcer' };
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n';
const metaXML = (pairs, type = '') =>
  pairs.map(([k, v]) => `<metadata${type} key="${esc(k)}" value="${esc(v)}"/>`).join('');

function extrasXML(partTris, extras, title, col, base = 0) {
  const name = esc(title);
  const settingsOf = (e, from) => e.settings?.[from] ?? null;
  if (extras.some((e) => e.settings?.prusa2)) {
    const kept = [];
    const all = [...partTris];
    const ends = [partTris.length / 3];
    for (const e of extras) { all.push(...e.tris); ends.push(all.length / 3); }
    const mesh = meshXML(all, (i) => (i < ends[0] && col.triAttrs ? col.triAttrs(i) : ''), kept);
    // the ranges are of the triangles WRITTEN (meshXML drops degenerate ones)
    const firsts = ends.map((end) => kept.findIndex((t) => t >= end)).map((i) => (i < 0 ? kept.length : i));
    const vols = [{ kind: null, name: title, settings: [] }, ...extras].map((e, k) => {
      const first = k ? firsts[k - 1] : 0, last = firsts[k] - 1;
      if (last < first) return '';
      const pairs = [['name', e.name || title], ['volume_type', e.kind ? PRUSA_TYPE[e.kind] : 'ModelPart'],
        ...(settingsOf(e, 'prusa2') ?? [])];
      return `<volume firstid="${first}" lastid="${last}">${metaXML(pairs, ' type="volume"')}</volume>`;
    }).join('');
    return {
      tris: extras.flatMap((e) => e.tris),
      prusa2: `<object id="${base + 1}" type="model" name="${name}"${col.pid}>${mesh}</object>`,
      config: `<object id="${base + 1}" instances_count="1">${metaXML([['name', title]], ' type="object"')}${vols}</object>`,
    };
  }

  // past the model's part, supports (base + 1-4) and colour table (base + MATERIALS_ID)
  const ids = extras.map((_, k) => base + MATERIALS_ID + 1 + k);
  const root = base + MATERIALS_ID + 1 + extras.length;
  const objects = extras.map((e, k) =>
    `<object id="${ids[k]}" type="model" name="${esc(e.name || e.kind)}">${meshXML(e.tris)}</object>`);
  objects.push(`<object id="${root}" type="model" name="${name}"><components><component objectid="${base + 1}"/>` +
    ids.map((id) => `<component objectid="${id}"/>`).join('') + '</components></object>');
  const bambu = `<object id="${root}">${metaXML([['name', title]])}` +
    `<part id="${base + 1}" subtype="normal_part">${metaXML([['name', title]])}</part>` +
    extras.map((e, k) => `<part id="${ids[k]}" subtype="${BAMBU_SUBTYPE[e.kind]}">` +
      metaXML([['name', e.name || e.kind], ...(settingsOf(e, 'bambu') ?? [])]) + '</part>').join('') +
    '</object>';
  // PrusaSlicer 3 asserts on a volume without its volume_settings object
  const prusa3 = { id: root, object_settings: {}, volumes: [
    { id: base + 1, type: 'ModelPart', volume_settings: {} },
    ...extras.map((e, k) => ({ id: ids[k], type: PRUSA_TYPE[e.kind], volume_settings: settingsOf(e, 'prusa3') ?? {} })),
  ] };
  return { root, objects, tris: extras.flatMap((e) => e.tris), bambu, prusa3 };
}
