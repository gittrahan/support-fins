/**
 * STL reader + binary STL writer.
 *
 * Written here rather than pulled in, because the export is the product: it has
 * to emit the part in its CHOSEN ORIENTATION, seated on the plate, with the fins
 * as additional solids in the same file. That is a handful of lines over a
 * DataView, and owning it means the byte layout is not a mystery when a slicer
 * complains.
 *
 * Layout: 80-byte header, uint32 triangle count, then per triangle 12 little-
 * endian float32 (normal, then three vertices) and a uint16 attribute word.
 */

const HEADER = 80;
const PER_TRI = 50;

/**
 * @param tris  flat array of vertices, three per triangle, each [x, y, z]
 * @param name  written into the header for provenance
 * @returns Blob
 */
export function writeBinarySTL(tris, name = 'Support Fins') {
  const count = Math.floor(tris.length / 3);
  const buf = new ArrayBuffer(HEADER + 4 + count * PER_TRI);
  const view = new DataView(buf);

  // Plain hyphen, not an em dash: the & 0x7f mask below turns an em dash into
  // control byte 0x14 rather than dropping it.
  const header = `${name} - support-fins`.slice(0, 79);
  for (let i = 0; i < header.length; i++) view.setUint8(i, header.charCodeAt(i) & 0x7f);

  view.setUint32(HEADER, count, true);

  let o = HEADER + 4;
  for (let t = 0; t < count; t++) {
    const a = tris[t * 3], b = tris[t * 3 + 1], c = tris[t * 3 + 2];

    // Facet normal from the winding. Some slicers ignore it, some do not; an
    // inconsistent normal is the kind of thing that shows up as a flipped face
    // in one program and not another.
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len > 1e-12) { nx /= len; ny /= len; nz /= len; } else { nx = ny = nz = 0; }

    view.setFloat32(o, nx, true);
    view.setFloat32(o + 4, ny, true);
    view.setFloat32(o + 8, nz, true);
    for (let i = 0; i < 3; i++) {
      const p = [a, b, c][i];
      view.setFloat32(o + 12 + i * 12, p[0], true);
      view.setFloat32(o + 16 + i * 12, p[1], true);
      view.setFloat32(o + 20 + i * 12, p[2], true);
    }
    view.setUint16(o + 48, 0, true);
    o += PER_TRI;
  }

  return new Blob([buf], { type: 'model/stl' });
}

/**
 * Binary or ASCII STL -> flat triangle soup (9 floats per face, as the file has
 * them). The site itself parses with three.js's STLLoader (ui/io.js); this one is
 * for the command line and the tests, where there is no three.js.
 *
 * Binary is decided by SIZE, not by the "solid" prefix: plenty of CAD exporters
 * (SolidWorks among them) start a binary file's header with "solid", and reading
 * one as text gives an empty part instead of an error. Some exporters also leave
 * bytes after the last triangle; three.js reads those files, so we do too: a file
 * at least as long as its triangle count says is binary unless it reads as ASCII
 * (a "solid" line and a "facet" soon after).
 *
 * @param bytes  Uint8Array of the whole file
 * @returns Float32Array
 */
export function readSTL(bytes) {
  const head = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 1024)));
  const looksAscii = /^\uFEFF?\s*solid/i.test(head) && /\bfacet\b/i.test(head);
  if (bytes.length >= HEADER + 4) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const n = dv.getUint32(HEADER, true);
    const need = HEADER + 4 + n * PER_TRI;
    if (bytes.length === need || (n > 0 && bytes.length > need && !looksAscii)) {
      if (n === 0) throw new Error('STL has no triangles');
      const pos = new Float32Array(n * 9);
      for (let f = 0; f < n; f++) {
        const o = HEADER + 4 + f * PER_TRI + 12;
        for (let i = 0; i < 9; i++) pos[f * 9 + i] = dv.getFloat32(o + i * 4, true);
      }
      return pos;
    }
  }
  if (!/^\uFEFF?\s*solid/i.test(head)) {
    throw new Error('not an STL: too short for binary and no "solid" line for ASCII (truncated file?)');
  }
  return readAsciiSTL(new TextDecoder().decode(bytes));
}

function readAsciiSTL(text) {
  const out = [];
  const re = /\bvertex\s+(\S+)\s+(\S+)\s+(\S+)/gi;
  for (let m; (m = re.exec(text));) {
    for (let k = 1; k <= 3; k++) {
      const v = Number(m[k]);
      if (!Number.isFinite(v)) throw new Error(`ASCII STL has a bad vertex: ${m[0]}`);
      out.push(v);
    }
  }
  if (out.length === 0) throw new Error('STL has no triangles');
  if (out.length % 9 !== 0) throw new Error('ASCII STL has a facet without three vertices (truncated file?)');
  return Float32Array.from(out);
}

/** Trigger a download without touching the network. */
export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
