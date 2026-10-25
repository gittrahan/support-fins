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

import { zipStore, unzip } from './zip.js';
import { filamentPainter } from './paintcode.js';

const NS_CORE = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const REL_3DMODEL = 'http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel';
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

/**
 * A part's colours (GitHub #236), so a painted part keeps them through the export.
 * PartColors = { paint, rgb }, both sparse arrays by triangle index (a hole is an
 * uncoloured triangle):
 *   paint[i]  { name, v }: a slicer's painted-colour attribute, verbatim -- Bambu
 *             Studio / OrcaSlicer write paint_color, PrusaSlicer its own
 *             slic3rpe:mmu_segmentation. Each reads only its own name, so it goes
 *             back out under the name it came in with.
 *   rgb[i]    '#RRGGBB[AA]': the core spec's colour (a <basematerials> or
 *             <m:colorgroup> entry), written back as one <basematerials> table.
 * The fins stay uncoloured: they are their own object, on whatever filament the
 * slicer gives them.
 */
export const PAINT_ATTRS = ['paint_color', 'slic3rpe:mmu_segmentation'];
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
    const iface = m.iface ?? [];
    let finTris = m.finTris;
    // a negative part cuts every part of its object: only apart from the supports
    // can it ride along without cutting the walls built in its hole
    const slicer = separate && m.extras?.length ? extrasXML(m.partTris, m.extras, m.name, col, base) : null;
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

    if (finTris && finTris.length) {
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
    base = slicer?.root ?? id(MATERIALS_ID);
  }

  // One model in the separate form, with supports, or several in either: the items
  // keep their 3MF positions (a single object gets centred by the slicer). On a bed
  // of known size every file is placed, a lone part without supports too: it stands
  // where it was moved to (ui/move.js)
  let t = '';
  if (bed || models.length > 1 || (separate && models.some((m) => m.finTris?.length))) {
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
    configs.push({ name: 'Metadata/model_settings.config', data: XML_HEAD + `<config>${cfg.bambu.join('')}</config>` },
      { name: 'Metadata/PrusaSlicer3_project.json', data: JSON.stringify({ objects: cfg.prusa3 }) });
  }
  return { xml, configs };
}

const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  `<Default Extension="rels" ContentType="${CT_RELS}"/>` +
  `<Default Extension="model" ContentType="${CT_MODEL}"/>` +
  '<Default Extension="json" ContentType="application/json"/>' +
  '<Default Extension="config" ContentType="application/xml"/></Types>';

/**
 * The site's own state, carried beside the model so a 3MF it exported can be
 * opened again with the supports the user placed by hand (#214): the drawn walls
 * as points, the fin mode and the settings. A slicer ignores an extra part in the
 * package; a re-save in one drops it, and the file then opens as a plain part.
 */
export const SESSION_PART = 'Metadata/support_fins.json';

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
 * @returns Blob    a .3mf package
 */
