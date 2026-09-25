# UI smoke gate: "did the page change?"

The Deno suite and the sweep only cover the engine (`fins.js`, `prop.js`, …).
Nothing else exercises `web/app.js` and `web/ui/`. This covers them: it drives
the real page in headless Chrome through a fixed script of about 50 steps and
dumps everything observable after each step, then diffs that against a base
build.

```sh
prototype/ui-smoke/vs-base.sh                  # vs origin/main, models cone + lbracket (~1.5 min)
prototype/ui-smoke/vs-base.sh <sha>            # vs any commit that has window.__sf.camera
MODELS="cone tshape" prototype/ui-smoke/vs-base.sh
KEEP=/some/dir prototype/ui-smoke/vs-base.sh   # keep the JSON dumps

# one run, to look at or to diff by hand
deno run -A prototype/ui-smoke/ui-smoke.js --model cone --out run.json
deno run -A prototype/ui-smoke/compare.js base.json run.json
```

**The script:** load → rotate X, Y → fins on → remove the nearest fin (hover,
click, Esc, restore, ⌘Z, redo) → PETG → pad Sure hold / Custom / gap / Auto →
tines off/on → sway → diamond cutouts → coverage 80 → Draw: a wall across the
overhang, then Esc, undo, clear, and their undos → Auto with the drawn wall →
"+ Add" on/off → strength arrow up / right / suggest / clear → layer view →
lay a face flat + undo → Suggest orientation, pick #2, collapse → reset →
fins off/on → overhang 55° → custom volume → 6× undo.

**Each step records:** every element with an `id` (text, hidden, disabled,
class, value, select options, the (i) tooltip); the part's quaternion;
triangle count + checksum of the fins, pad and drawn walls; the export geometry;
every visible mesh/line (type, colour, vertex count) and material opacity; the
canvas cursor; and every console error or warning. `s-time` and `fps` are
skipped because they vary run to run. Two runs of the same build are
identical, so any line `compare.js` prints is a real change.

**What it's for:** refactors that must not change behaviour (issue #22). For a
deliberate UI change it lists every place the change shows up, which is useful
for checking that nothing else moved.

**Needs:** Deno and a local Chrome (`CHROME=/path/to/chrome` to override the
macOS default). It serves `web/` and `prototype/stress/models/` itself, so it
needs no dev server and none of the gitignored `dev-models`. It runs one Chrome
at a time, because two in parallel stalled the GPU process.

**Not covered:** gizmo ring drags, file import (it loads through `?stl=`),
the 3MF object picker, STEP import, and export downloads (it checks the export
geometry, not the file bytes). Check those by hand when a change touches them.
