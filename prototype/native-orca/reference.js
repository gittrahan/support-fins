/** Exact committed native reference; the build must leave its source tree clean. */
export const REFERENCE = Object.freeze({
  repository: "https://github.com/patchx3/OrcaSlicer",
  revision: "fd37d8469259a2a0e45597b78c50711208fb530f",
  upstream: Object.freeze({
    repository: "https://github.com/lewis252310/OrcaSlicer",
    revision: "d4da6e4d0efd6dc490e02147741a756a2ed98143",
    tag: "fin-support-v0.1.0",
  }),
});

export async function sha256(data) {
  const bytes = typeof data === "string"
    ? new TextEncoder().encode(data)
    : data;
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

// reference is injectable for procedural tests; the command-line entry point
// always uses the pinned reference above, with no alternate-reference flag.
export async function verifyNativeSource(
  source,
  { reference = REFERENCE } = {},
) {
  source = await Deno.realPath(source);
  const git = async (...args) => {
    const r = await new Deno.Command("git", {
      args,
      cwd: source,
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (!r.success) {
      throw new Error(
        `native source check: git ${args[0]} failed: ${
          new TextDecoder().decode(r.stderr).trim()
        }`,
      );
    }
    return r.stdout;
  };
  const revision = new TextDecoder().decode(await git("rev-parse", "HEAD"))
    .trim();
  if (revision !== reference.revision) {
    throw new Error("wrong native source revision");
  }
  if ((await git("diff", "--cached", "--name-only", "-z")).length) {
    throw new Error("native source has staged changes");
  }
  if (
    (await git(
      "diff",
      "--ignore-submodules=none",
      "--name-only",
      "-z",
      "HEAD",
      "--",
    )).length
  ) {
    throw new Error("native source has tracked changes");
  }
  if ((await git("ls-files", "--others", "--exclude-standard", "-z")).length) {
    throw new Error("native source has untracked files");
  }
  return { revision };
}

if (import.meta.main) {
  if (Deno.args.length !== 1 || Deno.args[0].startsWith("--")) {
    throw new Error("usage: reference.js <native-source-directory>");
  }
  console.log(JSON.stringify(await verifyNativeSource(Deno.args[0]), null, 2));
}
