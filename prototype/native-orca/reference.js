/** Exact native source identity, including the recorded Clang compatibility patch. */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REFERENCE = Object.freeze({
  repository: "https://github.com/lewis252310/OrcaSlicer",
  revision: "d4da6e4d0efd6dc490e02147741a756a2ed98143",
  tag: "fin-support-v0.1.0",
  compatibilityPatch: Object.freeze({
    file: "patches/clang-fin-vector.patch",
    sha256: "4adda02650d5f5f1f3c1da95546f706f9a0639ac9ac5ef60e5de06c2b0babad6",
    sourceFile: "src/libslic3r/Support/FinSupport.cpp",
    originalSha256:
      "ebfbbe8a993e3b64d333e8857f01d240c1f9f0acdf2f979a590b4fb6b55040e3",
    patchedSha256:
      "63e3ba2d16a95c6ae411a90a5e8ca298b7a70b50610b7559ae1becad911e6df0",
  }),
  testCompatibilityPatch: Object.freeze({
    "file": "patches/fin-tests-api.patch",
    "sha256":
      "14ce0affbe37d96129702f3edb5138a1142f40e3a81c70a71a92969757414a9e",
    "sourceFile": "tests/fff_print/test_support_material.cpp",
    "originalSha256":
      "db6bf5975b026e0dc3a5e0ba5aced0000545dde389ec8d058fa347a530b51e18",
    "patchedSha256":
      "baf4fec574282b841cbfb905f339f0d8a8fa8195774f1b90091229568bf9ffff",
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
  { apply = false, reference = REFERENCE } = {},
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
  const text = (bytes) => new TextDecoder().decode(bytes);
  const revision = text(await git("rev-parse", "HEAD")).trim();
  if (revision !== reference.revision) {
    throw new Error("wrong native source revision");
  }
  if ((await git("diff", "--cached", "--name-only", "-z")).length) {
    throw new Error("native source has staged changes");
  }
  const patches = [
    reference.compatibilityPatch,
    reference.testCompatibilityPatch,
  ].filter(Boolean);
  const allowed = new Set(patches.map((p) => p.sourceFile));
  const changes = text(
    await git(
      "diff",
      "--ignore-submodules=none",
      "--name-only",
      "-z",
      "HEAD",
      "--",
    ),
  )
    .split("\0").filter(Boolean);
  if (changes.some((p) => !allowed.has(p))) {
    throw new Error("unexpected native source changes");
  }
  const pending = [];
  // Validate every input before applying anything. No unrelated or partial patch
  // is accepted, including in the test harness.
  for (const patch of patches) {
    const patchPath = fileURLToPath(new URL(patch.file, import.meta.url));
    if (await sha256(await Deno.readFile(patchPath)) !== patch.sha256) {
      throw new Error("compatibility patch checksum mismatch");
    }
    if (
      await sha256(await git("show", `HEAD:${patch.sourceFile}`)) !==
        patch.originalSha256
    ) {
      throw new Error("unexpected original native source contents");
    }
    const path = resolve(source, patch.sourceFile),
      info = await Deno.lstat(path);
    if (
      !info.isFile || info.isSymlink || await Deno.realPath(path) !== path ||
      !path.startsWith(source + (Deno.build.os === "windows" ? "\\" : "/")) ||
      info.mode !== null && (info.mode & 0o111)
    ) {
      throw new Error("unexpected native source path or file mode");
    }
    const hash = await sha256(await Deno.readFile(path));
    if (
      hash !== patch.patchedSha256 && !(apply && hash === patch.originalSha256)
    ) {
      throw new Error(
        "native source does not match the recorded compatibility patch",
      );
    }
    if (hash !== patch.patchedSha256) {
      await git("apply", "--check", patchPath);
      pending.push({ patch, patchPath, path });
    }
  }
  for (const { patch, patchPath, path } of pending) {
    await git("apply", patchPath);
    if (await sha256(await Deno.readFile(path)) !== patch.patchedSha256) {
      throw new Error(
        "native source does not match the recorded compatibility patch",
      );
    }
  }
  return {
    revision,
    compatibilityPatch: reference.compatibilityPatch,
    ...(reference.testCompatibilityPatch
      ? { testCompatibilityPatch: reference.testCompatibilityPatch }
      : {}),
  };
}

if (import.meta.main) {
  const apply = Deno.args[0] === "--apply";
  const args = apply ? Deno.args.slice(1) : Deno.args;
  if (args.length !== 1 || args[0].startsWith("--")) {
    throw new Error("usage: reference.js [--apply] <native-source-directory>");
  }
  console.log(
    JSON.stringify(await verifyNativeSource(args[0], { apply }), null, 2),
  );
}
