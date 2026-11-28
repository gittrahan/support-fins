// The entry the Rust component (component/) runs in QuickJS: export.js with a host made
// of the functions the component defines before it evaluates this bundle:
//
//   __sc_run(command, json)       -> '{"ok": "<reply json>"}' or '{"err": <WIT plugin-error>}'
//   __sc_log(level, message)      level: 'debug' | 'info' | 'warn' | 'error'
//   __sc_progress(fraction, message)
//   __sc_deflate(bytes)           -> raw DEFLATE of a Uint8Array (miniz_oxide)
//
// and globalThis.__sfExport(slot, options), which the component calls and settles: the
// file's bytes, or a thrown { payload: <WIT plugin-error> }. Math.hypot is already V8's
// then: the component puts its own in QuickJS's place (component/src/lib.rs, hypot).
import './polyfills.js';
import { exportFile, PluginError } from './export.js';

const g = globalThis;

// web/zip.js deflates a 3MF's parts with CompressionStream('deflate-raw') over a Blob's
// stream. QuickJS has neither: these stand-ins hand the bytes to the component's deflate,
// so the 3MF is as compact as the site's.
if (typeof g.CompressionStream !== 'function' && typeof g.__sc_deflate === 'function') {
  g.CompressionStream = class CompressionStream {
    constructor(format) {
      if (format !== 'deflate-raw') throw new TypeError(`no ${format} here`);
    }
  };
  g.Blob.prototype.stream = function stream() {
    const bytes = this._bytes;
    return { pipeThrough: () => ({ _deflated: g.__sc_deflate(bytes) }) };
  };
  g.Response = class Response {
    constructor(body) { this._bytes = body._deflated; }
    arrayBuffer() { return Promise.resolve(this._bytes.slice().buffer); }
  };
}

const host = {
  run(command, json) {
    const r = JSON.parse(g.__sc_run(command, json));
    if (r.err) {
      const e = new Error(`${command}: ${typeof r.err.val === 'string' ? r.err.val : r.err.val?.reason ?? r.err.tag}`);
      e.payload = r.err;
      throw e;
    }
    return r.ok;
  },
  log: (level, message) => g.__sc_log(level, message),
  progress: (fraction, message) => g.__sc_progress(fraction, message),
};

g.__sfExport = async (slot, options) => {
  try {
    return await exportFile(host, slot, options);
  } catch (e) {
    if (e?.payload?.tag) throw e;
    throw new PluginError('trap', `${e?.message ?? e}${e?.stack ? `\n${e.stack}` : ''}`);
  }
};
