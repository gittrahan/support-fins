// A project is edited, not re-exported. Retain each unchanged ZIP entry's local
// header and compressed payload; inflate only the members needed for analysis.
import { crc32, zipStore } from '../../web/zip.js';
import { inflateRaw } from 'node:zlib';

const dec = new TextDecoder();

export class ProjectZip {
  constructor(bytes) {
    this.bytes = bytes;
    this.entries = new Map();
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (v.getUint32(i, true) === 0x06054b50 && i + 22 + v.getUint16(i + 20, true) === bytes.length) {
        end = i; break;
      }
    }
    if (end < 0) throw new Error('not a ZIP project');
    const count = v.getUint16(end + 10, true);
    let at = v.getUint32(end + 16, true);
    if (v.getUint16(end + 4, true) || v.getUint16(end + 6, true)
        || v.getUint16(end + 8, true) !== count || count === 65535 || at === 0xffffffff
        || (end >= 20 && v.getUint32(end - 20, true) === 0x07064b50)) {
      throw new Error('--preserve-project does not support multi-disk or ZIP64 archives');
    }
    this.central = at;
    this.comment = bytes.slice(end + 22);
    const directoryEnd = at + v.getUint32(end + 12, true);
    if (directoryEnd !== end) throw new Error('invalid ZIP directory');
    for (let i = 0; i < count; i++) {
      if (at + 46 > end || v.getUint32(at, true) !== 0x02014b50) throw new Error('invalid ZIP entry');
      const nameLen = v.getUint16(at + 28, true), extra = v.getUint16(at + 30, true), comment = v.getUint16(at + 32, true);
      const next = at + 46 + nameLen + extra + comment;
      if (next > end) throw new Error('truncated ZIP entry');
      const name = dec.decode(bytes.subarray(at + 46, at + 46 + nameLen));
      const offset = v.getUint32(at + 42, true), size = v.getUint32(at + 20, true), length = v.getUint32(at + 24, true);
      const method = v.getUint16(at + 10, true), flags = v.getUint16(at + 8, true);
      if ([offset, size, length].includes(0xffffffff)) throw new Error('ZIP64 entries are not supported in project mode');
      if (flags & 1 || ![0, 8].includes(method)) throw new Error(`unsupported ZIP encoding: ${name}`);
      if (v.getUint16(at + 34, true) || offset + 30 > this.central
          || v.getUint32(offset, true) !== 0x04034b50) throw new Error(`invalid ZIP member: ${name}`);
      const localName = v.getUint16(offset + 26, true), localExtra = v.getUint16(offset + 28, true);
      const start = offset + 30 + localName + localExtra;
      if (start + size > this.central || dec.decode(bytes.subarray(offset + 30, offset + 30 + localName)) !== name) {
        throw new Error(`invalid ZIP data: ${name}`);
      }
      if (this.entries.has(name) || name.startsWith('/') || name.includes('\\')
          || name.split('/').some((p) => p === '..' || p === '.')) throw new Error(`ambiguous ZIP path: ${name}`);
      this.entries.set(name, { name, offset, start, size, length, method, crc: v.getUint32(at + 16, true),
        record: bytes.slice(at, next) });
      at = next;
    }
    if (at !== end) throw new Error('invalid ZIP directory length');
    const sorted = [...this.entries.values()].sort((a, b) => a.offset - b.offset);
    sorted.forEach((e, i) => {
      e.end = sorted[i + 1]?.offset ?? this.central;
      if (e.start + e.size > e.end) throw new Error(`overlapping ZIP entries: ${e.name}`);
    });
  }

  async read(name) {
    const e = this.entries.get(name);
    if (!e) throw new Error(`missing project member: ${name}`);
    const raw = this.bytes.subarray(e.start, e.start + e.size);
    // Node 20.10 supports the CLI but not DecompressionStream('deflate-raw').
    // Both Node and Deno provide zlib, including on that minimum Node version.
    const data = e.method === 0 ? raw : await new Promise((resolve, reject) => {
      inflateRaw(raw, (error, result) => error ? reject(error) : resolve(result));
    });
    if (data.length !== e.length || crc32(data) !== e.crc) throw new Error(`corrupt project member: ${name}`);
    return data;
  }

  async text(name) { return dec.decode(await this.read(name)); }

  async patch(changes) {
    const added = new ProjectZip(new Uint8Array(await zipStore([...changes]
      .filter(([, data]) => data !== null).map(([name, data]) => ({ name, data }))).arrayBuffer()));
    const locals = [], records = [];
    let offset = 0;
    const append = (zip, e) => {
      const raw = zip.bytes.subarray(e.offset, e.end);
      const record = e.record.slice();
      new DataView(record.buffer).setUint32(42, offset, true);
      locals.push(raw); records.push(record); offset += raw.length;
    };
    for (const e of this.entries.values()) if (!changes.has(e.name)) append(this, e);
    for (const e of added.entries.values()) append(added, e);
    const size = records.reduce((n, r) => n + r.length, 0);
    if (offset + size >= 0xffffffff || records.length >= 65535) throw new Error('output would require ZIP64');
    const end = new Uint8Array(22 + this.comment.length), v = new DataView(end.buffer);
    v.setUint32(0, 0x06054b50, true);
    v.setUint16(8, records.length, true); v.setUint16(10, records.length, true);
    v.setUint32(12, size, true); v.setUint32(16, offset, true);
    v.setUint16(20, this.comment.length, true); end.set(this.comment, 22);
    return new Blob([...locals, ...records, end]);
  }
}
