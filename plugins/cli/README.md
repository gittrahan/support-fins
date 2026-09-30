# Support Fins — command line

printfins.com from a terminal: fin one part or a whole folder, then open the results in
any slicer. It's the answer for Bambu Studio, which has no plugin API: run the parts
through this, open the 3MFs in Bambu.

Same engine as the site and every plugin (`plugins/shared/engine/computeFins`), and the
same settings: the flags are generated from `plugins/shared/engine/options.json`.

```
support-fins part.stl                          # -> part-fins.3mf next to it (part + fins)
support-fins part.stl --rot 0,35,0             # pose it first: degrees about X, then Y, then Z
support-fins *.stl --material petg --coverage 70
support-fins part.stl -o out.stl               # one STL with part + fins merged
support-fins part.stl --fins-only              # part-fins-only.stl, lines up with the part
support-fins plate.3mf --object 2              # a 3MF with several objects: pick one
support-fins part.stl --json                   # one JSON line per file (stats + summary)
support-fins --help                            # every setting, with the site's defaults
```

**Rotation.** The part is finned the way it sits in the file (z up), unless `--rot`
turns it. Pose it in your slicer or CAD tool and export, or give `--rot`. The output
is posed, centred over the origin, and seated on z = 0, as the site exports it.

**Settings** are the site's, in the site's units: percent sliders take 0-100
(`--coverage 70`, `--tine-density 50`), on/off settings are `--sway` / `--no-tines`.

**What it tells you.** One line per file: walls, tines, and anything left unsupported
(overhangs too shallow for a fin this way up, pieces that start in mid-air). That is a
report, not a failure: exit 0. Exit 1 = a file couldn't be read or finned (the other
files still are); exit 2 = bad arguments, nothing ran.

## Running it

```
deno run -RW plugins/cli/support-fins.js part.stl      # Deno 2
node plugins/cli/support-fins.js part.stl              # Node 20+
```

Single-file binary (no Deno or Node needed to run it, ~70 MB):

```
deno compile -RW --include plugins/shared/engine/options.json \
  -o support-fins plugins/cli/support-fins.js
```

## Code

- `support-fins.js` — the entry: gives `cli.js` a file system (Deno or Node) and an exit code.
- `cli.js` — flags, pose, read STL/3MF, `computeFins`, write. No file system of its own.
- `tests/cli.test.js` — `deno test -A plugins/cli/tests/`. Runs in memory: CLI fins equal
  `computeFins` on the posed part, and match the website's own path on lbracket@35.
- The summary line is `plugins/shared/engine/report.js`, word for word with the Python
  hosts' `host_report`.
