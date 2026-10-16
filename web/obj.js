/**
 * Wavefront OBJ reader: text in, the same { objects } list the 3MF and STEP
 * readers give, so the object picker and everything after it are unchanged.
 *
 * Only geometry is read: `v` (position; a trailing vertex colour is ignored),
 * `f` (any polygon, fanned into triangles; `v`, `v/vt`, `v//vn` and `v/vt/vn`
 * references, negative ones counting back from the latest vertex) and `o`, which
 * starts a new object. Groups (`g`) and materials (`usemtl`) stay inside their
 * object: exporters use them for a part's colour regions, and splitting on them
 * would hand the picker a model in pieces. Lines (`l`), points, curves and
 * texture/normal data are skipped. OBJ carries no unit, so it is read as mm, as
 * a slicer does.
 */

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

/**
 * Sniff an OBJ from the content. It is text (a binary STL's triangle count and
 * attribute words put NUL bytes in its first kilobyte), it is not an ASCII STL
 * ("solid"), and it has a vertex line.
 */
export function isObj(buffer) {
  const head = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 1024));
  if (head.length === 0 || head.includes(0)) return false;
  const text = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 65536)));
  if (/^﻿?\s*solid\b/i.test(text)) return false;
  return /^[ \t]*v[ \t]+[-+.\d]/m.test(text);
}

/**
 * @param bytes  Uint8Array of the whole file
 * @returns { objects: [{ name, positions:Float32Array, tris, meshes, bbox }] }
 */
export function readOBJ(bytes) {
  let text;
  try { text = new TextDecoder().decode(bytes); } catch (err) {
    if (err instanceof RangeError) throw new Error('OBJ is too large to read in a browser: export it as a binary STL or 3MF');
    throw err;
  }
  if (!text.includes('\n')) text = text.replace(/\r/g, '\n');   // old Mac: CR-only lines
  if (text.includes('\\')) text = text.replace(/\\(\r\n|\r|\n)/g, ' ');   // `\` continues a line
  let verts = new Float64Array(3 * 1024), nv = 0;   // x, y, z per vertex, in file order
  const objects = [];
  let cur = null;
  const start = (name) => {
    cur = { name: name || `object ${objects.length + 1}`, out: new Float32Array(9 * 1024), n: 0 };
    objects.push(cur);
  };
  const grow = (a, need) => {
    if (need <= a.length) return a;
    const b = new a.constructor(Math.max(need, a.length * 2));
    b.set(a);
    return b;
  };

  const index = (tok, line) => {
    const i = parseInt(tok, 10);        // "12/4/7" -> 12: the position is first
    const n = nv / 3;
    const k = i > 0 ? i - 1 : i < 0 ? n + i : NaN;
    if (!(k >= 0 && k < n)) throw new Error(`OBJ face points at a vertex that isn't there (line ${line}: ${tok})`);
    return k * 3;
  };

  // Line by line over the one string: a 2M-triangle file splits into millions of
  // line strings otherwise.
  for (let pos = 0, ln = 0; pos < text.length; ln++) {
    let end = text.indexOf('\n', pos);
    if (end < 0) end = text.length;
    const line = text.slice(pos, end);
    pos = end + 1;
    const hash = line.indexOf('#');
    const s = (hash < 0 ? line : line.slice(0, hash)).trim();
    if (s.length < 2) continue;
    const sp = s.search(/\s/);
    if (sp < 0) continue;
    const key = s.slice(0, sp);
    const rest = s.slice(sp + 1).trim();
    if (key === 'v') {
      const p = rest.split(/\s+/);
      verts = grow(verts, nv + 3);
      for (let k = 0; k < 3; k++) {
        const x = Number(p[k]);
        if (!Number.isFinite(x)) throw new Error(`OBJ has a bad vertex (line ${ln + 1}: ${s})`);
        verts[nv++] = x;
      }
    } else if (key === 'f') {
      if (!cur) start('');
      const ix = rest.split(/\s+/).map((tok) => index(tok, ln + 1));
      // A polygon fans from its first corner: right for the convex faces
      // exporters write (and every triangle and quad that isn't bow-tied).
      cur.out = grow(cur.out, cur.n + 9 * Math.max(0, ix.length - 2));
      for (let j = 1; j + 1 < ix.length; j++) {
        for (const a of [ix[0], ix[j], ix[j + 1]]) {
          cur.out[cur.n++] = verts[a]; cur.out[cur.n++] = verts[a + 1]; cur.out[cur.n++] = verts[a + 2];
        }
      }
    } else if (key === 'o') {
      // A new object, unless the current one has no faces yet (a name line
      // before its first face, or an `o` that only held lines).
      if (cur && cur.n === 0) cur.name = rest || cur.name;
      else start(rest);
    }
  }

  const solid = objects.filter((o) => o.n);
  if (solid.length === 0) throw new Error('OBJ has no faces');
  return {
    objects: solid.map((o) => {
      const positions = o.out.slice(0, o.n);
      return { name: o.name, positions, tris: positions.length / 9, meshes: 1, bbox: bbox(positions) };
    }),
  };
}
