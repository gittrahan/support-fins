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

Use `--preserve-project` on a Bambu Studio/MakerWorld project (or one saved by a
Bambu-based slicer with the same layout: OrcaSlicer, QIDI Studio) to keep its original
painted meshes, filament/printer/process settings, object positions and plates:

```sh
support-fins project.3mf --preserve-project
# -> project-fins-project.3mf, all printable objects on all plates

support-fins project.3mf --preserve-project --list-objects
support-fins project.3mf --preserve-project --list-plates
support-fins project.3mf --preserve-project --plate 2 --plate 5
support-fins project.3mf --preserve-project --plate 5 --object 7
support-fins project.3mf --preserve-project --object 2 --object 7 -o selected-fins.3mf
support-fins project.3mf --preserve-project --fin-extruder 2 --disable-native-supports
```

Each model's fins become their own object, `<name> supports`, with the model's pose
and plate, the way the site's 3MF exports them: each keeps its own perimeters, so a
tine only touches the part and breaks away cleanly. The slicer's own supports are off
on that object. Bambu Studio reports "G-code path conflicts" between a model and its
supports object because the tines touch it; that is expected, and the plate still
prints. A project or plate that prints by object instead gets the fins as a part of each
model (they would otherwise print after it), with a warning. Models needing no fins
get nothing. Unselected and nonprintable objects remain in the output.
`--list-objects` shows a plate summary followed by the original build-item
numbers, names, resource IDs and plate IDs. `--list-plates` shows just the summary:
each plate's ID, total object count and printable-object count, including empty
plates. Both commands are read-only and respect `--plate` filters. They list
objects without testing whether their meshes/settings can generate fins;
`--object` does not filter the listings. Choose one listing command at a time.

Use the displayed plate IDs with `--plate`; repeat it to select several plates.
These are the project's IDs, which may have gaps, not positions in the list.
If a plate has no stored ID, its 1-based position is used in both listing and
selection. Repeated IDs are deduplicated and objects retain their project order.
Without `--plate`, the default remains all printable objects across all plates.
For generation, every requested plate must exist and contain a printable object;
otherwise the command fails before generating fins or writing output. Listing an
empty plate is allowed. Counts refer to build items, including repeated instances.

Use the listed build-item numbers with `--object`, or a unique object name.
Build-item numbers are not 3MF resource IDs. Several `--object` flags select several
objects. With `--plate`, each object selector must match within the chosen plates;
numbers remain project-wide and names must be unique within those plates.
For example, `--plate 5 --object 7` selects original object 7 only if it is on
plate 5. Unselected plates and objects keep their geometry, placement and settings
in the full output project; stale slice artifacts are discarded as described below.

With `--json`, both listing commands add a `plates` array such as
`[{"id":"2","objects":3,"printableObjects":2},{"id":"5","objects":0,"printableObjects":0}]`.
`--list-objects` retains its existing `objects` array with original numbers and
identities; `--list-plates` omits that object list. Both return `output: null`.

The regular layer height comes from the project's `layer_height`, with object and
part overrides considered. The first-layer height is a different setting.
Missing, conflicting or variable layer heights (per object) require an explicit
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
Without `--object` (including plate-only selections), a model this mode can't handle
(variable layer heights, a negative part, a shared instance, no plate) is skipped with a warning and left as it
was; the rest get fins. If none of the selected objects can be processed, the
command fails without writing output. A model named with `--object` must work,
or nothing is written.

The initial supported layout is a millimeter Bambu project with component
assemblies referencing external mesh files and explicit plate assignments.
Shared build instances, negative parts (which would also subtract from added
fins), inline-only assemblies, ZIP64 archives and other slicer project formats
are refused with an explanation (in the every-object default, a model with one is skipped). Direct output from this mode is refused as
input to avoid adding fins twice. Individually editable fins are not included.

### Resume an interrupted project run

Enable checkpoints on the **first run**, then repeat the command after an interruption:

```sh
support-fins project.3mf --preserve-project --resume
# Optional: place the cache elsewhere, for example with a read-only source folder.
support-fins project.3mf --preserve-project --resume --cache-dir /path/to/cache -o /path/to/output.3mf
```

`--resume` saves each successfully processed object's fin geometry, including objects
that need no fins. Restarting reuses completed objects; the interrupted object starts
over. The source project is untouched, and output is written only after processing.
Default-mode skipped objects are still reported and left unchanged; they are never
marked complete in the cache. Explicitly selected objects still must all succeed.

The default cache is `<input>.fins-cache` beside the input (for example,
`project.3mf.fins-cache`). `--cache-dir` chooses a parent cache folder that can hold
several projects/runs. The CLI reports the actual run directory and reused objects
on stderr, keeping `--json` stdout machine-readable. Checkpoints are local geometry
data; keep them private like the original model.

Reuse requires identical source-file contents, object selection, processing settings
and runtime code/build. Changing any of those starts a fresh cache, with a message.
Source checkouts include uncommitted runtime-source changes in that check; runtime
upgrades can also invalidate checkpoints. Changing only the output filename, logging
or `--overwrite` does not invalidate them. A damaged checkpoint is reported and its
object recomputed. A checkpoint-write failure stops that file's processing, retaining
earlier checkpoints rather than continuing without recovery.

