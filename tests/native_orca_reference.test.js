import {
  REFERENCE,
  verifyNativeSource,
} from "../prototype/native-orca/reference.js";
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

Deno.test("native Orca: pinned source rejects tracked, staged and untracked changes but allows ignored builds", async () => {
  const temp = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "native-orca-reference-" }),
  );
  const source = `${temp}/source`;
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
    await Deno.writeTextFile(`${source}/normal.cpp`, "committed source\n");
    await Deno.writeTextFile(`${source}/.gitignore`, "/build/\n");
    await git("init", "-q");
    await git("config", "core.fsmonitor", "false");
    await git("config", "core.filemode", "true");
    await git("add", "normal.cpp", ".gitignore");
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
    const reference = { revision: await git("rev-parse", "HEAD") };
    assert(
      (await verifyNativeSource(source, { reference })).revision ===
        reference.revision,
    );
    await Deno.mkdir(`${source}/build`);
    await Deno.writeTextFile(
      `${source}/build/generated.cpp`,
      "ignored build output\n",
    );
    await verifyNativeSource(source, { reference });
    // An untracked build input must not be mistaken for a clean pinned tree.
    await Deno.mkdir(`${source}/extra`);
    await Deno.writeTextFile(`${source}/extra/stray.cpp`, "untracked input\n");
    await rejects(
      () => verifyNativeSource(source, { reference }),
      /untracked files/,
    );
    await git("add", "extra/stray.cpp");
    await rejects(
      () => verifyNativeSource(source, { reference }),
      /staged changes/,
    );
    await git("reset", "-q", "HEAD");
    await Deno.remove(`${source}/extra`, { recursive: true });
    await Deno.writeTextFile(`${source}/normal.cpp`, "changed source\n");
    await rejects(
      () => verifyNativeSource(source, { reference }),
      /tracked changes/,
    );
    await git("add", "normal.cpp");
    await rejects(
      () => verifyNativeSource(source, { reference }),
      /staged changes/,
    );
    await git("reset", "-q", "HEAD");
    await git("restore", "normal.cpp");
    await Deno.remove(`${source}/normal.cpp`);
    await rejects(
      () => verifyNativeSource(source, { reference }),
      /tracked changes/,
    );
    await git("restore", "normal.cpp");
    if (Deno.build.os !== "windows") {
      await Deno.chmod(`${source}/normal.cpp`, 0o755);
      await rejects(
        () => verifyNativeSource(source, { reference }),
        /tracked changes/,
      );
      await Deno.chmod(`${source}/normal.cpp`, 0o644);
      await Deno.remove(`${source}/normal.cpp`);
      await Deno.writeTextFile(`${temp}/outside.cpp`, "committed source\n");
      await Deno.symlink(`${temp}/outside.cpp`, `${source}/normal.cpp`);
      await rejects(
        () => verifyNativeSource(source, { reference }),
        /tracked changes/,
      );
      await Deno.remove(`${source}/normal.cpp`);
      await git("restore", "normal.cpp");
    }
    await rejects(
      () => verifyNativeSource(source, { reference: { revision: "wrong" } }),
      /wrong native source revision/,
    );
    await verifyNativeSource(source, { reference });
  } finally {
    await Deno.remove(temp, { recursive: true });
  }
});

Deno.test("native Orca: runtime receipts bind the executable and clean committed revision", async () => {
  const sourceReference = { revision: REFERENCE.revision };
  const runtime = {
    revision: REFERENCE.revision,
    sha256: "executable-hash",
    sourceReference,
  };
  const receipt = { format: 2, ...runtime };
  verifyBuildReceipt(receipt, runtime);
  for (
    const invalid of [
      { ...receipt, format: 1, sourceReference: undefined },
      { ...receipt, sha256: "other-executable" },
      { ...receipt, sourceReference: { revision: "other-revision" } },
      {
        ...receipt,
        sourceReference: { ...sourceReference, compatibilityPatch: {} },
      },
      { ...receipt, revision: "other-revision" },
    ]
  ) await rejects(() => verifyBuildReceipt(invalid, runtime), /build receipt/);
});
