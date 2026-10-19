#!/usr/bin/env python3
"""Build the command line as one file, for the download.

  python3 plugins/cli/build.py      # -> plugins/cli/build/support-fins.mjs

support-fins.js imports the engine from web/ and plugins/shared/, so on its own it
only runs inside a checkout. This bundles it (esbuild, as plugins/shared/bundle.py
does for the plugins) into one ES module that runs anywhere:

  deno run -RW support-fins.mjs part.stl
  node support-fins.mjs part.stl            # Node 20.10+
"""
import json
import pathlib
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent
OUT = HERE / "build" / "support-fins.mjs"

sys.path.insert(0, str(HERE.parent / "shared"))
from bundle import esbuild_cmd  # noqa: E402


# The negative-part cut (web/cut.js) loads Manifold's WASM from beside its loader;
# a one-file download has no beside, so the bytes ride in the bundle (~0.5 MB) and
# are handed over before the command line starts.
ENTRY = '''import {{ setManifoldWasm }} from {cut!r};
import wasm from {wasm!r};
setManifoldWasm(wasm);
await import({cli!r});
'''


ESBUILD_ARGS = ["--format=esm", "--platform=node", "--loader:.wasm=binary", "--target=es2022"]


def _entry(script, folder):
    entry = folder / "entry.js"
    folder.mkdir(parents=True, exist_ok=True)
    entry.write_text(ENTRY.format(
        cut=str(ROOT / "web" / "cut.js"),
        wasm=str(ROOT / "web" / "vendor" / "manifold-3d-3.5.4" / "manifold.wasm"),
        cli=str(script)))
    return entry


def inputs(script=HERE / "support-fins.js"):
    """Every file the bundle of `script` holds (what its version is numbered from)."""
    from version import bundle_inputs   # plugins/shared/version.py
    with tempfile.TemporaryDirectory() as tmp:
        return bundle_inputs(_entry(script, pathlib.Path(tmp)), *ESBUILD_ARGS)


def build(script=HERE / "support-fins.js", out=OUT, folders=(HERE,)):
    """Bundle an entry script (the MCP server's too: plugins/mcp/build.py) to one file,
    with its version (plugins/shared/version.py, from `folders` + what it bundles)
    compiled in as SUPPORT_FINS_VERSION. Returns (out, version)."""
    from version import version
    v = version([*folders, *inputs(script)])
    entry = _entry(script, out.parent)
    # --platform=node leaves node:fs (the Node branch's dynamic import) external;
    # Deno never reaches it.
    try:
        subprocess.run(esbuild_cmd() + [
            str(entry), "--bundle", *ESBUILD_ARGS, f"--define:SUPPORT_FINS_VERSION={json.dumps(v)}",
            f"--outfile={out}", "--log-level=warning",
        ], check=True)
    finally:
        entry.unlink(missing_ok=True)
    return out, v


if __name__ == "__main__":
    out, v = build()
    print(f"built {out.relative_to(ROOT)} {v} ({out.stat().st_size / 1024:.0f} KB)")