Completed checkpoints for the run are removed only after the output is successfully
written. An interrupted run or output failure retains them. Incompatible runs and
unfinished temporary writes may remain; delete their reported cache directories
manually when no command is using them. Cleanup never recursively deletes the
`--cache-dir` folder. Concurrent runs can repeat work when a checkpoint is removed
before it is read. Runs without `--resume` neither read nor write checkpoints;
`--cache-dir` requires `--resume`, which cannot be combined with `--list-objects`.

### Check compatibility before generating fins

```sh
support-fins project.3mf --preserve-project --check
support-fins project.3mf --preserve-project --check --object 2 --object 7 --json
# Check with the same overrides you intend to use for generation:
support-fins project.3mf --preserve-project --check --layer-height 0.2 --fin-extruder 2
```

`--check` inspects all printable objects, or the objects selected with `--plate`
and `--object`.
It checks project settings and loads referenced meshes one object at a time using
the same reader as generation. It reports the first blocking reason for each
incompatible object and continues checking the rest, even with explicit selections.
Native-support and print-by-object warnings are informational. Nonprintable and
unselected objects are excluded from the report; `--list-objects` still lists all
build items (within any `--plate` filter) without checking compatibility.

The check reads the input only: no fins, output project or cache are created, and
no output destination is tested. It works even when the default output already
exists. With Deno, a check needs no write permission:

```sh
deno run --allow-read plugins/cli/support-fins.js project.3mf --preserve-project --check
```

Do not combine `--check`
with `--list-objects`, `--list-plates`, `--output` or `--overwrite`; the existing project-mode
restrictions on `--rot` and `--fins-only` also apply.

A compatible result means the current project settings and reader accepted the
object. It does **not** guarantee that generation, output writing, slicing or
printing will succeed, or that all overhangs can receive fins. Checks do not repair
meshes. A problem in a shared manifest can affect several objects. Running a check
is optional; normal generation keeps its existing checks without an additional
full-project scan.

Exit codes:

- `--check`: **0** when all selected objects pass; **1** when any is incompatible,
  no printable objects are selected, or the project cannot be read.
- Generation: **0** when output is written, including runs that skip some objects;
  **1** for failure (including all objects skipped). Explicit selections still
  must all succeed before output is written.
- **2** for invalid command arguments in either mode. For several input files, a
  failed check/file makes the overall exit code 1; other files are still processed.

### Per-object reports

Project checking and generation report every selected object's identity, plate,
status, first blocking `reason` (or `null`), and `warnings` (an array of messages).
The terminal report includes summary counts and whether output was written.

`--json` keeps existing fields, including `objects` for successfully processed
objects during generation, and adds:

- `mode`: `check` or `generate`.
- `outputWritten`: whether this invocation wrote an output project.
- `objectResults`: all selected objects, in build order, with `number`, `id`,
  `name`, `plate`, `status`, `reason` and `warnings`. Compatible check results also
  include the resolved `layerHeight` and `filament`.
- `summary`: `selected` and a count for each status below, including zero counts.

| Status | Meaning |
| --- | --- |
| `compatible` / `incompatible` | Check accepted the object / found a blocking problem. No fins generated. |
| `processed` | Generation completed for this object with support geometry. |
| `no_supports` | Generation completed with no support geometry. This does not prove support is unnecessary. |
| `skipped` | Default-mode generation left an unsupported or failed object unchanged. |
| `failed` | An explicitly selected object failed, aborting generation. |
| `not_processed` | The run aborted before this object's processing completed. |

`processed` and `no_supports` describe computation; always check `outputWritten`
before treating the results as saved. If a later object or the final write fails,
the report retains known outcomes, but no output was written. If the project or
selection cannot be read, object identities may be unavailable and the result list
is empty. Existing files at the output path are not evidence of this run's success.

Completed check reports go to stdout, including incompatible checks with exit 1;
`objects` is empty and `output` is `null`. Successful generation reports also go
to stdout. Fatal errors keep the existing stderr JSON record with `input` and
`error`, now accompanied by the report fields when available. Progress and warnings
remain on stderr, which may contain non-JSON lines. `--list-objects` and ordinary
non-project exports retain their existing report formats. Reasons and warning
messages are descriptive text; use status values and counts for automation.

## Code

- `support-fins.js` — the entry: gives `cli.js` a file system (Deno or Node) and an exit code.
- `cli.js` — flags, pose, read STL/3MF, `computeFins`, write. No file system of its own.
- `project.js` — preserve Bambu projects; `project-zip.js` / `project-xml.js` edit
  archive members and manifests, and `project-io.js` protects atomic output.
- `project-report.js` — selected-object outcomes, counts and terminal formatting.
- `project-cache.js` — optional checksummed per-object checkpoints for project mode.
- `tests/cli.test.js` — `deno test -A plugins/cli/tests/`. Runs in memory: CLI fins equal
  `computeFins` on the posed part, and match the website's own path on lbracket@35.
- The summary line is `plugins/shared/engine/report.js`, word for word with the Python
  hosts' `host_report`.
