# Support Fins — command line

printfins.com from a terminal: fin one part or a whole folder, then open the results in
any slicer. It's the answer for Bambu Studio, which has no plugin API: run the parts
through this, open the 3MFs in Bambu.

Same engine as the site and every plugin (`plugins/shared/engine/computeFins`), and the
same settings: the flags are generated from `plugins/shared/engine/options.json`.

```
support-fins part.stl                          # -> part-fins.3mf next to it (part + fins)
support-fins part.stl --rot 0,35,0             # pose it first: the site's X · Y · Z readout
support-fins *.stl --gap 0.3 --coverage 70        # PETG: a wider Support gap
support-fins roof.stl --mode full              # Full coverage: walls under every overhang Auto leaves bare
support-fins part.stl -o out.stl               # one STL with part + fins merged
support-fins part.stl --fins-only              # part-fins-only.stl, lines up with part.stl
support-fins plate.3mf --object 2              # a 3MF with several objects: pick one
support-fins part.stl --json                   # one JSON line per file (stats + summary)
support-fins --help                            # every setting, with the site's defaults
```

**Rotation.** The part is finned the way it sits in the file (z up), unless `--rot`
turns it. `--rot` takes the numbers printfins.com shows under the part ("X 35° · Y 0° ·
Z 0°" is `--rot 35,0,0`), in the same order (three.js Euler XYZ), so a pose found on
the site carries over. The output is posed, centred over the origin, and seated on
z = 0, as the site exports it. `--fins-only` instead lines the fins up with the part as
it is in your file, so it can't take `--rot`.

A Support Fins 3MF (the site's or this tool's) is refused as input: it already has fins.
Settings the site would hide (`--sway-reach` without `--sway`) run but warn.

**Settings** are the site's, in the site's units: percent sliders take 0-100
(`--coverage 70`, `--tine-density 50`), on/off settings are `--sway` / `--no-tines`.

**What it tells you.** One line per file: walls, tines, and anything left unsupported
(overhangs too shallow for a fin this way up, pieces that start in mid-air). That is a
report, not a failure: exit 0. Exit 1 = a file couldn't be read or finned (the other
files still are); exit 2 = bad arguments, nothing ran.

## Running it

The download (printfins.com ▸ Plugins, or `support-fins.mjs` on the `plugins-latest`
release) is the whole tool in one file:

```
deno run -RW support-fins.mjs part.stl                 # Deno 2
node support-fins.mjs part.stl                         # Node 20.10+
```

From a checkout (`python3 plugins/cli/build.py` makes that file):

```
deno run -RW plugins/cli/support-fins.js part.stl      # Deno 2
node plugins/cli/support-fins.js part.stl              # Node 20.10+
```

Single-file binary (no Deno or Node needed to run it, ~70 MB):

```
deno compile -RW --include plugins/shared/engine/options.json \
  -o support-fins plugins/cli/support-fins.js
```

For an AI client (Claude Code, Claude Desktop), the same tool is an MCP server:
[`plugins/mcp/`](../mcp/README.md).

## Keeping a Bambu Studio project

Use `--preserve-project` on a Bambu Studio/MakerWorld project to keep its original
painted meshes, filament/printer/process settings, object positions and plates:

```sh
support-fins project.3mf --preserve-project
# -> project-fins-project.3mf, all printable objects on all plates

support-fins project.3mf --preserve-project --list-objects
support-fins project.3mf --preserve-project --object 2 --object 7 -o selected-fins.3mf
support-fins project.3mf --preserve-project --fin-extruder 2 --disable-native-supports
```

Generated fins are grouped into one support part per model; models needing no
fins get no empty part. Unselected and nonprintable objects remain in the output.
`--list-objects` lists the original build-item
numbers, names, resource IDs and plate IDs without generating anything; use its
numbers with `--object`, or a unique object name. Build-item numbers are not 3MF
resource IDs. Several `--object` flags select several objects.

The regular layer height comes from the project's `layer_height`, with object and
part overrides considered. The first-layer height is a different setting.
Missing, conflicting or variable layer heights require an explicit
`--layer-height` for fin generation; this does not change the project's slicing
settings. Fins inherit the object's base filament, or an unambiguous part
assignment. `--fin-extruder N` selects an existing 1-based filament slot; the
original palette and model assignments stay intact.

Native slicer supports are preserved, and the CLI reports when they remain
enabled: both native supports and fins may print. `--disable-native-supports`
sets `enable_support` to false only on selected objects and their part overrides.
The project-wide setting and unselected objects are retained.

**Re-slice the output in Bambu Studio.** Generated toolpaths, slice information
and referenced plate previews are discarded because they describe the old
geometry. User-authored layer-change commands are retained. Original mesh files
and other unchanged members retain their compressed ZIP bytes; only the necessary
manifests/settings and new support resources are written.

This mode preserves the existing pose, so it cannot be combined with `--rot` or
`--fins-only`. The input is protected against path aliases, symbolic links and
hard links. An existing output requires `--overwrite`; the completed project is
published atomically, and a failed object does not leave a partial output.

The initial supported layout is a millimeter Bambu project with component
assemblies referencing external mesh files and explicit plate assignments.
Shared build instances, negative parts (which would also subtract from added
fins), inline-only assemblies, ZIP64 archives and other slicer project formats
are refused with an explanation. Direct output from this mode is refused as
input to avoid adding fins twice. Individually editable fins and resume caching
are not included.

## Code

- `support-fins.js` — the entry: gives `cli.js` a file system (Deno or Node) and an exit code.
- `cli.js` — flags, pose, read STL/3MF, `computeFins`, write. No file system of its own.
- `project.js` — preserve Bambu projects; `project-zip.js` / `project-xml.js` edit
  archive members and manifests, and `project-io.js` protects atomic output.
- `tests/cli.test.js` — `deno test -A plugins/cli/tests/`. Runs in memory: CLI fins equal
  `computeFins` on the posed part, and match the website's own path on lbracket@35.
- The summary line is `plugins/shared/engine/report.js`, word for word with the Python
  hosts' `host_report`.
