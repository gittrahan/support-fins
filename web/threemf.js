/**
 * 3MF writer (core spec, 2015/02 namespace).
 *
 * Why 3MF alongside the STL: it carries the two things a raw STL cannot, both
 * of which matter to this tool specifically --
 *   1. UNITS. STL is unitless, so a slicer has to guess millimeters; a mis-guess
 *      is the classic "my part imported at 1/25 scale" bug. 3MF states mm.
 *   2. SEPARATE OBJECTS. The part and the fins go in as two distinct meshes
 *      assembled by <components> into one build item. They stay locked in the
 *      right relative position (the fins only work where they were placed), and
 *      a slicer shows the fins as their own selectable/colorable body -- so the
 *      breakaway support reads as support, not as part of the model.
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

import { zipStore } from './zip.js';

const NS_CORE = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
// Production extension. We declare it (but never list it in `requiredextensions`,
// so a reader that doesn't know it just ignores the p:* attributes) purely to
// carry a p:UUID on every object, the build, and each build item. PrusaSlicer's
// and Bambu/Orca's 3MF readers use those UUIDs to reconstruct the object tree
// faithfully; WITHOUT them a multi-body file (our part + fins) falls back to a
// grouping/arrange heuristic that spreads the bodies out or drops them to the
// bed -- the "geometry is not as expected" import that this tool kept hitting.
const NS_PROD = 'http://schemas.microsoft.com/3dmanufacturing/production/2015/06';
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
function meshXML(tris) {
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
    if (idx[0] !== idx[1] && idx[1] !== idx[2] && idx[0] !== idx[2]) faces.push(idx);
  }

  const v = new Array(verts.length);
  for (let i = 0; i < verts.length; i++) {
    const p = verts[i];
    v[i] = `<vertex x="${fmt(p[0])}" y="${fmt(p[1])}" z="${fmt(p[2])}"/>`;
  }
  const f = new Array(faces.length);
  for (let i = 0; i < faces.length; i++) {
    const t = faces[i];
    f[i] = `<triangle v1="${t[0]}" v2="${t[1]}" v3="${t[2]}"/>`;
  }
  return `<mesh><vertices>${v.join('')}</vertices><triangles>${f.join('')}</triangles></mesh>`;
}

// A v4 UUID for the production extension. crypto.randomUUID exists in every
// browser we target and in Node; the fallback keeps the writer working anywhere.
function uuid() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch (_) { /* fall through */ }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// The 3MF production extension requires every <component> to carry an identity
// (or real) transform. Stating it explicitly -- rather than relying on the
// "absent = identity" default -- stops slicers that auto-arrange an un-placed
// body from moving the fins off the part.
const IDENTITY = '1 0 0 0 1 0 0 0 1 0 0 0';

function modelXML(partTris, finTris, title) {
  const objects = [`<object id="1" type="model" p:UUID="${uuid()}">${meshXML(partTris)}</object>`];
  let buildId = 1;

  if (finTris && finTris.length) {
    objects.push(`<object id="2" type="model" p:UUID="${uuid()}">${meshXML(finTris)}</object>`);
    // An assembly object so the part and fins import as one locked unit while
    // remaining two distinct meshes. Each component states an explicit identity
    // transform and every object/item carries a p:UUID so the reader keeps the
    // relative placement instead of re-arranging the bodies.
    objects.push(
      `<object id="3" type="model" p:UUID="${uuid()}"><components>` +
      `<component objectid="1" transform="${IDENTITY}"/>` +
      `<component objectid="2" transform="${IDENTITY}"/></components></object>`);
    buildId = 3;
  }

  const safeTitle = String(title).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<model unit="millimeter" xml:lang="en-US" xmlns="${NS_CORE}" xmlns:p="${NS_PROD}">` +
    '<metadata name="Application">Support Fins</metadata>' +
    `<metadata name="Title">${safeTitle}</metadata>` +
    `<resources>${objects.join('')}</resources>` +
    `<build><item objectid="${buildId}" p:UUID="${uuid()}"/></build></model>`;
}

const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  `<Default Extension="rels" ContentType="${CT_RELS}"/>` +
  `<Default Extension="model" ContentType="${CT_MODEL}"/></Types>`;

const ROOT_RELS = '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  `<Relationship Id="rel0" Target="/3D/3dmodel.model" Type="${REL_3DMODEL}"/></Relationships>`;

/**
 * @param partTris  the model geometry, print space
 * @param finTris   the fins + pad, print space (may be empty)
 * @param name      written as the model Title
 * @returns Blob    a .3mf package
 */
export function writeThreeMF(partTris, finTris, name = 'Support Fins') {
  return zipStore([
    { name: '[Content_Types].xml', data: CONTENT_TYPES },
    { name: '_rels/.rels', data: ROOT_RELS },
    { name: '3D/3dmodel.model', data: modelXML(partTris, finTris, name) },
  ]);
}
