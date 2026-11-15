/** 3MF vocabulary both halves share: the package entries and paint attributes
 *  the site writes and reads, and the small XML helpers (tag scanner, matrices). */

export const REL_3DMODEL = 'http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel';

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

/**
 * The site's own state, carried beside the model so a 3MF it exported can be
 * opened again with the supports the user placed by hand (#214): the drawn walls
 * as points, the fin mode and the settings. A slicer ignores an extra part in the
 * package; a re-save in one drops it, and the file then opens as a plain part.
 */
export const SESSION_PART = 'Metadata/support_fins.json';

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
export const local = (tag) => {
  const c = tag.indexOf(':');
  return c < 0 ? tag : tag.slice(c + 1);
};

/**
 * An attribute by LOCAL name. The production extension is conventionally the
 * `p:` prefix (p:path, p:UUID), but the prefix is the file's to choose, so we
 * match on the part after the colon rather than assume `p:`.
 */
export function attrLocal(attrs, lname) {
  if (attrs[lname] !== undefined) return attrs[lname];
  for (const k in attrs) if (local(k) === lname) return attrs[k];
  return undefined;
}

// A p:path / relationship Target -> a package part name (zip entries have no
// leading slash; a 3MF path is absolute from the package root).
export const partName = (path) => path.replace(/^\//, '');

/**
 * A 3MF matrix is 12 numbers, row-major, translation last, applied to a ROW
 * vector: p' = p * M3 + t. Kept as that same flat 12 for composition.
 */
export function parseMatrix(s) {
  if (!s) return null;
  const v = s.trim().split(/\s+/).map(Number);
  if (v.length !== 12 || v.some((x) => !Number.isFinite(x))) return null;
  return v;
}

/** b applied after a, as one matrix (row-vector convention). */
export function compose(a, b) {
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
