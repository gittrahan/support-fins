// What web/*.js expects of a browser and a bare JavaScript engine lacks: TextEncoder,
// TextDecoder and Blob, for QuickJS (quickjs.js). Each is defined only where the engine
// has none. CompressionStream comes from quickjs.js, over the component's deflate.
const g = globalThis;

if (typeof g.TextEncoder !== 'function') {
  g.TextEncoder = class TextEncoder {
    get encoding() { return 'utf-8'; }
    encode(s = '') {
      s = String(s);
      const out = [];
      for (let i = 0; i < s.length; i++) {
        let c = s.charCodeAt(i);
        if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) {
          const d = s.charCodeAt(i + 1);
          if (d >= 0xdc00 && d < 0xe000) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; }
        }
        if (c >= 0xd800 && c < 0xe000) c = 0xfffd;           // a lone surrogate
        if (c < 0x80) out.push(c);
        else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
        else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      }
      return Uint8Array.from(out);
    }
  };
}

if (typeof g.TextDecoder !== 'function') {
  g.TextDecoder = class TextDecoder {
    get encoding() { return 'utf-8'; }
    decode(bytes) {
      if (!bytes) return '';
      const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes.buffer ?? bytes, bytes.byteOffset ?? 0, bytes.byteLength);
      let s = '';
      for (let i = 0; i < b.length;) {
        const c = b[i++];
        let cp;
        if (c < 0x80) cp = c;
        else if (c >= 0xc0 && c < 0xe0) cp = ((c & 31) << 6) | (b[i++] & 63);
        else if (c >= 0xe0 && c < 0xf0) cp = ((c & 15) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63);
        else if (c >= 0xf0) cp = ((c & 7) << 18) | ((b[i++] & 63) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63);
        else cp = 0xfffd;
        s += String.fromCodePoint(cp);
      }
      return s;
    }
  };
}

if (typeof g.Blob !== 'function') {
  const bytesOf = (p) => (p instanceof Uint8Array ? p
    : ArrayBuffer.isView(p) ? new Uint8Array(p.buffer, p.byteOffset, p.byteLength)
    : p instanceof ArrayBuffer ? new Uint8Array(p)
    : p instanceof g.Blob ? p._bytes
    : new g.TextEncoder().encode(String(p)));
  g.Blob = class Blob {
    constructor(parts = [], opts = {}) {
      const chunks = parts.map(bytesOf);
      const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
      let o = 0;
      for (const c of chunks) { out.set(c, o); o += c.length; }
      this._bytes = out;
      this.type = opts.type ?? '';
    }
    get size() { return this._bytes.length; }
    arrayBuffer() { return Promise.resolve(this._bytes.slice().buffer); }
  };
}