export function writeThreeMF(partTris, finTris, name = 'Support Fins',
  { separate = false, session = null, iface = [], colors = null, extras = [] } = {}) {
  return writePlate3MF([{ partTris, finTris, name, iface, colors, extras }], { title: name, separate, session });
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
 * @returns Blob a .3mf package
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
  return zipStore(entries);
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
const BAMBU_SUBTYPE = { negative: 'negative_part', modifier: 'modifier_part', blocker: 'support_blocker', enforcer: 'support_enforcer' };
const PRUSA_TYPE = { negative: 'NegativeVolume', modifier: 'ParameterModifier', blocker: 'SupportBlocker', enforcer: 'SupportEnforcer' };
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
 * Walk XML, calling onOpen(name, attrs, selfClosing) and onClose(name).
 * Attribute parsing honours quotes, so a value containing '>' (legal, and Bambu
 * writes object names verbatim) does not cut the tag short.
 */
export function scanXML(xml, onOpen, onClose) {
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) break;
    // Declarations, comments, CDATA: skip wholesale, none carry geometry.
    if (xml.startsWith('<!--', lt)) { i = xml.indexOf('-->', lt); i = i < 0 ? n : i + 3; continue; }
    if (xml.startsWith('<![CDATA[', lt)) { i = xml.indexOf(']]>', lt); i = i < 0 ? n : i + 3; continue; }
    if (xml.startsWith('<?', lt) || xml.startsWith('<!', lt)) {
      i = xml.indexOf('>', lt); i = i < 0 ? n : i + 1; continue;
    }
    if (xml[lt + 1] === '/') {
      const gt = xml.indexOf('>', lt);
      if (gt < 0) break;
      onClose(xml.slice(lt + 2, gt).trim());
      i = gt + 1;
      continue;
    }

    // Element name, then attributes up to an unquoted '>' or '/>'.
    let p = lt + 1;
    while (p < n && !/[\s/>]/.test(xml[p])) p++;
    const name = xml.slice(lt + 1, p);
    const attrs = {};
    let selfClosing = false;
    while (p < n) {
      while (p < n && /\s/.test(xml[p])) p++;
      if (xml[p] === '/' && xml[p + 1] === '>') { selfClosing = true; p += 2; break; }
      if (xml[p] === '>') { p++; break; }
      const nameStart = p;
      while (p < n && !/[\s=/>]/.test(xml[p])) p++;
      const attr = xml.slice(nameStart, p);
      while (p < n && /\s/.test(xml[p])) p++;
      if (xml[p] !== '=') { if (attr) attrs[attr] = ''; continue; }
      p++;
      while (p < n && /\s/.test(xml[p])) p++;
      const q = xml[p];
      let value;
      if (q === '"' || q === "'") {
        const end = xml.indexOf(q, p + 1);
        value = xml.slice(p + 1, end < 0 ? n : end);
        p = end < 0 ? n : end + 1;
      } else {
        const start = p;
        while (p < n && !/[\s/>]/.test(xml[p])) p++;
        value = xml.slice(start, p);
      }
      attrs[attr] = value;
    }
    onOpen(name, attrs, selfClosing);
    i = p;
  }
}

// Strip any namespace prefix: a writer may emit <m:object>, and the core
// elements are unambiguous by local name.
const local = (tag) => {
  const c = tag.indexOf(':');
  return c < 0 ? tag : tag.slice(c + 1);
};

/**
 * An attribute by LOCAL name. The production extension is conventionally the
 * `p:` prefix (p:path, p:UUID), but the prefix is the file's to choose, so we
 * match on the part after the colon rather than assume `p:`.
 */
function attrLocal(attrs, lname) {
  if (attrs[lname] !== undefined) return attrs[lname];
  for (const k in attrs) if (local(k) === lname) return attrs[k];
  return undefined;
}

