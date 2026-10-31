// Optional disk checkpoints for project mode. Each record is self-contained:
// interruption can lose the current object, never an earlier completed one.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';

const MAGIC = Buffer.from('SFINSC01');
const BAKED_MAGIC = Buffer.from('SFINSC02');
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

function encode(key, number, { triangles, offset, stats, baked }) {
  // Fins keep their existing float32 representation. Converted bodies require
  // float64 and explicit vertex identity: JSON/float32 coordinate round trips
  // can collapse paint boundaries or join otherwise distinct shells.
  const arrays = [{ values: triangles, width: 4, kind: 'float' }];
  let conversion;
  if (baked) {
    if ('analysisPositions' in baked) throw new Error('checkpoint must not retain analysis meshes');
    conversion = { ...baked, version: 1, parts: baked.parts.map(({ positions, vertexIDs, sourceFaces, ...part }) => {
      arrays.push({ values: positions, width: 8, kind: 'float' });
      if (vertexIDs !== undefined) arrays.push({ values: vertexIDs, width: 4, kind: 'uint' });
      if (sourceFaces !== undefined) arrays.push({ values: sourceFaces, width: 4, kind: 'int' });
      return { ...part, coordinates: positions.length, vertices: vertexIDs?.length ?? null, faces: sourceFaces?.length ?? null };
    }) };
  }
  const metadata = Buffer.from(JSON.stringify({ key, number, offset, stats,
    ...(baked ? { triangleCoordinates: triangles.length, baked: conversion } : {}) }));
  const body = Buffer.alloc(4 + metadata.length + arrays.reduce((n, a) => n + a.values.length * a.width, 0));
  body.writeUInt32LE(metadata.length); metadata.copy(body, 4);
  let cursor = 4 + metadata.length;
  for (const { values, width, kind } of arrays) for (const value of values) {
    if (!Number.isFinite(value) || kind === 'uint' && (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) ||
        kind === 'int' && (!Number.isSafeInteger(value) || value < -1 || value > 0x7fffffff)) {
      throw new Error('invalid checkpoint geometry');
    }
    if (kind === 'uint') body.writeUInt32LE(value, cursor);
    else if (kind === 'int') body.writeInt32LE(value, cursor);
    else if (width === 8) body.writeDoubleLE(value, cursor);
    else body.writeFloatLE(value, cursor);
    cursor += width;
  }
  return Buffer.concat([baked ? BAKED_MAGIC : MAGIC, digest(body), body]);
}

function decode(bytes, key, number) {
  const converted = bytes.subarray(0, 8).equals(BAKED_MAGIC);
  if (bytes.length < 44 || !converted && !bytes.subarray(0, 8).equals(MAGIC)) throw new Error('invalid checkpoint header');
  const body = bytes.subarray(40);
  if (!digest(body).equals(bytes.subarray(8, 40))) throw new Error('checkpoint checksum mismatch');
  const end = 4 + body.readUInt32LE();
  if (end > body.length || !converted && (body.length - end) % 36) throw new Error('incomplete triangle data');
  const meta = JSON.parse(body.subarray(4, end).toString('utf8'));
  if (meta.key !== key || meta.number !== number || !meta.offset
      || !['x', 'y', 'z'].every((k) => Number.isFinite(meta.offset[k]))
      || !meta.stats || typeof meta.stats !== 'object' || Array.isArray(meta.stats)) throw new Error('invalid checkpoint metadata');
  let cursor = end;
  const array = (length, width, kind = 'float') => {
    if (!Number.isSafeInteger(length) || length < 0 || length > Math.floor((body.length - cursor) / width)) {
      throw new Error('incomplete checkpoint geometry');
    }
    const values = kind === 'uint' ? new Uint32Array(length) : kind === 'int' ? new Int32Array(length)
      : width === 8 ? new Float64Array(length) : new Float32Array(length);
    for (let i = 0; i < length; i++, cursor += width) {
      values[i] = kind === 'uint' ? body.readUInt32LE(cursor) : kind === 'int' ? body.readInt32LE(cursor)
        : width === 8 ? body.readDoubleLE(cursor) : body.readFloatLE(cursor);
      if (!Number.isFinite(values[i])) throw new Error('invalid checkpoint coordinate');
      if (kind === 'int' && values[i] < -1) throw new Error('invalid checkpoint source face');
    }
    return values;
  };
  const triangles = array(converted ? meta.triangleCoordinates : (body.length - end) / 4, 4);
  if (triangles.length % 9) throw new Error('incomplete triangle data');
  const result = { triangles, offset: meta.offset, stats: meta.stats };
  if (converted) {
    const baked = meta.baked;
    if (!triangles.length || baked?.version !== 1 || !Array.isArray(baked.parts) || !baked.parts.length ||
        !Array.isArray(baked.removed) || !Array.isArray(baked.warnings) || !baked.warnings.length ||
        baked.warnings.some((w) => typeof w !== 'string') || !baked.compatibility ||
        !/^[a-f0-9]{64}$/.test(baked.fingerprint) || 'analysisPositions' in baked) {
      throw new Error('invalid baked checkpoint metadata');
    }
    const { version: _, ...conversion } = baked;
    conversion.parts = baked.parts.map(({ coordinates, vertices, faces, ...part }) => {
      if (!coordinates || coordinates % 9 || !Array.isArray(part.triangleAttributes) ||
          part.triangleAttributes.length !== coordinates / 9 || !Array.isArray(part.source?.route) ||
          !Array.isArray(part.properties) || !part.objectAttributes || !part.modelAttributes) {
        throw new Error('invalid baked checkpoint part');
      }
      const positions = array(coordinates, 8);
      if (vertices !== null && vertices !== coordinates / 3) throw new Error('invalid baked vertex identities');
      if (faces !== null && faces !== coordinates / 9) throw new Error('invalid baked source faces');
      return { ...part, positions, ...(vertices === null ? {} : { vertexIDs: array(vertices, 4, 'uint') }),
        ...(faces === null ? {} : { sourceFaces: array(faces, 4, 'int') }) };
    });
    result.baked = conversion;
  }
  if (cursor !== body.length) throw new Error('unexpected checkpoint geometry');
  return result;
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
  const key = digest(JSON.stringify(stable({ format: 2, source: digest(bytes).toString('hex'),
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
