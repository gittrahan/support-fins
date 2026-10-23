# Support Fins — MCP server

printfins.com for an AI client: Claude Code, Claude Desktop, or any app that speaks the
[Model Context Protocol](https://modelcontextprotocol.io). Ask it to "fin every STL in
this folder at 35° on Y" and it calls the tools below on the files on your computer.

It is the [command line](../cli/README.md) underneath: a tool call becomes the CLI's
arguments and `cli.js` does the work, so the fins, the file it writes, the checks and
the report are the CLI's, which are the site's (`plugins/shared/engine/computeFins`).

## Tools

| Tool | Writes |
|---|---|
| `fin_part` | the part + fins, posed and seated on the plate as the site exports it: `<part>-fins.3mf` beside the part, or `output` (`.3mf`, or `.stl` for one merged mesh) |
| `fins_only` | the fins alone as an STL, lined up with the part where it is in its file: `<part>-fins-only.stl`. Nothing is written when the part needs no fins |

Both take `path` (an `.stl` or `.3mf`; absolute, or relative to where the server
started -- which for Claude Desktop is `/`, so give absolute paths there; `~/` works), `object` for a 3MF with several objects, and `settings`: every setting the
site has, named as the CLI's flags (`coverage`, `tine-density`, `pad-style`, `sway`, ...)
in the site's units (percent sliders 0-100). The client sees the whole list, with
defaults and ranges, in the tool schema. `fin_part` also takes `rot`: `[x, y, z]`, the
"X · Y · Z" readout under the part on printfins.com.

For Full coverage with separated fill walls, pass
`"settings": {"mode": "full", "separate-walls": "on"}` to either tool. It is `"auto"`
(the default: on with `"tine-dir": "vertical"`, off otherwise, as on the site), `"on"`
or `"off"`. It keeps fill walls from crossing or sharing their bases, but can leave
more overhang unsupported; thin ties between tall walls stay. In Auto placement (`"mode": "auto"`) it has no
effect and returns a warning.

The result is the CLI's report line ("5 walls, 20 tines; 1 overhang is too shallow for a
fin this way up (tilt the part steeper)") plus the numbers behind it. Unsupported
overhangs are reported, not errors. A bad setting or an unreadable file is a tool error
that says why, and nothing is written.

## Install

Download `support-fins-mcp.mjs` from the `plugins-latest` release on GitHub. It is the whole server in one file and needs Node 20.10+ or Deno 2.

Claude Code:

```
claude mcp add support-fins -- node /path/to/support-fins-mcp.mjs
```

Claude Desktop and most other clients (`claude_desktop_config.json`, `.mcp.json`):

```json
{
  "mcpServers": {
    "support-fins": { "command": "node", "args": ["/path/to/support-fins-mcp.mjs"] }
  }
}
```

With Deno instead: `"command": "deno", "args": ["run", "-RWE", "/path/to/support-fins-mcp.mjs"]`.

## CAD tools with their own MCP server

Clients can run several servers at once, so a CAD tool's own MCP server and this one can
work on the same part: export the part to STL, `fins_only` it, import the fins back.
LayerLing's server (self-hosted LayerLing only; layerling.com has it off) imports files
with `layerling_import_file`, which takes the file's bytes, so the fins pass through the
AI client on the way: fine for a small part, impractical for a big one. Not yet tried
end to end. For anything else, open the 3MF from `fin_part` in your slicer.

## Code

- `server.js`: the protocol (JSON-RPC: initialize, tools/list, tools/call, ping) and the
  tools, built from the CLI's flags. No I/O of its own.
- `support-fins-mcp.js`: stdin/stdout + the file system (Deno or Node). stdout carries
  only protocol lines; the engine's own logging goes to stderr.
- `build.py`: the one-file download, `build/support-fins-mcp.mjs` (the CLI's bundler).
- `tests/server.test.js`: `deno test -A plugins/mcp/tests/`. A tool call writes the same
  bytes as the CLI; the schema is the CLI's flags; errors write nothing; and a full
  exchange over real stdio on Deno and on Node.
