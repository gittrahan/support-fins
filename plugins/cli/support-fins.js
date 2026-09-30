#!/usr/bin/env -S deno run --allow-read --allow-write
// Support Fins command line: `deno run -RW support-fins.js part.stl` or
// `node support-fins.js part.stl` (Node 20+). The logic is in cli.js; this file
// only gives it a file system and an exit code.
import { run } from './cli.js';

const deno = globalThis.Deno;
const fs = deno ? null : await import('node:fs/promises');

const io = deno
  ? { read: (p) => deno.readFile(p), write: (p, b) => deno.writeFile(p, b) }
  : { read: async (p) => new Uint8Array(await fs.readFile(p)), write: (p, b) => fs.writeFile(p, b) };
io.out = (line) => console.log(line);
io.err = (line) => console.error(line);

const argv = deno ? deno.args : globalThis.process.argv.slice(2);
const code = await run(argv, io);
if (deno) deno.exit(code); else globalThis.process.exitCode = code;
