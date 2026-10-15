#!/usr/bin/env python3
"""Build the command line as one file, for the download.

  python3 plugins/cli/build.py      # -> plugins/cli/build/support-fins.mjs

support-fins.js imports the engine from web/ and plugins/shared/, so on its own it
only runs inside a checkout. This bundles it (esbuild, as plugins/shared/bundle.py
does for the plugins) into one ES module that runs anywhere:

  deno run -RW support-fins.mjs part.stl
  node support-fins.mjs part.stl            # Node 20.10+
"""
import pathlib
import subprocess
import sys

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


def build(script=HERE / "support-fins.js", out=OUT):
    """Bundle an entry script (the MCP server's too: plugins/mcp/build.py) to one file."""
    out.parent.mkdir(parents=True, exist_ok=True)
    entry = out.parent / "entry.js"
    entry.write_text(ENTRY.format(
        cut=str(ROOT / "web" / "cut.js"),
        wasm=str(ROOT / "web" / "vendor" / "manifold-3d-3.5.4" / "manifold.wasm"),
        cli=str(script)))
    # --platform=node leaves node:fs (the Node branch's dynamic import) external;
    # Deno never reaches it.
    try:
        subprocess.run(esbuild_cmd() + [
            str(entry), "--bundle", "--format=esm", "--platform=node", "--loader:.wasm=binary",
            "--target=es2022", f"--outfile={out}", "--log-level=warning",
        ], check=True)
    finally:
        entry.unlink(missing_ok=True)
    return out


if __name__ == "__main__":
    out = build()
    print(f"built {out.relative_to(ROOT)} ({out.stat().st_size / 1024:.0f} KB)")
