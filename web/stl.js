/**
 * Binary STL writer.
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

  const header = `${name} — support-fins`.slice(0, 79);
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