// A p:path / relationship Target -> a package part name (zip entries have no
// leading slash; a 3MF path is absolute from the package root).
const partName = (path) => path.replace(/^\//, '');

/**
 * A 3MF matrix is 12 numbers, row-major, translation last, applied to a ROW
 * vector: p' = p * M3 + t. Kept as that same flat 12 for composition.
 */
function parseMatrix(s) {
  if (!s) return null;
  const v = s.trim().split(/\s+/).map(Number);
  if (v.length !== 12 || v.some((x) => !Number.isFinite(x))) return null;
  return v;
}

/** b applied after a, as one matrix (row-vector convention). */
function compose(a, b) {
  if (!a) return b;
  if (!b) return a;
  const m = new Array(12);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      m[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  for (let c = 0; c < 3; c++) {
    m[9 + c] = a[9] * b[c] + a[10] * b[3 + c] + a[11] * b[6 + c] + b[9 + c];
  }
  return m;
}

/**
 * Object types that are not printable solid geometry. `support` and `surface`
 * are not closed bodies and `other` is explicitly non-printable, so pulling
 * them in as part geometry would poison the overhang analysis. `model` and
 * `solidsupport` are kept; a missing type means `model` per the spec.
 */
const SKIP_TYPES = new Set(['support', 'surface', 'other']);

/** Parse one 3D/*.model part into { objects, items, unit }. */
function parseModelXML(xml, strict = false) {
  const objects = new Map();   // id -> { type, name, verts, tris, components, paint, rgb }
  const items = [];            // { objectid, transform }
  const groups = new Map();    // material/colour group id -> ['#RRGGBB', ...]
  const codes = new Map();     // paint string -> its own copy, shared by every repeat
  let unit = 'millimeter';
  let cur = null;              // object being filled
  let group = null;            // <basematerials>/<colorgroup> being filled
  let inVertices = false;
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
    switch (local(tag)) {
      case 'model':
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
    if (t === 'object') cur = null;
    else if (t === 'vertices') inVertices = false;
    else if (t === 'basematerials' || t === 'colorgroup') group = null;
  });

  return { objects, items, unit };
}

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

const stripExt = (s) => s.replace(/\.(stl|3mf|obj|step|stp)$/i, '');

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
function parseBambuConfig(configXML, filaments) {
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
function addPrusa3Parts(json, parts, filaments) {
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
function parsePrusaConfig(configXML, filaments) {
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

function emitObject(getPart, path, id, m, sink, seen, stats, role = null, roles = null, orient = false, fil = 0) {
  const part = getPart(path);
  const obj = part && part.objects.get(id);
  if (!obj) { stats.missing++; return; }        // dangling ref: a broken file
  const key = `${path} ${id}`;
  if (seen.has(key)) { stats.cycles = (stats.cycles ?? 0) + 1; return; }
  // Bambu writes a non-printing part as type="other": the config naming it wins,
  // so it is kept by kind instead of skipped as unknown geometry.
  if (SKIP_TYPES.has(obj.type) && !role) { stats.skipped++; return; }
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
    const { out, col } = sink(r);
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

  for (const c of obj.components) {
    const childPath = c.path ? partName(c.path) : path;
    emitObject(getPart, childPath, c.objectid, compose(c.transform, m), sink, seen, stats,
      named(roles?.parts?.get(c.objectid)) ?? role,
      roles && { ranges: roles.ranges, filRanges: roles.filRanges, filObject: roles.filObject, paint: roles.paint }, orient,
      roles?.filament?.parts.get(c.objectid) || fil);
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
 */
export function readThreeMFParts(parts, { buildIndex = null, doublePrecision = false, outwardWinding = false } = {}) {

  const rootName = findRootPart(parts);
  if (!rootName || !parts.has(rootName)) throw new Error('no 3D model part found in this 3MF');

  // Parse each part on demand and cache it -- a plate can reference the same
  // object_N.model many times, and most parts in a big package go untouched.
  const parsed = new Map();
  const getPart = (name) => {
    if (parsed.has(name)) return parsed.get(name);
    const data = parts.get(name);
    const p = data ? parseModelXML(new TextDecoder().decode(data), buildIndex !== null) : null;
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
      filament?.object ?? 0);
    if (buildIndex !== null && (stats.missing || stats.dropped || stats.cycles)) {
      throw new Error('selected object has missing resources, cyclic components or invalid triangle references');
    }
    // Fold stats first: a build item that was ALL support/dangling emits nothing
    // but its skipped count still has to be reported, not dropped with the item.
    agg.meshes += stats.meshes; agg.skipped += stats.skipped; agg.dropped += stats.dropped;
    // all-skipped/dangling item, or one with only non-printing parts: not a pickable body
    if (!main.out.length) continue;

    const positions = toMM(main.out);
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
        .map(([role, s]) => ({ kind: role.kind, name: role.name, settings: role.settings, positions: toMM(s.out) })),
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
