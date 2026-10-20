/**
 * Minimal ZIP writer (STORE only) and reader (STORE + DEFLATE).
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

export function crc32(bytes) {
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

// ---------------------------------------------------------------- ZIP reader

/**
 * Reading is not the mirror of writing: we emit STORE, but every 3MF a user
 * drags in (Fusion, Bambu, Orca, Prusa, FreeCAD) is DEFLATE. Inflate comes from
 * the platform's DecompressionStream rather than a vendored ~200-line inflate --
 * it is a web standard, present in the browsers this app targets and in Deno, so
 * the test suite exercises the same path the browser does.
 *
 * We walk the central directory rather than scanning for local headers: the
 * central directory is the authoritative index, and a local header may carry
 * zeroed sizes with the real ones in a trailing data descriptor (streamed ZIPs
 * do this, and some 3MF writers stream).
 */

const dec = new TextDecoder();

// End of central directory: fixed 22 bytes, but a trailing comment (up to
// 0xffff) can follow, so scan back from the end for the signature.
function findEOCD(view) {
  const max = Math.min(view.byteLength, 0xffff + 22);
  for (let i = 22; i <= max; i++) {
    const o = view.byteLength - i;
    if (view.getUint32(o, true) === 0x06054b50) return o;
  }
  return -1;
}

// 64-bit ZIP fields are BigInt off a DataView; everything a 3MF uses is far
// inside Number's exact-integer range, and the rest of this file is Numbers.
function num(big) {
  if (big > 9007199254740991n) throw new Error('ZIP entry is too large to read');
  return Number(big);
}

/**
 * Offset of the DATA of extra-field `id` within an extra-field block, or -1.
 * Each field is a 2-byte id, a 2-byte length, then that many bytes.
 */
function findExtra(view, start, len, id) {
  let p = start;
  const end = start + len;
  while (p + 4 <= end) {
    const fieldId = view.getUint16(p, true);
    const fieldLen = view.getUint16(p + 2, true);
    if (fieldId === id) return p + 4;
    p += 4 + fieldLen;
  }
  return -1;
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * @param bytes  Uint8Array of the whole archive
 * @returns Map<string, Uint8Array>  entry name (forward slashes) -> contents.
 *          Directory entries are skipped; only STORE and DEFLATE are supported,
 *          which covers every 3MF in practice.
 */
export async function unzip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEOCD(view);
  if (eocd < 0) throw new Error('not a ZIP archive (no end-of-central-directory record)');

    let count = view.getUint16(eocd + 10, true);
  let o = view.getUint32(eocd + 16, true);

  // ZIP64. A writer may use it for reasons of its own, not only past the 4GB /
  // 65535-entry limits -- some libraries switch it on unconditionally -- so a
  // small 3MF can arrive with 0xffff/0xffffffff placeholders in the EOCD and the
  // real values in a ZIP64 record. Refusing those rejected perfectly good files.
  // The locator sits immediately before the EOCD and points at that record.
  if (eocd >= 20 && view.getUint32(eocd - 20, true) === 0x07064b50) {
    const z64 = num(view.getBigUint64(eocd - 20 + 8, true));
    if (z64 >= 0 && z64 + 56 <= view.byteLength && view.getUint32(z64, true) === 0x06064b50) {
      count = num(view.getBigUint64(z64 + 32, true));
      o = num(view.getBigUint64(z64 + 48, true));
    }
  }
  // Placeholders with no ZIP64 record to resolve them: the archive is malformed
  // rather than merely large, and reading on would walk garbage offsets.
  if (count === 0xffff || o === 0xffffffff) throw new Error('corrupt ZIP: ZIP64 markers with no ZIP64 record');

  const out = new Map();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(o, true) !== 0x02014b50) throw new Error('corrupt ZIP central directory');
    const method = view.getUint16(o + 10, true);
    const nameLen = view.getUint16(o + 28, true);
    const extraLen = view.getUint16(o + 30, true);
    const commentLen = view.getUint16(o + 32, true);
    const name = dec.decode(bytes.subarray(o + 46, o + 46 + nameLen));
    let compSize = view.getUint32(o + 20, true);
    let localOff = view.getUint32(o + 42, true);

    // Any 0xffffffff field is really in the entry's ZIP64 extended-information
    // extra field (id 0x0001), whose values appear in a FIXED order --
    // uncompressed, compressed, local-header offset -- but only for the fields
    // that were actually overflowed. So which ones are present is decided by
    // which placeholders we saw, not by the field's own length.
    const uncompPlaceheld = view.getUint32(o + 24, true) === 0xffffffff;
    if (uncompPlaceheld || compSize === 0xffffffff || localOff === 0xffffffff) {
      const z = findExtra(view, o + 46 + nameLen, extraLen, 0x0001);
      if (z < 0) throw new Error(`corrupt ZIP: ${name} needs a ZIP64 extra field and has none`);
      let f = z;
      if (uncompPlaceheld) f += 8;                                     // skip uncompressed size
      if (compSize === 0xffffffff) { compSize = num(view.getBigUint64(f, true)); f += 8; }
      if (localOff === 0xffffffff) { localOff = num(view.getBigUint64(f, true)); }
    }
    o += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue;                       // directory marker

    // The local header's own name/extra lengths give where the data starts --
    // the extra field routinely differs in length from the central one.
    if (view.getUint32(localOff, true) !== 0x04034b50) throw new Error(`corrupt local header for ${name}`);
    const lNameLen = view.getUint16(localOff + 26, true);
    const lExtraLen = view.getUint16(localOff + 28, true);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const data = bytes.subarray(start, start + compSize);

    if (method === 0) out.set(name, data);
    else if (method === 8) out.set(name, await inflateRaw(data));
    else throw new Error(`unsupported ZIP compression method ${method} for ${name}`);
  }
  return out;
}
