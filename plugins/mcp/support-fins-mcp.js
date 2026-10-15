#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env
// Support Fins MCP server over stdio: `node support-fins-mcp.js` or
// `deno run -RWE support-fins-mcp.js`, started by the MCP client. The protocol is in
// server.js; this file only gives it stdin/stdout and a file system.
//
// stdout is the protocol channel: one JSON-RPC message per line, nothing else.
// The engine's vendored libraries may log, so console.log and friends go to stderr,
// set before the engine loads (a static import would run first).
for (const k of ['log', 'info', 'debug', 'warn', 'dir', 'table', 'trace']) console[k] = console.error;

const { handle } = await import('./server.js');
const path = await import('node:path');

const deno = globalThis.Deno;
const fs = deno ? null : await import('node:fs/promises');
const home = deno ? deno.env.get('HOME') ?? deno.env.get('USERPROFILE') : globalThis.process.env.HOME ?? globalThis.process.env.USERPROFILE;

const io = deno
  ? { read: (p) => deno.readFile(p), write: (p, b) => deno.writeFile(p, b) }
  : { read: async (p) => new Uint8Array(await fs.readFile(p)), write: (p, b) => fs.writeFile(p, b) };
io.resolve = (p) => path.resolve(home && /^~[\\/]/.test(p) ? path.join(home, p.slice(2)) : p);

const enc = new TextEncoder();
const send = deno
  ? (msg) => {
    const b = enc.encode(`${JSON.stringify(msg)}\n`);
    for (let n = 0; n < b.length;) n += deno.stdout.writeSync(b.subarray(n));
  }
  : (msg) => globalThis.process.stdout.write(`${JSON.stringify(msg)}\n`);

const pending = new Set();
function onLine(line) {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'not JSON' } });
    return;
  }
  const p = handle(msg, io).then((r) => { if (r) send(r); });
  pending.add(p);
  p.finally(() => pending.delete(p));
}

// Read until the client closes stdin, then finish what was asked and exit.
if (deno) {
  let buf = '';
  for await (const chunk of deno.stdin.readable.pipeThrough(new TextDecoderStream())) {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) { onLine(buf.slice(0, nl)); buf = buf.slice(nl + 1); }
  }
  onLine(buf);
} else {
  const rl = (await import('node:readline')).createInterface({ input: globalThis.process.stdin, crlfDelay: Infinity });
  for await (const line of rl) onLine(line);
}
await Promise.allSettled([...pending]);
