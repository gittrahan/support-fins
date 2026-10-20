// Both Node and Deno implement node:fs. Keep atomic/project-only writes separate
// from the CLI's established geometry-export writer.
import * as fs from 'node:fs/promises';
import path from 'node:path';

export async function checkProjectOutput(input, output, overwrite = false) {
  const source = await fs.realpath(input);
  const destination = path.join(await fs.realpath(path.dirname(path.resolve(output))), path.basename(output));
  if (source === destination) throw new Error("won't overwrite the input project");
  let target;
  try { target = await fs.lstat(output); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (!target) return;
  if (target.isSymbolicLink()) throw new Error('project output must not be a symbolic link');
  const original = await fs.stat(input);
  if (target.dev === original.dev && target.ino === original.ino) throw new Error("won't overwrite a hard link to the input project");
  if (!target.isFile()) throw new Error('project output is not a regular file');
  if (!overwrite) throw new Error('output already exists; choose a new -o or use --overwrite');
}

export async function writeProject(input, output, bytes, overwrite = false) {
  await checkProjectOutput(input, output, overwrite);
  const temporary = path.join(path.dirname(output), `.support-fins-${crypto.randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(temporary, 'wx');
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close(); handle = null;
    await checkProjectOutput(input, output, overwrite);
    if (overwrite) await fs.rename(temporary, output);
    else {
      // Atomic, fails if a destination appeared during generation. Where hard links
      // aren't supported (exFAT, some network shares; the error code varies by OS), an
      // exclusive copy still never replaces a file, and a failed copy leaves none.
      try { await fs.link(temporary, output); } catch (e) {
        if (e.code === 'EEXIST') throw e;
        try { await fs.copyFile(temporary, output, fs.constants.COPYFILE_EXCL); } catch (copy) {
          if (copy.code !== 'EEXIST') await fs.unlink(output).catch(() => {});
          throw copy;
        }
      }
    }
  } finally {
    if (handle) await handle.close();
    await fs.unlink(temporary).catch((e) => { if (e.code !== 'ENOENT') throw e; });
  }
}
