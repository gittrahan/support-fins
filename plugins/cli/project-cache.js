// Optional disk checkpoints for project mode. Each record is self-contained:
// interruption can lose the current object, never an earlier completed one.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';

const MAGIC = Buffer.from('SFINSC01');
const digest = (data) => createHash('sha256').update(data).digest();
const stable = (v) => Array.isArray(v) ? v.map(stable) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])])) : v;

// Source runs have an unstamped VERSION. Hash runtime contents, including dirty
// edits, rather than relying on Git or that version. Downloads hash the complete
// bundle, so they work outside a checkout and need no build manifest beside them.
export async function runtimeIdentity() {
  /* global SUPPORT_FINS_VERSION */
  if (typeof SUPPORT_FINS_VERSION === 'string') return digest(await fs.readFile(new URL(import.meta.url))).toString('hex');
  const root = fileURLToPath(new URL('../../', import.meta.url)), files = [];
  async function list(dir, recurse = true) {
    for (const e of await fs.readdir(path.join(root, dir), { withFileTypes: true })) {
      const name = `${dir}/${e.name}`;
      if (e.isSymbolicLink()) throw new Error(`cannot fingerprint a symbolic link in runtime sources: ${name}`);
      if (e.isDirectory() && recurse) await list(name);
      else if (e.isFile() && /\.(?:[cm]?js|json|wasm)$/.test(e.name)) files.push(name);
    }
  }
  await list('web'); await list('plugins/shared/engine'); await list('plugins/cli', false);
  const hash = createHash('sha256');
  for (const name of files.sort()) hash.update(name).update('\0').update(digest(await fs.readFile(path.join(root, name))));
  return hash.digest('hex');
}

function encode(key, number, { triangles, offset, stats }) {
  const metadata = Buffer.from(JSON.stringify({ key, number, offset, stats }));
  const body = Buffer.alloc(4 + metadata.length + triangles.length * 4);
  body.writeUInt32LE(metadata.length); metadata.copy(body, 4);
  for (let i = 0; i < triangles.length; i++) body.writeFloatLE(triangles[i], 4 + metadata.length + i * 4);
  return Buffer.concat([MAGIC, digest(body), body]);
}

function decode(bytes, key, number) {
  if (bytes.length < 44 || !bytes.subarray(0, 8).equals(MAGIC)) throw new Error('invalid checkpoint header');
  const body = bytes.subarray(40);
  if (!digest(body).equals(bytes.subarray(8, 40))) throw new Error('checkpoint checksum mismatch');
  const end = 4 + body.readUInt32LE();
  if (end > body.length || (body.length - end) % 36) throw new Error('incomplete triangle data');
  const meta = JSON.parse(body.subarray(4, end).toString('utf8'));
  if (meta.key !== key || meta.number !== number || !meta.offset
      || !['x', 'y', 'z'].every((k) => Number.isFinite(meta.offset[k]))
      || !meta.stats || typeof meta.stats !== 'object' || Array.isArray(meta.stats)) throw new Error('invalid checkpoint metadata');
  const triangles = new Float32Array((body.length - end) / 4);
  for (let i = 0; i < triangles.length; i++) {
    triangles[i] = body.readFloatLE(end + i * 4);
    if (!Number.isFinite(triangles[i])) throw new Error('invalid checkpoint coordinate');
  }
  return { triangles, offset: meta.offset, stats: meta.stats };
}

async function directory(dir) {
  await fs.mkdir(dir, { recursive: true });
  const stat = await fs.lstat(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`cache directory must not be a symbolic link: ${dir}`);
}

/** The I/O adapter supplies this only to project mode; tests can wrap it to
 * simulate interruption or output failure without adding production flags. */
export async function openProjectCache({ input, bytes, selection, settings, cacheDir, warn }, buildIdentity = runtimeIdentity) {
  const root = path.resolve(cacheDir ?? `${input}.fins-cache`);
  const build = await buildIdentity();
  const runtime = globalThis.Deno?.version ?? globalThis.process?.versions;
  const key = digest(JSON.stringify(stable({ format: 1, source: digest(bytes).toString('hex'),
    selection, settings, build, runtime }))).toString('hex');
  await directory(root);
  const dir = path.join(root, `support-fins-${key}`);
  const existing = await fs.readdir(root);
  if (!existing.includes(path.basename(dir)) && existing.some((n) => /^support-fins-[a-f0-9]{64}$/.test(n))) {
    warn('no compatible checkpoints: source, selection, settings or engine build differ; starting fresh');
  }
  await directory(dir);
  warn(`resume cache: ${dir}`);
  // Unique records avoid overwriting another process's checkpoint. Only complete
  // files observed at open, and files this invocation writes, are cleaned up.
  // Concurrent readers may miss a removed record and recompute, which is safe.
  const records = (await fs.readdir(dir)).filter((n) => /^object-[1-9]\d*-[a-f0-9-]+\.cache$/.test(n));
  const owned = new Set(records);
  return {
    async load(number) {
      for (const name of records.filter((n) => n.startsWith(`object-${number}-`))) {
        try {
          const file = path.join(dir, name), stat = await fs.lstat(file);
          if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('checkpoint is not a regular file');
          const result = decode(await fs.readFile(file), key, number);
          warn(`object ${number}: reusing completed checkpoint`);
          return result;
        } catch (e) {
          if (e.code !== 'ENOENT') warn(`object ${number}: unusable checkpoint (${e.message}); recomputing if no valid checkpoint remains`);
        }
      }
      return null;
    },
    async save(number, result) {
      const name = `object-${number}-${crypto.randomUUID()}.cache`;
      const temporary = path.join(dir, `${name}.tmp`);
      let handle;
      try {
        const bytes = encode(key, number, result);
        // Validate what will be persisted too (zero-fin objects are valid).
        decode(bytes, key, number);
        handle = await fs.open(temporary, 'wx', 0o600);
        await handle.writeFile(bytes); await handle.sync();
        await handle.close(); handle = null;
        await fs.rename(temporary, path.join(dir, name));
        owned.add(name);
      } catch (e) {
        throw new Error(`cannot save checkpoint for object ${number}: ${e.message}; stopping, previous checkpoints retained`);
      } finally {
        if (handle) await handle.close().catch(() => {});
        await fs.unlink(temporary).catch(() => {});
      }
    },
    async finish() {
      try {
        for (const name of owned) await fs.unlink(path.join(dir, name)).catch((e) => { if (e.code !== 'ENOENT') throw e; });
        // Never recursively delete a user-specified folder or another run's data.
        for (const folder of cacheDir == null ? [dir, root] : [dir]) await fs.rmdir(folder).catch((e) => {
          if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(e.code)) throw e;
        });
      } catch (e) { warn(`output saved, but checkpoint cleanup failed: ${e.message}; remove completed checkpoints manually`); }
    },
  };
}
