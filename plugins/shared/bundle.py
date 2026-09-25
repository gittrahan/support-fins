#!/usr/bin/env python3
"""Bundle the printfins.com engine for the plugins.

  python3 plugins/shared/bundle.py OUT.js   # -> one minified IIFE, global SupportFinsEngine

Bundles engine/bridge.js (which imports web/*.js, untouched) into one IIFE with
esbuild. Each plugin's own build calls bundle_engine() and packages the result
its own way (Orca inlines it into a single .py).

Needs esbuild: `npx esbuild` (fetched on demand) or ESBUILD=/path/to/esbuild.
"""
import os
import pathlib
import shutil
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
BRIDGE = HERE / "engine" / "bridge.js"
GLOBAL_NAME = "SupportFinsEngine"


def esbuild_cmd():
    if os.environ.get("ESBUILD"):
        return [os.environ["ESBUILD"]]
    if shutil.which("esbuild"):
        return ["esbuild"]
    # shutil.which finds npx.cmd on Windows, where a bare "npx" isn't executable
    return [shutil.which("npx") or "npx", "--yes", "esbuild@0.28"]


def bundle_engine(outfile):
    """Write the engine bundle to `outfile` and return its source."""
    outfile = pathlib.Path(outfile)
    outfile.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(esbuild_cmd() + [
        str(BRIDGE), "--bundle", "--format=iife",
        f"--global-name={GLOBAL_NAME}", "--target=es2022", "--minify",
        f"--outfile={outfile}", "--log-level=warning",
    ], check=True)
    return outfile.read_text(encoding="utf-8")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    js = bundle_engine(sys.argv[1])
    print(f"bundled {sys.argv[1]} ({len(js) / 1024:.0f} KB)")
