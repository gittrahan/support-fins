# Support Fins — FreeCAD add-on

printfins.com's breakaway support fins as a **parametric** object in FreeCAD: select a
part, **Add Support Fins**, and a `… fins` mesh appears under it. Change the part (a Pad
length, a fillet, its tilt) and the fins recompute to the new shape.

Same engine as the site and every plugin: the part is tessellated exactly the way the
site tessellates a STEP (OpenCascade, 0.01 mm / 0.1 rad), then `computeFins` runs in V8
(vendored mini-racer) through the shared host, `plugins/shared/py/supportfins_host.py`.
No fin geometry lives in the add-on.

## Use

- Select a part (a Part solid, a PartDesign Body or any feature in it, an App::Link, or a
  mesh), then
  **Support Fins ▸ Add Support Fins** (toolbar, or the Tools menu) in any workbench.
- **Bed** = the document's XY plane at the part's lowest point: the part prints the way it
  sits in the model, z up. Tilt it with its Placement (or the Body's) to change the pose.
  Moving a group the part sits in (an App::Part) moves the fins too.
- **Settings** are the fins object's properties, the site's settings with the site's
  defaults (generated from `plugins/shared/engine/options.json`). Ones the engine would
  ignore are hidden, as on the site; numbers are held to the engine's range. **Report** says what was placed and what wasn't
  reached; it's also printed to the Report view.
- **Auto update** (on) recomputes with the part. Turn it off on a big part to keep editing
  snappy: the fins keep their last result, the Report says they're out of date, and
  **Update Support Fins** recomputes them (the selected ones, or all).
- Export the part and its fins together (select both, File ▸ Export, .stl or .3mf).

Output is a mesh. Converting to a solid for STEP export comes later (local issue 016).

## Install (for now, until the Addon Manager listing)

```
python3 plugins/freecad/build.py --install ~/Library/Application\ Support/FreeCAD   # macOS
```

then restart FreeCAD. `--install` takes FreeCAD's user data folder (Help ▸ About shows it).
The build vendors mini-racer for **this machine's** platform (FreeCAD 1.0 on macOS has no
V8 or Qt WebEngine of its own, so this is the only runner).

## Code

- `SupportFins/supportfins_freecad.py` — the `SupportFins` object (`Mesh::FeaturePython`):
  tessellate the source, call the shared host, set the mesh and report.
- `SupportFins/supportfins_props.py` — options.json ⇄ properties. No FreeCAD imports.
- `SupportFins/InitGui.py` — the two commands, a global "Support Fins" toolbar (made once;
  delete it in Tools ▸ Customize and it stays deleted) and Tools-menu entries.
- `build.py` — the add-on folder: add-on + shared host + options.json + engine bundle +
  vendored mini-racer.

## Tests

```
python3 -m pytest -q plugins/freecad/tests/test_props.py          # anywhere; CI runs it
python3 plugins/freecad/build.py && \
  /Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd plugins/freecad/tests/smoke.py
cat plugins/freecad/build/smoke.json                              # last line: PASS / FAIL
```

`smoke.py` runs the real FreeCAD headless (35 checks: fins under the part on its lowest
point; following a length change, a tilt, a PartDesign feature and a moved App::Part;
Auto update off/Update; STEP parity with the site, asked live from `site_step.js` via deno;
Mesh, placed App::Part and App::Link sources; fins dropped into a placed group; settings
reaching the engine, hidden when ignored, clamped to its range; errors in the Report;
export of part + fins; save and reopen).
