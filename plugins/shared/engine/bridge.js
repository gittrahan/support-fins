// Bridge between a plugin's Python and the fin engine.
//
// Python plugins (Orca today) run this bundle, built by plugins/shared/bundle.py,
// inside an embedded V8 (mini-racer). Plain V8 has no atob/btoa/TextDecoder, so
// geometry crosses the boundary as base64 of raw little-endian bytes, decoded here
// by hand. That is ~20x smaller and much faster than a JSON number array for a
// 100k-triangle part.
//
//   in : base64 float64 triangle soup (posed, mm) + JSON options
//   out: JSON { triangles: base64 float32 soup (seated frame), offset, stats }
import { computeFins, ENGINE_DEFAULTS } from './fins_entry.js';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Uint8Array(256);
for (let i = 0; i < B64.length; i++) LOOKUP[B64.charCodeAt(i)] = i;

export function b64ToBytes(s) {
  let pad = 0;
  if (s.endsWith('==')) pad = 2; else if (s.endsWith('=')) pad = 1;
  const n = (s.length / 4) * 3 - pad;
  const out = new Uint8Array(n);
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    const a = LOOKUP[s.charCodeAt(i)], b = LOOKUP[s.charCodeAt(i + 1)];
    const c = LOOKUP[s.charCodeAt(i + 2)], d = LOOKUP[s.charCodeAt(i + 3)];
    const v = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < n) out[o++] = (v >> 16) & 255;
    if (o < n) out[o++] = (v >> 8) & 255;
    if (o < n) out[o++] = v & 255;
  }
  return out;
}

export function bytesToB64(bytes) {
  const parts = [];
  let chunk = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = i + 1 < bytes.length ? bytes[i + 1] : 0, c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const v = (a << 16) | (b << 8) | c;
    chunk += B64[(v >> 18) & 63] + B64[(v >> 12) & 63]
      + (i + 1 < bytes.length ? B64[(v >> 6) & 63] : '=')
      + (i + 2 < bytes.length ? B64[v & 63] : '=');
    if (chunk.length > 65536) { parts.push(chunk); chunk = ''; }
  }
  parts.push(chunk);
  return parts.join('');
}

export function computeFinsB64(soupB64, optionsJson) {
  const bytes = b64ToBytes(soupB64);
  const soup = new Float64Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 8);
  const options = optionsJson ? JSON.parse(optionsJson) : {};
  const res = computeFins(soup, options);
  const tri = new Uint8Array(res.triangles.buffer, res.triangles.byteOffset, res.triangles.byteLength);
  return JSON.stringify({ triangles: bytesToB64(tri), offset: res.offset, stats: res.stats });
}

export { computeFins, ENGINE_DEFAULTS };
