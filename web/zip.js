/**
 * Minimal ZIP writer -- STORE method only (no compression).
 *
 * A .3mf is an OPC package, which is just a ZIP with a fixed set of parts. We
 * write it here rather than pull in a compression library for the same reason
 * stl.js hand-rolls the STL: the container is part of the product, and a stored
 * (uncompressed) archive is a few hundred bytes over a DataView. Slicers read
 * stored entries fine -- 3MF text parts are small and compress poorly anyway.
 *
 * Layout per the ZIP APPNOTE: a local file header + data per entry, then the
 * central directory, then the end-of-central-directory record.
 */

// CRC-32 (IEEE 802.3), table built once.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const enc = new TextEncoder();

/**
 * @param files  [{ name, data }] where data is a string or Uint8Array. `name`
 *               uses forward slashes and is stored verbatim (ASCII expected).
 * @returns Blob  the .zip / .3mf payload
 */
export function zipStore(files) {
  const entries = files.map(({ name, data }) => {
    const nameBytes = enc.encode(name);
    const bytes = typeof data === 'string' ? enc.encode(data) : data;
    return { nameBytes, bytes, crc: crc32(bytes), offset: 0 };
  });

  // 30-byte fixed local header + name + data; 46-byte fixed central header + name.
  let localSize = 0;
  for (const e of entries) localSize += 30 + e.nameBytes.length + e.bytes.length;
  let centralSize = 0;
  for (const e of entries) centralSize += 46 + e.nameBytes.length;

  const buf = new ArrayBuffer(localSize + centralSize + 22);
  const view = new DataView(buf);
  const out = new Uint8Array(buf);
  let o = 0;

  for (const e of entries) {
    e.offset = o;
    view.setUint32(o, 0x04034b50, true);     // local file header signature
    view.setUint16(o + 4, 20, true);         // version needed to extract
    view.setUint16(o + 6, 0, true);          // flags
    view.setUint16(o + 8, 0, true);          // method: 0 = store
    view.setUint16(o + 10, 0, true);         // mod time
    view.setUint16(o + 12, 0x21, true);      // mod date (1980-01-01, arbitrary)
    view.setUint32(o + 14, e.crc, true);
    view.setUint32(o + 18, e.bytes.length, true);   // compressed size
    view.setUint32(o + 22, e.bytes.length, true);   // uncompressed size
    view.setUint16(o + 26, e.nameBytes.length, true);
    view.setUint16(o + 28, 0, true);         // extra field length
    o += 30;
    out.set(e.nameBytes, o); o += e.nameBytes.length;
    out.set(e.bytes, o); o += e.bytes.length;
  }

  const centralStart = o;
  for (const e of entries) {
    view.setUint32(o, 0x02014b50, true);     // central directory header signature
    view.setUint16(o + 4, 20, true);         // version made by
    view.setUint16(o + 6, 20, true);         // version needed
    view.setUint16(o + 8, 0, true);          // flags
    view.setUint16(o + 10, 0, true);         // method
    view.setUint16(o + 12, 0, true);         // mod time
    view.setUint16(o + 14, 0x21, true);      // mod date
    view.setUint32(o + 16, e.crc, true);
    view.setUint32(o + 20, e.bytes.length, true);
    view.setUint32(o + 24, e.bytes.length, true);
    view.setUint16(o + 28, e.nameBytes.length, true);
    view.setUint16(o + 30, 0, true);         // extra length
    view.setUint16(o + 32, 0, true);         // comment length
    view.setUint16(o + 34, 0, true);         // disk number start
    view.setUint16(o + 36, 0, true);         // internal attributes
    view.setUint32(o + 38, 0, true);         // external attributes
    view.setUint32(o + 42, e.offset, true);  // local header offset
    o += 46;
    out.set(e.nameBytes, o); o += e.nameBytes.length;
  }

  view.setUint32(o, 0x06054b50, true);       // end of central directory signature
  view.setUint16(o + 4, 0, true);            // disk number
  view.setUint16(o + 6, 0, true);            // disk with central directory
  view.setUint16(o + 8, entries.length, true);
  view.setUint16(o + 10, entries.length, true);
  view.setUint32(o + 12, centralSize, true);
  view.setUint32(o + 16, centralStart, true);
  view.setUint16(o + 20, 0, true);           // comment length

  return new Blob([buf], { type: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml' });
}
