import {
  REFERENCE,
  sha256,
  verifyNativeSource,
} from "../prototype/native-orca/reference.js";
import { pathToFileURL } from "node:url";
import { verifyBuildReceipt } from "../prototype/native-orca/run.js";
const assert = (value, message = "assertion failed") => {
  if (!value) throw new Error(message);
};
const rejects = async (fn, pattern) => {
  try {
    await fn();
  } catch (e) {
    assert(pattern.test(e.message), e.message);
    return;
  }
  throw new Error("expected rejection");
};

Deno.test("native Orca: only the exact recorded source patch is accepted or applied", async () => {
  const temp = await Deno.makeTempDir({ prefix: "native-orca-reference-" });
  const source = `${temp}/source`, patchPath = `${temp}/compat.patch`;
  try {
    await Deno.mkdir(source);
    await Deno.mkdir(`${temp}/template`);
    const git = async (...args) => {
      const r = await new Deno.Command("git", {
        args,
        cwd: source,
        stdout: "piped",
        stderr: "piped",
        env: {
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_COUNT: "0",
          GIT_TEMPLATE_DIR: `${temp}/template`,
        },
      }).output();
      assert(r.success, new TextDecoder().decode(r.stderr));
      return new TextDecoder().decode(r.stdout).trim();
    };
    const original = "original expression\n", patched = "explicit branches\n";
    const patch =
      "--- a/normal.cpp\n+++ b/normal.cpp\n@@ -1 +1 @@\n-original expression\n+explicit branches\n";
    await Deno.writeTextFile(`${source}/normal.cpp`, original);
    await Deno.writeTextFile(`${source}/other.cpp`, "untouched\n");
    await Deno.writeTextFile(patchPath, patch);
    await git("init", "-q");
    await git("config", "core.fsmonitor", "false");
    await git("add", "normal.cpp", "other.cpp");
    await git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-qm",
      "base",
    );
    const reference = {
      revision: await git("rev-parse", "HEAD"),
      compatibilityPatch: {
        file: pathToFileURL(patchPath).href,
        sha256: await sha256(patch),
        sourceFile: "normal.cpp",
        originalSha256: await sha256(original),
        patchedSha256: await sha256(patched),
      },
    };
    await rejects(
      () => verifyNativeSource(source, { reference }),
      /does not match/,
    );
    const result = await verifyNativeSource(source, { reference, apply: true });
    assert(
      result.compatibilityPatch.sha256 === reference.compatibilityPatch.sha256,
    );
    assert(await Deno.readTextFile(`${source}/normal.cpp`) === patched);
    await verifyNativeSource(source, { reference, apply: true }); // idempotent
    await Deno.writeTextFile(`${source}/other.cpp`, "unrelated modification\n");
    await rejects(
      () => verifyNativeSource(source, { reference }),
      /unexpected native source changes/,
    );
    await Deno.writeTextFile(`${source}/other.cpp`, "untouched\n");
    await Deno.writeTextFile(
      `${source}/normal.cpp`,
      patched + "extra change\n",
    );
    await rejects(
      () => verifyNativeSource(source, { reference }),
      /does not match/,
    );
    await Deno.writeTextFile(`${source}/normal.cpp`, patched);
    await Deno.writeTextFile(patchPath, patch + "tampered\n");
    await rejects(
      () => verifyNativeSource(source, { reference }),
      /patch checksum/,
    );
    await Deno.writeTextFile(patchPath, patch);
    await git("add", "normal.cpp");
    await rejects(
      () => verifyNativeSource(source, { reference }),
      /staged changes/,
    );
    await git("reset", "-q", "HEAD");
    await rejects(
      () =>
        verifyNativeSource(source, {
          reference: { ...reference, revision: "wrong" },
        }),
      /wrong native source revision/,
    );
    const secondPatch =
      "--- a/other.cpp\n+++ b/other.cpp\n@@ -1 +1 @@\n-untouched\n+test correction\n";
    const secondPath = `${temp}/test.patch`;
    await Deno.writeTextFile(secondPath, secondPatch);
    const both = {
      ...reference,
      testCompatibilityPatch: {
        file: pathToFileURL(secondPath).href,
        sha256: await sha256(secondPatch),
        sourceFile: "other.cpp",
        originalSha256: await sha256("untouched\n"),
        patchedSha256: await sha256("test correction\n"),
      },
    };
    await rejects(
      () => verifyNativeSource(source, { reference: both }),
      /does not match/,
    );
    const checked = await verifyNativeSource(source, {
      reference: both,
      apply: true,
    });
    assert(
      checked.testCompatibilityPatch.sha256 ===
        both.testCompatibilityPatch.sha256,
    );
    await verifyNativeSource(source, { reference: both, apply: true });
    await Deno.writeTextFile(`${source}/other.cpp`, "unrecorded test change\n");
    await rejects(
      () => verifyNativeSource(source, { reference: both }),
      /does not match/,
    );
    await Deno.writeTextFile(`${source}/other.cpp`, "untouched\n");
    if (Deno.build.os !== "windows") {
      await Deno.chmod(`${source}/normal.cpp`, 0o755);
      await rejects(
        () => verifyNativeSource(source, { reference }),
        /file mode/,
      );
      await Deno.chmod(`${source}/normal.cpp`, 0o644);
      await Deno.remove(`${source}/normal.cpp`);
      await Deno.writeTextFile(`${temp}/outside.cpp`, patched);
      await Deno.symlink(`${temp}/outside.cpp`, `${source}/normal.cpp`);
      await rejects(
        () => verifyNativeSource(source, { reference }),
        /source path/,
      );
    }
  } finally {
    await Deno.remove(temp, { recursive: true });
  }
});

Deno.test("native Orca: runtime receipts bind executable and compatibility-patch identity", async () => {
  const sourceReference = {
    revision: REFERENCE.revision,
    compatibilityPatch: REFERENCE.compatibilityPatch,
    testCompatibilityPatch: REFERENCE.testCompatibilityPatch,
  };
  const runtime = {
    revision: REFERENCE.revision,
    sha256: "executable-hash",
    sourceReference,
  };
  const receipt = { format: 2, ...runtime };
  verifyBuildReceipt(receipt, runtime);
  for (
    const invalid of [
      {
        ...receipt,
        format: 1,
        sourceChanges: false,
        sourceReference: undefined,
      },
      { ...receipt, sha256: "other-executable" },
      {
        ...receipt,
        sourceReference: { ...sourceReference, compatibilityPatch: {} },
      },
      {
        ...receipt,
        sourceReference: { ...sourceReference, testCompatibilityPatch: {} },
      },
      { ...receipt, revision: "other-revision" },
    ]
  ) await rejects(() => verifyBuildReceipt(invalid, runtime), /build receipt/);
});
