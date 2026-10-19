#!/usr/bin/env python3
"""Build the MCP server as one file, for the download.

  python3 plugins/mcp/build.py      # -> plugins/mcp/build/support-fins-mcp.mjs

The same bundle as the command line's (plugins/cli/build.py: esbuild, Manifold's
WASM inside), with the MCP entry in place of the CLI's:

  node support-fins-mcp.mjs                  # Node 20.10+, started by the MCP client
  deno run -RWE support-fins-mcp.mjs         # Deno 2
"""
import importlib.util
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE / "build" / "support-fins-mcp.mjs"

_spec = importlib.util.spec_from_file_location("cli_build", HERE.parent / "cli" / "build.py")
cli_build = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cli_build)

if __name__ == "__main__":
    out, v = cli_build.build(HERE / "support-fins-mcp.js", OUT, folders=(HERE, HERE.parent / "cli"))
    print(f"built {out.relative_to(cli_build.ROOT)} {v} ({out.stat().st_size / 1024:.0f} KB)")
