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


def build():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    # --platform=node leaves node:fs (the Node branch's dynamic import) external;
    # Deno never reaches it.
    subprocess.run(esbuild_cmd() + [
        str(HERE / "support-fins.js"), "--bundle", "--format=esm", "--platform=node",
        "--target=es2022", f"--outfile={OUT}", "--log-level=warning",
    ], check=True)
    return OUT


if __name__ == "__main__":
    out = build()
    print(f"built {out.relative_to(ROOT)} ({out.stat().st_size / 1024:.0f} KB)")
